// Minimal Gemini REST client on plain fetch: generateContent with inline audio or a Files API
// reference, resumable upload, file status and delete. The key travels only in the
// x-goog-api-key header to Google, never in a URL.

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com';

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } } | { fileData: { mimeType: string; fileUri: string } };

export interface GenerateRequest {
  model: string;
  systemInstruction: string;
  parts: Part[];
  temperature: number;
  thinkingBudget?: number;
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  finishReason?: string;
  outputTokens?: number;
  thoughtsTokens?: number;
}

/** Told about every generateContent call, like usage_service around retry_with_quota. */
export interface GenerateUsage {
  recordAttempt(apiKey: string, model: string): void;
  recordSuccess(apiKey: string, model: string): void;
  recordFailure(apiKey: string, model: string, error: unknown): void;
}

export interface GeminiFile {
  name: string;
  uri: string;
  mimeType: string;
  state?: string;
}

/** HTTP error from Gemini, with the fields the retry policy classifies on. */
export class GeminiHttpError extends Error {
  readonly status: number;
  readonly apiStatus: string;
  readonly apiMessage: string;
  readonly retryAfterSec: number | null;
  readonly rawBody: string;

  constructor(status: number, apiStatus: string, apiMessage: string, retryAfterSec: number | null, rawBody: string) {
    super(`${status} ${apiStatus}. ${apiMessage}`.trim());
    this.name = 'GeminiHttpError';
    this.status = status;
    this.apiStatus = apiStatus;
    this.apiMessage = apiMessage;
    this.retryAfterSec = retryAfterSec;
    this.rawBody = rawBody;
  }
}

/** Transport failure before any HTTP status: offline, DNS, reset, or Safari killing a request of a hidden page. */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function call(url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (error instanceof Error && error.name === 'TimeoutError') throw new NetworkError(`timeout: ${error.message}`);
    throw new NetworkError(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  }
  if (response.ok) return response;
  const body = await response.text().catch(() => '');
  let apiStatus = '';
  let apiMessage = body.slice(0, 2000);
  let retryAfter: number | null = null;
  try {
    const parsed = JSON.parse(body) as { error?: { status?: string; message?: string; details?: Array<Record<string, unknown>> } };
    apiStatus = parsed.error?.status ?? '';
    apiMessage = parsed.error?.message ?? apiMessage;
    for (const detail of parsed.error?.details ?? []) {
      const delay = detail.retryDelay;
      if (typeof delay === 'string' && /^\d+(\.\d+)?s$/.test(delay)) retryAfter = parseFloat(delay);
    }
  } catch {
    // Not JSON: keep the raw text.
  }
  const header = response.headers.get('retry-after');
  if (header && !Number.isNaN(Number(header))) retryAfter = Number(header);
  throw new GeminiHttpError(response.status, apiStatus, apiMessage, retryAfter, body.slice(0, 4000));
}

export class GeminiClient {
  private readonly apiKey: string;
  private readonly base: string;
  private readonly usage?: GenerateUsage;

  constructor(apiKey: string, base = GEMINI_BASE, usage?: GenerateUsage) {
    this.apiKey = apiKey;
    this.base = base;
    this.usage = usage;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { 'x-goog-api-key': this.apiKey, ...extra };
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    this.usage?.recordAttempt(this.apiKey, request.model);
    try {
      const result = await this.generateOnce(request);
      this.usage?.recordSuccess(this.apiKey, request.model);
      return result;
    } catch (error) {
      if (!isAbortError(error)) this.usage?.recordFailure(this.apiKey, request.model, error);
      throw error;
    }
  }

  /** models.get: free metadata read the desktop uses to check a key ("Verifica connessione"). */
  async getModel(model: string, signal?: AbortSignal): Promise<void> {
    await call(`${this.base}/v1beta/models/${encodeURIComponent(model)}`, { headers: this.headers(), signal });
  }

  private async generateOnce(request: GenerateRequest): Promise<GenerateResult> {
    const generationConfig: Record<string, unknown> = { temperature: request.temperature };
    if (request.thinkingBudget !== undefined) generationConfig.thinkingConfig = { thinkingBudget: request.thinkingBudget };
    const response = await call(`${this.base}/v1beta/models/${encodeURIComponent(request.model)}:generateContent`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.systemInstruction }] },
        contents: [{ role: 'user', parts: request.parts }],
        generationConfig,
      }),
      signal: request.signal,
    });
    const json = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
      usageMetadata?: { candidatesTokenCount?: number; thoughtsTokenCount?: number };
      promptFeedback?: { blockReason?: string };
    };
    const candidate = json.candidates?.[0];
    // Like the SDK's response.text: the non-thought text parts of the first candidate.
    const text = (candidate?.content?.parts ?? [])
      .filter(part => typeof part.text === 'string' && !part.thought)
      .map(part => part.text)
      .join('')
      .trim();
    return {
      text,
      finishReason: candidate?.finishReason ?? json.promptFeedback?.blockReason,
      outputTokens: json.usageMetadata?.candidatesTokenCount,
      thoughtsTokens: json.usageMetadata?.thoughtsTokenCount,
    };
  }

  /** Resumable upload in one request; returns the file resource. */
  async uploadFile(blob: Blob, mimeType: string, displayName: string, signal?: AbortSignal): Promise<GeminiFile> {
    const start = await call(`${this.base}/upload/v1beta/files`, {
      method: 'POST',
      headers: this.headers({
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(blob.size),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ file: { displayName } }),
      signal,
    });
    const uploadUrl = start.headers.get('x-goog-upload-url');
    if (!uploadUrl) throw new NetworkError('upload: x-goog-upload-url assente nella risposta');
    const response = await call(uploadUrl, {
      method: 'POST',
      headers: { 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' },
      body: blob,
      signal,
    });
    return ((await response.json()) as { file: GeminiFile }).file;
  }

  async getFile(name: string, signal?: AbortSignal): Promise<GeminiFile> {
    const response = await call(`${this.base}/v1beta/${name}`, { headers: this.headers(), signal });
    return (await response.json()) as GeminiFile;
  }

  async deleteFile(name: string): Promise<void> {
    await call(`${this.base}/v1beta/${name}`, { method: 'DELETE', headers: this.headers() });
  }
}

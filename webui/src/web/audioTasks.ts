import { chunkAudio, type Chunk } from './chunker';
import { OPUS_MIME, canEncodeOpus, encodeOpus } from './chunker/opus';
import type { CutResult, PreparedAudio } from './pipeline/run';

// The audio side of the pipeline, run inside audioWorker.ts: cut the file once, then prepare one
// chunk at a time (Opus when WebCodecs can encode it, else the cut chunk for the Files API).

export type AudioRequest =
  | { id: number; type: 'cut'; file: Blob; chunkSec: number; stepSec: number }
  | { id: number; type: 'prepare'; index: number }
  | { id: number; type: 'base64'; blob: Blob };

export type AudioReply =
  | { id: number; type: 'cut'; result: CutResult }
  | { id: number; type: 'prepare'; result: PreparedAudio }
  | { id: number; type: 'base64'; result: string }
  | { id: number; type: 'error'; message: string };

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function createAudioTasks(encoder: { canEncode: () => Promise<boolean>; encode: typeof encodeOpus } = { canEncode: canEncodeOpus, encode: encodeOpus }) {
  let chunks: Array<Chunk | undefined> = [];
  let opus: Promise<boolean> | null = null;

  async function handle(request: AudioRequest): Promise<AudioReply> {
    try {
      if (request.type === 'cut') {
        opus ??= encoder.canEncode();
        const { info, chunks: cut, totalMs } = await chunkAudio(request.file, { chunkSec: request.chunkSec, stepSec: request.stepSec });
        chunks = cut;
        const description = `${info.format === 'mp3' ? 'MP3' : 'M4A'} ${info.sampleRate} Hz ${info.channels === 1 ? 'mono' : 'stereo'} ~${info.bitrateKbps} kbps`;
        return {
          id: request.id,
          type: 'cut',
          result: { plan: cut.map(chunk => ({ index: chunk.index, startSec: chunk.startSec, durationSec: chunk.durationSec })), durationSec: info.durationSec, cutMs: totalMs, description },
        };
      }
      if (request.type === 'prepare') {
        const chunk = chunks[request.index];
        if (!chunk) throw new Error(`blocco ${request.index + 1} non disponibile`);
        // The page keeps the prepared audio until its request succeeds; the cut chunk can go.
        chunks[request.index] = undefined;
        if (!(await (opus ??= encoder.canEncode()))) {
          return { id: request.id, type: 'prepare', result: { blob: chunk.blob, mimeType: chunk.mimeType, codec: 'original', encodeMs: 0, note: 'questo browser non codifica Opus, carico il file originale' } };
        }
        const encoded = await encoder.encode(chunk.blob);
        if ('error' in encoded) {
          return { id: request.id, type: 'prepare', result: { blob: chunk.blob, mimeType: chunk.mimeType, codec: 'original', encodeMs: 0, note: `codifica Opus non riuscita (${encoded.error}), carico il file originale` } };
        }
        return { id: request.id, type: 'prepare', result: { blob: encoded.blob, mimeType: OPUS_MIME, codec: 'opus', encodeMs: encoded.ms } };
      }
      return { id: request.id, type: 'base64', result: await blobToBase64(request.blob) };
    } catch (error) {
      return { id: request.id, type: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  }

  return { handle };
}

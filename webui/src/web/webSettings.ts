import type { ModelOption } from '../bridge';
import { PROFILE_MODEL_OPTIONS } from '../generationProfile';
import { STORAGE_KEYS } from '../storageKeys';
import { DEFAULT_MODEL } from '../utils';
import { hashKey } from './apiUsage';

// Same list as the desktop registry: both read el_sbobinator/generation_profile.json.
export const WEB_MODEL_OPTIONS: ModelOption[] = PROFILE_MODEL_OPTIONS.map(option => ({
  id: option.id,
  label: option.label,
  summary: option.summary,
  default_chunk_minutes: option.default_chunk_minutes,
  phase1_temperature: option.phase1_temperature,
  ...(option.is_default ? { is_default: true } : {}),
}));

// One key per line; blank lines and repeats are dropped, order is kept (the first key is the main one).
export function parseKeyLines(text: string): string[] {
  const keys: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const key = line.trim();
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

function read(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string): boolean {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

// The spike (el-sbobinator-web.pages.dev) kept its keys here, one per line.
export const SPIKE_KEYS_STORAGE_KEY = 'sbob-gemini-key';

/** Takes over the spike's keys once, if this app has none, and removes the spike's copy. */
export function adoptSpikeKeys(): void {
  const spike = read(SPIKE_KEYS_STORAGE_KEY);
  if (!spike) return;
  if (!loadWebKeys().length && !saveWebKeys(parseKeyLines(spike))) return;
  write(SPIKE_KEYS_STORAGE_KEY, '');
}

export function loadWebKeys(): string[] {
  return parseKeyLines(read(STORAGE_KEYS.WEB_GEMINI_KEYS_V1));
}

export function saveWebKeys(keys: string[]): boolean {
  return write(STORAGE_KEYS.WEB_GEMINI_KEYS_V1, parseKeyLines(keys.join('\n')).join('\n'));
}

export function loadWebModel(): string {
  const model = read(STORAGE_KEYS.WEB_MODEL_V1);
  return WEB_MODEL_OPTIONS.some(option => option.id === model) ? model : DEFAULT_MODEL;
}

export function saveWebModel(model: string): boolean {
  return write(STORAGE_KEYS.WEB_MODEL_V1, WEB_MODEL_OPTIONS.some(option => option.id === model) ? model : DEFAULT_MODEL);
}

// Models the main key answered "not found" for (Google gives older models only to older projects).
// Tied to that key: with another main key the list starts empty, since its project may have them.
interface UnavailableModels {
  key: string;
  models: string[];
}

function readUnavailable(): UnavailableModels | null {
  try {
    const parsed = JSON.parse(read(STORAGE_KEYS.WEB_UNAVAILABLE_MODELS_V1) || 'null') as UnavailableModels | null;
    return parsed && typeof parsed.key === 'string' && Array.isArray(parsed.models) ? parsed : null;
  } catch {
    return null;
  }
}

export function loadUnavailableModels(mainKey: string): string[] {
  const stored = readUnavailable();
  return mainKey && stored?.key === hashKey(mainKey) ? stored.models.filter(model => typeof model === 'string') : [];
}

export function rememberUnavailableModel(mainKey: string, model: string): void {
  if (!mainKey) return;
  const models = loadUnavailableModels(mainKey);
  if (models.includes(model)) return;
  write(STORAGE_KEYS.WEB_UNAVAILABLE_MODELS_V1, JSON.stringify({ key: hashKey(mainKey), models: [...models, model] }));
}

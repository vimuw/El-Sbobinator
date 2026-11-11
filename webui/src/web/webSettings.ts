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

function knownModel(model: string): string {
  return WEB_MODEL_OPTIONS.some(option => option.id === model) ? model : DEFAULT_MODEL;
}

// The previous default. Setup and Settings always save the model, so a v1 value of 3.6 Flash
// is usually the old default rather than a choice: it moves to 2.5 Flash once (web build only).
const PREVIOUS_DEFAULT_MODEL = 'gemini-3.6-flash';

// Once per browser: the v1 value moves to v2 and v1 goes, so a later hand-picked 3.6 Flash stays.
// A main key already known to lack the default keeps 3.6 Flash (it would only be switched back).
function migrateWebModelV1(): string {
  const legacy = read(STORAGE_KEYS.WEB_MODEL_V1);
  if (!legacy) return '';
  const lacksDefault = loadUnavailableModels(loadWebKeys()[0] ?? '').includes(DEFAULT_MODEL);
  const model = knownModel(legacy === PREVIOUS_DEFAULT_MODEL && !lacksDefault ? DEFAULT_MODEL : legacy);
  if (write(STORAGE_KEYS.WEB_MODEL_V2, model)) write(STORAGE_KEYS.WEB_MODEL_V1, '');
  return model;
}

export function loadWebModel(): string {
  return knownModel(read(STORAGE_KEYS.WEB_MODEL_V2) || migrateWebModelV1());
}

export function saveWebModel(model: string): boolean {
  const saved = write(STORAGE_KEYS.WEB_MODEL_V2, knownModel(model));
  // A choice made before any read retires v1 too, so it can never be migrated later.
  if (saved) write(STORAGE_KEYS.WEB_MODEL_V1, '');
  return saved;
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

import type { ModelOption } from '../bridge';
import { PROFILE_MODEL_OPTIONS, sanitizeModelName } from '../generationProfile';
import { STORAGE_KEYS } from '../storageKeys';

// The models listed in src/profiles/generation_profile.json.
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

// A saved model Google retired (2.5 Flash) or renamed resolves to its successor (legacy_aliases),
// anything else unknown to the default.
function knownModel(model: string): string {
  return sanitizeModelName(model);
}

// Once per browser: the v1 value moves to v2 and v1 goes.
function migrateWebModelV1(): string {
  const legacy = read(STORAGE_KEYS.WEB_MODEL_V1);
  if (!legacy) return '';
  const model = knownModel(legacy);
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

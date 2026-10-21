import type { ModelOption } from '../bridge';
import { STORAGE_KEYS } from '../storageKeys';
import { DEFAULT_MODEL } from '../utils';

// Same list as el_sbobinator/core/model_registry.py (MODEL_OPTIONS); webSettings.test.ts pins the ids.
export const WEB_MODEL_OPTIONS: ModelOption[] = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', summary: '', default_chunk_minutes: 15, phase1_temperature: 0.35 },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', summary: '', default_chunk_minutes: 15, phase1_temperature: 0.35, is_default: true },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', summary: '', default_chunk_minutes: 15, phase1_temperature: 0.35 },
];

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

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../storageKeys';
import {
  SPIKE_KEYS_STORAGE_KEY,
  WEB_MODEL_OPTIONS,
  adoptSpikeKeys,
  loadUnavailableModels,
  loadWebKeys,
  loadWebModel,
  parseKeyLines,
  rememberUnavailableModel,
  saveWebModel,
} from './webSettings';

function stubStorage(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  return values;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('web settings', () => {
  it('parses one key per line, dropping blanks and repeats', () => {
    expect(parseKeyLines(' a \r\n\nb\na\n')).toEqual(['a', 'b']);
  });

  it('offers the same models as the desktop registry', () => {
    // model_registry.py builds MODEL_OPTIONS from this file.
    const profile = JSON.parse(readFileSync(new URL('../../../el_sbobinator/generation_profile.json', import.meta.url), 'utf8')) as {
      models: { default: string; options: Array<{ id: string }> };
    };
    expect(WEB_MODEL_OPTIONS.map(option => option.id)).toEqual(profile.models.options.map(option => option.id));
    expect(WEB_MODEL_OPTIONS.filter(option => option.is_default).map(option => option.id)).toEqual([profile.models.default]);
  });

  it("takes over the spike's keys once on the same origin", () => {
    const values = stubStorage({ [SPIKE_KEYS_STORAGE_KEY]: 'AIzaSySpikeOne1234567890123\nAIzaSySpikeTwo1234567890123\n' });
    adoptSpikeKeys();
    expect(loadWebKeys()).toEqual(['AIzaSySpikeOne1234567890123', 'AIzaSySpikeTwo1234567890123']);
    // The spike's copy goes: a key removed later in the app must not come back.
    expect(values.has(SPIKE_KEYS_STORAGE_KEY)).toBe(false);
  });

  it('keeps the keys already saved in the app and drops the spike copy', () => {
    const values = stubStorage({ [STORAGE_KEYS.WEB_GEMINI_KEYS_V1]: 'AIzaSyAppKey12345678901234', [SPIKE_KEYS_STORAGE_KEY]: 'AIzaSySpikeOne1234567890123' });
    adoptSpikeKeys();
    expect(loadWebKeys()).toEqual(['AIzaSyAppKey12345678901234']);
    expect(values.has(SPIKE_KEYS_STORAGE_KEY)).toBe(false);
  });

  it('remembers a missing model for the main key only, never storing the key', () => {
    const values = stubStorage({});
    const key = 'AIzaSyMainKey1234567890123';
    rememberUnavailableModel(key, 'gemini-2.5-flash');
    rememberUnavailableModel(key, 'gemini-2.5-flash');

    expect(loadUnavailableModels(key)).toEqual(['gemini-2.5-flash']);
    expect(values.get(STORAGE_KEYS.WEB_UNAVAILABLE_MODELS_V1)).not.toContain(key);
    // A new main key may belong to a project that has the model.
    expect(loadUnavailableModels('AIzaSyOtherKey123456789012')).toEqual([]);
    expect(loadUnavailableModels('')).toEqual([]);
  });

  it('gives a fresh browser the default model', () => {
    stubStorage({});
    expect(loadWebModel()).toBe('gemini-2.5-flash');
  });

  it('moves a 3.6 Flash saved as the old default to 2.5 Flash once', () => {
    stubStorage({ [STORAGE_KEYS.WEB_MODEL_V1]: 'gemini-3.6-flash' });
    expect(loadWebModel()).toBe('gemini-2.5-flash');
    expect(loadWebModel()).toBe('gemini-2.5-flash');

    // Picked again by hand after the move: the migration never runs twice.
    expect(saveWebModel('gemini-3.6-flash')).toBe(true);
    expect(loadWebModel()).toBe('gemini-3.6-flash');
    expect(loadWebModel()).toBe('gemini-3.6-flash');
  });

  it('keeps a model chosen before the first read', () => {
    stubStorage({ [STORAGE_KEYS.WEB_MODEL_V1]: 'gemini-3.6-flash' });
    saveWebModel('gemini-3.6-flash');
    expect(loadWebModel()).toBe('gemini-3.6-flash');
  });

  it('leaves other saved models where they are', () => {
    stubStorage({ [STORAGE_KEYS.WEB_MODEL_V1]: 'gemini-3.8-flash' });
    expect(loadWebModel()).toBe('gemini-3.8-flash');
    expect(loadWebModel()).toBe('gemini-3.8-flash');
  });

  it('keeps 3.6 Flash for a main key already known to lack 2.5 Flash', () => {
    const key = 'AIzaSyMainKey1234567890123';
    stubStorage({ [STORAGE_KEYS.WEB_GEMINI_KEYS_V1]: key, [STORAGE_KEYS.WEB_MODEL_V1]: 'gemini-3.6-flash' });
    rememberUnavailableModel(key, 'gemini-2.5-flash');
    expect(loadWebModel()).toBe('gemini-3.6-flash');
  });

  it('ignores a damaged unavailable-models entry', () => {
    stubStorage({ [STORAGE_KEYS.WEB_UNAVAILABLE_MODELS_V1]: '{broken' });
    expect(loadUnavailableModels('AIzaSyMainKey1234567890123')).toEqual([]);
  });
});

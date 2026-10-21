import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WEB_MODEL_OPTIONS, parseKeyLines } from './webSettings';

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
});

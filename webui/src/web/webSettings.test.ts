import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WEB_MODEL_OPTIONS, parseKeyLines } from './webSettings';

describe('web settings', () => {
  it('parses one key per line, dropping blanks and repeats', () => {
    expect(parseKeyLines(' a \r\n\nb\na\n')).toEqual(['a', 'b']);
  });

  it('offers the same models as the desktop registry', () => {
    const registry = readFileSync(new URL('../../../el_sbobinator/core/model_registry.py', import.meta.url), 'utf8');
    const supported = /SUPPORTED_MODELS[^=]*=\s*\(([^)]*)\)/.exec(registry)![1].match(/"([^"]+)"/g)!.map(id => id.replace(/"/g, ''));
    expect(WEB_MODEL_OPTIONS.map(option => option.id)).toEqual(supported);
    const defaultModel = /^DEFAULT_MODEL = "([^"]+)"/m.exec(registry)![1];
    expect(WEB_MODEL_OPTIONS.find(option => option.is_default)?.id).toBe(defaultModel);
  });
});

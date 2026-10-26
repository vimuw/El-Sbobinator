import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PROFILE_DEFAULT_MODEL,
  PROFILE_MODEL_OPTIONS,
  PROMPT_REVISIONE,
  PROMPT_SISTEMA,
  buildChunkPrompt,
  profileModel,
  sanitizeModelName,
} from './generationProfile';
import { DEFAULT_MODEL } from './utils';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

// tests/core/test_generation_profile.py pins the same values on the Python side.
describe('generation profile', () => {
  it('sends the same prompts as the desktop pipeline', () => {
    expect(PROMPT_SISTEMA).toHaveLength(3102);
    expect(sha256(PROMPT_SISTEMA)).toBe('7dcacaaecd75f97bdf68e5e846d297950cc9e816650be161a3b6392364ce20c4');
    expect(PROMPT_REVISIONE).toHaveLength(1345);
    expect(sha256(PROMPT_REVISIONE)).toBe('70fd33bef767a23a02cc58b48235b2606e13bb405cd687edbe9db70016ce3f78');
  });

  it('builds the chunk prompt like generation_service.build_chunk_prompt', () => {
    const base = 'Trascrivi TUTTO il contenuto di questo blocco audio seguendo rigorosamente le istruzioni di sistema. '
      + 'Non omettere nessun concetto, esempio, cifra o termine tecnico. '
      + "Non riassumere: la lunghezza dell'output deve essere proporzionale a quella dell'audio. "
      + 'Ogni paragrafo generato deve essere unico: non ripetere mai lo stesso paragrafo o frase.';
    // `$&` and braces must reach the prompt as written, not as replacement patterns.
    const tail = 'coda {x} "citata" $& fine';
    expect(buildChunkPrompt('')).toBe(base);
    expect(buildChunkPrompt(tail)).toBe(
      base
      + "\n\nATTENZIONE: Stai continuando una stesura. Questo è l'ultimo paragrafo che hai generato nel blocco precedente:\n"
      + `"...${tail}"\n\n`
      + 'Riprendi il discorso da qui IN MODO FLUIDO. Usa la stessa grandezza per i titoli. '
      + "Se all'inizio di questo blocco c'è sovrapposizione, NON ripetere testualmente le frasi già dette, "
      + 'ma se compare anche solo un dettaglio nuovo includilo.',
    );
  });

  it('keeps the model defaults of the desktop registry', () => {
    expect(PROFILE_MODEL_OPTIONS.map(option => option.id)).toEqual(['gemini-2.5-flash', 'gemini-3.6-flash', 'gemini-3.8-flash']);
    expect(PROFILE_DEFAULT_MODEL).toBe('gemini-3.6-flash');
    expect(DEFAULT_MODEL).toBe(PROFILE_DEFAULT_MODEL);
    expect(profileModel('gemini-2.5-flash').phase1_thinking_budget).toBe(16384);
    expect(profileModel('gemini-3.8-flash').phase1_thinking_budget).toBeUndefined();
    for (const option of PROFILE_MODEL_OPTIONS) {
      expect(option.default_chunk_minutes).toBe(15);
      expect(option.default_macro_char_limit).toBe(22000);
      expect(option.phase1_temperature).toBe(0.35);
    }
    expect(sanitizeModelName('gemini-3.7-flash')).toBe('gemini-3.8-flash');
    expect(sanitizeModelName(' gemini-2.5-flash ')).toBe('gemini-2.5-flash');
    expect(sanitizeModelName('gemini-1.5-pro')).toBe(PROFILE_DEFAULT_MODEL);
  });

  it('is the file Python loads', () => {
    const python = readFileSync(new URL('../../el_sbobinator/core/generation_profile.py', import.meta.url), 'utf8');
    expect(python).toContain('"generation_profile.json"');
  });
});

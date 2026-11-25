import { createHash } from 'node:crypto';
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

// The same values the desktop app (branch desktop-2.7) pinned on the Python side.
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
    // 2.5 Flash left on 2026-12-01 (Google routes it to a Lite model): 3.6 Flash is the default.
    expect(PROFILE_MODEL_OPTIONS.map(option => option.id)).toEqual(['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-4-hydrogen']);
    expect(PROFILE_DEFAULT_MODEL).toBe('gemini-3.6-flash');
    expect(DEFAULT_MODEL).toBe(PROFILE_DEFAULT_MODEL);
    expect(PROFILE_MODEL_OPTIONS.filter(option => option.is_default).map(option => option.id)).toEqual(['gemini-3.6-flash']);
    // Every model keeps its own thinking: no budget is sent.
    expect(PROFILE_MODEL_OPTIONS.filter(option => option.phase1_thinking_budget !== undefined)).toEqual([]);
    expect(profileModel('gemini-4-hydrogen').label).toBe('Gemini 4 Hydrogen');
    // The slower models say so in Settings.
    expect(Object.fromEntries(PROFILE_MODEL_OPTIONS.map(option => [option.id, option.summary]))).toEqual({
      'gemini-3.6-flash': '',
      'gemini-3.8-flash': 'Più lento',
      'gemini-4-hydrogen': 'Più lento',
    });
    for (const option of PROFILE_MODEL_OPTIONS) {
      expect(option.default_chunk_minutes).toBe(15);
      expect(option.default_macro_char_limit).toBe(22000);
      expect(option.phase1_temperature).toBe(0.35);
    }
    expect(sanitizeModelName('gemini-3.7-flash')).toBe('gemini-3.8-flash');
    expect(sanitizeModelName(' gemini-3.6-flash ')).toBe('gemini-3.6-flash');
    // Saved settings and paused sessions with the retired 2.5 Flash go on with 3.6 Flash.
    expect(sanitizeModelName('gemini-2.5-flash')).toBe('gemini-3.6-flash');
    expect(sanitizeModelName('gemini-1.5-pro')).toBe(PROFILE_DEFAULT_MODEL);
  });
});

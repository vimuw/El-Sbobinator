import profile from '../../el_sbobinator/generation_profile.json';

// Prompts and model defaults, read from the same file as the desktop pipeline
// (el_sbobinator/core/generation_profile.py). The browser pipeline sends exactly these texts.

export interface ProfileModelOption {
  id: string;
  label: string;
  summary: string;
  default_chunk_minutes: number;
  default_macro_char_limit: number;
  phase1_temperature: number;
  phase1_thinking_budget?: number;
  is_default?: boolean;
}

export const PROMPT_SISTEMA: string = profile.prompts.system;
export const PROMPT_REVISIONE: string = profile.prompts.revision;

export const PROFILE_MODEL_OPTIONS: readonly ProfileModelOption[] = profile.models.options;
export const PROFILE_DEFAULT_MODEL: string = profile.models.default;
const LEGACY_MODEL_ALIASES: Record<string, string> = profile.models.legacy_aliases;

// Port of generation_service.build_chunk_prompt.
export function buildChunkPrompt(previousTail: string): string {
  let prompt = profile.prompts.chunk;
  if (previousTail) prompt += profile.prompts.chunk_continuation.replace('{previous_tail}', () => previousTail);
  return prompt;
}

// Port of model_registry.sanitize_model_name.
export function sanitizeModelName(name: string | null | undefined): string {
  const candidate = String(name ?? '').trim();
  const resolved = LEGACY_MODEL_ALIASES[candidate] ?? candidate;
  return PROFILE_MODEL_OPTIONS.some(option => option.id === resolved) ? resolved : PROFILE_DEFAULT_MODEL;
}

export function profileModel(name: string): ProfileModelOption {
  const id = sanitizeModelName(name);
  return PROFILE_MODEL_OPTIONS.find(option => option.id === id)!;
}

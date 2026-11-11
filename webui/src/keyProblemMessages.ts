// The failure texts that ask the user to check the API key or the model it can use.
// webRun.failurePayload writes them and RunOutcomeBanner recognises them, both through this module.

const INVALID_KEY_PREFIX = 'Chiave API non valida';
const MODEL_UNAVAILABLE_TAIL = ' per questa chiave API: scegli un altro modello nelle impostazioni o usa un’altra chiave.';

export const INVALID_KEY_MESSAGE = `${INVALID_KEY_PREFIX}: controlla di averla copiata per intero da Google AI Studio (Impostazioni → Chiave API).`;

/** The text for a run that found these models (labels, in the order tried) missing for the key. */
export function modelUnavailableMessage(labels: readonly string[]): string {
  if (labels.length === 0) return `Modello non disponibile${MODEL_UNAVAILABLE_TAIL}`;
  if (labels.length === 1) return `${labels[0]} non è disponibile${MODEL_UNAVAILABLE_TAIL}`;
  return `${labels.slice(0, -1).join(', ')} e ${labels.at(-1)} non sono disponibili${MODEL_UNAVAILABLE_TAIL}`;
}

export const isKeyProblemMessage = (error: string): boolean =>
  error.startsWith(INVALID_KEY_PREFIX) || error.endsWith(MODEL_UNAVAILABLE_TAIL);

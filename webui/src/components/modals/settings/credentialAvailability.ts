import type { CredentialProfile } from '../../../bridge';

export const DEFAULT_QUOTA_RESET_INFO = 'Le quote si azzerano alle 09:00 (ora italiana)';

/**
 * Whether a key can serve `model` right now. Keys without telemetry are assumed usable.
 * A `temporarily_failing` key with no per-model exhaustion is treated as unusable for
 * every model, because the failure is not attributed to a specific one.
 */
export function isCredentialUsableForModel(
  cred: CredentialProfile | undefined,
  model: string,
): boolean {
  if (!cred) return true;
  if (
    cred.operational_status === 'invalid' ||
    cred.operational_status === 'permission_denied' ||
    cred.operational_status === 'request_error'
  ) {
    return false;
  }
  const exhausted = cred.exhausted_models || [];
  if (exhausted.includes(model)) return false;
  if (cred.operational_status === 'temporarily_failing' && exhausted.length === 0) return false;
  return true;
}

export function maskedSuffix(maskedKey: string | null | undefined): string {
  return maskedKey ? maskedKey.slice(-4) : '';
}

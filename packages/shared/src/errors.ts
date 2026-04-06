/**
 * Extracts a human-readable message from an unknown caught value.
 * Prefer this over inline `err instanceof Error ? err.message : String(err)`.
 */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

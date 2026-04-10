/**
 * Extracts a human-readable message from an unknown caught value.
 * Prefer this over inline `err instanceof Error ? err.message : String(err)`.
 */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Thrown when a service rejects input that passed schema validation but
 * fails cross-field or stateful business rules (e.g., idealValue outside
 * native scale). Routes map this to HTTP 400.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Thrown when a requested entity does not exist. Routes map this to HTTP 404.
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

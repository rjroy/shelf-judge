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

export const AXIS_VALIDATION_CODES = {
  INVALID_AXIS_PAYLOAD: "invalid_axis_payload",
  UNKNOWN_DERIVED_FIELD: "unknown_derived_field",
  MISSING_DERIVED_CONFIGURATION: "missing_derived_configuration",
  UNSUPPORTED_DERIVED_CONFIGURATION: "unsupported_derived_configuration",
  INVALID_TARGET_PLAYER_COUNT: "invalid_target_player_count",
  INVALID_MAXIMUM_SCORING_TIME: "invalid_maximum_scoring_time",
  INVALID_CURVE_FOR_NATIVE_SCALE: "invalid_curve_for_native_scale",
  INVALID_LEGACY_AXIS_REPAIR: "invalid_legacy_axis_repair",
} as const;

export type AxisValidationCode = (typeof AXIS_VALIDATION_CODES)[keyof typeof AXIS_VALIDATION_CODES];

export interface AxisValidationDetail {
  field: string;
  path: readonly (string | number)[];
}

/**
 * Structured validation failure for the additive current-axis contracts.
 * Consumers branch on code and details, never on the human-readable message.
 */
export class CodedAxisValidationError extends Error {
  constructor(
    message: string,
    public readonly code: AxisValidationCode,
    public readonly details: readonly AxisValidationDetail[],
  ) {
    super(message);
    this.name = "CodedAxisValidationError";
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

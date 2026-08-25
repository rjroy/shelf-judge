import type {
  AxisValidationCode,
  AxisValidationDetail,
  CreateAxisInput,
  DerivedFieldDiscovery,
  NativeScale,
} from "@shelf-judge/shared";

export type ConfigurationDraft = Record<string, string>;

interface AxisErrorBody {
  error?: string;
  message?: string;
  code?: AxisValidationCode;
  details?: readonly AxisValidationDetail[];
}

export interface AxisFormError {
  summary: string;
  fields: Record<string, string>;
}

export function configurationDraftFromField(
  field: DerivedFieldDiscovery,
  configuration: object = field.template.configuration,
): ConfigurationDraft {
  return Object.fromEntries(
    field.configuration.map((property) => {
      const configuredValue: unknown = Reflect.get(configuration, property.name);
      const value = typeof configuredValue === "number" ? configuredValue : property.default;
      return [property.name, value === undefined ? "" : String(value)];
    }),
  );
}

export function configurationFromDraft(
  field: DerivedFieldDiscovery,
  draft: ConfigurationDraft,
): Record<string, number> {
  return Object.fromEntries(
    field.configuration.map((property) => [property.name, Number(draft[property.name])]),
  );
}

export function nativeScaleFromDiscovery(
  field: DerivedFieldDiscovery,
  draft: ConfigurationDraft,
): NativeScale {
  const discovery = field.nativeScaleDiscovery;
  if (discovery.type === "fixed") return { min: discovery.min, max: discovery.max };
  const configuredMaximum = Number(draft[discovery.maxConfigurationProperty]);
  return {
    min: discovery.min,
    max: Number.isFinite(configuredMaximum) ? configuredMaximum : field.nativeScale.max,
  };
}

export function derivedCreateInput(
  field: DerivedFieldDiscovery,
  draft: ConfigurationDraft,
): Extract<CreateAxisInput, { source: "derived" }> {
  return {
    source: "derived",
    derivedField: field.id,
    name: field.template.name,
    description: field.template.description,
    weight: field.template.weight,
    preferenceShape: field.template.preferenceShape,
    idealValue: field.template.idealValue,
    toleranceWidth: field.template.toleranceWidth,
    configuration: configurationFromDraft(field, draft),
  };
}

function fieldErrorMessage(code: AxisValidationCode | undefined, field: string): string {
  switch (code) {
    case "missing_derived_configuration":
      return "This value is required.";
    case "invalid_target_player_count":
    case "invalid_maximum_scoring_time":
      return "Enter a whole number within the displayed bounds.";
    case "invalid_curve_for_native_scale":
      return "Adjust this value to fit the configured native scale.";
    case "unknown_derived_field":
      return "Select a currently supported derived field.";
    case "unsupported_derived_configuration":
      return "This setting is not supported for the selected field.";
    case "invalid_legacy_axis_repair":
      return "Choose valid repair settings before retrying.";
    default:
      return `${field} is invalid.`;
  }
}

export async function readAxisFormError(response: Response): Promise<AxisFormError> {
  const fallback = `Request failed (${response.status})`;
  const body = (await response.json().catch(() => ({}))) as AxisErrorBody;
  const fields = Object.fromEntries(
    (body.details ?? []).map((detail) => [
      detail.path.map(String).join(".") || detail.field,
      fieldErrorMessage(body.code, detail.field),
    ]),
  );
  const serverMessage = body.message ?? body.error;
  return {
    summary: serverMessage
      ? `${Object.values(fields)[0] ?? "Request rejected"} ${serverMessage}`
      : fallback,
    fields,
  };
}

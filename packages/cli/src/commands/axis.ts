// Axis commands: templates, list, create, update, repair, delete
import type {
  Axis,
  AxisValidationCode,
  AxisValidationDetail,
  DerivedFieldDiscovery,
  DerivedFieldDiscoveryResponse,
} from "@shelf-judge/shared";
import type { DaemonClient, DaemonResponse } from "../client.js";
import type { OutputOptions } from "../output.js";
import { formatTable, printOutput } from "../output.js";

type AxisData = Axis;

interface AxisErrorBody {
  error?: string;
  message?: string;
  code?: AxisValidationCode;
  details?: readonly AxisValidationDetail[];
}

export interface CurveOptions {
  shape?: string;
  ideal?: number;
  tolerance?: string;
  toleranceWidth?: number;
  noTolerance?: boolean;
  noToleranceWidth?: boolean;
  lean?: string;
  vetoBelow?: number;
  vetoAbove?: number;
  noVeto?: boolean;
}

export interface DerivedAxisOptions {
  template?: string;
  targetPlayerCount?: number;
  maximumScoringTime?: number;
}

type AxisMutationOptions = OutputOptions & DerivedAxisOptions & CurveOptions;

function formatShapeColumn(axis: AxisData): string {
  const shape = axis.preferenceShape ?? "higher-is-better";
  let label: string;
  if (shape === "higher-is-better") {
    label = "linear\u2191";
  } else if (shape === "lower-is-better") {
    label = "linear\u2193";
  } else {
    const ideal = axis.idealValue != null ? axis.idealValue : "?";
    const tolerance =
      axis.toleranceWidth != null ? `\u00b1${axis.toleranceWidth}` : (axis.tolerance ?? "");
    label = `sweet@${ideal}${tolerance ? ` ${tolerance}` : ""}`;
  }
  if (axis.veto) label += " V";
  return label;
}

function buildCurveBody(opts: CurveOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (opts.shape !== undefined) body.preferenceShape = opts.shape;
  if (opts.ideal !== undefined) body.idealValue = opts.ideal;
  if (opts.noTolerance) body.tolerance = null;
  else if (opts.tolerance !== undefined) body.tolerance = opts.tolerance;
  if (opts.noToleranceWidth) body.toleranceWidth = null;
  else if (opts.toleranceWidth !== undefined) body.toleranceWidth = opts.toleranceWidth;
  if (opts.lean !== undefined) body.leanDirection = opts.lean === "none" ? null : opts.lean;
  if (opts.noVeto) {
    body.veto = null;
  } else if (opts.vetoBelow !== undefined) {
    body.veto = { direction: "below", threshold: opts.vetoBelow };
  } else if (opts.vetoAbove !== undefined) {
    body.veto = { direction: "above", threshold: opts.vetoAbove };
  }
  return body;
}

function formatAxisError(fallback: string, response: DaemonResponse<unknown>): Error {
  const body = response.data as AxisErrorBody;
  const message = body.message ?? body.error ?? fallback;
  const fields = body.details?.map(({ field }) => field).join(", ");
  if (!body.code) return new Error(message);
  const guidance: Record<AxisValidationCode, string> = {
    invalid_axis_payload: "Check the command options and value types.",
    unknown_derived_field: "Run `shelf-judge axis templates` and choose a listed template ID.",
    missing_derived_configuration:
      "Provide each required configuration flag shown by `axis templates`.",
    unsupported_derived_configuration:
      "Remove unsupported configuration flags or choose the matching template.",
    invalid_target_player_count:
      "Provide a whole target player count within the bounds shown by `axis templates`.",
    invalid_maximum_scoring_time:
      "Provide a whole scoring cap within the bounds shown by `axis templates`.",
    invalid_curve_for_native_scale:
      "Adjust the ideal, tolerance, veto, or scoring cap to fit the template's native scale.",
    invalid_legacy_axis_repair:
      "Repair the disabled axis with a listed template and compatible curve settings.",
    tournament_axis_managed: "Tournament axes are managed by tournament commands.",
    disabled_legacy_axis: "Repair or delete this disabled legacy axis before using it.",
  };
  return new Error(
    `${guidance[body.code]} [${body.code}]${fields ? ` Fields: ${fields}.` : ""} Server: ${message}`,
  );
}

async function getDiscovery(client: DaemonClient): Promise<DerivedFieldDiscoveryResponse> {
  const response = await client.get<DerivedFieldDiscoveryResponse>("/api/axes/derived-fields");
  if (!response.ok) throw formatAxisError("Template discovery failed", response);
  return response.data;
}

function selectTemplate(
  discovery: DerivedFieldDiscoveryResponse,
  templateId: string | undefined,
): DerivedFieldDiscovery {
  if (!templateId) {
    throw new Error("--template is required for a derived axis");
  }
  const field = discovery.fields.find(({ id }) => id === templateId);
  if (!field) {
    const available = discovery.fields.map(({ id }) => id).join(", ");
    throw new Error(`Unknown template: ${templateId}. Available templates: ${available}`);
  }
  return field;
}

function configurationFlags(opts: DerivedAxisOptions): Record<string, number | undefined> {
  return {
    targetPlayerCount: opts.targetPlayerCount,
    maximumScoringTime: opts.maximumScoringTime,
  };
}

function configurationFromOptions(
  field: DerivedFieldDiscovery,
  opts: DerivedAxisOptions,
  requireExplicit: boolean,
): Record<string, number> {
  const flags = configurationFlags(opts);
  const configuration: Record<string, number> = {};
  for (const property of field.configuration) {
    const value = flags[property.name];
    if (value !== undefined) {
      configuration[property.name] = value;
    } else if (requireExplicit && property.default !== undefined) {
      configuration[property.name] = property.default;
    } else if (requireExplicit && property.required) {
      const flag = `--${property.name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
      throw new Error(`${flag} is required for template ${field.id}`);
    }
  }
  return configuration;
}

function assertConfigurationFlagsApply(
  field: DerivedFieldDiscovery,
  opts: DerivedAxisOptions,
): void {
  const supported = new Set(field.configuration.map(({ name }) => name));
  for (const [name, value] of Object.entries(configurationFlags(opts))) {
    if (value !== undefined && !supported.has(name)) {
      throw new Error(`${name} is not configurable for template ${field.id}`);
    }
  }
}

function templateBody(field: DerivedFieldDiscovery): Record<string, unknown> {
  return {
    source: "derived",
    derivedField: field.id,
    name: field.template.name,
    description: field.template.description,
    weight: field.template.weight,
    preferenceShape: field.template.preferenceShape,
    ...(field.template.idealValue === undefined ? {} : { idealValue: field.template.idealValue }),
    ...(field.template.toleranceWidth === undefined
      ? {}
      : { toleranceWidth: field.template.toleranceWidth }),
  };
}

function formatDiscoveryDetails(field: DerivedFieldDiscovery): string {
  const configuration = field.configuration
    .map(({ name, minimum, maximum }) => `${name} ${minimum}..${maximum}`)
    .join(", ");
  return [field.provenance, configuration].filter(Boolean).join("; ");
}

export async function axisTemplates(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const discovery = await getDiscovery(client);
  if (opts.json) return printOutput(discovery, opts);
  return formatTable(
    ["ID", "Template", "Weight", "Shape", "Scale", "Unit", "Details"],
    discovery.fields.map((field) => [
      field.id,
      field.template.name,
      String(field.template.weight),
      field.template.preferenceShape,
      `${field.nativeScale.min}..${field.nativeScale.max}`,
      field.unit,
      formatDiscoveryDetails(field),
    ]),
  );
}

export async function axisList(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const response = await client.get<AxisData[]>("/api/axes");
  if (!response.ok) throw formatAxisError("List failed", response);
  if (opts.json) return printOutput(response.data, opts);

  const discovery = await getDiscovery(client);
  const fields = new Map(discovery.fields.map((field) => [field.id, field]));
  const table = formatTable(
    ["ID", "Name", "Weight", "Source", "Shape", "Configuration", "Provenance"],
    response.data.map((axis) => {
      if (axis.source === "derived") {
        const field = fields.get(axis.derivedField);
        const configuration = Object.entries(axis.configuration)
          .map(([key, value]) => `${key}=${value}`)
          .join(", ");
        return [
          axis.id.slice(0, 8),
          axis.name,
          String(axis.weight),
          `derived:${axis.derivedField}`,
          formatShapeColumn(axis),
          configuration || "---",
          field ? `${field.provenance} (${field.unit})` : "---",
        ];
      }
      return [
        axis.id.slice(0, 8),
        axis.name,
        String(axis.weight),
        axis.source === "legacy" ? "legacy (disabled)" : axis.source,
        formatShapeColumn(axis),
        axis.source === "legacy" ? (axis.legacyField ?? "unknown field") : "---",
        axis.source === "legacy" ? axis.reason : "---",
      ];
    }),
  );
  const disabled = response.data.filter((axis) => axis.source === "legacy");
  if (disabled.length === 0) return table;
  return `${table}\n\nDisabled legacy axes:\n${disabled
    .map(
      (axis) =>
        `  ${axis.id}: repair with \`shelf-judge axis repair ${axis.id} --template <id>\` or delete with \`shelf-judge axis delete ${axis.id}\``,
    )
    .join("\n")}`;
}

export async function axisCreate(
  client: DaemonClient,
  args: string[],
  opts: AxisMutationOptions & { weight?: number; description?: string },
): Promise<string> {
  const requestedName = args.join(" ");
  let body: Record<string, unknown>;
  if (opts.template) {
    const field = selectTemplate(await getDiscovery(client), opts.template);
    assertConfigurationFlagsApply(field, opts);
    body = {
      ...templateBody(field),
      configuration: configurationFromOptions(field, opts, true),
      ...buildCurveBody(opts),
    };
    if (requestedName) body.name = requestedName;
  } else {
    if (!requestedName) {
      throw new Error(
        "Usage: shelf-judge axis create <name> [--weight N] or axis create --template <id>",
      );
    }
    if (opts.targetPlayerCount !== undefined || opts.maximumScoringTime !== undefined) {
      throw new Error("Configuration flags require --template");
    }
    body = { name: requestedName, ...buildCurveBody(opts) };
  }
  if (opts.weight !== undefined) body.weight = opts.weight;
  else if (!opts.template) body.weight = 50;
  if (opts.description !== undefined) body.description = opts.description;

  const response = await client.post<AxisData>("/api/axes", body);
  if (!response.ok) throw formatAxisError("Create failed", response);
  if (opts.json) return printOutput(response.data, opts);
  return `Created axis: ${response.data.name} (ID: ${response.data.id}, weight: ${response.data.weight})`;
}

export async function axisUpdate(
  client: DaemonClient,
  args: string[],
  opts: AxisMutationOptions & { weight?: number; name?: string; description?: string },
): Promise<string> {
  const id = args[0];
  if (!id) throw new Error("Usage: shelf-judge axis update <id> [options]");

  const body: Record<string, unknown> = { ...buildCurveBody(opts) };
  if (opts.weight !== undefined) body.weight = opts.weight;
  if (opts.name !== undefined) body.name = opts.name;
  if (opts.description !== undefined) body.description = opts.description;

  const hasConfiguration =
    opts.targetPlayerCount !== undefined || opts.maximumScoringTime !== undefined;
  if (hasConfiguration) {
    const axesResponse = await client.get<AxisData[]>("/api/axes");
    if (!axesResponse.ok) throw formatAxisError("Could not load axis configuration", axesResponse);
    const axis = axesResponse.data.find((candidate) => candidate.id === id);
    if (!axis) throw new Error(`Axis not found: ${id}`);
    if (axis.source !== "derived") throw new Error("Configuration flags require a derived axis");
    const field = selectTemplate(await getDiscovery(client), axis.derivedField);
    assertConfigurationFlagsApply(field, opts);
    body.configuration = { ...axis.configuration, ...configurationFromOptions(field, opts, false) };
  }

  if (Object.keys(body).length === 0) throw new Error("At least one option must be provided");
  const response = await client.put<AxisData>(`/api/axes/${encodeURIComponent(id)}`, body);
  if (!response.ok) throw formatAxisError("Update failed", response);
  if (opts.json) return printOutput(response.data, opts);
  return `Updated axis: ${response.data.name} (weight: ${response.data.weight})`;
}

export async function axisRepair(
  client: DaemonClient,
  args: string[],
  opts: AxisMutationOptions & { weight?: number; name?: string; description?: string },
): Promise<string> {
  const id = args[0];
  if (!id) throw new Error("Usage: shelf-judge axis repair <id> --template <id> [options]");
  const field = selectTemplate(await getDiscovery(client), opts.template);
  assertConfigurationFlagsApply(field, opts);
  const body: Record<string, unknown> = {
    derivedField: field.id,
    configuration: configurationFromOptions(field, opts, true),
    ...buildCurveBody(opts),
  };
  if (opts.weight !== undefined) body.weight = opts.weight;
  if (opts.name !== undefined) body.name = opts.name;
  if (opts.description !== undefined) body.description = opts.description;

  const response = await client.post<AxisData>(`/api/axes/${encodeURIComponent(id)}/repair`, body);
  if (!response.ok) throw formatAxisError("Repair failed", response);
  if (opts.json) return printOutput(response.data, opts);
  return `Repaired axis: ${response.data.name} as derived:${field.id} (ID: ${response.data.id})`;
}

export async function axisDelete(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const id = args[0];
  if (!id) throw new Error("Usage: shelf-judge axis delete <id>");
  const response = await client.del<{ deletedRatingsCount: number }>(
    `/api/axes/${encodeURIComponent(id)}`,
  );
  if (!response.ok) throw formatAxisError("Delete failed", response);
  if (opts.json) return printOutput(response.data, opts);
  return `Deleted axis. Removed ${response.data.deletedRatingsCount} rating(s) across games.`;
}

// Redundancy commands: settings, enable, disable, stage, set
import type { RedundancySettings } from "@shelf-judge/shared";
import type { DaemonClient } from "../client.js";
import type { OutputOptions } from "../output.js";
import { formatTable, printOutput } from "../output.js";

function formatSettings(settings: RedundancySettings): string {
  const cw = settings.componentWeights;
  return formatTable(
    ["Setting", "Value"],
    [
      ["enabled", String(settings.enabled)],
      ["stage", settings.stage],
      ["similarityThreshold", String(settings.similarityThreshold)],
      ["maxPenalty", String(settings.maxPenalty)],
      ["minNeighbors", String(settings.minNeighbors)],
      ["expectedNeighbors", String(settings.expectedNeighbors)],
      ["componentWeights.binary", String(cw.binary)],
      ["componentWeights.continuous", String(cw.continuous)],
      ["componentWeights.personalAxes", String(cw.personalAxes)],
    ],
  );
}

export async function redundancySettings(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const { ok, data } = await client.get<RedundancySettings>("/api/redundancy/settings");

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to load redundancy settings");
  }

  if (opts.json) return printOutput(data, opts);

  return formatSettings(data);
}

export async function redundancyEnable(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const { ok, data } = await client.patch<RedundancySettings>("/api/redundancy/settings", {
    enabled: true,
  });

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to enable redundancy");
  }

  if (opts.json) return printOutput(data, opts);

  return "Redundancy scoring enabled.\n\n" + formatSettings(data);
}

export async function redundancyDisable(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const { ok, data } = await client.patch<RedundancySettings>("/api/redundancy/settings", {
    enabled: false,
  });

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to disable redundancy");
  }

  if (opts.json) return printOutput(data, opts);

  return "Redundancy scoring disabled.\n\n" + formatSettings(data);
}

export async function redundancyStage(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const stage = args[0];

  if (!stage || (stage !== "annotation" && stage !== "integrated")) {
    throw new Error("Usage: shelf-judge redundancy stage <annotation|integrated>");
  }

  const { ok, data } = await client.patch<RedundancySettings>("/api/redundancy/settings", {
    stage,
  });

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to set redundancy stage");
  }

  if (opts.json) return printOutput(data, opts);

  return `Redundancy stage set to "${stage}".\n\n` + formatSettings(data);
}

const NUMERIC_KEYS = new Set(["similarityThreshold", "maxPenalty", "minNeighbors", "expectedNeighbors"]);
const VALID_KEYS = new Set([
  "enabled",
  "stage",
  "similarityThreshold",
  "maxPenalty",
  "minNeighbors",
  "expectedNeighbors",
  "componentWeights",
]);

export async function redundancySet(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const key = args[0];
  const rawValue = args.slice(1).join(" ");

  if (!key || !rawValue) {
    throw new Error("Usage: shelf-judge redundancy set <key> <value>");
  }

  if (!VALID_KEYS.has(key)) {
    throw new Error(`Unknown setting: "${key}". Valid keys: ${[...VALID_KEYS].join(", ")}`);
  }

  let value: unknown;

  if (key === "enabled") {
    if (rawValue === "true") value = true;
    else if (rawValue === "false") value = false;
    else throw new Error('enabled must be "true" or "false"');
  } else if (key === "componentWeights") {
    try {
      value = JSON.parse(rawValue) as unknown;
    } catch {
      throw new Error(
        'componentWeights must be valid JSON, e.g. \'{"binary":0.4,"continuous":0.3,"personalAxes":0.3}\'',
      );
    }
  } else if (NUMERIC_KEYS.has(key)) {
    const num = Number(rawValue);
    if (!Number.isFinite(num)) {
      throw new Error(`${key} must be a number`);
    }
    value = num;
  } else {
    // stage: pass as string
    value = rawValue;
  }

  const { ok, data } = await client.patch<RedundancySettings>("/api/redundancy/settings", {
    [key]: value,
  });

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? `Failed to set ${key}`);
  }

  if (opts.json) return printOutput(data, opts);

  return `Updated ${key}.\n\n` + formatSettings(data);
}

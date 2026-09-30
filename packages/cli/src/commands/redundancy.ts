// Redundancy commands: settings, enable, disable, stage, set
import type { RedundancySettings } from "@shelf-judge/shared";
import type { DaemonClient } from "../client.js";
import { responseError } from "../errors.js";
import type { OutputOptions } from "../output.js";
import { formatTable, printOutput } from "../output.js";

type RedundancySettingsResponse = RedundancySettings & { migrationNotice?: string | null };

function formatSettings(settings: RedundancySettingsResponse): string {
  const cw = settings.componentWeights;
  const table = formatTable(
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
    ],
  );
  return settings.migrationNotice ? `${table}\n\nNotice: ${settings.migrationNotice}` : table;
}

export async function redundancySettings(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const { ok, data } = await client.get<RedundancySettingsResponse>("/api/redundancy/settings");

  if (!ok) {
    throw responseError(data, "Failed to load redundancy settings");
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
    throw responseError(data, "Failed to enable redundancy");
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
    throw responseError(data, "Failed to disable redundancy");
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
    throw responseError(data, "Failed to set redundancy stage");
  }

  if (opts.json) return printOutput(data, opts);

  return `Redundancy stage set to "${stage}".\n\n` + formatSettings(data);
}

const NUMERIC_KEYS = new Set([
  "similarityThreshold",
  "maxPenalty",
  "minNeighbors",
  "expectedNeighbors",
]);
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
    throw responseError(data, `Failed to set ${key}`);
  }

  if (opts.json) return printOutput(data, opts);

  return `Updated ${key}.\n\n` + formatSettings(data);
}

const SEMANTIC = "/api/redundancy/semantic";
type SignalScope = "description-only" | "owner-notes-only" | "description-and-owner-notes";

function fail(data: unknown, fallback: string): never {
  throw responseError(data, fallback);
}

function semanticOutput(data: unknown, opts: OutputOptions): string {
  return opts.json ? printOutput(data, opts) : JSON.stringify(data, null, 2);
}

function flags(args: string[]): Set<string> {
  const parsed = new Set(args);
  if (parsed.size !== args.length || args.some((arg) => !arg.startsWith("--"))) {
    throw new Error("Unexpected or duplicate option");
  }
  return parsed;
}

export async function redundancySemanticSettings(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const [field, value, ...extra] = args;
  if (
    extra.length ||
    !field ||
    !["enabled", "factual", "description", "ownerNote", "cachedOwnerNoteUse"].includes(field)
  ) {
    throw new Error(
      "Usage: shelf-judge redundancy semantic-settings <enabled|factual|description|ownerNote|cachedOwnerNoteUse> <value>",
    );
  }
  let patch: Record<string, unknown>;
  if (field === "enabled" || field === "cachedOwnerNoteUse") {
    if (value !== "true" && value !== "false") throw new Error(`${field} must be true or false`);
    patch = { [field]: value === "true" };
  } else {
    const weight = Number(value);
    if (value === undefined || value.trim() === "" || !Number.isFinite(weight) || weight < 0)
      throw new Error(`${field} must be a non-negative number`);
    patch = { weights: { [field]: weight } };
  }
  const { ok, data } = await client.patch(`${SEMANTIC}-settings`, patch);
  if (!ok) fail(data, "Failed to update semantic redundancy settings");
  return semanticOutput(data, opts);
}

export async function redundancySemanticStatus(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const { ok, data } = await client.get(`${SEMANTIC}/summary`);
  if (!ok) fail(data, "Failed to load semantic redundancy status");
  return semanticOutput(data, opts);
}

export async function redundancySemanticProgress(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const { ok, data } = await client.get(`${SEMANTIC}/refresh-status`);
  if (!ok) fail(data, "Failed to load semantic refresh progress");
  return semanticOutput(data, opts);
}

export async function redundancySemanticDisclosure(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const [scope, ...extra] = args;
  if (
    extra.length ||
    !["description-only", "owner-notes-only", "description-and-owner-notes"].includes(scope ?? "")
  ) {
    throw new Error(
      "Usage: shelf-judge redundancy disclose <description-only|owner-notes-only|description-and-owner-notes>",
    );
  }
  const { ok, data } = await client.post(`${SEMANTIC}/disclosure`, {
    signalScope: scope as SignalScope,
  });
  if (!ok) fail(data, "Failed to create redundancy disclosure");
  return semanticOutput(data, opts);
}

interface ManifestPage {
  manifestId: string;
  manifestDigest: string;
  offset: number;
  nextOffset: number;
  complete: boolean;
  pairs: ManifestPair[];
}

interface ManifestPair {
  gameA: string;
  gameB: string;
  hasDescriptionA: boolean;
  hasDescriptionB: boolean;
  hasOwnerNoteA: boolean;
  hasOwnerNoteB: boolean;
}

function compareManifestPairs(left: ManifestPair, right: ManifestPair): number {
  const a = left.gameA.localeCompare(right.gameA);
  return a === 0 ? left.gameB.localeCompare(right.gameB) : a;
}

function validManifestPair(value: unknown): value is ManifestPair {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const pair = value as Record<string, unknown>;
  return (
    typeof pair.gameA === "string" &&
    typeof pair.gameB === "string" &&
    pair.gameA < pair.gameB &&
    typeof pair.hasDescriptionA === "boolean" &&
    typeof pair.hasDescriptionB === "boolean" &&
    typeof pair.hasOwnerNoteA === "boolean" &&
    typeof pair.hasOwnerNoteB === "boolean"
  );
}

export async function redundancySemanticInspect(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const [id, digest, countText, ...extra] = args;
  const pairCount = Number(countText);
  if (!id || !digest || extra.length || !Number.isSafeInteger(pairCount) || pairCount < 0) {
    throw new Error("Usage: shelf-judge redundancy inspect <manifest-id> <digest> <pair-count>");
  }
  const pairs: unknown[] = [];
  let previousPair: ManifestPair | undefined;
  let offset = 0;
  while (offset < pairCount || (pairCount === 0 && offset === 0)) {
    const request = { manifestId: id, manifestDigest: digest, offset };
    let response;
    try {
      response = await client.post<ManifestPage>(`${SEMANTIC}/disclosure/page`, request);
    } catch {
      // Page delivery is idempotent for the same manifest identity and offset.
      response = await client.post<ManifestPage>(`${SEMANTIC}/disclosure/page`, request);
    }
    if (!response.ok)
      fail(response.data, "Disclosure manifest retrieval failed; no acknowledgement sent");
    const page = response.data;
    if (
      page.manifestId !== id ||
      page.manifestDigest !== digest ||
      page.offset !== offset ||
      !Array.isArray(page.pairs) ||
      !Number.isSafeInteger(page.nextOffset) ||
      page.nextOffset !== offset + page.pairs.length ||
      page.pairs.some((pair) => !validManifestPair(pair))
    )
      throw new Error("Manifest page identity or offset mismatch; no acknowledgement sent");
    for (const pair of page.pairs) {
      if (previousPair && compareManifestPairs(previousPair, pair) >= 0)
        throw new Error("Manifest pair ordering is invalid; no acknowledgement sent");
      previousPair = pair;
    }
    pairs.push(...page.pairs);
    if (page.complete) {
      if (pairs.length !== pairCount || page.nextOffset !== pairCount)
        throw new Error("Manifest count mismatch; no acknowledgement sent");
      break;
    }
    if (page.nextOffset <= offset || page.pairs.length === 0)
      throw new Error("Invalid manifest pagination; no acknowledgement sent");
    offset = page.nextOffset;
  }
  if (pairs.length !== pairCount)
    throw new Error("Manifest is incomplete; no acknowledgement sent");
  const result = { manifestId: id, manifestDigest: digest, pairCount, pairs };
  if (opts.json) return printOutput(result, opts);
  const lines = [`Complete manifest ${digest} (${pairCount} pairs):`];
  for (const pair of pairs) lines.push(JSON.stringify(pair));
  return lines.join("\n");
}

export async function redundancySemanticStart(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const [id, digest, countText, ...rawFlags] = args;
  const pairCount = Number(countText);
  const options = flags(rawFlags);
  if (
    !id ||
    !digest ||
    !Number.isSafeInteger(pairCount) ||
    pairCount < 0 ||
    !options.has("--authorize") ||
    (options.has("--authorize-notes") && options.has("--decline-notes"))
  ) {
    throw new Error(
      "Usage: shelf-judge redundancy refresh <manifest-id> <digest> <pair-count> --authorize [--authorize-notes|--decline-notes] [--use-cached-notes]",
    );
  }
  const unknown = [...options].filter(
    (flag) =>
      !["--authorize", "--authorize-notes", "--decline-notes", "--use-cached-notes"].includes(flag),
  );
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  const noteTransmissionAuthorized = options.has("--authorize-notes");
  const body = {
    manifestId: id,
    manifestDigest: digest,
    pairCount,
    transmissionAuthorized: true,
    noteTransmissionAuthorized,
    cachedOwnerNoteUseAuthorized: options.has("--use-cached-notes"),
  };
  // This operation is explicitly replay-safe for an identical manifest-bound acknowledgement.
  let response;
  try {
    response = await client.post(`${SEMANTIC}/acknowledge-and-start`, body);
  } catch {
    response = await client.post(`${SEMANTIC}/acknowledge-and-start`, body);
  }
  if (!response.ok) fail(response.data, "Refresh was refused or the disclosure is stale");
  return semanticOutput(response.data, opts);
}

export async function redundancySemanticCancel(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const [commandId, ...extra] = args;
  if (!commandId || extra.length)
    throw new Error("Usage: shelf-judge redundancy cancel <command-id>");
  const { ok, data } = await client.post(`${SEMANTIC}/cancel`, { commandId });
  if (!ok) fail(data, "Failed to cancel semantic refresh");
  return semanticOutput(data, opts);
}

export async function redundancySemanticRevoke(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  if (args.length) throw new Error("Usage: shelf-judge redundancy revoke");
  const { ok, data } = await client.patch(`${SEMANTIC}-settings`, {
    enabled: false,
    cachedOwnerNoteUse: false,
  });
  if (!ok) fail(data, "Failed to revoke semantic use");
  return semanticOutput(data, opts);
}

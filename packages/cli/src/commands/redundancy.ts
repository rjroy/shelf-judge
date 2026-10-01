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

interface SemanticRunPreview {
  requestId: string;
  precondition: string;
  provider: string;
  modelId: string;
  eligibleGameCount: number;
  pairCount: number;
  descriptionBearingPairCount: number;
  noteBearingPairCount: number;
  noteTransmissionPermitted: boolean;
  providerConfigured: boolean;
  scoringEffect: "integrated-fitness" | "annotation-only";
  retentionCaveat: string;
  limits: {
    maxEligiblePairs: number;
    maxProviderAttempts: number;
    maxRunDurationMs: number;
    reportedTokenStopThreshold: number;
    reportedTokenThresholdIsBilledCeiling: false;
  };
  withinPairLimit: boolean;
  expiresAt: string;
}

interface SemanticRunStatus {
  status: string;
  measurement: string;
  eligibleGameCount: number | null;
  pairCount: number | null;
  coverage: unknown;
  progress: null | {
    state: string;
    pairCount: number;
    completedPairs: number;
    cacheHits: number;
    cacheMisses: number;
    failedPairs: number;
    stopReason?: "provider-limit" | "provider-unconfigured";
  };
}

function fail(data: unknown, fallback: string): never {
  throw responseError(data, fallback);
}

function semanticOutput(data: unknown, opts: OutputOptions): string {
  return opts.json ? printOutput(data, opts) : JSON.stringify(data, null, 2);
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
  const { ok, data } = await client.get<SemanticRunStatus>(`${SEMANTIC}/refresh-status`);
  if (!ok) fail(data, "Failed to load semantic refresh progress");
  return opts.json ? printOutput(data, opts) : formatRunStatus(data);
}

function formatRunPreview(preview: SemanticRunPreview): string {
  const tokenThreshold = preview.limits.reportedTokenStopThreshold.toLocaleString();
  return [
    "Semantic Run preview",
    `Provider/model: ${preview.provider} / ${preview.modelId}`,
    `Eligible games: ${preview.eligibleGameCount}; eligible pairs: ${preview.pairCount}`,
    `Pairs with descriptions: ${preview.descriptionBearingPairCount}; pairs with notes: ${preview.noteBearingPairCount}`,
    `Scoring effect: ${preview.scoringEffect}`,
    `Note transmission permission available: ${preview.noteTransmissionPermitted ? "yes" : "no"}`,
    `Provider configured: ${preview.providerConfigured ? "yes" : "no"}`,
    `Limits: ${preview.limits.maxEligiblePairs.toLocaleString()} eligible pairs; ${preview.limits.maxProviderAttempts} provider attempts; ${Math.round(preview.limits.maxRunDurationMs / 1000)} seconds`,
    `Reported-token stop threshold: ${tokenThreshold} (not a hard billed ceiling)`,
    `Retention: ${preview.retentionCaveat}`,
    `Preview expires: ${preview.expiresAt}`,
    preview.withinPairLimit
      ? "Scope is within the pair limit."
      : "Scope exceeds the pair limit; no Run was started.",
    "Note transmission is off by default. Add --authorize-notes only if you intend to send owner notes.",
  ].join("\n");
}

function formatRunStatus(status: SemanticRunStatus): string {
  const lines = [`Semantic status: ${status.status} (${status.measurement})`];
  if (status.eligibleGameCount !== null && status.pairCount !== null) {
    lines.push(`Eligible games: ${status.eligibleGameCount}; pairs: ${status.pairCount}`);
  } else {
    lines.push("Coverage counts: not measured");
  }
  if (status.progress) {
    const progress = status.progress;
    lines.push(
      `Last run: ${progress.state}; ${progress.completedPairs}/${progress.pairCount} completed; ${progress.cacheHits} cache hits; ${progress.cacheMisses} misses; ${progress.failedPairs} failed`,
    );
    if (progress.stopReason === "provider-limit") {
      lines.push(
        "Run stopped at a provider attempt or reported-token limit; prior checkpoints are retained.",
      );
    } else if (progress.stopReason === "provider-unconfigured") {
      lines.push(
        "Run stopped because the provider is not configured; prior checkpoints are retained.",
      );
    }
  }
  return lines.join("\n");
}

export async function redundancySemanticRun(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const options = new Set(args);
  if (options.size !== args.length || args.some((arg) => arg !== "--authorize-notes")) {
    throw new Error("Usage: shelf-judge redundancy run [--authorize-notes] [--json]");
  }
  const { ok: previewOk, data: preview } = await client.get<SemanticRunPreview>(
    `${SEMANTIC}/run-preview`,
  );
  if (!previewOk) fail(preview, "Unable to preview semantic Run");
  if (
    typeof preview.requestId !== "string" ||
    typeof preview.precondition !== "string" ||
    !Number.isSafeInteger(preview.pairCount) ||
    typeof preview.withinPairLimit !== "boolean"
  ) {
    throw new Error("Daemon returned an invalid semantic Run preview");
  }
  if (!preview.withinPairLimit) {
    const summary = formatRunPreview(preview);
    if (opts.json)
      return printOutput({ preview, state: "not-started", reason: "scope-over-limit" }, opts);
    return `${summary}\nNo Run was started because the scope exceeds the pair limit.`;
  }
  if (!preview.providerConfigured) {
    const summary = formatRunPreview(preview);
    if (opts.json)
      return printOutput({ preview, state: "not-started", reason: "provider-unconfigured" }, opts);
    return `${summary}\nNo Run was started because the provider is not configured.`;
  }
  const noteTransmissionAuthorized = options.has("--authorize-notes");
  if (noteTransmissionAuthorized && !preview.noteTransmissionPermitted) {
    throw new Error("Note transmission is not currently permitted; no Run was started");
  }
  const { ok, data } = await client.post(`${SEMANTIC}/run`, {
    requestId: preview.requestId,
    precondition: preview.precondition,
    noteTransmissionAuthorized,
  });
  if (!ok) {
    const reason =
      typeof data === "object" && data !== null && "error" in data ? data.error : undefined;
    if (reason === "precondition-failed") {
      throw new Error("Run preview expired or current sources/settings changed; run preview again");
    }
    if (reason === "run-conflict") throw new Error("Another semantic Run is already active");
    if (reason === "scope-over-limit") {
      throw new Error("Run scope exceeds the provider limit; no Run was started");
    }
    if (reason === "run-unavailable") {
      throw new Error("Semantic Run is unavailable or provider configuration is missing");
    }
    fail(data, "Run was refused; preview may be stale or expired");
  }
  if (opts.json) return printOutput({ preview, result: data }, opts);
  return `${formatRunPreview(preview)}\nRun accepted: ${JSON.stringify(data)}`;
}

export async function redundancySemanticCancel(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const [runId, ...extra] = args;
  if (!runId || extra.length) throw new Error("Usage: shelf-judge redundancy cancel <run-id>");
  const { ok, data } = await client.post(`${SEMANTIC}/cancel`, { runId });
  if (!ok) fail(data, "Failed to cancel semantic refresh");
  return semanticOutput(data, opts);
}

export async function redundancySemanticActiveRun(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  if (args.length) throw new Error("Usage: shelf-judge redundancy active [--json]");
  const { ok, data } = await client.get<{ runId: string } | null>(`${SEMANTIC}/active-run`);
  if (!ok) fail(data, "Failed to load active semantic Run");
  return opts.json
    ? printOutput(data, opts)
    : data
      ? `Active Run: ${data.runId}`
      : "No active Run.";
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

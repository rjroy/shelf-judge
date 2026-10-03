// Redundancy commands: settings, enable, disable, stage, set
import type {
  JevRunPreview,
  JevWishlistCandidateSelection,
  RedundancySettings,
} from "@shelf-judge/shared";
import { DEFAULT_JEV_RUN_BUDGET } from "@shelf-judge/shared";
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

interface SemanticRefreshProgress {
  coverageMeasurement: "not-measured";
  activity: { state: "active"; runId: string } | { state: "idle" } | { state: "unavailable" };
  progress:
    | {
        state: "saved";
        relation: "active-run" | "historical" | "unknown";
        value: {
          state: string;
          scope?: "collection" | "wishlist";
          pairCount: number;
          completedPairs: number;
          cacheHits: number;
          cacheMisses: number;
          failedPairs: number;
          stopReason?:
            | "provider-limit"
            | "provider-unconfigured"
            | "application-attempt-limit"
            | "application-token-threshold"
            | "application-deadline";
        };
      }
    | { state: "none" }
    | { state: "unavailable" };
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
  const { ok, data } = await client.get<SemanticRefreshProgress>(`${SEMANTIC}/refresh-progress`);
  if (!ok) fail(data, "Failed to load semantic refresh progress");
  return opts.json ? printOutput(data, opts) : formatRunProgress(data);
}

function formatRunPreview(preview: JevRunPreview): string {
  const tokenThreshold = preview.limits.reportedTokenStopThreshold.toLocaleString();
  const wishlistPreview = "scope" in preview ? preview : null;
  const lines = [
    "Semantic Run preview",
    `Provider/model: ${preview.provider} / ${preview.modelId}`,
    ...(wishlistPreview
      ? [
          "Run scope: wishlist candidates",
          `Wishlist entries: ${wishlistPreview.scope.wishlistEntryCount}; selected: ${wishlistPreview.scope.selectedCandidateCount}; unselected: ${wishlistPreview.scope.unselectedEntryCount}`,
          `Selected owned overlaps: ${wishlistPreview.scope.ownedOverlapCandidateCount}; requested: ${wishlistPreview.scope.requestedCandidateCount}; source eligible: ${wishlistPreview.scope.eligibleCandidateCount}; source unavailable: ${wishlistPreview.scope.unavailableCandidateCount}`,
          `Eligible owned games: ${wishlistPreview.scope.eligibleOwnedGameCount}; comparison pairs: ${wishlistPreview.scope.comparisonPairCount}; valid C_ONLY cache hits: ${wishlistPreview.scope.cachedHitPairCount}; sendable pairs: ${wishlistPreview.scope.sendablePairCount}`,
          `Selected candidates: ${formatWishlistSelection(wishlistPreview.selection)}`,
          "Wishlist submissions use descriptions only; owner notes are never included.",
        ]
      : [
          "Run scope: collection",
          `Eligible games: ${preview.eligibleGameCount}; eligible pairs: ${preview.pairCount}`,
          `Pairs with descriptions: ${preview.descriptionBearingPairCount}; pairs with notes: ${preview.noteBearingPairCount}`,
        ]),
    `Scoring effect: ${preview.scoringEffect}`,
    `Provider configured: ${preview.providerConfigured ? "yes" : "no"}`,
    `Application stop limits: ${preview.limits.maxProviderAttempts.toLocaleString()} provider attempts; ${Math.round(preview.limits.maxRunDurationMs / 60_000)} minutes; ${preview.limits.maxEligiblePairs.toLocaleString()} eligible pairs`,
    `Provider-reported usage stop threshold: ${tokenThreshold} tokens (reported usage is not a billing cap)`,
    `Retention: ${preview.retentionCaveat}`,
    `Preview expires: ${preview.expiresAt}`,
    preview.withinPairLimit
      ? "Scope is within the pair limit."
      : "Scope exceeds the pair limit; no Run was started.",
  ];
  if (!wishlistPreview) {
    lines.push(
      `Note transmission permission available: ${preview.noteTransmissionPermitted ? "yes" : "no"}`,
      "Note transmission is off by default. Add --authorize-notes only if you intend to send owner notes.",
    );
  }
  return lines.join("\n");
}

function formatWishlistSelection(selection: JevWishlistCandidateSelection): string {
  return selection.kind === "all" ? "all" : selection.bggIds.join(", ");
}

function formatRunProgress(status: SemanticRefreshProgress): string {
  const lines = ["Semantic refresh progress"];
  if (status.coverageMeasurement === "not-measured") {
    lines.push("Coverage counts: not measured");
  }
  if (status.activity.state === "active") {
    lines.push(`Live activity: active (Run ${status.activity.runId})`);
  } else if (status.activity.state === "idle") {
    lines.push("Live activity: idle");
  } else {
    lines.push("Live activity: unavailable");
  }

  if (status.progress.state === "unavailable") {
    lines.push("Saved progress: unavailable");
  } else if (status.progress.state === "none") {
    lines.push("Saved progress: none");
  } else {
    const progress = status.progress.value;
    lines.push(`Run scope: ${progress.scope ?? "unknown (legacy progress; not inferred)"}`);
    const label =
      status.progress.relation === "active-run"
        ? "Live associated progress"
        : status.progress.relation === "historical"
          ? "Historical saved progress"
          : "Saved progress (run association unknown)";
    lines.push(
      `${label}: ${progress.state}; ${progress.completedPairs}/${progress.pairCount} completed; ${progress.cacheHits} cache hits; ${progress.cacheMisses} misses; ${progress.failedPairs} failed`,
    );
    if (progress.stopReason === "provider-limit") {
      lines.push(
        "Run stopped at a legacy local budget limit (provider-limit); this code does not establish that TypeSafe rate-limited the request. Prior checkpoints are retained.",
      );
    } else if (progress.stopReason === "provider-unconfigured") {
      lines.push(
        "Run stopped because the provider is not configured; prior checkpoints are retained.",
      );
    } else if (progress.stopReason === "application-attempt-limit") {
      lines.push(
        "Run stopped at the application provider-attempt limit; this is a local budget stop, not evidence of provider rate limiting. Prior checkpoints are retained.",
      );
    } else if (progress.stopReason === "application-token-threshold") {
      lines.push(
        "Run stopped at the application-enforced provider-reported usage threshold; reported tokens are not a billing cap. Prior checkpoints are retained.",
      );
    } else if (progress.stopReason === "application-deadline") {
      lines.push(
        "Run stopped at the application Run-duration deadline. Prior checkpoints are retained.",
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
  const defaults = {
    maxAttempts: DEFAULT_JEV_RUN_BUDGET.maxProviderAttempts,
    reportedTokenStop: DEFAULT_JEV_RUN_BUDGET.reportedTokenStopThreshold,
    maxDurationMinutes: DEFAULT_JEV_RUN_BUDGET.maxRunDurationMs / 60_000,
  };
  const bounds = {
    maxAttempts: 75_000,
    reportedTokenStop: Number.MAX_SAFE_INTEGER,
    maxDurationMinutes: 720,
  };
  const values = { ...defaults };
  const seen = new Set<string>();
  const candidateIds: number[] = [];
  let scope: "collection" | "wishlist" = "collection";
  let scopeSeen = false;
  let authorizeNotes = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--authorize-notes") {
      if (authorizeNotes) throw new Error("--authorize-notes may only be specified once");
      authorizeNotes = true;
      continue;
    }
    if (arg === "--scope") {
      if (scopeSeen) throw new Error("--scope may only be specified once");
      scopeSeen = true;
      const value = args[++index];
      if (value !== "collection" && value !== "wishlist") {
        throw new Error('--scope must be "collection" or "wishlist"');
      }
      scope = value;
      continue;
    }
    if (arg === "--bgg-id") {
      const rawId = args[++index];
      if (rawId === undefined || !/^[1-9][0-9]*$/u.test(rawId)) {
        throw new Error("--bgg-id must be a positive safe integer");
      }
      const bggId = Number(rawId);
      if (!Number.isSafeInteger(bggId)) {
        throw new Error("--bgg-id must be a positive safe integer");
      }
      candidateIds.push(bggId);
      continue;
    }
    const flagToKey = {
      "--max-attempts": "maxAttempts",
      "--reported-token-stop": "reportedTokenStop",
      "--max-duration-minutes": "maxDurationMinutes",
    } as const;
    const key = flagToKey[arg as keyof typeof flagToKey];
    if (!key || seen.has(arg)) {
      throw new Error(
        "Usage: shelf-judge redundancy run [--max-attempts N] [--reported-token-stop N] [--max-duration-minutes N] [--authorize-notes] [--json]",
      );
    }
    seen.add(arg);
    const rawValue = args[++index];
    const value = rawValue !== undefined && /^\d+$/.test(rawValue) ? Number(rawValue) : Number.NaN;
    if (!Number.isSafeInteger(value) || value <= 0 || value > bounds[key]) {
      throw new Error(`${arg} must be a positive safe integer no greater than ${bounds[key]}`);
    }
    values[key] = value;
  }
  if (candidateIds.length > 0 && scope !== "wishlist") {
    throw new Error("--bgg-id requires --scope wishlist");
  }
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new Error("--bgg-id values must be unique");
  }
  if (scope === "wishlist" && authorizeNotes) {
    throw new Error("Wishlist Runs are description-only; --authorize-notes is not applicable");
  }
  const query = new URLSearchParams({
    maxProviderAttempts: String(values.maxAttempts),
    reportedTokenStopThreshold: String(values.reportedTokenStop),
    maxRunDurationMs: String(values.maxDurationMinutes * 60_000),
  });
  if (scope === "wishlist") {
    query.set("scope", "wishlist");
    for (const bggId of candidateIds.sort((a, b) => a - b)) query.append("bggId", String(bggId));
  } else if (scopeSeen) {
    query.set("scope", "collection");
  }
  const { ok: previewOk, data: preview } = await client.get<JevRunPreview>(
    `${SEMANTIC}/run-preview?${query.toString()}`,
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
  if (scope === "wishlist" && !("scope" in preview)) {
    throw new Error("Daemon returned a collection preview for a wishlist Run request");
  }
  if (scope === "collection" && "scope" in preview) {
    throw new Error("Daemon returned a wishlist preview for a collection Run request");
  }
  if (scope === "wishlist" && "scope" in preview) {
    const selectedIds = [...candidateIds].sort((a, b) => a - b);
    const selectionMatches =
      selectedIds.length === 0
        ? preview.selection.kind === "all"
        : preview.selection.kind === "selected" &&
          preview.selection.bggIds.length === selectedIds.length &&
          preview.selection.bggIds.every((bggId, index) => bggId === selectedIds[index]);
    if (preview.scope.scope !== "wishlist" || !selectionMatches) {
      throw new Error("Daemon preview did not preserve the requested wishlist candidate selection");
    }
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
  const noteTransmissionAuthorized = authorizeNotes;
  if (noteTransmissionAuthorized && !preview.noteTransmissionPermitted) {
    throw new Error("Note transmission is not currently permitted; no Run was started");
  }
  const disclosure = formatRunPreview(preview);
  if (opts.json) console.error(disclosure);
  else console.log(disclosure);
  const { ok, data, status } = await client.post(`${SEMANTIC}/run`, {
    requestId: preview.requestId,
    precondition: preview.precondition,
    noteTransmissionAuthorized,
  });
  if (!ok) {
    if (status === 412) {
      throw new Error("Run preview expired or current sources/settings changed; run preview again");
    }
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
  return `Run accepted: ${JSON.stringify(data)}`;
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

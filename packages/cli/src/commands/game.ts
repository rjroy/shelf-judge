// Game commands: search, add, list, rate, remove, set-status
import type { DaemonClient, DaemonResponse } from "../client.js";
import type {
  AcquisitionMutationRequest,
  GameWithPurchaseUtilization,
  OwnershipStatus,
} from "@shelf-judge/shared";
import {
  formatStoredAmount,
  IntentionCommandSchema,
  IntentionMutationErrorSchema,
  IntentionMutationResultSchema,
  ManualPlayCorrectionResponseSchema,
  OwnerGameNoteClearRequestSchema,
  OwnerGameNoteDetailWithPurchaseUtilizationSchema,
  OwnerGameNoteMutationErrorSchema,
  OwnerGameNoteMutationResultSchema,
  OwnerGameNoteReadResultSchema,
  OwnerGameNoteSetRequestSchema,
} from "@shelf-judge/shared";
import type { OutputOptions } from "../output.js";
import {
  formatDisplayScore,
  formatPurchaseUtilization,
  formatTable,
  formatScore,
  printOutput,
} from "../output.js";
import { StructuredCliError } from "../errors.js";

interface CommandDependencies {
  createCommandId?: () => string;
  writeStderr?: (message: string) => void;
}

function parseFlags(
  args: string[],
  positionalCount: number,
  allowedFlags: readonly string[],
  usage: string,
): { positional: string[]; flags: Map<string, string> } {
  const positional = args.slice(0, positionalCount);
  const rest = args.slice(positionalCount);
  if (positional.length !== positionalCount || positional.some((value) => value.startsWith("--"))) {
    throw new Error(usage);
  }

  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (
      flag === undefined ||
      value === undefined ||
      !allowedFlags.includes(flag) ||
      flags.has(flag)
    ) {
      throw new Error(usage);
    }
    flags.set(flag, value);
  }
  return { positional, flags };
}

function commandIdFor(supplied: string | undefined, dependencies: CommandDependencies): string {
  if (supplied !== undefined) return supplied;
  const commandId = (dependencies.createCommandId ?? (() => crypto.randomUUID()))();
  (dependencies.writeStderr ?? console.error)(`Command ID: ${commandId}`);
  return commandId;
}

function parseExpectedVersion(value: string | undefined, usage: string): number {
  if (value === undefined || !/^\d+$/.test(value)) throw new Error(usage);
  const version = Number(value);
  if (!Number.isSafeInteger(version)) throw new Error(usage);
  return version;
}

function renderOwnerNoteMutationResult(
  response: DaemonResponse,
  operation: "set" | "clear",
  gameId: string,
  commandId: string,
  expectedVersion: number,
  opts: OutputOptions,
): string {
  const parsed = OwnerGameNoteMutationResultSchema.safeParse(response.data);
  if (!parsed.success) throw new Error(`Invalid owner-note response: ${parsed.error.message}`);
  const result = parsed.data;
  const expectedStatus = result.ok
    ? 200
    : result.error.code === "game-not-found"
      ? 404
      : result.error.code === "stale-version" || result.error.code === "command-reuse"
        ? 409
        : result.error.code === "version-overflow"
          ? 422
          : result.error.code === "persistence-failure"
            ? 500
            : 400;
  const expectedResultVersion = result.ok
    ? result.accepted.alreadyClear
      ? expectedVersion
      : expectedVersion + 1
    : null;
  const coherent =
    response.ok === result.ok &&
    response.status === expectedStatus &&
    (result.ok
      ? Number.isSafeInteger(expectedResultVersion) &&
        result.accepted.operation === operation &&
        result.accepted.gameId === gameId &&
        result.accepted.commandId === commandId &&
        result.accepted.version === expectedResultVersion
      : result.commandId === commandId &&
        (result.error.code === "game-not-found"
          ? result.error.gameId === gameId
          : result.error.code === "stale-version"
            ? result.error.gameId === gameId && result.error.expectedVersion === expectedVersion
            : result.error.code === "persistence-failure"
              ? result.error.operation === `shelf.game.note.${operation}`
              : true));
  if (!coherent) throw new Error("Invalid owner-note response: command identity mismatch");
  if (!result.ok) throw new StructuredCliError(result);
  if (opts.json) return printOutput(result, opts);

  const replay = result.accepted.replayed ? " (replayed)" : "";
  if (operation === "set") {
    return `Owner note saved for game ${gameId} at version ${result.accepted.version}${replay}.`;
  }
  if (result.accepted.alreadyClear) {
    return `Owner note for game ${gameId} was already clear at version ${result.accepted.version}${replay}.`;
  }
  return `Owner note cleared for game ${gameId} at version ${result.accepted.version}${replay}.`;
}

export async function gameNoteGet(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const [gameId, ...extra] = args;
  if (gameId === undefined || extra.length > 0) {
    throw new Error("Usage: shelf-judge game note get <game-id> [--json]");
  }
  const response = await client.get(`/api/games/${encodeURIComponent(gameId)}/note`);
  if (!response.ok) {
    const structured = OwnerGameNoteMutationErrorSchema.safeParse(response.data);
    if (structured.success) throw new StructuredCliError(structured.data);
    if (
      typeof response.data === "object" &&
      response.data !== null &&
      Object.keys(response.data).length === 2 &&
      "code" in response.data &&
      response.data.code === "internal_error" &&
      "error" in response.data &&
      typeof response.data.error === "string"
    ) {
      throw new StructuredCliError(response.data);
    }
    throw new Error("Invalid owner-note error response");
  }
  const parsed = OwnerGameNoteReadResultSchema.safeParse(response.data);
  if (!parsed.success || parsed.data.gameId !== gameId) {
    const detail = parsed.success ? "game identity mismatch" : parsed.error.message;
    throw new Error(`Invalid owner-note response: ${detail}`);
  }
  if (opts.json) return printOutput(parsed.data, opts);

  const note = parsed.data.note;
  if (note.state === "missing") return `Owner note for game ${gameId}: never authored (version 0).`;
  if (note.state === "cleared") {
    return `Owner note for game ${gameId}: explicitly cleared (version ${note.version}, updated ${note.updatedAt}).`;
  }
  return `Owner note for game ${gameId} (version ${note.version}, updated ${note.updatedAt}):\n${note.text}`;
}

export async function gameNoteSet(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
  dependencies: CommandDependencies = {},
): Promise<string> {
  const usage =
    "Usage: shelf-judge game note set <game-id> --expected-version <n> --text <text> [--command-id <uuid>] [--json]";
  const { positional, flags } = parseFlags(
    args,
    1,
    ["--expected-version", "--text", "--command-id"],
    usage,
  );
  const [gameId] = positional;
  const suppliedCommandId = flags.get("--command-id");
  const expectedVersion = parseExpectedVersion(flags.get("--expected-version"), usage);
  const preliminary = OwnerGameNoteSetRequestSchema.safeParse({
    commandId: suppliedCommandId ?? "00000000-0000-4000-8000-000000000001",
    expectedVersion,
    text: flags.get("--text"),
  });
  if (!preliminary.success) throw new Error(usage);
  const request = {
    ...preliminary.data,
    commandId: commandIdFor(suppliedCommandId, dependencies),
  };
  const response = await client.put(`/api/games/${encodeURIComponent(gameId)}/note`, request);
  return renderOwnerNoteMutationResult(
    response,
    "set",
    gameId,
    request.commandId,
    request.expectedVersion,
    opts,
  );
}

export async function gameNoteClear(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
  dependencies: CommandDependencies = {},
): Promise<string> {
  const usage =
    "Usage: shelf-judge game note clear <game-id> --expected-version <n> [--command-id <uuid>] [--json]";
  const { positional, flags } = parseFlags(args, 1, ["--expected-version", "--command-id"], usage);
  const [gameId] = positional;
  const suppliedCommandId = flags.get("--command-id");
  const expectedVersion = parseExpectedVersion(flags.get("--expected-version"), usage);
  const preliminary = OwnerGameNoteClearRequestSchema.safeParse({
    commandId: suppliedCommandId ?? "00000000-0000-4000-8000-000000000001",
    expectedVersion,
  });
  if (!preliminary.success) throw new Error(usage);
  const request = {
    ...preliminary.data,
    commandId: commandIdFor(suppliedCommandId, dependencies),
  };
  const response = await client.del(`/api/games/${encodeURIComponent(gameId)}/note`, request);
  return renderOwnerNoteMutationResult(
    response,
    "clear",
    gameId,
    request.commandId,
    request.expectedVersion,
    opts,
  );
}

function renderIntentionResult(data: unknown, opts: OutputOptions): string {
  const parsed = IntentionMutationResultSchema.safeParse(data);
  if (!parsed.success) throw new Error(`Invalid intention response: ${parsed.error.message}`);
  if (!parsed.data.ok) {
    const guidance =
      parsed.data.error.code === "stale-version"
        ? "Refresh the current intention and review it before issuing a new command. Do not retry this stale version."
        : undefined;
    throw new StructuredCliError(
      guidance === undefined ? parsed.data : { ...parsed.data, guidance },
    );
  }
  return printOutput(parsed.data, { ...opts, json: true });
}

export async function gameIntentionSet(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
  dependencies: CommandDependencies = {},
): Promise<string> {
  const usage =
    "Usage: shelf-judge game intention set <game-id> <first-play|replay> [--command-id <uuid>]";
  const { positional, flags } = parseFlags(args, 2, ["--command-id"], usage);
  const [gameId, kind] = positional;
  const suppliedCommandId = flags.get("--command-id");
  const preliminary = IntentionCommandSchema.safeParse({
    type: "create",
    commandId: suppliedCommandId ?? "00000000-0000-4000-8000-000000000001",
    gameId,
    kind,
    expectedActiveIntention: "absent",
  });
  if (!preliminary.success || preliminary.data.type !== "create") throw new Error(usage);
  const command = {
    ...preliminary.data,
    commandId: commandIdFor(suppliedCommandId, dependencies),
  };

  const response = await client.post(`/api/games/${encodeURIComponent(gameId)}/intention`, {
    commandId: command.commandId,
    kind: command.kind,
    expectedActiveIntention: command.expectedActiveIntention,
  });
  return renderIntentionResult(response.data, opts);
}

export async function gameIntentionResolve(
  client: DaemonClient,
  type: "complete" | "retire",
  args: string[],
  opts: OutputOptions,
  dependencies: CommandDependencies = {},
): Promise<string> {
  const usage = `Usage: shelf-judge game intention ${type} <game-id> <intention-id> --expected-version <n> [--command-id <uuid>]`;
  const { positional, flags } = parseFlags(args, 2, ["--expected-version", "--command-id"], usage);
  const expectedVersionText = flags.get("--expected-version");
  if (expectedVersionText === undefined || !/^[1-9]\d*$/.test(expectedVersionText)) {
    throw new Error(usage);
  }
  const [gameId, intentionId] = positional;
  const suppliedCommandId = flags.get("--command-id");
  const preliminary = IntentionCommandSchema.safeParse({
    type,
    commandId: suppliedCommandId ?? "00000000-0000-4000-8000-000000000001",
    gameId,
    intentionId,
    expectedVersion: Number(expectedVersionText),
  });
  if (!preliminary.success || preliminary.data.type === "create") throw new Error(usage);
  const command = {
    ...preliminary.data,
    commandId: commandIdFor(suppliedCommandId, dependencies),
  };

  const response = await client.post(
    `/api/games/${encodeURIComponent(gameId)}/intention/${encodeURIComponent(intentionId)}/${type}`,
    { commandId: command.commandId, expectedVersion: command.expectedVersion },
  );
  return renderIntentionResult(response.data, opts);
}

export async function gamePlaysSet(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const usage = "Usage: shelf-judge game plays set <game-id> <count>";
  const [gameId, countText, ...extra] = args;
  if (
    gameId === undefined ||
    countText === undefined ||
    extra.length > 0 ||
    !/^\d+$/.test(countText)
  ) {
    throw new Error(usage);
  }
  const playCount = Number(countText);
  if (!Number.isSafeInteger(playCount)) throw new Error(usage);

  const response = await client.put(`/api/games/${encodeURIComponent(gameId)}/plays`, {
    playCount,
  });
  const parsed = ManualPlayCorrectionResponseSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new Error(`Invalid play-correction response: ${parsed.error.message}`);
  }
  if (!("ok" in parsed.data) || !parsed.data.ok) throw new StructuredCliError(parsed.data);
  return printOutput(parsed.data, { ...opts, json: true });
}

export async function gameSearch(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const query = args.join(" ");
  if (!query) {
    throw new Error("Usage: shelf-judge game search <query>");
  }

  const { ok, data } = await client.get<
    Array<{ id: number; name: string; yearPublished: number | null }>
  >(`/api/games/search?q=${encodeURIComponent(query)}`);

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Search failed");
  }

  if (opts.json) return printOutput(data, opts);

  const results = data as Array<{ id: number; name: string; yearPublished: number | null }>;
  return formatTable(
    ["BGG ID", "Name", "Year"],
    results.map((r) => [String(r.id), r.name, r.yearPublished ? String(r.yearPublished) : "---"]),
  );
}

export async function gameAdd(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions & { bggId?: number; name?: string },
): Promise<string> {
  const body: Record<string, unknown> = {};

  if (opts.bggId !== undefined) {
    body.bggId = opts.bggId;
  }
  if (opts.name !== undefined) {
    body.name = opts.name;
  }

  if (!body.bggId && !body.name) {
    throw new Error("Usage: shelf-judge game add --bgg-id <id> or --name <name>");
  }

  const { ok, data } = await client.post(`/api/games`, body);

  if (!ok) {
    const err = data as { error: string };
    throw new Error(err.error ?? "Add failed");
  }

  if (opts.json) return printOutput(data, opts);

  const result = data as { game: { id: string; name: string; bggId: number | null } };
  return `Added: ${result.game.name} (ID: ${result.game.id})`;
}

interface GameListItem {
  game: { id: string; name: string; yearPublished: number | null; ownership?: OwnershipStatus };
  score: { score: number } | null;
  displayScore: string | null;
}

interface TournamentStatsEntry {
  gameId: string;
  gameName: string;
  stats: { displayLabel: string };
}

export async function gameList(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions & { ownership?: string },
): Promise<string> {
  const ownership = opts.ownership ?? "owned";
  const query = ownership !== "owned" ? `?ownership=${encodeURIComponent(ownership)}` : "";
  const { ok, data } = await client.get<GameListItem[]>(`/api/games${query}`);

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "List failed");
  }

  // Fetch tournament stats to show rank column (best-effort, don't fail if unavailable)
  const tournamentRes = await client.get<TournamentStatsEntry[]>("/api/tournament/stats");
  const rankMap = new Map<string, string>();
  if (tournamentRes.ok) {
    for (const e of tournamentRes.data) {
      rankMap.set(e.gameId, e.stats.displayLabel);
    }
  }

  if (opts.json) return printOutput(data, opts);

  const hasRanks = rankMap.size > 0;
  const headers = hasRanks
    ? ["ID", "Name", "Year", "Score", "Rank"]
    : ["ID", "Name", "Year", "Score"];

  return formatTable(
    headers,
    data.map((g) => {
      const displayName =
        g.game.ownership === "previously-owned" ? `${g.game.name} [prev]` : g.game.name;
      const row = [
        g.game.id.slice(0, 8),
        displayName,
        g.game.yearPublished ? String(g.game.yearPublished) : "---",
        formatDisplayScore(g.displayScore),
      ];
      if (hasRanks) {
        row.push(rankMap.get(g.game.id) ?? "---");
      }
      return row;
    }),
  );
}

export async function gameAcquisition(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const [gameId, state, amount, ...extra] = args;
  const validState = state === "unknown" || state === "gift" || state === "purchase";
  const validShape =
    gameId !== undefined &&
    validState &&
    extra.length === 0 &&
    ((state === "purchase" && amount !== undefined) ||
      ((state === "unknown" || state === "gift") && amount === undefined));
  if (!validShape) {
    throw new Error("Usage: shelf-judge game acquisition <game-id> unknown|gift|purchase [amount]");
  }

  let body: AcquisitionMutationRequest;
  if (state === "purchase" && amount !== undefined) {
    body = { state, amount };
  } else if (state === "unknown" || state === "gift") {
    body = { state };
  } else {
    throw new Error("Usage: shelf-judge game acquisition <game-id> unknown|gift|purchase [amount]");
  }
  const { ok, data } = await client.put<{ game: GameWithPurchaseUtilization["game"] }>(
    `/api/games/${encodeURIComponent(gameId)}/acquisition`,
    body,
  );
  if (!ok) {
    const error = data as { error?: string };
    throw new Error(error.error ?? "Updating acquisition failed");
  }
  if (opts.json) return printOutput(data, opts);

  const acquisition = data.game.acquisition;
  if (acquisition.state === "unknown") {
    return `${data.game.name}: acquisition is unknown.`;
  }
  if (acquisition.state === "gift") {
    return `${data.game.name}: recorded as a gift with no owner cost.`;
  }
  if (acquisition.state === "purchase") {
    const cost = formatStoredAmount(acquisition.amount.hundredths);
    return acquisition.amount.hundredths === 0
      ? `${data.game.name}: recorded as a zero-cost purchase (${cost}), distinct from unknown or gift.`
      : `${data.game.name}: lifetime landed cost recorded as ${cost}.`;
  }
  return `${data.game.name}: saved acquisition data is invalid and can be corrected.`;
}

export async function gameValue(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const [gameId, ...extra] = args;
  if (!gameId || extra.length > 0) {
    throw new Error("Usage: shelf-judge game value <game-id>");
  }
  const { ok, data } = await client.get(
    `/api/games/${encodeURIComponent(gameId)}?includePredicted=true`,
  );
  if (!ok) {
    const error = data as { error?: string };
    throw new Error(error.error ?? "Getting purchase utilization failed");
  }
  const parsed = OwnerGameNoteDetailWithPurchaseUtilizationSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid game-detail response: ${parsed.error.message}`);
  }
  const { ownerNote, ...game } = parsed.data.game;
  const { intentions, ...detail } = parsed.data;
  void ownerNote;
  void intentions;
  const projected: GameWithPurchaseUtilization = { ...detail, game };
  return opts.json ? printOutput(projected, opts) : formatPurchaseUtilization(projected);
}

interface RateParsed {
  gameId: string;
  ratings: Record<string, number>;
}

export function parseRateArgs(args: string[], axisFlags: string[]): RateParsed {
  // args[0] is the game ID
  // axisFlags come from --axis parsing: ["Wife will play it", "8", "Visual design", "9"]
  const gameId = args[0];
  if (!gameId) {
    throw new Error(
      "Usage: shelf-judge game rate <id> --axis <name> <rating> [--axis <name> <rating>]...",
    );
  }

  const ratings: Record<string, number> = {};
  for (let i = 0; i < axisFlags.length; i += 2) {
    const axisId = axisFlags[i];
    const rating = Number(axisFlags[i + 1]);
    if (!axisId || isNaN(rating)) {
      throw new Error(
        `Invalid axis rating pair at position ${i}: "${axisFlags[i]}" "${axisFlags[i + 1]}"`,
      );
    }
    ratings[axisId] = rating;
  }

  if (Object.keys(ratings).length === 0) {
    throw new Error("At least one --axis <name> <rating> pair is required");
  }

  return { gameId, ratings };
}

export async function gameRate(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions & { axisFlags: string[] },
): Promise<string> {
  const parsed = parseRateArgs(args, opts.axisFlags);

  const { ok, data } = await client.put(`/api/games/${encodeURIComponent(parsed.gameId)}/ratings`, {
    ratings: parsed.ratings,
  });

  if (!ok) {
    const err = data as { error: string };
    throw new Error(err.error ?? "Rate failed");
  }

  if (opts.json) return printOutput(data, opts);

  const result = data as { game: { name: string }; score: { score: number } | null };
  const scoreStr = result.score ? formatScore(result.score.score) : "not yet rated";
  return `Rated ${result.game.name}. Fitness: ${scoreStr}`;
}

export async function gameRefreshAllBgg(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const { ok, data } = await client.post<{ refreshed: number; errors: string[] }>(
    "/api/games/refresh",
  );

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Refresh failed");
  }

  if (opts.json) return printOutput(data, opts);

  const result = data;
  const lines: string[] = [`Refreshed ${result.refreshed} game(s)`];
  if (result.errors.length > 0) {
    lines.push(`Errors (${result.errors.length}):`);
    for (const err of result.errors) {
      lines.push(`  - ${err}`);
    }
  }
  return lines.join("\n");
}

export async function gameRemove(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const id = args[0];
  if (!id) {
    throw new Error("Usage: shelf-judge game remove <id>");
  }

  const { ok, status, data } = await client.del(`/api/games/${encodeURIComponent(id)}`);

  if (!ok) {
    const structured = IntentionMutationErrorSchema.safeParse(data);
    if (structured.success) throw new StructuredCliError(structured.data);
    const err = data as { error?: string };
    throw new Error(err.error ?? "Remove failed");
  }

  if (opts.json) return printOutput({ removed: true, id }, opts);

  return status === 204 ? `Removed game ${id}` : `Removed game ${id}`;
}

export async function gameSetStatus(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const [id, status] = args;
  if (!id || !status) {
    throw new Error("Usage: shelf-judge game set-status <id> <owned|previously-owned>");
  }

  const { ok, data } = await client.patch<{ game: { name: string; ownership: OwnershipStatus } }>(
    `/api/games/${encodeURIComponent(id)}/ownership`,
    { ownership: status },
  );

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Set status failed");
  }

  if (opts.json) return printOutput(data, opts);

  return `"${data.game.name}" marked as ${data.game.ownership}.`;
}

export async function gameAssignShelf(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const [gameId, shelfId, ...extra] = args;
  if (!gameId || !shelfId || extra.length > 0) {
    throw new Error(
      "Usage: shelf-judge game assign-shelf <game-id> <shelf-id>\n" +
        "       The game must be owned and have box dimensions.",
    );
  }

  const { ok, data } = await client.put<{ game: { name: string; manualShelfId: string | null } }>(
    `/api/games/${encodeURIComponent(gameId)}/shelf-assignment`,
    { shelfId },
  );

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Shelf assignment failed");
  }

  if (opts.json) return printOutput(data, opts);
  return `Assigned "${data.game.name}" to shelf ${shelfId}.`;
}

export async function gameClearShelf(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const [gameId, ...extra] = args;
  if (!gameId || extra.length > 0) {
    throw new Error("Usage: shelf-judge game clear-shelf <game-id>");
  }

  const { ok, data } = await client.put<{ game: { name: string; manualShelfId: string | null } }>(
    `/api/games/${encodeURIComponent(gameId)}/shelf-assignment`,
    { shelfId: null },
  );

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Clearing shelf assignment failed");
  }

  if (opts.json) return printOutput(data, opts);
  return `Cleared manual shelf assignment for "${data.game.name}".`;
}

export async function gameEdit(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions & {
    boxWidth?: number;
    boxHeight?: number;
    boxDepth?: number;
    clearBox?: boolean;
  },
): Promise<string> {
  const id = args[0];
  if (!id) {
    throw new Error(
      "Usage: shelf-judge game edit <id> --box-width <W> --box-height <H> --box-depth <D> | --clear-box",
    );
  }

  // Box dimensions handling
  const hasAnyDim =
    opts.boxWidth !== undefined || opts.boxHeight !== undefined || opts.boxDepth !== undefined;
  const hasAllDims =
    opts.boxWidth !== undefined && opts.boxHeight !== undefined && opts.boxDepth !== undefined;

  if (opts.clearBox && hasAnyDim) {
    throw new Error("Cannot use --clear-box together with dimension flags");
  }

  if (hasAnyDim && !hasAllDims) {
    throw new Error("All three --box-width, --box-height, and --box-depth are required together");
  }

  if (!opts.clearBox && !hasAnyDim) {
    throw new Error(
      "Usage: shelf-judge game edit <id> --box-width <W> --box-height <H> --box-depth <D> | --clear-box",
    );
  }

  let body: Record<string, unknown>;
  if (opts.clearBox) {
    body = { clear: true };
  } else if (
    opts.boxWidth !== undefined &&
    opts.boxHeight !== undefined &&
    opts.boxDepth !== undefined
  ) {
    body = { width: opts.boxWidth, height: opts.boxHeight, depth: opts.boxDepth };
  } else {
    throw new Error("All three box dimensions are required together");
  }

  const { ok, data } = await client.put<{
    game: {
      name: string;
      boxDimensions: { width: number; height: number; depth: number } | null;
    };
  }>(`/api/games/${encodeURIComponent(id)}/dimensions`, body);

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Edit failed");
  }

  if (opts.json) return printOutput(data, opts);

  const game = data.game;
  if (game.boxDimensions) {
    return `${game.name}: box dimensions set to ${game.boxDimensions.width} \u00D7 ${game.boxDimensions.height} \u00D7 ${game.boxDimensions.depth} in`;
  }
  return `${game.name}: box dimensions cleared`;
}

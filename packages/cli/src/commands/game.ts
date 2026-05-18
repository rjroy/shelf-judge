// Game commands: search, add, list, rate, remove, set-status
import type { DaemonClient } from "../client.js";
import type { OwnershipStatus } from "@shelf-judge/shared";
import type { OutputOptions } from "../output.js";
import { formatTable, formatScore, printOutput } from "../output.js";

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
        formatScore(g.score?.score ?? null),
      ];
      if (hasRanks) {
        row.push(rankMap.get(g.game.id) ?? "---");
      }
      return row;
    }),
  );
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
    const err = data as { error: string };
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
  } else {
    body = { width: opts.boxWidth!, height: opts.boxHeight!, depth: opts.boxDepth! };
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

// Game commands: search, add, list, rate, remove
import type { DaemonClient } from "../client.js";
import type { OutputOptions } from "../output.js";
import { formatTable, formatScore, printOutput } from "../output.js";

export async function gameSearch(client: DaemonClient, args: string[], opts: OutputOptions): Promise<string> {
  const query = args.join(" ");
  if (!query) {
    throw new Error("Usage: shelf-judge game search <query>");
  }

  const { ok, data } = await client.get<Array<{ id: number; name: string; yearPublished: number | null }>>(`/api/games/search?q=${encodeURIComponent(query)}`);

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

export async function gameAdd(client: DaemonClient, args: string[], opts: OutputOptions & { bggId?: number; name?: string }): Promise<string> {
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
  game: { id: string; name: string; yearPublished: number | null };
  score: { score: number } | null;
}

export async function gameList(client: DaemonClient, _args: string[], opts: OutputOptions): Promise<string> {
  const { ok, data } = await client.get<GameListItem[]>("/api/games");

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "List failed");
  }

  if (opts.json) return printOutput(data, opts);

  const games = data as GameListItem[];
  return formatTable(
    ["ID", "Name", "Year", "Score"],
    games.map((g) => [
      g.game.id.slice(0, 8),
      g.game.name,
      g.game.yearPublished ? String(g.game.yearPublished) : "---",
      formatScore(g.score?.score ?? null),
    ]),
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
    throw new Error("Usage: shelf-judge game rate <id> --axis <name> <rating> [--axis <name> <rating>]...");
  }

  const ratings: Record<string, number> = {};
  for (let i = 0; i < axisFlags.length; i += 2) {
    const axisId = axisFlags[i];
    const rating = Number(axisFlags[i + 1]);
    if (!axisId || isNaN(rating)) {
      throw new Error(`Invalid axis rating pair at position ${i}: "${axisFlags[i]}" "${axisFlags[i + 1]}"`);
    }
    ratings[axisId] = rating;
  }

  if (Object.keys(ratings).length === 0) {
    throw new Error("At least one --axis <name> <rating> pair is required");
  }

  return { gameId, ratings };
}

export async function gameRate(client: DaemonClient, args: string[], opts: OutputOptions & { axisFlags: string[] }): Promise<string> {
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

export async function gameRemove(client: DaemonClient, args: string[], opts: OutputOptions): Promise<string> {
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

// Tournament commands: start, next, pick, stop, stats
import type { DaemonClient } from "../client.js";
import type { OutputOptions } from "../output.js";
import { formatTable, formatScore, printOutput } from "../output.js";
import type {
  TournamentSession,
  TournamentGameStatsDisplay,
  SessionFilter,
} from "@shelf-judge/shared";

interface FilterOpts extends OutputOptions {
  filterFlags: string[];
}

interface NextPairGame {
  id: string;
  name: string;
}

interface NextPairResponse {
  gameA: NextPairGame;
  gameB: NextPairGame;
  gameAStats: TournamentGameStatsDisplay;
  gameBStats: TournamentGameStatsDisplay;
}

interface NextPairDone {
  done: true;
}

interface ComparisonResponse {
  comparison: { id: string; winnerId: string };
  updatedStats: {
    gameA: TournamentGameStatsDisplay;
    gameB: TournamentGameStatsDisplay;
  };
}

interface AllStatsEntry {
  gameId: string;
  gameName: string;
  stats: TournamentGameStatsDisplay;
}

export function parseFilterFlags(flags: string[]): SessionFilter[] {
  const filters: SessionFilter[] = [];
  for (const flag of flags) {
    const colonIdx = flag.indexOf(":");
    if (colonIdx === -1) {
      throw new Error(`Invalid filter format: "${flag}". Expected type:value (e.g. name:wingspan)`);
    }
    const rawType = flag.slice(0, colonIdx);
    const value = flag.slice(colonIdx + 1);

    const typeMap: Record<string, SessionFilter["type"]> = {
      name: "name",
      fitness: "minFitness",
      tag: "bggTag",
      stale: "staleness",
    };

    const mappedType = typeMap[rawType];
    if (!mappedType) {
      throw new Error(`Unknown filter type: "${rawType}". Valid types: name, fitness, tag, stale`);
    }
    if (!value) {
      throw new Error(`Filter "${rawType}" requires a value after the colon`);
    }
    filters.push({ type: mappedType, value });
  }
  return filters;
}

export async function tournamentStart(
  client: DaemonClient,
  _args: string[],
  opts: FilterOpts,
): Promise<string> {
  const filters = parseFilterFlags(opts.filterFlags);
  const body: { filters?: SessionFilter[] } = {};
  if (filters.length > 0) {
    body.filters = filters;
  }

  const { ok, data } = await client.post<{ session: TournamentSession }>(
    "/api/tournament/sessions",
    body,
  );

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to start session");
  }

  if (opts.json) return printOutput(data, opts);

  const session = data.session;
  const filterDesc = session.filters
    ? session.filters.map((f) => `${f.type}:${f.value}`).join(", ")
    : "all games";
  return `Session started (${session.gameIds.length} games, filters: ${filterDesc})`;
}

export async function tournamentNext(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  // Get active session first
  const sessionRes = await client.get<{ session: TournamentSession }>(
    "/api/tournament/sessions/active",
  );
  if (!sessionRes.ok) {
    throw new Error("No active session. Start one with: sj tournament start");
  }

  const session = sessionRes.data.session;
  const { ok, data } = await client.get<NextPairResponse | NextPairDone>(
    `/api/tournament/sessions/${session.id}/next`,
  );

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to get next pair");
  }

  if (opts.json) return printOutput(data, opts);

  if ("done" in data && data.done) {
    return "Session complete. No more pairs to compare.";
  }

  const pair = data as NextPairResponse;
  const table = formatTable(
    ["", "Name", "Fitness", "Rank", "Comparisons"],
    [
      [
        "A",
        pair.gameA.name,
        formatScore(pair.gameAStats.normalizedScore),
        pair.gameAStats.displayLabel,
        String(pair.gameAStats.comparisonCount),
      ],
      [
        "B",
        pair.gameB.name,
        formatScore(pair.gameBStats.normalizedScore),
        pair.gameBStats.displayLabel,
        String(pair.gameBStats.comparisonCount),
      ],
    ],
  );

  return [
    "Which would you keep?",
    "",
    table,
    "",
    `Use \`sj tournament pick ${pair.gameA.id}\` or \`sj tournament pick ${pair.gameB.id}\` to choose.`,
  ].join("\n");
}

export async function tournamentPick(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const winnerId = args[0];
  if (!winnerId) {
    throw new Error("Usage: sj tournament pick <game-id>");
  }

  // Get active session and current pair
  const sessionRes = await client.get<{ session: TournamentSession }>(
    "/api/tournament/sessions/active",
  );
  if (!sessionRes.ok) {
    throw new Error("No active session. Start one with: sj tournament start");
  }

  const session = sessionRes.data.session;
  const nextRes = await client.get<NextPairResponse | NextPairDone>(
    `/api/tournament/sessions/${session.id}/next`,
  );

  if (!nextRes.ok || ("done" in nextRes.data && nextRes.data.done)) {
    throw new Error("No pair available to judge. Session may be complete.");
  }

  const pair = nextRes.data as NextPairResponse;

  const { ok, data } = await client.post<ComparisonResponse>(
    `/api/tournament/sessions/${session.id}/compare`,
    {
      gameAId: pair.gameA.id,
      gameBId: pair.gameB.id,
      winnerId,
    },
  );

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to submit comparison");
  }

  if (opts.json) return printOutput(data, opts);

  const winnerName = data.comparison.winnerId === pair.gameA.id ? pair.gameA.name : pair.gameB.name;
  return `Picked: ${winnerName}`;
}

export async function tournamentStop(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const sessionRes = await client.get<{ session: TournamentSession }>(
    "/api/tournament/sessions/active",
  );
  if (!sessionRes.ok) {
    throw new Error("No active session to stop.");
  }

  const session = sessionRes.data.session;
  const { ok, data } = await client.post<{ session: TournamentSession }>(
    `/api/tournament/sessions/${session.id}/end`,
  );

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to end session");
  }

  if (opts.json) return printOutput(data, opts);

  return `Session ended (${data.session.comparisonCount} comparisons made)`;
}

export async function tournamentStats(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const gameId = args[0];

  if (gameId) {
    // Single game stats
    const { ok, data } = await client.get<TournamentGameStatsDisplay>(
      `/api/tournament/games/${encodeURIComponent(gameId)}/stats`,
    );

    if (!ok) {
      const err = data as unknown as { error: string };
      throw new Error(err.error ?? "Failed to get game stats");
    }

    if (opts.json) return printOutput(data, opts);

    const lines: string[] = [];
    lines.push(`ELO: ${data.eloRating}`);
    lines.push(`Rank: ${data.displayLabel}`);
    lines.push(`Comparisons: ${data.comparisonCount}`);
    lines.push(`Record: ${data.wins}W / ${data.losses}L`);

    if (data.recentComparisons.length > 0) {
      lines.push("");
      lines.push("Recent comparisons:");
      for (const c of data.recentComparisons) {
        const result = c.won ? "won" : "lost";
        const opponent = c.opponentGameName ?? c.opponentGameId.slice(0, 8);
        lines.push(`  vs ${opponent} - ${result}`);
      }
    }

    return lines.join("\n");
  }

  // All game stats summary
  const { ok, data } = await client.get<AllStatsEntry[]>("/api/tournament/stats");

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to get tournament stats");
  }

  if (opts.json) return printOutput(data, opts);

  if (data.length === 0) {
    return "(no tournament data)";
  }

  // Sort by normalized score descending, unranked to bottom
  const sorted = [...data].sort((a, b) => {
    const aScore = a.stats.normalizedScore ?? -1;
    const bScore = b.stats.normalizedScore ?? -1;
    return bScore - aScore;
  });

  return formatTable(
    ["#", "Name", "Rank", "Comparisons"],
    sorted.map((e, i) => [
      String(i + 1),
      e.gameName,
      e.stats.displayLabel,
      String(e.stats.comparisonCount),
    ]),
  );
}

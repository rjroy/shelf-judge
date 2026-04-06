// Score commands: list, get
import type { DaemonClient } from "../client.js";
import type { OutputOptions, BreakdownEntry } from "../output.js";
import { formatTable, formatScore, formatBreakdown, printOutput } from "../output.js";
import type { TournamentGameStatsDisplay } from "@shelf-judge/shared";

interface ScoredGame {
  gameId: string;
  gameName: string;
  score: number;
  ratedAxisCount: number;
  totalAxisCount: number;
  breakdown: BreakdownEntry[];
}

interface UnscoredGame {
  gameId: string;
  gameName: string;
  score: null;
  status: string;
}

interface ScoreListResponse {
  scored: ScoredGame[];
  unscored: UnscoredGame[];
}

export async function scoreList(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const { ok, data } = await client.get<ScoreListResponse>("/api/scores");

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "List failed");
  }

  if (opts.json) return printOutput(data, opts);

  const lines: string[] = [];

  if (data.scored.length > 0) {
    lines.push(
      formatTable(
        ["#", "Name", "Score", "Rated Axes"],
        data.scored.map((g, i) => [
          String(i + 1),
          g.gameName,
          formatScore(g.score),
          `${g.ratedAxisCount}/${g.totalAxisCount}`,
        ]),
      ),
    );
  }

  if (data.unscored.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Unscored:");
    for (const g of data.unscored) {
      lines.push(`  ${g.gameName} - not yet rated`);
    }
  }

  if (lines.length === 0) {
    return "(no games)";
  }

  return lines.join("\n");
}

interface ScoreGetResponse {
  gameId: string;
  gameName: string;
  score: number | null;
  status?: string;
  ratedAxisCount?: number;
  totalAxisCount?: number;
  breakdown?: BreakdownEntry[];
}

export async function scoreGet(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const id = args[0];
  if (!id) {
    throw new Error("Usage: shelf-judge score get <id>");
  }

  const { ok, data } = await client.get<ScoreGetResponse>(
    `/api/games/${encodeURIComponent(id)}/score`,
  );

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Get failed");
  }

  if (opts.json) return printOutput(data, opts);

  if (data.score === null) {
    return `${data.gameName}: not yet rated`;
  }

  // Fetch tournament stats for this game (best-effort)
  const tournamentRes = await client.get<TournamentGameStatsDisplay>(
    `/api/tournament/games/${encodeURIComponent(id)}/stats`,
  );

  const lines: string[] = [];
  lines.push(`${data.gameName}`);
  lines.push(
    `Fitness: ${formatScore(data.score)} (${data.ratedAxisCount}/${data.totalAxisCount} axes rated)`,
  );

  if (tournamentRes.ok) {
    lines.push(`Tournament Rank: ${tournamentRes.data.displayLabel}`);

    // Divergence flag: when both scores are non-null, non-provisional, and differ by > 2.0
    if (
      tournamentRes.data.normalizedScore !== null &&
      !tournamentRes.data.isProvisional &&
      Math.abs(data.score - tournamentRes.data.normalizedScore) > 2.0
    ) {
      lines.push(
        `[divergence] Fitness (${formatScore(data.score)}) and tournament rank (${formatScore(tournamentRes.data.normalizedScore)}) differ by more than 2.0`,
      );
    }
  }

  lines.push("");

  if (data.breakdown && data.breakdown.length > 0) {
    lines.push(formatBreakdown(data.breakdown));
  }

  return lines.join("\n");
}

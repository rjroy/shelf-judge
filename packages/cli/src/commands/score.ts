// Score commands: list, get
import type { DaemonClient } from "../client.js";
import type { OutputOptions, BreakdownEntry } from "../output.js";
import { formatTable, formatScore, formatBreakdown, printOutput } from "../output.js";
import type { TournamentGameStatsDisplay } from "@shelf-judge/shared";

interface VetoInfo {
  axisId: string;
  axisName: string;
  threshold: number;
  direction: "below" | "above";
  rawValue: number;
}

interface ScoredGame {
  gameId: string;
  gameName: string;
  score: number;
  ratedAxisCount: number;
  totalAxisCount: number;
  breakdown: BreakdownEntry[];
  vetoed?: boolean;
  vetoedBy?: VetoInfo | null;
  hypotheticalScore?: number | null;
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
          g.vetoed ? `VETOED (${formatScore(g.hypotheticalScore)})` : formatScore(g.score),
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
  vetoed?: boolean;
  vetoedBy?: VetoInfo | null;
  hypotheticalScore?: number | null;
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

  if (data.vetoed && data.vetoedBy) {
    lines.push(`Fitness: VETOED (hypothetical: ${formatScore(data.hypotheticalScore)})`);
    const dir = data.vetoedBy.direction === "below" ? "below" : "above";
    lines.push(
      `Veto: "${data.vetoedBy.axisName}" scored ${data.vetoedBy.rawValue} (threshold: ${dir} ${data.vetoedBy.threshold})`,
    );
  } else {
    lines.push(
      `Fitness: ${formatScore(data.score)} (${data.ratedAxisCount}/${data.totalAxisCount} axes rated)`,
    );
  }

  if (tournamentRes.ok) {
    const compareScore = data.vetoed ? data.hypotheticalScore : data.score;
    lines.push(`Tournament Rank: ${tournamentRes.data.displayLabel}`);

    if (
      compareScore !== null &&
      compareScore !== undefined &&
      tournamentRes.data.normalizedScore !== null &&
      !tournamentRes.data.isProvisional &&
      Math.abs(compareScore - tournamentRes.data.normalizedScore) > 2.0
    ) {
      lines.push(
        `[divergence] Fitness (${formatScore(compareScore)}) and tournament rank (${formatScore(tournamentRes.data.normalizedScore)}) differ by more than 2.0`,
      );
    }
  }

  lines.push("");

  if (data.breakdown && data.breakdown.length > 0) {
    lines.push(formatBreakdown(data.breakdown));
  }

  return lines.join("\n");
}

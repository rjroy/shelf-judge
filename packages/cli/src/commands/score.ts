// Score commands: list, get
import type { DaemonClient } from "../client.js";
import type { OutputOptions, BreakdownEntry } from "../output.js";
import { formatTable, formatScore, formatBreakdown, printOutput } from "../output.js";

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

  const result = data as ScoreListResponse;
  const lines: string[] = [];

  if (result.scored.length > 0) {
    lines.push(
      formatTable(
        ["#", "Name", "Score", "Rated Axes"],
        result.scored.map((g, i) => [
          String(i + 1),
          g.gameName,
          formatScore(g.score),
          `${g.ratedAxisCount}/${g.totalAxisCount}`,
        ]),
      ),
    );
  }

  if (result.unscored.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Unscored:");
    for (const g of result.unscored) {
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

  const result = data as ScoreGetResponse;

  if (result.score === null) {
    return `${result.gameName}: not yet rated`;
  }

  const lines: string[] = [];
  lines.push(`${result.gameName}`);
  lines.push(
    `Fitness: ${formatScore(result.score)} (${result.ratedAxisCount}/${result.totalAxisCount} axes rated)`,
  );
  lines.push("");

  if (result.breakdown && result.breakdown.length > 0) {
    lines.push(formatBreakdown(result.breakdown));
  }

  return lines.join("\n");
}

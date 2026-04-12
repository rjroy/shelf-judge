// Score commands: list, get
import type { DaemonClient } from "../client.js";
import type { OutputOptions, BreakdownEntry } from "../output.js";
import { formatTable, formatScore, formatBreakdown, printOutput } from "../output.js";
import type {
  TournamentGameStatsDisplay,
  GameWithScore,
  NichePosition,
  RedundancyAdjustment,
} from "@shelf-judge/shared";

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

interface ScoreListOpts extends OutputOptions {
  includePredicted?: boolean;
  showNiches?: boolean;
  showRedundancy?: boolean;
}

export async function scoreList(
  client: DaemonClient,
  _args: string[],
  opts: ScoreListOpts,
): Promise<string> {
  if (opts.includePredicted || opts.showNiches || opts.showRedundancy) {
    return scoreListWithPredictions(client, opts);
  }

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

  // Fetch game detail for niche position and redundancy data (best-effort)
  const detailRes = await client.get<GameWithScore>(`/api/games/${encodeURIComponent(id)}`);
  if (detailRes.ok) {
    const adj = detailRes.data.score?.redundancyAdjustment;
    if (adj) {
      lines.push("");
      lines.push(formatRedundancyDetail(adj, detailRes.data.score!.score));
    }

    if (detailRes.data.nichePosition) {
      lines.push("");
      lines.push(formatNichePosition(detailRes.data.nichePosition, data.vetoed ?? false));
    }
  }

  return lines.join("\n");
}

async function scoreListWithPredictions(
  client: DaemonClient,
  opts: ScoreListOpts,
): Promise<string> {
  const params: string[] = [];
  if (opts.includePredicted) params.push("includePredicted=true");
  if (opts.showNiches) params.push("includeNiches=true");
  const qs = params.length > 0 ? `?${params.join("&")}` : "";

  const { ok, data } = await client.get<GameWithScore[]>(`/api/games${qs}`);

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "List failed");
  }

  if (opts.json) return printOutput(data, opts);

  const scored = data.filter((e) => e.score !== null);
  const unscored = data.filter((e) => e.score === null);

  const lines: string[] = [];

  if (scored.length > 0) {
    const headers = ["#", "Name", "Score", "Rated Axes", ""];
    if (opts.showRedundancy) headers.push("Adjusted");
    if (opts.showNiches) headers.push("Niches");

    lines.push(
      formatTable(
        headers,
        scored.map((e, i) => {
          const s = e.score!;
          const isPredicted = s.predictionMeta !== null && s.predictionMeta !== undefined;
          const marker = isPredicted ? "[P]" : "";
          const row = [
            String(i + 1),
            e.game.name,
            s.vetoed ? `VETOED (${formatScore(s.hypotheticalScore)})` : formatScore(s.score),
            `${s.ratedAxisCount}/${s.totalAxisCount}`,
            marker,
          ];
          if (opts.showRedundancy) {
            row.push(formatRedundancySummary(s.redundancyAdjustment ?? null));
          }
          if (opts.showNiches) {
            row.push(formatNicheSummary(e.nichePosition ?? null, s.vetoed));
          }
          return row;
        }),
      ),
    );
  }

  if (unscored.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Unscored:");
    for (const e of unscored) {
      lines.push(`  ${e.game.name} - not yet rated`);
    }
  }

  if (lines.length === 0) {
    return "(no games)";
  }

  return lines.join("\n");
}

function formatNicheSummary(nichePosition: NichePosition | null, vetoed: boolean): string {
  if (vetoed) return "vetoed";
  if (!nichePosition || nichePosition.niches.length === 0) return "---";
  const champCount = nichePosition.niches.filter((n) => n.isChampion).length;
  const total = nichePosition.niches.length;
  if (champCount > 0) {
    return `${total} niches, champ of ${champCount}`;
  }
  return `${total} niches`;
}

function formatRedundancySummary(adj: RedundancyAdjustment | null): string {
  if (!adj) return "---";
  if (adj.penalty === 0) return formatScore(adj.adjustedScore);
  return `${formatScore(adj.adjustedScore)} (-${adj.penalty.toFixed(1)})`;
}

function formatRedundancyDetail(adj: RedundancyAdjustment, currentScore: number): string {
  const lines: string[] = ["Redundancy:"];
  const isIntegrated = currentScore !== adj.originalScore;

  if (adj.penalty === 0) {
    lines.push(`  Best among ${adj.nicheSize} similar games (rank #${adj.nicheRank})`);
  } else if (isIntegrated) {
    lines.push(
      `  Fitness: ${formatScore(adj.adjustedScore)} (was ${formatScore(adj.originalScore)}, -${adj.penalty.toFixed(1)} redundancy)`,
    );
    lines.push(`  Niche rank: #${adj.nicheRank} of ${adj.nicheSize} similar games`);
  } else {
    lines.push(
      `  Would be ${formatScore(adj.adjustedScore)} with redundancy applied (-${adj.penalty.toFixed(1)} penalty)`,
    );
    lines.push(`  Niche rank: #${adj.nicheRank} of ${adj.nicheSize} similar games`);
  }

  if (adj.nicheNeighbors.length > 0) {
    lines.push("  Top neighbors:");
    const top = adj.nicheNeighbors.slice(0, 5);
    for (const n of top) {
      const predicted = n.isPredicted ? " [P]" : "";
      lines.push(
        `    ${n.gameName} (similarity: ${(n.similarity * 100).toFixed(0)}%, fitness: ${formatScore(n.fitnessScore)})${predicted}`,
      );
    }
  }

  return lines.join("\n");
}

function formatNichePosition(nichePosition: NichePosition, vetoed: boolean): string {
  if (vetoed) {
    return "This game is vetoed and excluded from niche rankings.";
  }

  if (nichePosition.niches.length === 0) return "";

  const lines: string[] = ["Niche Position:"];
  for (const niche of nichePosition.niches) {
    lines.push(`  ${niche.name} (${niche.size} games) [${niche.type}]`);
    lines.push(
      `    Rank: #${niche.rank} of ${niche.size}  |  Champion: ${niche.champion.gameName} (${formatScore(niche.champion.fitnessScore)})`,
    );

    const aboveStr =
      niche.above.length > 0
        ? niche.above.map((n) => `${n.gameName} (${formatScore(n.fitnessScore)})`).join(", ")
        : "(none)";
    const belowStr =
      niche.below.length > 0
        ? niche.below.map((n) => `${n.gameName} (${formatScore(n.fitnessScore)})`).join(", ")
        : "(none)";
    lines.push(`    Above: ${aboveStr}  |  Below: ${belowStr}`);
  }
  return lines.join("\n");
}

// Predict commands: predict <game-id>, predict readiness
import type { DaemonClient } from "../client.js";
import type { OutputOptions } from "../output.js";
import { formatTable, formatScore, formatBreakdown, printOutput } from "../output.js";
import type { PredictedGameResponse, PredictionReadiness } from "@shelf-judge/shared";

export async function predictGame(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const id = args[0];
  if (!id) {
    throw new Error("Usage: shelf-judge predict <game-id>");
  }

  const { ok, data } = await client.get<PredictedGameResponse>(
    `/api/predictions/${encodeURIComponent(id)}`,
  );

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Prediction failed");
  }

  if (opts.json) return printOutput(data, opts);

  const lines: string[] = [];
  const { game, score, tension } = data;

  lines.push(game.name);

  if (score.vetoed && score.vetoedBy) {
    lines.push(`Predicted Fitness: VETOED (hypothetical: ${formatScore(score.hypotheticalScore)})`);
    const dir = score.vetoedBy.direction === "below" ? "below" : "above";
    lines.push(
      `Veto: "${score.vetoedBy.axisName}" scored ${score.vetoedBy.rawValue} (threshold: ${dir} ${score.vetoedBy.threshold})`,
    );
  } else {
    lines.push(
      `Predicted Fitness: ${formatScore(score.score)} (${score.ratedAxisCount}/${score.totalAxisCount} axes rated)`,
    );
  }

  if (score.predictionMeta) {
    const meta = score.predictionMeta;
    lines.push(
      `Prediction: ${meta.predictedAxisCount} predicted, ${meta.actualAxisCount} actual, ${meta.referenceGameCount} reference games`,
    );
    lines.push(
      `Confidence: ${meta.confidence} (${(meta.coveragePercent * 100).toFixed(0)}% coverage, stage ${meta.readinessStage})`,
    );
  }

  if (tension) {
    lines.push("");
    lines.push(
      `[tension] Predicted fitness (${formatScore(tension.predictedFitness)}) vs tournament cluster (${formatScore(tension.tournamentClusterAverage)})`,
    );
    lines.push(`  ${tension.note}`);
  }

  lines.push("");

  if (score.breakdown && score.breakdown.length > 0) {
    lines.push(formatBreakdown(score.breakdown));

    // Show reference games for predicted axes
    const predictedAxes = score.breakdown.filter(
      (e) => e.source === "predicted" && e.referenceGames && e.referenceGames.length > 0,
    );
    if (predictedAxes.length > 0) {
      lines.push("");
      lines.push("Reference Games:");
      for (const axis of predictedAxes) {
        lines.push(`  ${axis.axisName}:`);
        for (const ref of axis.referenceGames!) {
          lines.push(`    ${ref.gameName} (similarity: ${ref.similarity.toFixed(2)})`);
        }
      }
    }
  }

  return lines.join("\n");
}

export async function predictReadiness(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const { ok, data } = await client.get<PredictionReadiness>("/api/predictions/readiness");

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Readiness check failed");
  }

  if (opts.json) return printOutput(data, opts);

  const lines: string[] = [];

  const stageLabels: Record<number, string> = {
    0: "Not Ready",
    1: "Basic",
    2: "Good",
    3: "Strong",
  };

  lines.push(`Prediction Readiness: Stage ${data.stage} (${stageLabels[data.stage] ?? "Unknown"})`);
  lines.push(`Rated Games: ${data.ratedGameCount}`);
  if (data.stage < 3) {
    lines.push(`Next Stage At: ${data.nextStageAt} rated games`);
  }

  if (data.weakAxes.length > 0) {
    lines.push("");
    lines.push("Weak Axes:");
    lines.push(
      formatTable(
        ["Axis", "Rated Count"],
        data.weakAxes.map((a) => [a.axisName, String(a.ratedCount)]),
      ),
    );
  }

  if (data.suggestedActions.length > 0) {
    lines.push("");
    lines.push("Suggested Actions:");
    for (const action of data.suggestedActions) {
      lines.push(`  - ${action}`);
    }
  }

  return lines.join("\n");
}

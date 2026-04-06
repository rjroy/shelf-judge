import type { FitnessResult } from "@shelf-judge/shared";

function scoreRangeClass(score: number): string {
  if (score >= 7.5) return "high";
  if (score >= 5.0) return "mid";
  return "low";
}

export function ScoreBadge({ score }: { score: FitnessResult | null }) {
  if (!score) {
    return <span className="score-badge-not-rated">not rated</span>;
  }

  return (
    <span className="score-badge-inline">
      <span className={`score-dot ${scoreRangeClass(score.score)}`} />
      <span className="score-value">{score.score.toFixed(1)}</span>
    </span>
  );
}

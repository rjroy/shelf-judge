import type { FitnessResult } from "@shelf-judge/shared";
import { scoreRangeClass } from "@/lib/score-utils";

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

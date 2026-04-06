import type { FitnessResult } from "@shelf-judge/shared";

function scoreRangeClass(score: number): string {
  if (score >= 7.5) return "high";
  if (score >= 5.0) return "mid";
  return "low";
}

export function ScoreBadge({ score }: { score: FitnessResult | null }) {
  if (!score) {
    return (
      <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: 12 }}>
        not rated
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          flexShrink: 0,
          background: `var(--score-${scoreRangeClass(score.score)})`,
        }}
      />
      <span
        style={{
          fontWeight: 700,
          color: "var(--score-color)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {score.score.toFixed(1)}
      </span>
    </span>
  );
}

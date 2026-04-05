import type { FitnessResult } from "@shelf-judge/shared";

export function ScoreBadge({ score }: { score: FitnessResult | null }) {
  if (!score) {
    return <span style={{ color: "#999", fontStyle: "italic" }}>not yet rated</span>;
  }

  // Color from red (1) through yellow (5) to green (10)
  const hue = ((score.score - 1) / 9) * 120; // 0=red, 120=green
  const backgroundColor = `hsl(${hue}, 60%, 45%)`;

  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        backgroundColor,
        color: "white",
        fontWeight: 600,
        fontSize: 14,
      }}
    >
      {score.score.toFixed(1)}
    </span>
  );
}

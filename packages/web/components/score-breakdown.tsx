import type { FitnessResult } from "@shelf-judge/shared";
import { ScoreBadge } from "./score-badge";

export function ScoreBreakdown({ score }: { score: FitnessResult | null }) {
  if (!score) {
    return (
      <p style={{ color: "#999", fontStyle: "italic" }}>
        Not yet rated. Rate this game on at least one axis to see a fitness score.
      </p>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 14, color: "#666" }}>Overall:</span>
        <ScoreBadge score={score} />
        <span style={{ fontSize: 13, color: "#999" }}>
          ({score.ratedAxisCount} of {score.totalAxisCount} axes rated)
        </span>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #e0e0e0", textAlign: "left" }}>
            <th style={{ padding: "6px 10px" }}>Axis</th>
            <th style={{ padding: "6px 10px" }}>Rating</th>
            <th style={{ padding: "6px 10px" }}>Weight</th>
            <th style={{ padding: "6px 10px" }}>Contribution</th>
            <th style={{ padding: "6px 10px" }}>Source</th>
          </tr>
        </thead>
        <tbody>
          {score.breakdown.map((entry) => (
            <tr key={entry.axisId} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "6px 10px" }}>{entry.axisName}</td>
              <td style={{ padding: "6px 10px" }}>
                {entry.rating !== null ? (
                  entry.rating.toFixed(1)
                ) : (
                  <span style={{ color: "#999", fontStyle: "italic" }}>not rated</span>
                )}
              </td>
              <td style={{ padding: "6px 10px" }}>{entry.weight}</td>
              <td style={{ padding: "6px 10px" }}>
                {entry.contribution !== null ? entry.contribution.toFixed(2) : "-"}
              </td>
              <td style={{ padding: "6px 10px" }}>
                <SourceLabel source={entry.source} bggOriginal={entry.bggOriginal} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourceLabel({ source, bggOriginal }: { source: string; bggOriginal: number | null }) {
  if (source === "override" && bggOriginal !== null) {
    return (
      <span>
        <span style={{ color: "#7c3aed" }}>Override</span>
        <span style={{ color: "#999", fontSize: 12, marginLeft: 4 }}>
          (BGG: {bggOriginal.toFixed(1)})
        </span>
      </span>
    );
  }
  if (source === "bgg") {
    return <span style={{ color: "#059669" }}>BGG</span>;
  }
  return <span style={{ color: "#2563eb" }}>Personal</span>;
}

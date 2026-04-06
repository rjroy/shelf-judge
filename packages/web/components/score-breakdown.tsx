import type { FitnessResult } from "@shelf-judge/shared";

export function ScoreBreakdown({ score }: { score: FitnessResult | null }) {
  if (!score) {
    return (
      <p className="bgg-data-line" style={{ fontStyle: "italic" }}>
        Not yet rated. Rate this game on at least one axis to see a fitness score.
      </p>
    );
  }

  const totalWeight = score.breakdown
    .filter((e) => e.rating !== null)
    .reduce((sum, e) => sum + e.weight, 0);

  return (
    <table className="breakdown-table">
      <thead>
        <tr>
          <th>Axis</th>
          <th className="right">Rating</th>
          <th className="right">Weight</th>
          <th className="right">Contribution</th>
          <th style={{ textAlign: "right" }}>Source</th>
        </tr>
      </thead>
      <tbody>
        {score.breakdown.map((entry) => {
          const rowClass =
            entry.source === "override" ? "override-row" : entry.source === "bgg" ? "bgg-row" : "";
          const contribPct =
            entry.contribution !== null && totalWeight > 0
              ? Math.round((entry.contribution / score.score) * 100)
              : null;

          return (
            <tr key={entry.axisId} className={rowClass}>
              <td style={{ fontWeight: 500 }}>
                {entry.axisName}
                {entry.source === "override" && entry.bggOriginal !== null && (
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
                    BGG value: {entry.bggOriginal.toFixed(1)} → scaled{" "}
                    {Math.round(entry.bggOriginal)}
                  </div>
                )}
              </td>
              <td className="right">
                {entry.rating !== null ? (
                  entry.rating
                ) : (
                  <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>—</span>
                )}
              </td>
              <td className="right">{entry.weight}</td>
              <td className="right">
                {contribPct !== null ? (
                  <div className="contrib-cell">
                    <div className="contrib-bar-track">
                      <div className="contrib-bar-fill" style={{ width: `${contribPct}%` }} />
                    </div>
                    <span className="contrib-pct">{contribPct}%</span>
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td style={{ textAlign: "right" }}>
                <SourceBadge source={entry.source} />
              </td>
            </tr>
          );
        })}
        <tr className="total-row">
          <td colSpan={3} style={{ fontWeight: 700 }}>
            Fitness Score
          </td>
          <td colSpan={2} style={{ textAlign: "right" }}>
            {score.score.toFixed(1)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function SourceBadge({ source }: { source: string }) {
  if (source === "override") {
    return <span className="source-badge source-override">Override</span>;
  }
  if (source === "bgg") {
    return <span className="source-badge source-bgg">BGG</span>;
  }
  return <span className="source-badge source-personal">Personal</span>;
}

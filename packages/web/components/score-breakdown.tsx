import type { FitnessResult } from "@shelf-judge/shared";

export function ScoreBreakdown({ score }: { score: FitnessResult | null }) {
  if (!score) {
    return (
      <p className="bgg-data-line breakdown-empty">
        Not yet rated. Rate this game on at least one axis to see a fitness score.
      </p>
    );
  }

  const totalWeight = score.breakdown
    .filter((e) => e.rating !== null)
    .reduce((sum, e) => sum + e.weight, 0);

  const displayScore = score.vetoed ? (score.hypotheticalScore ?? 0) : score.score;

  return (
    <>
      {/* Veto banner */}
      {score.vetoed && score.vetoedBy && (
        <div className="veto-banner">
          <div className="veto-banner-title">VETOED</div>
          <div className="veto-banner-detail">
            <strong>{score.vetoedBy.axisName}</strong> scored {score.vetoedBy.rawValue.toFixed(1)}{" "}
            (threshold: {score.vetoedBy.direction} {score.vetoedBy.threshold})
          </div>
          {score.hypotheticalScore !== null && (
            <div className="veto-banner-hypothetical">
              Without veto, fitness would be {score.hypotheticalScore.toFixed(1)}
            </div>
          )}
        </div>
      )}

      <table className={`breakdown-table${score.vetoed ? " breakdown-vetoed" : ""}`}>
        <thead>
          <tr>
            <th>Axis</th>
            <th className="right">Raw</th>
            <th className="right">Effective</th>
            <th className="right">Weight</th>
            <th className="right">Contribution</th>
            <th className="right">Source</th>
          </tr>
        </thead>
        <tbody>
          {score.breakdown.map((entry) => {
            const rowClass = [
              entry.source === "override"
                ? "override-row"
                : entry.source === "bgg"
                  ? "bgg-row"
                  : "",
              entry.curveAffected ? "curve-affected-row" : "",
            ]
              .filter(Boolean)
              .join(" ");

            const contribPct =
              entry.contribution !== null && totalWeight > 0 && displayScore > 0
                ? Math.round((entry.contribution / displayScore) * 100)
                : null;

            // Show raw when it differs from effective (different scale or curve applied)
            const showRaw =
              entry.rawValue !== null &&
              entry.effectiveRating !== null &&
              Math.abs(entry.rawValue - entry.effectiveRating) > 0.05;

            return (
              <tr key={entry.axisId} className={rowClass}>
                <td className="breakdown-name-cell">
                  {entry.axisName}
                  {entry.curveAffected && (
                    <span className="curve-indicator" title="Curve applied">
                      ~
                    </span>
                  )}
                  {entry.source === "override" && entry.bggOriginal !== null && (
                    <div className="breakdown-override-detail">
                      BGG: {entry.bggOriginal.toFixed(1)}
                    </div>
                  )}
                </td>
                <td className="right breakdown-raw">
                  {showRaw && entry.rawValue !== null ? (
                    entry.rawValue.toFixed(1)
                  ) : (
                    <span className="breakdown-dash">&mdash;</span>
                  )}
                </td>
                <td className="right">
                  {entry.rating !== null ? (
                    entry.rating
                  ) : (
                    <span className="breakdown-dash">&mdash;</span>
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
                    <span className="breakdown-dash">&mdash;</span>
                  )}
                </td>
                <td className="right">
                  <SourceBadge source={entry.source} />
                </td>
              </tr>
            );
          })}
          <tr className="total-row">
            <td colSpan={4} className="total-label">
              {score.vetoed ? "Hypothetical Score" : "Fitness Score"}
            </td>
            <td colSpan={2} className="right">
              {score.vetoed ? (
                <span className="score-hypothetical">{displayScore.toFixed(1)}</span>
              ) : (
                score.score.toFixed(1)
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </>
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

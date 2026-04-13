"use client";

import { useState } from "react";
import Link from "next/link";
import type {
  FitnessResult,
  FitnessBreakdownEntry,
  PredictionConfidence,
  ReferenceGame,
} from "@shelf-judge/shared";

export function ScoreBreakdown({
  score,
  isPreviouslyOwned = false,
}: {
  score: FitnessResult | null;
  isPreviouslyOwned?: boolean;
}) {
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
  const hasPredictions = score.predictionMeta !== null;

  const predictedCount = score.breakdown.filter((e) => e.source === "predicted").length;
  const actualCount = score.breakdown.filter(
    (e) => e.source !== "predicted" && e.rating !== null,
  ).length;
  const excludedCount = score.breakdown.filter(
    (e) => e.source === "predicted" && e.predictionConfidence === "insufficient",
  ).length;

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
          {score.breakdown.map((entry) => (
            <BreakdownRow
              key={entry.axisId}
              entry={entry}
              totalWeight={totalWeight}
              displayScore={displayScore}
            />
          ))}
          {isPreviouslyOwned && (
            <>
              <tr className="excluded-row">
                <td>
                  Niche bonus <span className="excluded-label">Excluded</span>
                </td>
                <td className="right">&ndash;</td>
                <td className="right">&ndash;</td>
                <td className="right">&ndash;</td>
                <td className="right">&ndash;</td>
                <td className="right">&ndash;</td>
              </tr>
              <tr className="excluded-row">
                <td>
                  Redundancy adj. <span className="excluded-label">Excluded</span>
                </td>
                <td className="right">&ndash;</td>
                <td className="right">&ndash;</td>
                <td className="right">&ndash;</td>
                <td className="right">&ndash;</td>
                <td className="right">&ndash;</td>
              </tr>
            </>
          )}
          <tr className="total-row">
            <td colSpan={4} className="total-label">
              {score.vetoed
                ? "Hypothetical Score"
                : hasPredictions
                  ? "~Predicted Fitness"
                  : "Fitness Score"}
            </td>
            <td colSpan={2} className="right">
              {score.vetoed ? (
                <span className="score-hypothetical">{displayScore.toFixed(1)}</span>
              ) : hasPredictions ? (
                <span className="score-predicted">
                  ~{score.score.toFixed(1)}
                  <span
                    style={{
                      fontSize: "11px",
                      color: "var(--text-secondary)",
                      marginLeft: "8px",
                      fontWeight: 400,
                    }}
                  >
                    {actualCount} actual, {predictedCount - excludedCount} predicted
                    {excludedCount > 0 ? `, ${excludedCount} excl.` : ""}
                  </span>
                </span>
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

function BreakdownRow({
  entry,
  totalWeight,
  displayScore,
}: {
  entry: FitnessBreakdownEntry;
  totalWeight: number;
  displayScore: number;
}) {
  const [expanded, setExpanded] = useState(false);

  const isPredicted = entry.source === "predicted";
  const isInsufficient = isPredicted && entry.predictionConfidence === "insufficient";

  const rowClass = [
    entry.source === "override"
      ? "override-row"
      : entry.source === "bgg"
        ? "bgg-row"
        : isPredicted
          ? isInsufficient
            ? "predicted-row insufficient-row"
            : "predicted-row"
          : "",
    entry.curveAffected ? "curve-affected-row" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const contribPct =
    entry.contribution !== null && totalWeight > 0 && displayScore > 0
      ? Math.round((entry.contribution / displayScore) * 100)
      : null;

  const showRaw =
    entry.rawValue !== null &&
    entry.effectiveRating !== null &&
    Math.abs(entry.rawValue - entry.effectiveRating) > 0.05;

  return (
    <>
      <tr className={rowClass}>
        <td className="breakdown-name-cell">
          {entry.axisName}
          {entry.curveAffected && (
            <span className="curve-indicator" title="Curve applied">
              ~
            </span>
          )}
          {isPredicted && entry.predictionConfidence && (
            <ConfidenceBadge
              level={entry.predictionConfidence}
              clickable={entry.referenceGames !== null && entry.referenceGames.length > 0}
              onClick={() => setExpanded((v) => !v)}
            />
          )}
          {entry.source === "override" && entry.bggOriginal !== null && (
            <div className="breakdown-override-detail">BGG: {entry.bggOriginal.toFixed(1)}</div>
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
          {entry.rating !== null ? entry.rating : <span className="breakdown-dash">&mdash;</span>}
        </td>
        <td className="right">{entry.weight}</td>
        <td className="right">
          {isInsufficient ? (
            <span className="breakdown-dash" style={{ fontSize: "11px" }}>
              excl.
            </span>
          ) : contribPct !== null ? (
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
      {expanded && isPredicted && entry.referenceGames && entry.referenceGames.length > 0 && (
        <tr>
          <td colSpan={6} style={{ padding: 0 }}>
            <ConfidenceBreakdownPanel
              axisName={entry.axisName}
              confidence={entry.predictionConfidence!}
              referenceGames={entry.referenceGames}
              rating={entry.rating}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function ConfidenceBadge({
  level,
  clickable,
  onClick,
}: {
  level: PredictionConfidence;
  clickable?: boolean;
  onClick?: () => void;
}) {
  const label =
    level === "strong"
      ? "Strong"
      : level === "moderate"
        ? "Moderate"
        : level === "weak"
          ? "Weak"
          : level === "insufficient"
            ? "Insufficient"
            : "Actual";

  return (
    <span
      className={`conf-badge conf-${level}`}
      style={clickable ? { cursor: "pointer" } : undefined}
      onClick={clickable ? onClick : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
    >
      {label}
    </span>
  );
}

function ConfidenceBreakdownPanel({
  axisName,
  confidence,
  referenceGames,
  rating,
}: {
  axisName: string;
  confidence: PredictionConfidence;
  referenceGames: ReferenceGame[];
  rating: number | null;
}) {
  const avgSimilarity =
    referenceGames.length > 0
      ? referenceGames.reduce((sum, g) => sum + g.similarity, 0) / referenceGames.length
      : 0;

  return (
    <div className="conf-panel">
      <div className="conf-panel-title">
        {axisName} &mdash; Confidence Breakdown
        <ConfidenceBadge level={confidence} />
      </div>

      <div className="conf-stats">
        <div className="conf-stat">
          <div className="conf-stat-value">{referenceGames.length}</div>
          <div className="conf-stat-label">Reference Games</div>
        </div>
        <div className="conf-stat">
          <div className="conf-stat-value">{avgSimilarity.toFixed(2)}</div>
          <div className="conf-stat-label">Avg Similarity</div>
        </div>
        <div className="conf-stat">
          <div className="conf-stat-value">{rating !== null ? rating.toFixed(1) : "-"}</div>
          <div className="conf-stat-label">Predicted Rating</div>
        </div>
      </div>

      <div className="ref-game-list">
        {referenceGames.map((ref) => (
          <div key={ref.gameId} className="ref-game-item">
            <Link href={`/games/${ref.gameId}`} className="game-link ref-game-name">
              {ref.gameName}
            </Link>
            <div className="ref-game-sim-track">
              <div
                className="ref-game-sim-fill"
                style={{ width: `${Math.round(ref.similarity * 100)}%` }}
              />
            </div>
            <span className="ref-game-sim-value">{ref.similarity.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  if (source === "override") {
    return <span className="source-badge source-override">Override</span>;
  }
  if (source === "bgg") {
    return <span className="source-badge source-bgg">BGG</span>;
  }
  if (source === "predicted") {
    return <span className="source-badge source-predicted">Predicted</span>;
  }
  return <span className="source-badge source-personal">Personal</span>;
}

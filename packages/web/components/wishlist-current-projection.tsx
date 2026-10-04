import { useState } from "react";
import type { CurrentWishlistRow } from "@/lib/wishlist-current-projection-view-model";

/** Inert until Phase 6 binds this current-result card to the loaded wishlist page. */
export function WishlistCurrentProjectionCard({ row }: { row: CurrentWishlistRow }) {
  const [expanded, setExpanded] = useState(false);
  const { entry, prediction } = row;

  return (
    <article className="wishlist-card" aria-label={`${entry.name} current prediction`}>
      <div className="wc-main wc-main--compact-thumb">
        <div className="wc-thumb">
          {entry.thumbnailUrl ? <img src={entry.thumbnailUrl} alt={entry.name} /> : null}
        </div>
        <div className="wc-info">
          <div className="wc-name">
            <a
              href={`https://boardgamegeek.com/boardgame/${entry.bggId}`}
              className="game-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              {entry.name}
            </a>
          </div>
          {entry.yearPublished ? <div className="wc-year">{entry.yearPublished}</div> : null}
          {prediction ? (
            <div className="wc-score-row">
              <span className="wc-score-prefix">~</span>
              <span className="wc-score">{prediction.score.toFixed(1)}</span>
              <span
                className={`confidence-badge confidence-${prediction.predictionMeta?.confidence ?? "unknown"}`}
              >
                {prediction.predictionMeta?.confidence ?? "Confidence unavailable"}
              </span>
              <span className="wc-added">Current prediction</span>
            </div>
          ) : (
            <div className="wc-no-prediction">
              <strong>Current prediction unavailable</strong>
              <div>{row.unavailableMessage}</div>
            </div>
          )}
          {prediction && (
            <div className="wc-added">
              Current prediction uses {prediction.ratedAxisCount} of {prediction.totalAxisCount}{" "}
              rated axes.
            </div>
          )}
          {row.redundancyScore !== null && (
            <div className="wc-added">
              {row.redundancyAdjusted
                ? "With redundancy"
                : row.redundancySource === "base-prediction"
                  ? "Base prediction"
                  : "Current comparison score"}
              : {row.redundancyScore.toFixed(1)}
            </div>
          )}
        </div>
      </div>
      {prediction && prediction.breakdown.length > 0 && (
        <div className="wc-expand">
          <button
            className="wc-expand-toggle"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
          >
            <span className={`wc-expand-caret${expanded ? " open" : ""}`} aria-hidden="true">
              {"\u25B6"}
            </span>
            <span>Per-axis breakdown</span>
            <span style={{ color: "var(--predict-accent)", fontSize: 11, marginLeft: 4 }}>
              {prediction.breakdown.length} axes
            </span>
          </button>
          {expanded && (
            <div className="wc-breakdown">
              {prediction.breakdown.map((axis) => (
                <div key={axis.axisId} className="wc-breakdown-row">
                  <span className="wc-axis-name">{axis.axisName}</span>
                  <span className="wc-axis-rating">{axis.effectiveRating ?? "—"}</span>
                  <span
                    className={`conf-badge-sm ${axis.predictionConfidence ?? "actual"}`}
                    aria-label={`${axis.predictionConfidence ?? "actual"} confidence`}
                  >
                    {axis.predictionConfidence ?? "Actual"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

import { useState } from "react";
import type { CurrentWishlistRow } from "@/lib/wishlist-current-projection-view-model";
import { relativeDate } from "@/lib/date-utils";

/** Inert until Phase 6 binds this current-result card to the loaded wishlist page. */
export function WishlistCurrentProjectionCard({
  row,
  onRemove,
  onRefresh,
  onAddToCollection,
}: {
  row: CurrentWishlistRow;
  onRemove: (id: string) => void;
  onRefresh: (id: string) => Promise<void>;
  onAddToCollection: (bggId: number) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
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
              {prediction.vetoed && <span className="wc-added">Vetoed</span>}
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
          {row.redundancySource === "current" && row.redundancyAdjustment && (
            <div className="preview-redundancy" aria-label="Current redundancy adjustment">
              <div className="preview-redundancy-title">Redundancy</div>
              <p className="preview-redundancy-provenance">
                Current comparison using the signals available now.
              </p>
              <div className="preview-redundancy-score">
                With redundancy:{" "}
                <strong>{row.redundancyAdjustment.adjustedScore.toFixed(1)}</strong>
                {row.redundancyAdjustment.penalty > 0 && (
                  <span className="preview-redundancy-penalty">
                    {" "}
                    (-{row.redundancyAdjustment.penalty.toFixed(1)})
                  </span>
                )}
              </div>
              {row.redundancyAdjustment.nicheNeighbors.length > 0 ? (
                <div className="preview-redundancy-neighbors">
                  {row.redundancyAdjustment.nicheNeighbors.slice(0, 3).map((neighbor) => (
                    <div key={neighbor.gameId} className="preview-redundancy-neighbor">
                      <span className="preview-redundancy-neighbor-name">{neighbor.gameName}</span>
                      <span className="preview-redundancy-neighbor-sim">
                        {(neighbor.similarity * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="preview-redundancy-empty">No similar games in collection.</div>
              )}
            </div>
          )}
          {row.redundancySource === "current" && !row.redundancyAdjustment && (
            <div className="wc-added">Current comparison; no adjustment is available.</div>
          )}
          {row.redundancyScore !== null && !row.redundancyAdjusted && (
            <div className="wc-added">
              {row.redundancySource === "base-prediction"
                ? "Base prediction"
                : "Current ordering score"}
              : {row.redundancyScore.toFixed(1)}
            </div>
          )}
          <div className="wc-added">Added {relativeDate(entry.addedAt)}</div>
        </div>
        <div className="wc-actions">
          <button
            className="btn btn-primary btn-sm"
            disabled={adding}
            onClick={() => {
              setAdding(true);
              void onAddToCollection(entry.bggId).finally(() => setAdding(false));
            }}
          >
            {adding ? "Adding…" : "Add to Collection"}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true);
              void onRefresh(entry.id).finally(() => setRefreshing(false));
            }}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button className="btn btn-danger-ghost btn-xs" onClick={() => onRemove(entry.id)}>
            Remove
          </button>
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

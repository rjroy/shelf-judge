import type { CollectionProfileAxisDistribution } from "@shelf-judge/shared";

const ratingLabels = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

export function CollectionProfileAxisDistributions({
  distributions,
}: {
  distributions: CollectionProfileAxisDistribution[];
}) {
  if (distributions.length === 0) {
    return (
      <p className="profile-state" data-axis-state="empty">
        No axis distributions are available.
      </p>
    );
  }
  return (
    <div className="axis-diagnostic-list">
      {distributions.map((distribution) => (
        <section
          key={distribution.axisId}
          className="axis-diagnostic"
          aria-labelledby={`axis-${distribution.axisId}`}
        >
          <h2 id={`axis-${distribution.axisId}`}>{distribution.axisName}</h2>
          <p className="profile-status-label">Diagnostic distribution, not an identity claim</p>
          <dl className="profile-facts">
            <div>
              <dt>Rated games</dt>
              <dd>{distribution.ratedGameCount}</dd>
            </div>
            <div>
              <dt>Mean</dt>
              <dd>{distribution.mean.toFixed(1)}</dd>
            </div>
            <div>
              <dt>Median</dt>
              <dd>{distribution.median.toFixed(1)}</dd>
            </div>
            <div>
              <dt>Population standard deviation</dt>
              <dd>{distribution.standardDeviation.toFixed(1)}</dd>
            </div>
            <div>
              <dt>Range</dt>
              <dd>
                {distribution.range.min.toFixed(1)} to {distribution.range.max.toFixed(1)}
              </dd>
            </div>
          </dl>
          <ol
            className="axis-histogram"
            aria-label="Effective preference rating counts from 1 to 10"
          >
            {distribution.histogram.map((count, index) => (
              <li key={index}>
                <span>Rating {ratingLabels[index] ?? ""}</span>
                <strong>{count} games</strong>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

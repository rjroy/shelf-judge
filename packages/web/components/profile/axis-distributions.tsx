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
      {distributions.map((distribution) => {
        const maxCount = Math.max(...distribution.histogram, 1);

        return (
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
            <div className="axis-histogram-frame">
              <ol
                className="axis-histogram"
                aria-label="Effective preference rating counts from 1 to 10"
              >
                {distribution.histogram.map((count, index) => {
                  const rating = ratingLabels[index] ?? "";
                  const height = count === 0 ? "2px" : `${(count / maxCount) * 100}%`;

                  return (
                    <li
                      key={index}
                      aria-label={`Rating ${rating}: ${count} ${count === 1 ? "game" : "games"}`}
                    >
                      <strong className="axis-histogram-count">
                        {count}
                        <small>{count === 1 ? "game" : "games"}</small>
                      </strong>
                      <span className="axis-histogram-track" aria-hidden="true">
                        <span
                          className={`axis-histogram-bar${count === 0 ? " zero" : ""}`}
                          style={{ height }}
                        />
                      </span>
                      <span className="axis-histogram-rating" aria-hidden="true">
                        {rating}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
            <p className="axis-histogram-caption">Effective preference rating, 1-10</p>
          </section>
        );
      })}
    </div>
  );
}

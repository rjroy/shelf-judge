import type { AxisDistribution } from "@shelf-judge/shared";

export function AxisDistributions({
  distributions,
  gameCount,
}: {
  distributions: AxisDistribution[];
  gameCount: number;
}) {
  if (distributions.length === 0) return null;

  return (
    <div className="section-card">
      <div className="section-header">
        <span className="section-title-main">Axis Rating Distributions</span>
        <span className="section-count">
          {distributions.length} {distributions.length === 1 ? "axis" : "axes"} &middot; {gameCount}{" "}
          games
        </span>
      </div>
      <div className="section-body" style={{ paddingBottom: 4 }}>
        {distributions.map((dist) => {
          const maxCount = Math.max(...dist.histogram, 1);
          return (
            <div key={dist.axisId} className="axis-dist-row">
              <div className="axis-dist-top">
                <span className="axis-name">{dist.axisName}</span>
                <div className="axis-stats">
                  <div className="axis-stat">
                    <span className="axis-stat-val">{dist.mean.toFixed(1)}</span>
                    <span className="axis-stat-lbl">Mean</span>
                  </div>
                  <div className="axis-stat">
                    <span className="axis-stat-val">{dist.median.toFixed(1)}</span>
                    <span className="axis-stat-lbl">Median</span>
                  </div>
                  <div className="axis-stat">
                    <span className="axis-stat-val">{dist.standardDeviation.toFixed(1)}</span>
                    <span className="axis-stat-lbl">Std Dev</span>
                  </div>
                  <div className="axis-stat">
                    <span className="axis-stat-val">
                      {dist.range.min.toFixed(1)}&ndash;{dist.range.max.toFixed(1)}
                    </span>
                    <span className="axis-stat-lbl">Range</span>
                  </div>
                </div>
              </div>
              <div className="mini-histogram">
                {dist.histogram.map((count, i) => {
                  const height = Math.max(2, (count / maxCount) * 100);
                  const isPeak = count >= maxCount * 0.85;
                  const isZero = count === 0;
                  return (
                    <div
                      key={i}
                      className={`hist-bar${isPeak ? " peak" : ""}${isZero ? " zero" : ""}`}
                      style={{ height: `${height}%` }}
                    />
                  );
                })}
              </div>
              <div className="hist-labels">
                {Array.from({ length: 10 }, (_, i) => (
                  <span key={i} className="hist-label-tick">
                    {i + 1}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

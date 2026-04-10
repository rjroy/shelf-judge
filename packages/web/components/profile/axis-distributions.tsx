import type { AxisDistribution } from "@shelf-judge/shared";

function computeHistogramBuckets(
  distribution: AxisDistribution,
  ratedGameCount: number,
): { height: number; count: number; isPeak: boolean; isZero: boolean }[] {
  // Compute 10 buckets for ratings 1-10 based on distribution stats.
  // We generate approximate bucket counts from the distribution parameters.
  // In a real implementation the daemon would provide raw bucket counts;
  // for now we approximate using a normal distribution curve.
  const { mean, standardDeviation } = distribution;
  const sd = Math.max(standardDeviation, 0.5);
  const buckets: number[] = [];

  for (let i = 1; i <= 10; i++) {
    const z = (i - mean) / sd;
    buckets.push(Math.exp(-0.5 * z * z));
  }

  const maxVal = Math.max(...buckets);
  const peakThreshold = maxVal * 0.85;

  return buckets.map((val) => {
    const normalized = maxVal > 0 ? val / maxVal : 0;
    const height = Math.max(2, normalized * 100);
    return {
      height,
      count: Math.round(normalized * ratedGameCount),
      isPeak: val >= peakThreshold,
      isZero: normalized < 0.08,
    };
  });
}

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
          const buckets = computeHistogramBuckets(dist, dist.ratedGameCount);
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
                      {dist.range.min}&ndash;{dist.range.max}
                    </span>
                    <span className="axis-stat-lbl">Range</span>
                  </div>
                </div>
              </div>
              <div className="mini-histogram">
                {buckets.map((bucket, i) => (
                  <div
                    key={i}
                    className={`hist-bar${bucket.isPeak ? " peak" : ""}${bucket.isZero ? " zero" : ""}`}
                    style={{ height: `${bucket.height}%` }}
                  />
                ))}
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

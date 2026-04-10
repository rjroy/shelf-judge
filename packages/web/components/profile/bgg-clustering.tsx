import type { AttributeCluster, WeightRangeCluster } from "@shelf-judge/shared";

function AttributeList({
  label,
  clusters,
  gameCount,
}: {
  label: string;
  clusters: AttributeCluster[];
  gameCount: number;
}) {
  if (clusters.length === 0) return null;

  return (
    <div>
      <div className="bgg-section-label">{label}</div>
      {clusters.map((cluster) => {
        const pct = gameCount > 0 ? (cluster.count / gameCount) * 100 : 0;
        return (
          <div key={cluster.name} className="bgg-attr-row">
            <span className="bgg-attr-name">{cluster.name}</span>
            <div className="bgg-bar-track">
              <div className="bgg-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="bgg-attr-count">
              {cluster.count} ({Math.round(cluster.percentage)}%)
            </span>
          </div>
        );
      })}
    </div>
  );
}

function WeightRangeHistogram({ ranges }: { ranges: WeightRangeCluster[] }) {
  if (ranges.length === 0) return null;

  const maxCount = Math.max(...ranges.map((r) => r.count));
  const peakThreshold = maxCount * 0.85;

  return (
    <div>
      <div className="bgg-section-label">Complexity (BGG Weight)</div>
      <div className="weight-range-row">
        {ranges.map((range) => {
          const height = maxCount > 0 ? (range.count / maxCount) * 100 : 0;
          const isPeak = range.count >= peakThreshold;
          const isZero = range.count === 0;
          return (
            <div
              key={range.range}
              className={`wt-bucket${isPeak ? " peak" : ""}${isZero ? " zero" : ""}`}
              style={{ height: `${Math.max(4, height)}%` }}
            />
          );
        })}
      </div>
      <div className="weight-range-labels">
        {ranges.map((range) => (
          <span key={range.range}>{range.range}</span>
        ))}
      </div>
    </div>
  );
}

export function BggClustering({
  clustering,
  gameCount,
}: {
  clustering: {
    mechanics: AttributeCluster[];
    categories: AttributeCluster[];
    subdomains: AttributeCluster[];
    weightRanges: WeightRangeCluster[];
  };
  gameCount: number;
}) {
  const hasMechanics = clustering.mechanics.length > 0;
  const hasCategories = clustering.categories.length > 0;
  const hasSubdomains = clustering.subdomains.length > 0;
  const hasWeightRanges = clustering.weightRanges.length > 0;

  if (!hasMechanics && !hasCategories && !hasSubdomains && !hasWeightRanges) return null;

  return (
    <div className="section-card">
      <div className="section-header">
        <span className="section-title-main">BGG Attribute Concentrations</span>
        <span className="section-count">{gameCount} games</span>
      </div>
      <div className="section-body">
        <div className="two-col">
          <div>
            {hasMechanics && (
              <AttributeList
                label="Top Mechanics"
                clusters={clustering.mechanics}
                gameCount={gameCount}
              />
            )}
            {hasCategories && (
              <AttributeList
                label="Top Categories"
                clusters={clustering.categories}
                gameCount={gameCount}
              />
            )}
          </div>
          <div>
            {hasSubdomains && (
              <AttributeList
                label="Subdomains"
                clusters={clustering.subdomains}
                gameCount={gameCount}
              />
            )}
            {hasWeightRanges && <WeightRangeHistogram ranges={clustering.weightRanges} />}
          </div>
        </div>
      </div>
    </div>
  );
}

import type { CollectionOutlier, OutlierClassification } from "@shelf-judge/shared";

const HIGH_DISTANCE_THRESHOLD = 0.7;

const classificationLabels: Record<OutlierClassification, string> = {
  "lone-wolf": "Lone Wolf",
  "category-orphan": "Category Orphan",
  "high-fitness-outlier": "High-Fitness",
};

const classificationClasses: Record<OutlierClassification, string> = {
  "lone-wolf": "lone-wolf",
  "category-orphan": "category-orphan",
  "high-fitness-outlier": "high-fitness",
};

function DistanceChip({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  const isHigh = value >= HIGH_DISTANCE_THRESHOLD;
  return (
    <span className={`dist-component${isHigh ? " high" : ""}`}>
      {label}: {value.toFixed(2)}
    </span>
  );
}

export function Outliers({ outliers }: { outliers: CollectionOutlier[] }) {
  if (outliers.length === 0) return null;

  return (
    <div className="section-card">
      <div className="section-header">
        <span className="section-title-main">Collection Outliers</span>
        <span className="section-count">
          {outliers.length} {outliers.length === 1 ? "game" : "games"} &middot; composite distance
          &gt; 2&sigma;
        </span>
      </div>
      <div className="section-body">
        {outliers.map((outlier) => (
          <div key={outlier.gameId} className="outlier-row">
            <div className="outlier-info">
              <div className="outlier-name">{outlier.gameName}</div>
              <div className="outlier-reason">
                Composite distance <span>{outlier.distances.composite.toFixed(2)}</span> from
                collection centroid
              </div>
              <div className="outlier-distance">
                <DistanceChip label="Mechanics" value={outlier.distances.binary} />
                <DistanceChip label="BGG attrs" value={outlier.distances.continuous} />
                <DistanceChip label="Axis ratings" value={outlier.distances.personalAxes} />
              </div>
            </div>
            <div className="outlier-type-tags">
              {outlier.classifications.map((cls) => (
                <span key={cls} className={`outlier-type-tag ${classificationClasses[cls]}`}>
                  {classificationLabels[cls]}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

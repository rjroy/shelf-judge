import type { AxisWeightEntry } from "@shelf-judge/shared";

export function AxisWeights({ weights }: { weights: AxisWeightEntry[] }) {
  if (weights.length === 0) return null;

  const sorted = [...weights].sort((a, b) => b.percentage - a.percentage);

  return (
    <div className="section-card">
      <div className="section-header">
        <span className="section-title-main">Axis Importance</span>
        <span className="section-count">% of total weight</span>
      </div>
      <div className="section-body">
        {sorted.map((entry, i) => (
          <div key={entry.axisId} className="weight-row">
            <span className="weight-rank">{i + 1}</span>
            <span className="weight-name">{entry.axisName}</span>
            <div className="weight-bar-track">
              <div className="weight-bar-fill" style={{ width: `${entry.percentage}%` }} />
            </div>
            <span className="weight-pct">{Math.round(entry.percentage)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

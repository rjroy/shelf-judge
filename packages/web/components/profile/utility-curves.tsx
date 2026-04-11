import type { UtilityCurveDeclaration } from "@shelf-judge/shared";

function getShapeLabel(curve: UtilityCurveDeclaration): string {
  switch (curve.shape) {
    case "sweet-spot":
      return curve.leanDirection ? `Sweet spot (${curve.leanDirection}-lean)` : "Sweet spot";
    case "higher-is-better":
      return "Higher is better";
    case "lower-is-better":
      return "Lower is better";
    default:
      return curve.shape;
  }
}

function formatNativeValue(value: number, scale: { min: number; max: number }): string {
  if (Number.isInteger(value) && scale.max <= 100) return String(value);
  return value.toFixed(1);
}

export function UtilityCurves({ curves }: { curves: UtilityCurveDeclaration[] }) {
  // Only show axes with non-default curves (anything beyond plain higher-is-better with no extras)
  const configured = curves.filter(
    (c) =>
      c.shape !== "higher-is-better" ||
      c.idealValue !== null ||
      c.tolerance !== null ||
      c.vetoThreshold !== null,
  );

  if (configured.length === 0) return null;

  return (
    <div className="section-card">
      <div className="section-header">
        <span className="section-title-main">Utility Curve Declarations</span>
        <span className="section-count">
          {configured.length} configured {configured.length === 1 ? "axis" : "axes"}
        </span>
      </div>
      <div className="section-body">
        {configured.map((curve) => (
          <div key={curve.axisId} className="curve-row">
            <span className="curve-axis-name">{curve.axisName}</span>
            <div className="curve-details">
              <span className="curve-tag shape">{getShapeLabel(curve)}</span>
              {curve.idealValue !== null && (
                <span className="curve-tag sweet-spot">
                  Ideal: {formatNativeValue(curve.idealValue, curve.nativeScale)}
                </span>
              )}
              {curve.tolerance !== null && (
                <span className="curve-tag tolerance">Tolerance: {curve.tolerance}</span>
              )}
              {curve.vetoThreshold !== null && (
                <span className="curve-tag veto">
                  Veto {curve.vetoThreshold.direction}{" "}
                  {formatNativeValue(curve.vetoThreshold.threshold, curve.nativeScale)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

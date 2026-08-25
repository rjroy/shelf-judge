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

function formatNativeValue(value: number, unit?: string | null): string {
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${formatted}${unit ? ` ${unit}` : ""}`;
}

export function UtilityCurves({ curves }: { curves: UtilityCurveDeclaration[] }) {
  // Only show axes with non-default curves (anything beyond plain higher-is-better with no extras)
  const configured = curves.filter(
    (c) =>
      c.shape !== "higher-is-better" ||
      c.idealValue !== null ||
      c.tolerance !== null ||
      c.toleranceWidth !== null ||
      c.derivedField !== null ||
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
                  Ideal: {formatNativeValue(curve.idealValue, curve.unit)}
                </span>
              )}
              {curve.tolerance !== null && (
                <span className="curve-tag tolerance">Tolerance: {curve.tolerance}</span>
              )}
              {curve.toleranceWidth !== null && (
                <span className="curve-tag tolerance">
                  Tolerance: {formatNativeValue(curve.toleranceWidth)}{" "}
                  {curve.unit ?? "native units"}
                </span>
              )}
              <span className="curve-tag native-scale">
                Native scale: {formatNativeValue(curve.nativeScale.min)}-
                {formatNativeValue(curve.nativeScale.max)} {curve.unit ?? "rating"}
              </span>
              {curve.provenance && <span className="curve-detail-line">{curve.provenance}</span>}
              {curve.configurationSummary && (
                <span className="curve-detail-line">{curve.configurationSummary}</span>
              )}
              {curve.vetoThreshold !== null && (
                <span className="curve-tag veto">
                  Veto {curve.vetoThreshold.direction}{" "}
                  {formatNativeValue(curve.vetoThreshold.threshold, curve.unit)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

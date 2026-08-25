import type { Axis, LeanDirection, PreferenceShape, ToleranceLevel } from "@shelf-judge/shared";

export interface CurveState {
  shape: PreferenceShape;
  idealValue: string;
  tolerance: ToleranceLevel;
  toleranceWidth: string;
  leanDirection: LeanDirection | null;
  vetoEnabled: boolean;
  vetoDirection: "below" | "above";
  vetoThreshold: string;
}

export const DEFAULT_CURVE: CurveState = {
  shape: "higher-is-better",
  idealValue: "",
  tolerance: "moderate",
  toleranceWidth: "",
  leanDirection: null,
  vetoEnabled: false,
  vetoDirection: "below",
  vetoThreshold: "",
};

export function curveStateFromAxis(axis: Axis): CurveState {
  return {
    shape: axis.preferenceShape ?? "higher-is-better",
    idealValue: axis.idealValue != null ? String(axis.idealValue) : "",
    tolerance: axis.tolerance ?? "moderate",
    toleranceWidth: axis.toleranceWidth != null ? String(axis.toleranceWidth) : "",
    leanDirection: axis.leanDirection ?? null,
    vetoEnabled: axis.veto != null,
    vetoDirection: axis.veto?.direction ?? "below",
    vetoThreshold: axis.veto != null ? String(axis.veto.threshold) : "",
  };
}

export function curveStateToBody(
  curve: CurveState,
  mode: "create" | "update",
): Record<string, unknown> {
  const body: Record<string, unknown> = { preferenceShape: curve.shape };
  if (curve.shape === "sweet-spot") {
    body.idealValue = curve.idealValue !== "" ? parseFloat(curve.idealValue) : null;
    body.leanDirection = curve.leanDirection;
    if (curve.toleranceWidth !== "") {
      body.toleranceWidth = parseFloat(curve.toleranceWidth);
      if (mode === "update") body.tolerance = null;
    } else {
      body.tolerance = curve.tolerance;
      body.toleranceWidth = null;
    }
  } else {
    body.idealValue = null;
    body.leanDirection = null;
    if (mode === "update") {
      body.tolerance = null;
      body.toleranceWidth = null;
    }
  }
  if (curve.vetoEnabled && curve.vetoThreshold !== "") {
    body.veto = { direction: curve.vetoDirection, threshold: parseFloat(curve.vetoThreshold) };
  } else {
    body.veto = null;
  }
  return body;
}

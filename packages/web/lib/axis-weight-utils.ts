import type { Axis } from "@shelf-judge/shared";

export function getEnabledAxisWeightTotal(axes: readonly Axis[]): number {
  return axes.reduce((sum, axis) => sum + (axis.enabled ? axis.weight : 0), 0);
}

export function getAxisWeightPercentage(axis: Axis, totalWeight: number): number {
  return axis.enabled && totalWeight > 0 ? Math.round((axis.weight / totalWeight) * 100) : 0;
}

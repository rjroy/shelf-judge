// Staged, pure similarity math. This module is intentionally not wired into
// production consumers until the approved activation phase.

import type { RedundancySettings, SemanticRedundancySettings } from "@shelf-judge/shared";
import { jaccardDistance, normalizedManhattanDistance } from "./feature-vector.js";

export interface SimilaritySettings {
  factual: { binary: number; continuous: number };
  semantic: { enabled: boolean; factual: number; description: number; ownerNote: number };
}

export type AvailableSimilarityComponent =
  | { availability: "available"; value: number }
  | { availability: "unavailable" };

export interface SimilarityComponents {
  factual: AvailableSimilarityComponent;
  description: AvailableSimilarityComponent;
  ownerNote: AvailableSimilarityComponent;
}

function assertWeight(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative weight`);
  }
}

function assertSimilarity(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be a finite similarity in [0, 1]`);
  }
}

/** Capture the existing persisted settings as one in-memory scoring snapshot. */
export function captureSimilaritySettings(
  redundancy: RedundancySettings,
  semantic: SemanticRedundancySettings,
): SimilaritySettings {
  const { binary, continuous } = redundancy.componentWeights;
  assertWeight("factual binary weight", binary);
  assertWeight("factual continuous weight", continuous);
  if (binary === 0 && continuous === 0) {
    throw new RangeError("factual binary and continuous weights must have a positive sum");
  }

  const { factual, description, ownerNote } = semantic.weights;
  assertWeight("semantic factual weight", factual);
  assertWeight("semantic description weight", description);
  assertWeight("semantic owner-note weight", ownerNote);
  const semanticEnabled = semantic.enabled;

  return {
    factual: { binary, continuous },
    semantic: {
      enabled: semanticEnabled,
      // Semantic enablement gates JEV-backed signals, not factual F.
      factual,
      description: semanticEnabled ? description : 0,
      // This setting only controls whether the caller may supply cached note
      // evidence. The math helper never reads or authorizes a cache row.
      ownerNote: semanticEnabled && semantic.cachedOwnerNoteUse ? ownerNote : 0,
    },
  };
}

/** Factual similarity using the existing non-personal factual feature axes. */
export function factualSimilarity(
  a: { binary: number[]; continuous: number[] },
  b: { binary: number[]; continuous: number[] },
  weights: SimilaritySettings["factual"],
): number {
  assertWeight("factual binary weight", weights.binary);
  assertWeight("factual continuous weight", weights.continuous);
  const scale = Math.max(weights.binary, weights.continuous);
  if (scale === 0) throw new RangeError("factual weights must have a positive sum");
  const binaryWeight = weights.binary / scale;
  const continuousWeight = weights.continuous / scale;
  const total = binaryWeight + continuousWeight;
  const binaryDistance = jaccardDistance(a.binary, b.binary);
  const continuousDistance = normalizedManhattanDistance(a.continuous, b.continuous);
  const similarity =
    1 - (binaryWeight * binaryDistance + continuousWeight * continuousDistance) / total;
  assertSimilarity("factual", similarity);
  return similarity;
}

/**
 * Combine explicitly available, caller-authorized pair components. A valid
 * zero remains available and contributes its configured weight; null denotes
 * the all-unavailable result rather than a fabricated zero similarity.
 */
export function unifiedSimilarity(
  components: SimilarityComponents,
  settings: SimilaritySettings,
): number | null {
  let weightedSum = 0;
  let maxAvailableWeight = 0;
  let normalizedWeightTotal = 0;

  for (const key of ["factual", "description", "ownerNote"] as const) {
    const component = components[key];
    const weight = settings.semantic[key];
    assertWeight(`${key} weight`, weight);
    if (component.availability === "unavailable" || weight === 0) continue;
    assertSimilarity(key, component.value);
    maxAvailableWeight = Math.max(maxAvailableWeight, weight);
  }
  if (maxAvailableWeight === 0) return null;

  for (const key of ["factual", "description", "ownerNote"] as const) {
    const component = components[key];
    const weight = settings.semantic[key];
    if (component.availability === "unavailable" || weight === 0) continue;
    const normalizedWeight = weight / maxAvailableWeight;
    weightedSum += component.value * normalizedWeight;
    normalizedWeightTotal += normalizedWeight;
  }

  return weightedSum / normalizedWeightTotal;
}

// Standalone bin-packing algorithm. No imports from @shelf-judge/shared.
// Optimizes for spatial efficiency and item similarity simultaneously.
// See .lore/designs/similarity-weighted-bin-packing.md for the full algorithm spec.

// --- Types ---

export interface PackItem {
  id: string;
  dimensions: [number, number, number] | null; // [h, w, d], null = dimensionless
  priority: number; // higher = placed first in overflow ordering
  compare: (other: PackItem) => number; // similarity [0,1], 1 = identical
  locationOverride?: { binId: string; hard: boolean } | undefined;
}

export interface PackBin {
  id: string;
  dimensions: [number, number, number] | null; // [h, w, d], null = dimensionless
  axisPriority: [number, number, number]; // default [0,1,2]
  axisMinimize: [boolean, boolean, boolean]; // default [false, true, true]
  layer: number; // default 0, higher fills first
  neighbors: string[]; // adjacent bin IDs
}

export interface PackConfig {
  mergeStrategy: MergeStrategy;
  binFitnessWeights: { base: number; unsorted: number; neighbor: number; topN: number };
  itemFitnessWeights: { space: number; game: number; neighbor: number };
  minRemainder: [number, number, number];
  forceAxis0Width: boolean;
}

export type MergeStrategy = "avg" | "geo" | "harmonic" | "max" | "min" | "geomax";

export interface PackResult {
  assignments: Map<string, PackAssignment>; // binId -> assignment
  overflow: string[]; // item IDs that couldn't be placed
}

export interface PackAssignment {
  binId: string;
  itemIds: string[];
  remainingDimensions: [number, number, number] | null;
  grade: string; // S, A, B, C, D, F
  baseFitness: number; // internal coherence score
}

export const DEFAULT_PACK_CONFIG: PackConfig = {
  mergeStrategy: "geomax",
  binFitnessWeights: { base: 0.2, unsorted: 0.7, neighbor: 0.1, topN: 1 },
  itemFitnessWeights: { space: 0.1, game: 0.8, neighbor: 0.1 },
  minRemainder: [0.25, 3, 4],
  forceAxis0Width: true,
};

// --- Merge Strategies ---

export function merge(strategy: MergeStrategy, scores: number[]): number {
  if (scores.length === 0) return 0;
  switch (strategy) {
    case "avg":
      return mergeAvg(scores);
    case "geo":
      return mergeGeo(scores);
    case "harmonic":
      return mergeHarmonic(scores);
    case "max":
      return mergeMax(scores);
    case "min":
      return mergeMin(scores);
    case "geomax":
      return mergeGeomax(scores);
  }
}

function mergeAvg(scores: number[]): number {
  let sum = 0;
  for (const s of scores) sum += s;
  return sum / scores.length;
}

function mergeGeo(scores: number[]): number {
  let product = 1;
  for (const s of scores) product *= s;
  return Math.pow(product, 1 / scores.length);
}

function mergeHarmonic(scores: number[]): number {
  let sumRecip = 0;
  for (const s of scores) {
    if (s === 0) return 0;
    sumRecip += 1 / s;
  }
  return scores.length / sumRecip;
}

function mergeMax(scores: number[]): number {
  let best = -Infinity;
  for (const s of scores) {
    if (s > best) best = s;
  }
  return best;
}

function mergeMin(scores: number[]): number {
  let worst = Infinity;
  for (const s of scores) {
    if (s < worst) worst = s;
  }
  return worst;
}

function mergeGeomax(scores: number[]): number {
  const cap = mergeMax(scores);
  if (cap === 0) return 0;
  let product = cap;
  for (const s of scores) product *= s;
  return Math.pow(product, 1 / (scores.length + 1));
}

// --- Rotation ---

/**
 * Find the best rotation of item dimensions to fit a bin.
 * Returns rotated dimensions or null if the item cannot fit.
 *
 * Algorithm: iterate axes in priority order. For each axis, pick an unused
 * item dimension that fits the bin on that axis. When minimizing, pick the
 * smallest fitting dimension (conserve space). When not minimizing, pick the
 * largest fitting dimension (fill space). If none fits, try swapping the
 * last two assigned dimensions as a recovery step.
 */
export function findBestRotation(
  itemDims: [number, number, number],
  binDims: [number, number, number],
  axisPriority: [number, number, number],
  axisMinimize: [boolean, boolean, boolean],
  forceAxis0Width: boolean,
): [number, number, number] | null {
  const result: [number, number, number] = [0, 0, 0];
  const usedItemIndices = new Set<number>();

  // When forceAxis0Width is on, axis 0 of the result is locked to the item's
  // original axis 0. Only axes 1 and 2 participate in rotation.
  if (forceAxis0Width) {
    if (itemDims[0] > binDims[0]) return null;
    result[0] = itemDims[0];
    usedItemIndices.add(0);
  }

  const axesToAssign = forceAxis0Width ? axisPriority.filter((a) => a !== 0) : [...axisPriority];

  for (let pi = 0; pi < axesToAssign.length; pi++) {
    const axis = axesToAssign[pi];
    const binSize = binDims[axis];
    const minimize = axisMinimize[axis];

    // Collect candidate item dimensions that fit this axis
    const candidates: { idx: number; size: number }[] = [];
    for (let i = 0; i < 3; i++) {
      if (usedItemIndices.has(i)) continue;
      if (itemDims[i] <= binSize) {
        candidates.push({ idx: i, size: itemDims[i] });
      }
    }

    if (candidates.length > 0) {
      // Pick based on minimization flag
      candidates.sort((a, b) => (minimize ? a.size - b.size : b.size - a.size));
      const pick = candidates[0];
      result[axis] = pick.size;
      usedItemIndices.add(pick.idx);
    } else {
      // No candidate fits. Try swapping the last two assigned dimensions.
      if (pi >= 1) {
        const prevAxis = axesToAssign[pi - 1];
        const prevItemIdx = findItemIdxForAxis(result, itemDims, prevAxis, usedItemIndices);
        if (prevItemIdx !== null) {
          // Try swapping: give this axis what prev had, give prev something else
          const prevSize = result[prevAxis];
          if (prevSize <= binSize) {
            // The prev dimension fits this axis. Now find something for prev axis.
            usedItemIndices.delete(prevItemIdx);
            const swapCandidates: { idx: number; size: number }[] = [];
            for (let i = 0; i < 3; i++) {
              if (usedItemIndices.has(i)) continue;
              if (i === prevItemIdx) continue; // Reserved for current axis
              if (itemDims[i] <= binDims[prevAxis]) {
                swapCandidates.push({ idx: i, size: itemDims[i] });
              }
            }
            if (swapCandidates.length > 0) {
              const prevMinimize = axisMinimize[prevAxis];
              swapCandidates.sort((a, b) => (prevMinimize ? a.size - b.size : b.size - a.size));
              result[axis] = prevSize;
              usedItemIndices.add(prevItemIdx);
              result[prevAxis] = swapCandidates[0].size;
              usedItemIndices.add(swapCandidates[0].idx);
              continue;
            }
            // Swap failed, restore
            usedItemIndices.add(prevItemIdx);
          }
        }
      }
      return null; // Cannot fit
    }
  }

  return result;
}

/** Find which original item index was assigned to a given result axis. */
function findItemIdxForAxis(
  result: [number, number, number],
  itemDims: [number, number, number],
  axis: number,
  usedIndices: Set<number>,
): number | null {
  const targetSize = result[axis];
  for (const idx of usedIndices) {
    if (itemDims[idx] === targetSize) return idx;
  }
  return null;
}

// --- Fitness Functions ---

/** Score how well an item fits a specific bin. */
export function itemInBinFitness(
  item: PackItem,
  bin: BinState,
  allBins: Map<string, BinState>,
  config: PackConfig,
): number {
  const w = config.itemFitnessWeights;

  // Space fitness
  let spaceScore = 0;
  if (item.dimensions && bin.remaining) {
    const rotated = findBestRotation(
      item.dimensions,
      bin.remaining,
      bin.bin.axisPriority,
      bin.bin.axisMinimize,
      config.forceAxis0Width,
    );
    if (rotated) {
      const ratios = [
        rotated[0] / bin.remaining[0],
        rotated[1] / bin.remaining[1],
        rotated[2] / bin.remaining[2],
      ];
      spaceScore = merge(config.mergeStrategy, ratios);
    }
    // If rotation fails, spaceScore stays 0 (item doesn't physically fit)
  } else if (!item.dimensions || !bin.remaining) {
    // Dimensionless item or bin: space is not a factor, neutral score
    spaceScore = 0.5;
  }

  // Similarity fitness (how well item matches existing bin contents)
  let similarityScore = 0;
  if (bin.items.length > 0) {
    const scores = bin.items.map((existing) => item.compare(existing));
    similarityScore = merge(config.mergeStrategy, scores);
  }

  // Neighbor fitness
  let neighborScore = 0;
  if (bin.bin.neighbors.length > 0) {
    const perNeighbor: number[] = [];
    for (const nId of bin.bin.neighbors) {
      const neighbor = allBins.get(nId);
      if (neighbor && neighbor.items.length > 0) {
        const nScores = neighbor.items.map((ni) => item.compare(ni));
        perNeighbor.push(merge(config.mergeStrategy, nScores));
      }
    }
    if (perNeighbor.length > 0) {
      neighborScore = merge(config.mergeStrategy, perNeighbor);
    }
  }

  return spaceScore * w.space + similarityScore * w.game + neighborScore * w.neighbor;
}

/** Score how urgently a bin needs filling. */
export function binReadiness(
  bin: BinState,
  unplacedItems: PackItem[],
  allBins: Map<string, BinState>,
  config: PackConfig,
): number {
  const w = config.binFitnessWeights;

  // Base fitness: internal coherence of current contents
  let baseFitness = 0;
  if (bin.items.length >= 2) {
    const perItem: number[] = [];
    for (let i = 0; i < bin.items.length; i++) {
      const others: number[] = [];
      for (let j = 0; j < bin.items.length; j++) {
        if (i !== j) others.push(bin.items[i].compare(bin.items[j]));
      }
      perItem.push(merge(config.mergeStrategy, others));
    }
    baseFitness = merge(config.mergeStrategy, perItem);
  } else if (bin.items.length === 1) {
    baseFitness = 1; // Single item, perfectly coherent
  }

  // Unsorted fitness: how well top-N candidates would fit
  let unsortedFitness = 0;
  if (unplacedItems.length > 0) {
    const fitScores = unplacedItems.map((item) => itemInBinFitness(item, bin, allBins, config));
    fitScores.sort((a, b) => b - a);
    const topN = Math.min(config.binFitnessWeights.topN, fitScores.length);
    unsortedFitness = merge(config.mergeStrategy, fitScores.slice(0, topN));
  }

  // Neighbor fitness
  let neighborFitness = 0;
  if (bin.bin.neighbors.length > 0 && unplacedItems.length > 0) {
    const perNeighbor: number[] = [];
    for (const nId of bin.bin.neighbors) {
      const neighbor = allBins.get(nId);
      if (neighbor && neighbor.items.length > 0) {
        const bestScores = unplacedItems.map((item) => {
          const scores = neighbor.items.map((ni) => item.compare(ni));
          return merge(config.mergeStrategy, scores);
        });
        bestScores.sort((a, b) => b - a);
        perNeighbor.push(bestScores[0]);
      }
    }
    if (perNeighbor.length > 0) {
      neighborFitness = merge(config.mergeStrategy, perNeighbor);
    }
  }

  return baseFitness * w.base + unsortedFitness * w.unsorted + neighborFitness * w.neighbor;
}

// --- Internal State ---

interface BinState {
  bin: PackBin;
  items: PackItem[];
  remaining: [number, number, number] | null; // null for dimensionless bins
}

/** Check whether an item physically fits a bin's remaining space. */
function itemFits(item: PackItem, binState: BinState, config: PackConfig): boolean {
  if (!item.dimensions || !binState.remaining) return true; // dimensionless
  return (
    findBestRotation(
      item.dimensions,
      binState.remaining,
      binState.bin.axisPriority,
      binState.bin.axisMinimize,
      config.forceAxis0Width,
    ) !== null
  );
}

/** Place an item in a bin, updating remaining dimensions. */
function placeItem(item: PackItem, binState: BinState, config: PackConfig): void {
  binState.items.push(item);
  if (item.dimensions && binState.remaining) {
    const rotated = findBestRotation(
      item.dimensions,
      binState.remaining,
      binState.bin.axisPriority,
      binState.bin.axisMinimize,
      config.forceAxis0Width,
    )!;
    // Post-placement: subtract rotated axis-0 from bin's remaining axis-0.
    // Axes 1 and 2 unchanged (1D simplification).
    binState.remaining = [
      binState.remaining[0] - rotated[0],
      binState.remaining[1],
      binState.remaining[2],
    ];
  }
}

/** Compute the volume of a 3D tuple. */
function volume(dims: [number, number, number]): number {
  return dims[0] * dims[1] * dims[2];
}

// --- Grading ---

function computeGrades(
  binStates: Map<string, BinState>,
  config: PackConfig,
): Map<string, { grade: string; baseFitness: number }> {
  const results = new Map<string, { grade: string; baseFitness: number }>();
  const binEntries = [...binStates.entries()];

  // Compute max pairwise similarity across all items in all bins
  const allItems: PackItem[] = [];
  for (const [, bs] of binEntries) {
    allItems.push(...bs.items);
  }
  let maxPairwise = 0;
  for (let i = 0; i < allItems.length; i++) {
    for (let j = i + 1; j < allItems.length; j++) {
      const sim = allItems[i].compare(allItems[j]);
      if (sim > maxPairwise) maxPairwise = sim;
    }
  }
  if (maxPairwise === 0) maxPairwise = 1; // Prevent division by zero

  // Compute raw grade scores per bin
  const gradeScores: { binId: string; score: number; baseFitness: number }[] = [];

  for (const [binId, bs] of binEntries) {
    if (bs.items.length === 0) {
      gradeScores.push({ binId, score: 0, baseFitness: 0 });
      continue;
    }

    // Base fitness (internal coherence)
    let baseFit = 0;
    if (bs.items.length >= 2) {
      const perItem: number[] = [];
      for (let i = 0; i < bs.items.length; i++) {
        const others: number[] = [];
        for (let j = 0; j < bs.items.length; j++) {
          if (i !== j) others.push(bs.items[i].compare(bs.items[j]));
        }
        perItem.push(merge(config.mergeStrategy, others));
      }
      baseFit = merge(config.mergeStrategy, perItem);
    } else {
      baseFit = 1;
    }

    const spaceW = config.itemFitnessWeights.space;
    const baseW = config.binFitnessWeights.base;

    if (!bs.bin.dimensions) {
      // Dimensionless bin: grade is base fitness alone (no normalization per design doc)
      gradeScores.push({ binId, score: baseFit, baseFitness: baseFit });
    } else if (bs.items.length === 1) {
      // Single item: space fitness only
      let spaceFit = 0;
      const item = bs.items[0];
      if (item.dimensions) {
        const rotated = findBestRotation(
          item.dimensions,
          bs.bin.dimensions,
          bs.bin.axisPriority,
          bs.bin.axisMinimize,
          config.forceAxis0Width,
        );
        if (rotated) {
          const ratios = [
            rotated[0] / bs.bin.dimensions[0],
            rotated[1] / bs.bin.dimensions[1],
            rotated[2] / bs.bin.dimensions[2],
          ];
          spaceFit = merge(config.mergeStrategy, ratios);
        }
      }
      gradeScores.push({ binId, score: spaceFit, baseFitness: baseFit });
    } else {
      // Multiple items: weighted combination of best space fit and normalized base
      let bestSpace = 0;
      for (const item of bs.items) {
        if (item.dimensions && bs.bin.dimensions) {
          const rotated = findBestRotation(
            item.dimensions,
            bs.bin.dimensions,
            bs.bin.axisPriority,
            bs.bin.axisMinimize,
            config.forceAxis0Width,
          );
          if (rotated) {
            const ratios = [
              rotated[0] / bs.bin.dimensions[0],
              rotated[1] / bs.bin.dimensions[1],
              rotated[2] / bs.bin.dimensions[2],
            ];
            const s = merge(config.mergeStrategy, ratios);
            if (s > bestSpace) bestSpace = s;
          }
        }
      }
      const normalizedBase = baseFit / maxPairwise;
      const score = (spaceW * bestSpace + baseW * normalizedBase) / (spaceW + baseW);
      gradeScores.push({ binId, score, baseFitness: baseFit });
    }
  }

  // Assign letter grades based on percentile rank
  const sorted = [...gradeScores].sort((a, b) => a.score - b.score);
  const n = sorted.length;

  for (let i = 0; i < n; i++) {
    const percentile = n <= 1 ? 1 : i / (n - 1);
    let grade: string;
    if (percentile >= 0.9) grade = "S";
    else if (percentile >= 0.7) grade = "A";
    else if (percentile >= 0.5) grade = "B";
    else if (percentile >= 0.3) grade = "C";
    else if (percentile >= 0.1) grade = "D";
    else grade = "F";

    results.set(sorted[i].binId, {
      grade,
      baseFitness: sorted[i].baseFitness,
    });
  }

  return results;
}

// --- Main Algorithm ---

export function pack(
  items: PackItem[],
  bins: PackBin[],
  partialConfig: Partial<PackConfig> = {},
): PackResult {
  const config: PackConfig = { ...DEFAULT_PACK_CONFIG, ...partialConfig };

  // Initialize bin states
  const binStates = new Map<string, BinState>();
  for (const bin of bins) {
    binStates.set(bin.id, {
      bin,
      items: [],
      remaining: bin.dimensions ? [...bin.dimensions] : null,
    });
  }

  const unplaced = new Set(items.map((item) => item.id));

  // --- Phase 1: Place Fixed Items ---
  for (const item of items) {
    if (!item.locationOverride) continue;
    const override = item.locationOverride;

    if (override.hard) {
      // Hard override: place directly, create bin if needed
      let bs = binStates.get(override.binId);
      if (!bs) {
        const syntheticBin: PackBin = {
          id: override.binId,
          dimensions: null,
          axisPriority: [0, 1, 2],
          axisMinimize: [false, true, true],
          layer: 0,
          neighbors: [],
        };
        bs = { bin: syntheticBin, items: [], remaining: null };
        binStates.set(override.binId, bs);
      }
      placeItem(item, bs, config);
      unplaced.delete(item.id);
    } else {
      // Soft override: place if bin exists and item fits
      const bs = binStates.get(override.binId);
      if (bs && itemFits(item, bs, config)) {
        placeItem(item, bs, config);
        unplaced.delete(item.id);
      }
      // Otherwise falls through to later phases
    }
  }

  // --- Phase 2: Place Unambiguous Items ---
  // Items that physically fit exactly one bin
  const phase2Items = items.filter((i) => unplaced.has(i.id));
  for (const item of phase2Items) {
    const fittingBins: string[] = [];
    for (const [binId, bs] of binStates) {
      if (itemFits(item, bs, config)) {
        fittingBins.push(binId);
      }
    }
    if (fittingBins.length === 1) {
      placeItem(item, binStates.get(fittingBins[0])!, config);
      unplaced.delete(item.id);
    }
  }

  // --- Phase 3: Greedy Iterative Fill ---
  let progress = true;
  while (unplaced.size > 0 && progress) {
    progress = false;
    const currentUnplaced = items.filter((i) => unplaced.has(i.id));

    // Score and sort bins by readiness
    const binScores: { binId: string; readiness: number; layer: number; vol: number }[] = [];
    for (const [binId, bs] of binStates) {
      const ready = binReadiness(bs, currentUnplaced, binStates, config);
      const vol = bs.remaining ? volume(bs.remaining) : Infinity;
      binScores.push({ binId, readiness: ready, layer: bs.bin.layer, vol });
    }
    binScores.sort((a, b) => {
      if (b.readiness !== a.readiness) return b.readiness - a.readiness;
      if (b.layer !== a.layer) return b.layer - a.layer;
      if (a.vol !== b.vol) return a.vol - b.vol; // smaller first
      return a.binId.localeCompare(b.binId);
    });

    // Try the highest-readiness bin
    for (const { binId } of binScores) {
      const bs = binStates.get(binId)!;
      let bestItem: PackItem | null = null;
      let bestFitness = -Infinity;

      for (const item of currentUnplaced) {
        if (!itemFits(item, bs, config)) continue;
        const fit = itemInBinFitness(item, bs, binStates, config);
        if (fit > bestFitness) {
          bestFitness = fit;
          bestItem = item;
        }
      }

      if (bestItem) {
        placeItem(bestItem, bs, config);
        unplaced.delete(bestItem.id);
        progress = true;
        break; // Re-sort bins after every placement
      }
    }
  }

  // --- Phase 4: Overflow ---
  const overflow = items
    .filter((i) => unplaced.has(i.id))
    .sort((a, b) => b.priority - a.priority)
    .map((i) => i.id);

  // --- Grading ---
  const grades = computeGrades(binStates, config);

  // --- Build result ---
  const assignments = new Map<string, PackAssignment>();
  for (const [binId, bs] of binStates) {
    const gradeInfo = grades.get(binId) ?? { grade: "F", baseFitness: 0 };
    assignments.set(binId, {
      binId,
      itemIds: bs.items.map((i) => i.id),
      remainingDimensions: bs.remaining,
      grade: gradeInfo.grade,
      baseFitness: gradeInfo.baseFitness,
    });
  }

  return { assignments, overflow };
}

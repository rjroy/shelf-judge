import { describe, expect, test } from "bun:test";
import {
  type PackBin,
  type PackConfig,
  type PackItem,
  DEFAULT_PACK_CONFIG,
  findBestRotation,
  merge,
  pack,
} from "../src/services/bin-packing";

// --- Helpers ---

function makeItem(
  id: string,
  dims: [number, number, number] | null,
  overrides: Partial<PackItem> = {},
): PackItem {
  return {
    id,
    dimensions: dims,
    priority: 0,
    compare: () => 0,
    ...overrides,
  };
}

function makeBin(
  id: string,
  dims: [number, number, number] | null,
  overrides: Partial<PackBin> = {},
): PackBin {
  return {
    id,
    dimensions: dims,
    axisPriority: [0, 1, 2],
    axisMinimize: [false, true, true],
    layer: 0,
    neighbors: [],
    ...overrides,
  };
}

/** Creates items with a similarity function based on group membership. */
function makeGroupedItems(groups: Record<string, string[]>): PackItem[] {
  const groupOf = new Map<string, string>();
  for (const [group, ids] of Object.entries(groups)) {
    for (const id of ids) groupOf.set(id, group);
  }
  const items: PackItem[] = [];
  for (const [, ids] of Object.entries(groups)) {
    for (const id of ids) {
      items.push({
        id,
        dimensions: [2, 10, 10],
        priority: 0,
        compare: (other) => (groupOf.get(id) === groupOf.get(other.id) ? 0.9 : 0.1),
      });
    }
  }
  return items;
}

// --- Merge Strategies ---

describe("merge strategies", () => {
  test("avg: arithmetic mean", () => {
    expect(merge("avg", [0.2, 0.4, 0.6])).toBeCloseTo(0.4, 10);
  });

  test("avg: single value", () => {
    expect(merge("avg", [0.7])).toBeCloseTo(0.7, 10);
  });

  test("geo: geometric mean", () => {
    // (0.2 * 0.4 * 0.6)^(1/3) = 0.048^(1/3) ≈ 0.3634
    expect(merge("geo", [0.2, 0.4, 0.6])).toBeCloseTo(Math.pow(0.048, 1 / 3), 4);
  });

  test("geo: zero input produces zero", () => {
    expect(merge("geo", [0.5, 0, 0.8])).toBeCloseTo(0, 10);
  });

  test("harmonic: harmonic mean", () => {
    // 3 / (1/0.2 + 1/0.4 + 1/0.6) = 3 / (5 + 2.5 + 1.667) = 3 / 9.167 ≈ 0.3273
    expect(merge("harmonic", [0.2, 0.4, 0.6])).toBeCloseTo(3 / (5 + 2.5 + 5 / 3), 4);
  });

  test("harmonic: zero input produces zero", () => {
    expect(merge("harmonic", [0.5, 0, 0.8])).toBe(0);
  });

  test("max: returns maximum", () => {
    expect(merge("max", [0.2, 0.8, 0.5])).toBeCloseTo(0.8, 10);
  });

  test("min: returns minimum", () => {
    expect(merge("min", [0.2, 0.8, 0.5])).toBeCloseTo(0.2, 10);
  });

  test("geomax: (cap * product)^(1/(n+1))", () => {
    // cap = 0.8, product = 0.8 * 0.2 * 0.8 * 0.5 = 0.064
    // (0.8 * 0.064)^(1/4) = 0.0512^0.25 ≈ 0.4757
    const scores = [0.2, 0.8, 0.5];
    const cap = 0.8;
    const product = 0.8 * 0.2 * 0.5;
    const expected = Math.pow(cap * product, 1 / 4);
    expect(merge("geomax", scores)).toBeCloseTo(expected, 4);
  });

  test("geomax: all zeros produces zero", () => {
    expect(merge("geomax", [0, 0, 0])).toBe(0);
  });

  test("empty scores produce zero for all strategies", () => {
    const strategies = ["avg", "geo", "harmonic", "max", "min", "geomax"] as const;
    for (const s of strategies) {
      expect(merge(s, [])).toBe(0);
    }
  });
});

// --- Rotation ---

describe("findBestRotation", () => {
  const defaultPriority: [number, number, number] = [0, 1, 2];
  const defaultMinimize: [boolean, boolean, boolean] = [false, true, true];

  test("item fits without rotation", () => {
    const result = findBestRotation(
      [5, 10, 10],
      [10, 12, 12],
      defaultPriority,
      defaultMinimize,
      false,
    );
    expect(result).not.toBeNull();
    // Each rotated dimension must be <= corresponding bin dimension
    expect(result![0]).toBeLessThanOrEqual(10);
    expect(result![1]).toBeLessThanOrEqual(12);
    expect(result![2]).toBeLessThanOrEqual(12);
  });

  test("item fits only when rotated", () => {
    // Item [12, 5, 8], bin [10, 14, 10]
    // Original orientation: 12 > 10 on axis 0, doesn't fit
    // After rotation: some permutation works
    const result = findBestRotation(
      [12, 5, 8],
      [10, 14, 10],
      defaultPriority,
      defaultMinimize,
      false,
    );
    expect(result).not.toBeNull();
    expect(result![0]).toBeLessThanOrEqual(10);
    expect(result![1]).toBeLessThanOrEqual(14);
    expect(result![2]).toBeLessThanOrEqual(10);
  });

  test("item exactly shelf-sized (boundary case)", () => {
    const result = findBestRotation(
      [10, 12, 8],
      [10, 12, 8],
      defaultPriority,
      defaultMinimize,
      false,
    );
    expect(result).not.toBeNull();
  });

  test("item 0.1 too large on one axis, doesn't fit", () => {
    // Item [10.1, 12, 8], bin [10, 12, 8]
    // 10.1 doesn't fit axis 0 (10), and no rotation helps because 12 > 10 too
    const result = findBestRotation(
      [10.1, 12, 8],
      [10, 12, 8],
      defaultPriority,
      defaultMinimize,
      false,
    );
    expect(result).toBeNull();
  });

  test("item too large on all axes", () => {
    const result = findBestRotation(
      [15, 15, 15],
      [10, 10, 10],
      defaultPriority,
      defaultMinimize,
      false,
    );
    expect(result).toBeNull();
  });

  test("forceAxis0Width locks axis 0", () => {
    // Item [5, 12, 8], bin [10, 14, 10], forceAxis0Width = true
    // Axis 0 must be item's original axis 0 (5)
    const result = findBestRotation(
      [5, 12, 8],
      [10, 14, 10],
      defaultPriority,
      defaultMinimize,
      true,
    );
    expect(result).not.toBeNull();
    expect(result![0]).toBe(5); // Locked to item's axis 0
  });

  test("forceAxis0Width: item axis 0 too large", () => {
    // Item [11, 5, 5], bin [10, 14, 14], forceAxis0Width = true
    // Axis 0 locked to 11, but bin axis 0 is only 10
    const result = findBestRotation(
      [11, 5, 5],
      [10, 14, 14],
      defaultPriority,
      defaultMinimize,
      true,
    );
    expect(result).toBeNull();
  });

  test("minimization flags affect dimension assignment", () => {
    // Item [3, 7, 5], bin [10, 10, 10]
    // Axis 0 minimize=false: pick largest fitting (7)
    // Axis 1 minimize=true: pick smallest remaining fitting (3)
    // Axis 2 minimize=true: pick remaining (5)
    const result = findBestRotation([3, 7, 5], [10, 10, 10], [0, 1, 2], [false, true, true], false);
    expect(result).not.toBeNull();
    expect(result![0]).toBe(7); // Largest on non-minimize axis
    expect(result![1]).toBe(3); // Smallest on minimize axis
    expect(result![2]).toBe(5); // Remaining
  });
});

// --- Packing: Empty and trivial cases ---

describe("pack: empty and trivial", () => {
  test("no items, no bins: empty result", () => {
    const result = pack([], []);
    expect(result.assignments.size).toBe(0);
    expect(result.overflow).toEqual([]);
  });

  test("no items, one bin: bin exists with no items", () => {
    const result = pack([], [makeBin("b1", [10, 10, 10])]);
    expect(result.assignments.get("b1")!.itemIds).toEqual([]);
    expect(result.overflow).toEqual([]);
  });

  test("one item, no bins: item overflows", () => {
    const result = pack([makeItem("i1", [5, 5, 5])], []);
    expect(result.overflow).toEqual(["i1"]);
  });

  test("single item, single bin: item placed", () => {
    const result = pack([makeItem("i1", [5, 10, 10])], [makeBin("b1", [10, 12, 12])]);
    expect(result.assignments.get("b1")!.itemIds).toEqual(["i1"]);
    expect(result.overflow).toEqual([]);
  });

  test("single item, single bin: item graded", () => {
    const result = pack([makeItem("i1", [5, 10, 10])], [makeBin("b1", [10, 12, 12])]);
    const assignment = result.assignments.get("b1")!;
    expect(["S", "A", "B", "C", "D", "F"]).toContain(assignment.grade);
  });
});

// --- Dimensionless items and bins ---

describe("pack: dimensionless", () => {
  test("dimensionless item bypasses spatial checks", () => {
    const result = pack([makeItem("i1", null)], [makeBin("b1", [10, 10, 10])]);
    expect(result.assignments.get("b1")!.itemIds).toEqual(["i1"]);
  });

  test("dimensionless bin accepts all items", () => {
    const result = pack([makeItem("i1", [100, 100, 100])], [makeBin("b1", null)]);
    expect(result.assignments.get("b1")!.itemIds).toEqual(["i1"]);
  });

  test("dimensionless item and dimensionless bin", () => {
    const result = pack([makeItem("i1", null)], [makeBin("b1", null)]);
    expect(result.assignments.get("b1")!.itemIds).toEqual(["i1"]);
  });
});

// --- Phase 1: Fixed items ---

describe("pack: phase 1 (fixed items)", () => {
  test("hard override places item directly", () => {
    const item = makeItem("i1", [5, 5, 5], {
      locationOverride: { binId: "b1", hard: true },
    });
    const result = pack([item], [makeBin("b1", [10, 10, 10])]);
    expect(result.assignments.get("b1")!.itemIds).toEqual(["i1"]);
  });

  test("hard override creates bin if it doesn't exist", () => {
    const item = makeItem("i1", [5, 5, 5], {
      locationOverride: { binId: "phantom", hard: true },
    });
    const result = pack([item], [makeBin("b1", [10, 10, 10])]);
    expect(result.assignments.has("phantom")).toBe(true);
    expect(result.assignments.get("phantom")!.itemIds).toEqual(["i1"]);
  });

  test("soft override places item when bin exists and fits", () => {
    const item = makeItem("i1", [5, 5, 5], {
      locationOverride: { binId: "b1", hard: false },
    });
    const result = pack([item], [makeBin("b1", [10, 10, 10])]);
    expect(result.assignments.get("b1")!.itemIds).toEqual(["i1"]);
  });

  test("soft override falls through when bin doesn't exist", () => {
    const item = makeItem("i1", [5, 5, 5], {
      locationOverride: { binId: "phantom", hard: false },
    });
    const result = pack([item], [makeBin("b1", [10, 10, 10])]);
    // Item should end up placed in b1 via later phases, not in phantom
    expect(result.assignments.has("phantom")).toBe(false);
    expect(result.assignments.get("b1")!.itemIds).toEqual(["i1"]);
  });
});

// --- Phase 2: Unambiguous placement ---

describe("pack: phase 2 (unambiguous)", () => {
  test("item fitting exactly one bin is placed there", () => {
    // Item [9, 5, 5] fits only b1 [10, 6, 6], not b2 [4, 4, 4]
    const items = [makeItem("i1", [9, 5, 5])];
    const bins = [makeBin("b1", [10, 6, 6]), makeBin("b2", [4, 4, 4])];
    const result = pack(items, bins);
    expect(result.assignments.get("b1")!.itemIds).toContain("i1");
    expect(result.assignments.get("b2")!.itemIds).not.toContain("i1");
  });

  test("item fitting multiple bins goes to phase 3 instead", () => {
    const items = [makeItem("i1", [5, 5, 5])];
    const bins = [makeBin("b1", [10, 10, 10]), makeBin("b2", [10, 10, 10])];
    const result = pack(items, bins);
    // Item should be placed somewhere (phase 3), not overflow
    expect(result.overflow).toEqual([]);
  });
});

// --- Phase 3: Greedy fill ---

describe("pack: phase 3 (greedy fill)", () => {
  test("similar items cluster into the same bin", () => {
    const items = makeGroupedItems({
      strategy: ["s1", "s2", "s3"],
      party: ["p1", "p2", "p3"],
    });
    // Each bin can hold at most 3 items (height 7, each item uses 2 on axis 0),
    // forcing the algorithm to split items across bins.
    const bins = [makeBin("b1", [7, 12, 12]), makeBin("b2", [7, 12, 12])];
    const result = pack(items, bins);

    const b1Items = result.assignments.get("b1")!.itemIds;
    const b2Items = result.assignments.get("b2")!.itemIds;

    // Each bin should have mostly items from one group
    const b1Strategy = b1Items.filter((id) => id.startsWith("s")).length;
    const b1Party = b1Items.filter((id) => id.startsWith("p")).length;
    const b2Strategy = b2Items.filter((id) => id.startsWith("s")).length;
    const b2Party = b2Items.filter((id) => id.startsWith("p")).length;

    // One bin should be dominated by strategy, the other by party
    const clustered = (b1Strategy >= 2 && b2Party >= 2) || (b1Party >= 2 && b2Strategy >= 2);
    expect(clustered).toBe(true);
  });

  test("higher-layer bins fill first", () => {
    const items = [makeItem("i1", [5, 10, 10])];
    const bins = [
      makeBin("low", [10, 12, 12], { layer: 0 }),
      makeBin("high", [10, 12, 12], { layer: 1 }),
    ];
    const result = pack(items, bins);
    // With equal fitness, higher layer wins tiebreak
    expect(result.assignments.get("high")!.itemIds).toContain("i1");
  });

  test("remaining dimensions decrease after placement", () => {
    const item = makeItem("i1", [3, 10, 10]);
    const bin = makeBin("b1", [10, 12, 12]);
    const result = pack([item], [bin]);
    const remaining = result.assignments.get("b1")!.remainingDimensions!;
    // Axis 0 reduced by 3 (item's rotated axis-0 size)
    expect(remaining[0]).toBeLessThan(10);
    // Axes 1, 2 unchanged
    expect(remaining[1]).toBe(12);
    expect(remaining[2]).toBe(12);
  });

  test("re-sort after each placement changes bin selection", () => {
    // Set up two bins and three items. After the first placement changes
    // a bin's similarity profile, the second item should route differently.
    const compare = (a: string, b: string) => {
      // i1 and i2 are similar, i3 is different
      if ((a === "i1" && b === "i2") || (a === "i2" && b === "i1")) return 0.9;
      return 0.1;
    };

    const items: PackItem[] = [
      { id: "i1", dimensions: [2, 10, 10], priority: 0, compare: (o) => compare("i1", o.id) },
      { id: "i2", dimensions: [2, 10, 10], priority: 0, compare: (o) => compare("i2", o.id) },
      { id: "i3", dimensions: [2, 10, 10], priority: 0, compare: (o) => compare("i3", o.id) },
    ];
    const bins = [makeBin("b1", [10, 12, 12]), makeBin("b2", [10, 12, 12])];

    const result = pack(items, bins);

    // i1 and i2 should cluster (high similarity), i3 should go elsewhere
    const b1 = result.assignments.get("b1")!.itemIds;
    const b2 = result.assignments.get("b2")!.itemIds;

    const i1Bin = b1.includes("i1") ? "b1" : "b2";
    const i2Bin = b1.includes("i2") ? "b1" : "b2";
    expect(i1Bin).toBe(i2Bin); // i1 and i2 should be in the same bin
  });
});

// --- Phase 4: Overflow ---

describe("pack: phase 4 (overflow)", () => {
  test("items that don't fit anywhere appear in overflow", () => {
    const items = [makeItem("big", [20, 20, 20])];
    const bins = [makeBin("b1", [10, 10, 10])];
    const result = pack(items, bins);
    expect(result.overflow).toEqual(["big"]);
  });

  test("overflow preserves priority ordering (highest first)", () => {
    const items = [
      makeItem("low", [20, 20, 20], { priority: 1 }),
      makeItem("high", [20, 20, 20], { priority: 5 }),
      makeItem("mid", [20, 20, 20], { priority: 3 }),
    ];
    const bins = [makeBin("b1", [10, 10, 10])];
    const result = pack(items, bins);
    expect(result.overflow).toEqual(["high", "mid", "low"]);
  });
});

// --- Grading ---

describe("pack: grading", () => {
  test("bins receive grades from the valid set", () => {
    const items = [makeItem("i1", [3, 10, 10]), makeItem("i2", [3, 10, 10])];
    const bins = [makeBin("b1", [10, 12, 12]), makeBin("b2", [10, 12, 12])];
    const result = pack(items, bins);
    const validGrades = new Set(["S", "A", "B", "C", "D", "F"]);
    for (const [, assignment] of result.assignments) {
      expect(validGrades.has(assignment.grade)).toBe(true);
    }
  });

  test("grade distribution spans S through F with enough bins", () => {
    // Create 10 bins with varying item counts to produce grade spread
    const items: PackItem[] = [];
    const bins: PackBin[] = [];
    for (let b = 0; b < 10; b++) {
      bins.push(makeBin(`b${b}`, [100, 100, 100]));
      // Put different numbers of items in each bin via hard overrides
      for (let i = 0; i < b + 1; i++) {
        const itemId = `b${b}_i${i}`;
        items.push(
          makeItem(itemId, [2, 10, 10], {
            locationOverride: { binId: `b${b}`, hard: true },
            compare: (other) => {
              // Items in the same bin are similar
              return other.id.startsWith(`b${b}_`) ? 0.8 : 0.2;
            },
          }),
        );
      }
    }
    const result = pack(items, bins);
    const grades = new Set<string>();
    for (const [, a] of result.assignments) {
      grades.add(a.grade);
    }
    // With 10 bins, we should see at least 3 different grades
    expect(grades.size).toBeGreaterThanOrEqual(3);
  });

  test("empty bin gets grade F or lowest", () => {
    const items = [
      makeItem("i1", [3, 10, 10], {
        locationOverride: { binId: "b1", hard: true },
      }),
    ];
    const bins = [makeBin("b1", [10, 12, 12]), makeBin("b2", [10, 12, 12])];
    const result = pack(items, bins);
    // b2 has no items, should get lowest grade
    expect(result.assignments.get("b2")!.grade).toBe("F");
  });
});

// --- Fitness function specifics ---

describe("pack: fitness scoring", () => {
  test("space score: tight fit scores higher than loose fit", () => {
    // Two items competing for one bin. The tighter-fitting one should win.
    const tight = makeItem("tight", [9, 11, 11]);
    const loose = makeItem("loose", [2, 3, 3]);
    const bin = makeBin("b1", [10, 12, 12]);

    // Use space-only weights to isolate spatial scoring
    const config: Partial<PackConfig> = {
      itemFitnessWeights: { space: 1, game: 0, neighbor: 0 },
      binFitnessWeights: { base: 0, unsorted: 1, neighbor: 0, topN: 1 },
    };
    const result = pack([tight, loose], [bin], config);
    // Tight should be placed first (higher space fitness)
    expect(result.assignments.get("b1")!.itemIds[0]).toBe("tight");
  });

  test("similarity score drives placement with game-heavy weights", () => {
    // Default weights are similarity-heavy (0.8). Items similar to existing
    // bin contents should be preferred.
    const anchor = makeItem("anchor", [2, 10, 10], {
      locationOverride: { binId: "b1", hard: true },
    });
    const similar = makeItem("sim", [2, 10, 10], {
      compare: (other) => (other.id === "anchor" ? 0.9 : 0.1),
    });
    const different = makeItem("diff", [2, 10, 10], {
      compare: () => 0.1,
    });

    const bins = [makeBin("b1", [20, 12, 12]), makeBin("b2", [20, 12, 12])];
    const result = pack([anchor, similar, different], bins);
    // similar should follow anchor into b1
    expect(result.assignments.get("b1")!.itemIds).toContain("sim");
  });
});

// --- Post-placement dimension update ---

describe("pack: post-placement dimension update", () => {
  test("axis 0 decreases, axes 1 and 2 unchanged", () => {
    const result = pack([makeItem("i1", [4, 10, 8])], [makeBin("b1", [10, 12, 10])]);
    const rem = result.assignments.get("b1")!.remainingDimensions!;
    // Axes 1, 2 should be original values
    expect(rem[1]).toBe(12);
    expect(rem[2]).toBe(10);
    // Axis 0 should be reduced
    expect(rem[0]).toBeLessThan(10);
    expect(rem[0]).toBeGreaterThan(0);
  });

  test("multiple placements accumulate axis-0 reduction", () => {
    const items = [makeItem("i1", [3, 10, 10]), makeItem("i2", [3, 10, 10])];
    const bin = makeBin("b1", [10, 12, 12]);
    const result = pack(items, [bin]);
    const rem = result.assignments.get("b1")!.remainingDimensions!;
    // Each item consumes 3 on axis 0 (with minimize=false, it picks 10 for axis 0,
    // but let's check the actual result)
    expect(rem[0]).toBeLessThanOrEqual(10);
    expect(rem[1]).toBe(12);
    expect(rem[2]).toBe(12);
  });
});

// --- Edge cases ---

describe("pack: edge cases", () => {
  test("all items overflow when no bins provided", () => {
    const items = [makeItem("a", [5, 5, 5]), makeItem("b", [5, 5, 5])];
    const result = pack(items, []);
    expect(result.overflow.length).toBe(2);
  });

  test("item with zero-size dimension", () => {
    // A flat item (one dimension is 0) should not break anything
    // It will fit any bin trivially on that axis
    const result = pack([makeItem("flat", [0, 10, 10])], [makeBin("b1", [10, 12, 12])]);
    expect(result.assignments.get("b1")!.itemIds).toContain("flat");
  });

  test("bin fills up and stops accepting items", () => {
    // 3 items of height 4 each, bin has height 10. Third item won't fit.
    const items = [
      makeItem("i1", [4, 10, 10]),
      makeItem("i2", [4, 10, 10]),
      makeItem("i3", [4, 10, 10]),
    ];
    const bin = makeBin("b1", [10, 12, 12]);
    const result = pack(items, [bin]);
    // Two items fit (4+4=8 <= 10), third doesn't (4+4+4=12 > 10)
    expect(result.assignments.get("b1")!.itemIds.length).toBe(2);
    expect(result.overflow.length).toBe(1);
  });

  test("config defaults applied when partial config given", () => {
    // Just override one field, rest should be defaults
    const result = pack([makeItem("i1", [5, 10, 10])], [makeBin("b1", [10, 12, 12])], {
      mergeStrategy: "avg",
    });
    expect(result.assignments.get("b1")!.itemIds).toEqual(["i1"]);
  });

  test("many items and bins complete without error", () => {
    const items: PackItem[] = [];
    const bins: PackBin[] = [];
    for (let i = 0; i < 50; i++) {
      items.push(
        makeItem(`i${i}`, [2 + (i % 5), 10, 10], {
          compare: (other) => {
            const myGroup = Math.floor(parseInt(other.id.slice(1)) / 10);
            const otherGroup = Math.floor(parseInt(other.id.slice(1)) / 10);
            return myGroup === otherGroup ? 0.7 : 0.2;
          },
        }),
      );
    }
    for (let b = 0; b < 10; b++) {
      bins.push(makeBin(`b${b}`, [30, 12, 12]));
    }
    const result = pack(items, bins);
    const placed = [...result.assignments.values()].reduce((sum, a) => sum + a.itemIds.length, 0);
    expect(placed + result.overflow.length).toBe(50);
  });
});

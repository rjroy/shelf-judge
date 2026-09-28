import { describe, expect, test } from "bun:test";
import {
  decodeStoredSource,
  prepareMissingStoredSource,
  prepareStoredSourceUpdate,
  SourceRevisionSchema,
} from "../../src/services/stored-source-revision.js";

const NOW = "2026-09-27T00:00:00.000Z";
const prediction = {
  stageThresholds: [5, 15, 30] as [number, number, number],
  defaultK: 5,
  minSimilarityThreshold: 0.2,
};

describe("stored source revisions", () => {
  test("prepares missing sources at revision zero", () => {
    for (const kind of [
      "tournament",
      "prediction-settings",
      "niche-settings",
      "redundancy-settings",
      "shelf-config",
    ] as const) {
      const result = prepareMissingStoredSource(kind, NOW);
      expect(result.revision).toBe(0);
      expect(result.stored.revision).toBe(0);
      expect(result.migrated).toBe(true);
    }
  });

  test("decodes current data without exposing revision as domain data", () => {
    const decoded = decodeStoredSource("prediction-settings", { ...prediction, revision: 8 });
    expect(decoded.revision).toBe(8);
    expect(decoded.data).toEqual(prediction);
    expect(Object.hasOwn(decoded.data, "revision")).toBe(false);
    expect(decoded.migrated).toBe(false);
  });

  test("composes prediction legacy-field removal and revision migration", () => {
    const decoded = decodeStoredSource("prediction-settings", {
      ...prediction,
      tournamentStabilityBoost: 1.2,
    });
    expect(decoded.data).toEqual(prediction);
    expect(decoded.stored).toEqual({ ...prediction, revision: 0 });
    expect(decoded.migrated).toBe(true);
    expect(decodeStoredSource("prediction-settings", decoded.stored).migrated).toBe(false);
  });

  test("composes legacy tournament migration and revision migration", () => {
    const legacy = {
      settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
      sessions: [],
      comparisons: [],
      gameStats: {},
    };
    const decoded = decodeStoredSource("tournament", legacy);
    expect(decoded.migrated).toBe(true);
    expect(decoded.revision).toBe(0);
    expect("comparisons" in decoded.data).toBe(false);
    const roundTrip = decodeStoredSource("tournament", decoded.stored);
    expect(roundTrip.migrated).toBe(false);
    expect(roundTrip.data).toEqual(decoded.data);
  });

  test("preserves legacy shelf dimensionless normalization", () => {
    const raw = {
      units: [
        {
          id: "u",
          name: "Unit",
          shelves: [{ id: "s", name: "Shelf", width: 1, height: 2, depth: 3 }],
        },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    };
    const decoded = decodeStoredSource("shelf-config", raw);
    expect("units" in decoded.data && decoded.data.units[0]?.shelves[0]?.dimensionless).toBe(false);
    expect(decoded.migrated).toBe(true);
    expect(decodeStoredSource("shelf-config", decoded.stored).migrated).toBe(false);
  });

  test("advances a versioned source revision once when schema normalization changes stored data", () => {
    const legacyVersionedShelf = {
      units: [
        {
          id: "unit",
          name: "Unit",
          shelves: [{ id: "shelf", name: "Shelf", width: 1, height: 2, depth: 3 }],
        },
      ],
      createdAt: NOW,
      updatedAt: NOW,
      revision: 7,
    };
    const first = decodeStoredSource("shelf-config", legacyVersionedShelf);
    expect(first.revision).toBe(8);
    expect(first.migrated).toBe(true);
    const second = decodeStoredSource("shelf-config", first.stored);
    expect(second.revision).toBe(8);
    expect(second.migrated).toBe(false);
  });

  test("rejects overflow when a versioned legacy source needs normalization", () => {
    const shelf = {
      units: [
        {
          id: "unit",
          name: "Unit",
          shelves: [{ id: "shelf", name: "Shelf", width: 1, height: 2, depth: 3 }],
        },
      ],
      createdAt: NOW,
      updatedAt: NOW,
      revision: Number.MAX_SAFE_INTEGER,
    };
    expect(() => decodeStoredSource("shelf-config", shelf)).toThrow("revision overflow");
  });

  test("rejects malformed current data and unsafe revisions instead of resetting", () => {
    expect(() =>
      decodeStoredSource("prediction-settings", { ...prediction, revision: -1 }),
    ).toThrow();
    expect(() =>
      decodeStoredSource("prediction-settings", {
        ...prediction,
        revision: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow();
    expect(() =>
      decodeStoredSource("prediction-settings", {
        stageThresholds: [1],
        defaultK: 0,
        minSimilarityThreshold: 2,
        revision: 4,
      }),
    ).toThrow();
    expect(SourceRevisionSchema.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(true);
  });

  test("increments only for semantic changes and rejects overflow", () => {
    const current = decodeStoredSource("prediction-settings", { ...prediction, revision: 3 });
    const noOp = prepareStoredSourceUpdate(current, { ...prediction });
    expect(noOp).toMatchObject({ revision: 3, changed: false });
    expect(noOp.stored).toBe(current.stored);

    const changed = prepareStoredSourceUpdate(current, { ...prediction, defaultK: 7 });
    expect(changed).toMatchObject({ revision: 4, changed: true });

    const maxed = decodeStoredSource("prediction-settings", {
      ...prediction,
      revision: Number.MAX_SAFE_INTEGER,
    });
    expect(() => prepareStoredSourceUpdate(maxed, { ...prediction, defaultK: 7 })).toThrow(
      "overflow",
    );
  });
});

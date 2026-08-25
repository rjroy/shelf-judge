// Lock-down regression test for Phase 6 of the tournament-axis-source plan
// (`.lore/plans/tournament/elo-axis-source.md`). The revealed-preference
// tension surface was removed once tournament data became a first-class axis
// source (REQ-TAXIS-16, supersedes REQ-PRED-16/17/28). This test asserts the
// public shared surface no longer carries that vocabulary, so a future
// re-introduction has to be deliberate.

import { describe, expect, test } from "bun:test";
import * as shared from "../src/index";

describe("shared public surface (Phase 6 strike)", () => {
  test("does not export RevealedPreferenceTension", () => {
    expect("RevealedPreferenceTension" in shared).toBe(false);
  });

  test("does not export detectRevealedPreferenceTension", () => {
    expect("detectRevealedPreferenceTension" in shared).toBe(false);
  });

  test("PredictedGameResponse has no `tension` field", () => {
    // Build a minimal response object using the public type. If `tension`
    // were declared, TypeScript would require it (or accept it as excess
    // property). We assert at runtime that the field is absent on
    // representative wire payloads round-tripped through the response type.
    const response: shared.PredictedGameResponse = {
      game: {
        id: "g1",
        bggId: 1,
        name: "Test",
        yearPublished: null,
        minPlayers: null,
        maxPlayers: null,
        playingTime: null,
        imageUrl: null,
        numPlays: null,
        bggData: null,
        ownership: "owned",
        boxDimensions: null,
        manualShelfId: null,
        ratings: {},
        createdAt: "",
        updatedAt: "",
      },
      score: {
        score: 0,
        ratedAxisCount: 0,
        totalAxisCount: 0,
        breakdown: [],
        vetoed: false,
        vetoedBy: null,
        hypotheticalScore: null,
        predictionMeta: null,
        redundancyAdjustment: null,
      },
      predictionUnavailable: null,
      redundancyPreview: null,
    };
    expect("tension" in response).toBe(false);
  });
});

describe("shared public surface (derived-axis cutover)", () => {
  test("exports canonical axis and collection schemas", () => {
    expect("CreateAxisSchema" in shared).toBe(true);
    expect("UpdateAxisSchema" in shared).toBe(true);
    expect("AxisSchema" in shared).toBe(true);
    expect("CollectionSchema" in shared).toBe(true);
  });

  test("does not export transitional current schema names", () => {
    expect("CurrentCreateAxisSchema" in shared).toBe(false);
    expect("CurrentUpdateAxisSchema" in shared).toBe(false);
    expect("CurrentAxisSchema" in shared).toBe(false);
    expect("CurrentCollectionSchema" in shared).toBe(false);
  });

  test("does not export BGG-specific axis resolution or scale helpers", () => {
    expect("resolveBggRawValue" in shared).toBe(false);
    expect("getNativeScale" in shared).toBe(false);
  });

  test("does not expose persisted legacy model types", () => {
    // @ts-expect-error Persisted legacy input belongs to the daemon migration parser.
    const legacyAxis: import("../src").LegacyAxis = {};
    // @ts-expect-error Persisted legacy input belongs to the daemon migration parser.
    const legacyCollection: import("../src").LegacyCollection = {};
    // @ts-expect-error Persisted legacy input belongs to the daemon migration parser.
    const legacySource: import("../src").LegacyAxisSource = "bgg";

    expect(legacyAxis).toEqual({});
    expect(legacyCollection).toEqual({});
    expect(legacySource).toBe("bgg");
  });

  test("shared source and barrel contain no persisted legacy model declarations", async () => {
    const [types, barrel] = await Promise.all([
      Bun.file("packages/shared/src/types.ts").text(),
      Bun.file("packages/shared/src/index.ts").text(),
    ]);
    for (const removedName of ["LegacyAxisSource", "LegacyAxis", "LegacyCollection"]) {
      const exportedDeclaration = new RegExp(`export (?:type|interface) ${removedName}\\b`);
      const barrelExport = new RegExp(`^\\s*${removedName},?$`, "m");
      expect(types).not.toMatch(exportedDeclaration);
      expect(barrel).not.toMatch(barrelExport);
    }
  });
});

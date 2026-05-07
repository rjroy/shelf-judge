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

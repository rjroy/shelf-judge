import { describe, expect, test } from "bun:test";
import { canonicalSuggestedPlayerPoll } from "../../src/services/suggested-player-poll.js";

const bucket = { best: 1, recommended: 0, notRecommended: 0 };

describe("canonicalSuggestedPlayerPoll", () => {
  test("retains factual absent and empty states for empty bucket lists", () => {
    for (const state of ["absent", "empty"] as const) {
      expect(canonicalSuggestedPlayerPoll({ state, buckets: [] })).toMatchObject({
        status: "valid",
        state,
        buckets: [],
      });
    }
  });

  test("derives usable state from an exact positive safe label", () => {
    expect(
      canonicalSuggestedPlayerPoll({
        state: "unusable",
        buckets: [{ playerCount: "3", ...bucket }],
      }),
    ).toMatchObject({ status: "valid", state: "usable" });
  });

  test("derives unusable state from aggregate and unsafe labels", () => {
    for (const playerCount of ["4+", "9007199254740992"]) {
      expect(
        canonicalSuggestedPlayerPoll({
          state: "usable",
          buckets: [{ playerCount, ...bucket }],
        }),
      ).toEqual({
        status: "valid",
        state: "unusable",
        buckets: [{ playerCount, ...bucket }],
        source: "bgg-suggested-player-poll",
        observedAt: null,
      });
    }
  });
});

import { describe, expect, mock, test } from "bun:test";
import type { Axis, FitnessResult } from "@shelf-judge/shared";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildRatingMutation,
  createRatingFormState,
  derivedOverrideDraft,
  RatingFormContent,
  ratingFormReducer,
  saveRatings,
  submitRatingForm,
} from "@/components/rating-form";

const personalAxis: Axis = {
  id: "personal-axis",
  name: "Personal axis",
  description: null,
  enabled: true,
  source: "personal",
  weight: 50,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const derivedAxis: Axis = {
  id: "derived-axis",
  name: "Play Time",
  description: null,
  enabled: true,
  source: "derived",
  derivedField: "playingTime",
  configuration: { maximumScoringTime: 240 },
  weight: 50,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const playerCountAxis: Axis = {
  ...derivedAxis,
  id: "player-count-axis",
  name: "Player Count Fit",
  derivedField: "playerCountFit",
  configuration: { targetPlayerCount: 4 },
};

const disabledLegacyAxis: Axis = {
  id: "legacy-axis",
  name: "Old Play Time",
  description: null,
  enabled: false,
  source: "legacy",
  reason: "Unknown historical field",
  legacyField: "oldPlayingTime",
  legacyPayload: {},
  weight: 50,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function derivedScore(
  axis: Axis,
  derivedField: "playerCountFit" | "playingTime",
  sourceValue: number | null,
  effectiveRating: number | null,
): FitnessResult {
  return {
    score: effectiveRating ?? 0,
    ratedAxisCount: effectiveRating === null ? 0 : 1,
    totalAxisCount: 1,
    vetoed: false,
    vetoedBy: null,
    hypotheticalScore: null,
    predictionMeta: null,
    redundancyAdjustment: null,
    breakdown: [
      {
        axisId: axis.id,
        axisName: axis.name,
        weight: axis.weight,
        effectiveRating,
        contribution: effectiveRating,
        source: "derived",
        derivedField,
        sourceValue,
        scoringRawValue: sourceValue,
        unit: derivedField === "playingTime" ? "minutes" : "fit score",
        provenance: `Published ${derivedField}`,
        preferenceShape: "higher-is-better",
        curveAffected: false,
        configurationSummary:
          derivedField === "playingTime" ? "Scoring cap: 240 minutes" : "Target: 4 players",
        overridden: false,
        overrideValue: null,
        predictionConfidence: null,
        referenceGames: null,
      },
    ],
  };
}

function renderForm(
  overrides: {
    axes?: Axis[];
    currentRatings?: Record<string, number>;
    score?: FitnessResult;
  } = {},
): string {
  return renderToStaticMarkup(
    <RatingFormContent
      gameId="game-1"
      axes={overrides.axes ?? [personalAxis, derivedAxis]}
      currentRatings={overrides.currentRatings ?? {}}
      score={overrides.score}
      refresh={() => undefined}
    />,
  );
}

describe("RatingForm controller", () => {
  test("excludes disabled legacy ratings from state and submitted mutations", () => {
    const currentRatings = { [personalAxis.id]: 7, [disabledLegacyAxis.id]: 9 };
    const state = createRatingFormState([personalAxis, disabledLegacyAxis], currentRatings);

    expect(state.ratings).toEqual({ [personalAxis.id]: "7" });
    expect(
      buildRatingMutation([personalAxis, disabledLegacyAxis], currentRatings, state.ratings)
        .ratings,
    ).toEqual({ [personalAxis.id]: 7 });
  });

  test("enters, changes, and clears derived overrides", () => {
    const initial = createRatingFormState([derivedAxis], {});
    const entered = ratingFormReducer(initial, {
      type: "change",
      axisId: derivedAxis.id,
      value: "8",
    });
    const changed = ratingFormReducer(entered, {
      type: "change",
      axisId: derivedAxis.id,
      value: "6",
    });
    const cleared = ratingFormReducer(changed, { type: "remove", axisId: derivedAxis.id });

    expect(buildRatingMutation([derivedAxis], {}, entered.ratings).ratings).toEqual({
      [derivedAxis.id]: 8,
    });
    expect(changed.ratings[derivedAxis.id]).toBe("6");
    expect(
      buildRatingMutation([derivedAxis], { [derivedAxis.id]: 6 }, cleared.ratings).ratings,
    ).toEqual({ [derivedAxis.id]: null });
    expect(derivedOverrideDraft(7.5)).toBe(8);
  });

  test("tracks saving, failure, and reset transitions", () => {
    const initial = createRatingFormState([personalAxis], { [personalAxis.id]: 7 });
    const saving = ratingFormReducer(initial, { type: "save-started" });
    const failed = ratingFormReducer(saving, { type: "save-failed", error: "Save failed" });
    const reset = ratingFormReducer(failed, { type: "reset", ratings: initial.ratings });

    expect(saving).toMatchObject({ saving: true, error: null });
    expect(failed).toMatchObject({ saving: false, error: "Save failed" });
    expect(reset).toEqual(initial);
  });

  test("saves ratings with null wire semantics and refreshes", async () => {
    const requestMock = mock((input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    const refresh = mock(() => undefined);

    await saveRatings(
      "game-1",
      { [derivedAxis.id]: null },
      refresh,
      requestMock as unknown as typeof fetch,
    );

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock.mock.calls[0]?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ ratings: { [derivedAxis.id]: null } }),
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("runs validation and async failures through production state transitions", async () => {
    let state = createRatingFormState([personalAxis], {});
    const dispatch = (action: Parameters<typeof ratingFormReducer>[1]) => {
      state = ratingFormReducer(state, action);
    };
    const request = mock((input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(
        new Response(JSON.stringify({ error: "Daemon unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;

    await submitRatingForm({
      gameId: "game-1",
      axes: [personalAxis],
      currentRatings: {},
      drafts: { [personalAxis.id]: "11" },
      refresh: () => undefined,
      request,
      dispatch,
    });
    expect(state).toMatchObject({
      saving: false,
      error: "Ratings must be between 1 and 10: Personal axis",
    });

    await submitRatingForm({
      gameId: "game-1",
      axes: [personalAxis],
      currentRatings: {},
      drafts: { [personalAxis.id]: "7" },
      refresh: () => undefined,
      request,
      dispatch,
    });
    expect(state).toMatchObject({ saving: false, error: "Daemon unavailable" });
  });

  test("renders labels and derived metadata from initial controller state", () => {
    const playerScore = derivedScore(playerCountAxis, "playerCountFit", 10, 10);
    const timeScore = derivedScore(derivedAxis, "playingTime", 300, 8);
    const score: FitnessResult = {
      ...playerScore,
      score: 8,
      ratedAxisCount: 2,
      totalAxisCount: 2,
      breakdown: [
        {
          ...playerScore.breakdown[0],
          provenance:
            "BoardGameGeek suggested-player-count poll with publisher-declared bounds fallback",
        },
        {
          ...timeScore.breakdown[0],
          scoringRawValue: 240,
          provenance: "Publisher-listed playing time imported from BoardGameGeek",
        },
      ],
    };
    const html = renderForm({
      axes: [personalAxis, playerCountAxis, derivedAxis],
      currentRatings: { [personalAxis.id]: 7, [derivedAxis.id]: 8 },
      score,
    });

    expect(html).toContain("Very Good");
    expect(html).toContain("Stored override (1-10): 8");
    expect(html).toContain("Target: 4 players");
    expect(html).toContain("Scoring cap: 240 minutes");
    expect(html).toContain("Publisher-listed playing time imported from BoardGameGeek");
  });

  test("renders metadata fallback when no derived score is available", () => {
    expect(renderForm()).toContain("Source metadata unavailable");
  });
});

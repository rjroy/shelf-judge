import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Game, GameIntentionDetail, PlayIntention } from "@shelf-judge/shared";
import {
  ActiveIntentionControl,
  createIntentionControlState,
  eligibleIntentionKind,
  focusIntentionControlTarget,
  IntentionFeedback,
  IntentionControls,
  intentionControlReducer,
  isPlayEvidenceStale,
} from "@/components/intention-controls";

const observedAt = "2026-08-28T10:00:00.000Z";

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: "game-1",
    bggId: 42,
    name: "Test Game",
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bestPlayers: null,
    playingTime: null,
    imageUrl: null,
    bggData: null,
    numPlays: 0,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "valid", value: 0, source: "manual", observedAt },
    durationEvidence: { status: "missing", source: "manual", observedAt: null },
    playerRangeEvidence: { status: "missing", source: "manual", observedAt: null },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt: null,
    },
    bestPlayersInvalidEvidence: null,
    entityMetadata: {
      mechanic: {
        state: "unrefreshable",
        entities: [],
        observedAt: null,
        refreshFailure: null,
        correctionDestination: null,
        explanation: "This game has no BGG ID, so Shelf Judge cannot refresh entity metadata.",
      },
      designer: {
        state: "unrefreshable",
        entities: [],
        observedAt: null,
        refreshFailure: null,
        correctionDestination: null,
        explanation: "This game has no BGG ID, so Shelf Judge cannot refresh entity metadata.",
      },
      artist: {
        state: "unrefreshable",
        entities: [],
        observedAt: null,
        refreshFailure: null,
        correctionDestination: null,
        explanation: "This game has no BGG ID, so Shelf Judge cannot refresh entity metadata.",
      },
    },
    latestPlayCountCheck: null,
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    createdAt: observedAt,
    updatedAt: observedAt,
    ...overrides,
  };
}

function intention(overrides: Partial<PlayIntention> = {}): PlayIntention {
  return {
    intentionId: "intention-1",
    gameId: "game-1",
    kind: "first-play",
    baseline: { playCount: 0, evidenceSource: "manual", observedAt },
    createdAt: "2026-08-28T10:01:00.000Z",
    version: 1,
    resolution: null,
    ...overrides,
  };
}

const emptyDetail: GameIntentionDetail = { activeIntention: null, resolvedHistory: [] };

describe("intention create eligibility", () => {
  test("offers first play only for valid non-stale zero and replay only for positive evidence", () => {
    expect(eligibleIntentionKind(game())).toBe("first-play");
    expect(
      eligibleIntentionKind(
        game({
          numPlays: 4,
          playCountEvidence: { status: "valid", value: 4, source: "manual", observedAt },
        }),
      ),
    ).toBe("replay");

    const firstHtml = renderToStaticMarkup(
      <IntentionControls game={game()} detail={emptyDetail} />,
    );
    expect(firstHtml).toContain("Create first-play intention");
    expect(firstHtml).not.toContain("Create replay intention");

    const replayHtml = renderToStaticMarkup(
      <IntentionControls
        game={game({
          numPlays: 2,
          playCountEvidence: { status: "valid", value: 2, source: "manual", observedAt },
        })}
        detail={emptyDetail}
      />,
    );
    expect(replayHtml).toContain("Create replay intention");
    expect(replayHtml).not.toContain("Create first-play intention");
  });

  test("rejects every ownership and evidence ineligibility while showing valid destinations", () => {
    const cases: Game[] = [
      game({ ownership: "previously-owned" }),
      game({
        numPlays: null,
        playCountEvidence: { status: "missing", source: "manual", observedAt },
      }),
      game({
        numPlays: null,
        playCountEvidence: {
          status: "invalid",
          source: "bgg-collection",
          observedAt,
          evidence: { presence: "present", value: "many" },
        },
      }),
      game({
        playCountEvidence: { status: "valid", value: 0, source: "manual", observedAt: null },
      }),
      game({
        latestPlayCountCheck: { status: "missing", observedAt: "2026-08-28T11:00:00.000Z" },
      }),
    ];
    for (const candidate of cases) expect(eligibleIntentionKind(candidate)).toBeNull();

    const stale = cases[4];
    expect(isPlayEvidenceStale(stale)).toBe(true);
    const html = renderToStaticMarkup(<IntentionControls game={stale} detail={emptyDetail} />);
    expect(html).toContain("A newer BGG check did not provide a valid play count.");
    expect(html).toContain("Latest successful check: missing at 2026-08-28T11:00:00.000Z.");
    expect(html).toContain("Correct recorded play count");
    expect(html).toContain('href="#bgg-refresh"');
    expect(html).not.toContain("Create first-play intention");

    const manualHtml = renderToStaticMarkup(
      <IntentionControls game={game({ bggId: null })} detail={emptyDetail} />,
    );
    expect(manualHtml).toContain("Correct recorded play count");
    expect(manualHtml).not.toContain('href="#bgg-refresh"');
  });
});

describe("intention reducer outcomes", () => {
  test("creates, completes, retires, and keeps leave-active as a non-mutation response", () => {
    const commandId = "10000000-0000-4000-8000-000000000001";
    let state = intentionControlReducer(createIntentionControlState(game(), emptyDetail), {
      type: "request-start",
      generation: 1,
    });
    state = intentionControlReducer(state, {
      type: "intention-result",
      generation: 1,
      gameName: "Test Game",
      result: {
        ok: true,
        commandId,
        intention: intention(),
        linkedOwnershipTransition: null,
      },
    });
    expect(state.activeIntention?.intentionId).toBe("intention-1");
    expect(state.announcement).toContain("intention created");

    const activeHtml = renderToStaticMarkup(
      <IntentionControls
        game={game()}
        detail={{ activeIntention: intention(), resolvedHistory: [] }}
      />,
    );
    expect(activeHtml).toContain("Mark complete from personal knowledge");
    expect(activeHtml).toContain("Retire intention");
    expect(activeHtml).toContain("Leave active (no change)");

    for (const outcome of ["completed", "retired"] as const) {
      const resolution =
        outcome === "completed"
          ? ({
              outcome,
              source: "owner-confirmed",
              resolvedAt: "2026-08-28T12:00:00.000Z",
            } as const)
          : ({
              outcome,
              source: "owner-retired",
              resolvedAt: "2026-08-28T12:00:00.000Z",
            } as const);
      const resolved = intention({ version: 2, resolution });
      const result = intentionControlReducer(
        { ...state, activeIntention: intention(), history: [] },
        {
          type: "intention-result",
          generation: state.generation,
          gameName: "Test Game",
          result: { ok: true, commandId, intention: resolved, linkedOwnershipTransition: null },
        },
      );
      expect(result.activeIntention).toBeNull();
      expect(result.history[0]?.resolution.outcome).toBe(outcome);
    }
  });

  test("retains input, consumes returned stale state, and ignores delayed generations", () => {
    let state = createIntentionControlState(game(), {
      activeIntention: intention(),
      resolvedHistory: [],
    });
    state = intentionControlReducer(state, { type: "play-count-input", value: "7" });
    state = intentionControlReducer(state, { type: "request-start", generation: 1 });
    state = intentionControlReducer(state, {
      type: "intention-result",
      generation: 1,
      gameName: "Test Game",
      result: {
        ok: false,
        commandId: "10000000-0000-4000-8000-000000000001",
        error: {
          code: "stale-version",
          gameId: "game-1",
          intentionId: "intention-1",
          expectedVersion: 1,
          current: intention({
            version: 2,
            resolution: {
              outcome: "retired",
              source: "owner-retired",
              resolvedAt: "2026-08-28T12:00:00.000Z",
            },
          }),
        },
      },
    });
    expect(state.playCountInput).toBe("7");
    expect(state.activeIntention).toBeNull();
    expect(state.history).toHaveLength(1);
    expect(state.staleGuidance).toContain("will not retry automatically");
    expect(state.focusTarget).toBe("status");

    const staleFeedback = renderToStaticMarkup(
      <>
        <IntentionFeedback state={state} />
        <ActiveIntentionControl
          game={state.game}
          active={state.activeIntention}
          pending={state.pending}
          onAction={() => undefined}
        />
      </>,
    );
    expect(staleFeedback).toContain('class="intention-live-status"');
    expect(staleFeedback).toContain('tabindex="-1"');
    expect(staleFeedback).toContain("Refresh and review:");
    expect(staleFeedback).toContain("Shelf Judge will not retry automatically.");
    expect(staleFeedback).not.toContain("Mark complete from personal knowledge");

    let focused: "status" | "play-count" | null = null;
    focusIntentionControlTarget(
      state.focusTarget,
      { current: { focus: () => (focused = "status") } },
      { current: { focus: () => (focused = "play-count") } },
    );
    expect(focused).toBe("status");

    state = intentionControlReducer(state, { type: "open-correction", generation: 2 });
    const reopened = state;
    state = intentionControlReducer(state, {
      type: "request-failure",
      generation: 1,
      message: "late failure",
    });
    expect(state).toBe(reopened);
    expect(state.error).not.toBe("late failure");
  });

  test("focuses a visible error target for a general request failure", () => {
    const state = intentionControlReducer(createIntentionControlState(game(), emptyDetail), {
      type: "request-failure",
      generation: 0,
      message: "The request could not be completed.",
    });
    const feedback = renderToStaticMarkup(<IntentionFeedback state={state} />);
    expect(feedback).toContain('class="intention-live-status"');
    expect(feedback).toContain('role="alert"');
    expect(feedback).toContain("The request could not be completed.");

    let focused = false;
    focusIntentionControlTarget(
      state.focusTarget,
      { current: { focus: () => (focused = true) } },
      { current: null },
    );
    expect(focused).toBe(true);
  });

  test("cancel invalidates pending work and reopening preserves the entered correction", () => {
    let state = createIntentionControlState(game(), emptyDetail);
    state = intentionControlReducer(state, { type: "open-correction", generation: 1 });
    state = intentionControlReducer(state, { type: "play-count-input", value: "12" });
    state = intentionControlReducer(state, { type: "request-start", generation: 2 });
    state = intentionControlReducer(state, { type: "cancel-correction", generation: 3 });
    state = intentionControlReducer(state, { type: "open-correction", generation: 4 });
    expect(state.playCountInput).toBe("12");
    expect(state.correctionOpen).toBe(true);
    const unchanged = state;
    state = intentionControlReducer(state, {
      type: "request-failure",
      generation: 2,
      message: "superseded",
    });
    expect(state).toBe(unchanged);
  });

  test("associates play-count field validation and deliberately focuses the field", () => {
    const state = intentionControlReducer(createIntentionControlState(game(), emptyDetail), {
      type: "client-validation",
      generation: 1,
      message: "Enter a nonnegative whole number.",
    });
    expect(state.fieldIssues.playCount).toBe("Enter a nonnegative whole number.");
    expect(state.focusTarget).toBe("play-count");

    const html = renderToStaticMarkup(<IntentionControls game={game()} detail={emptyDetail} />);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('type="button"');

    const serverState = intentionControlReducer(
      { ...state, pending: true },
      {
        type: "play-result",
        generation: 1,
        gameName: "Test Game",
        result: {
          code: "validation",
          issues: [{ field: "playCount", message: "Server rejected this count." }],
        },
      },
    );
    expect(serverState.fieldIssues.playCount).toBe("Server rejected this count.");
    expect(serverState.focusTarget).toBe("play-count");
  });

  test("announces automatic completion and treats non-monotonic observation as conflict", () => {
    const active = intention();
    let state = createIntentionControlState(game(), {
      activeIntention: active,
      resolvedHistory: [],
    });
    state = intentionControlReducer(state, { type: "request-start", generation: 1 });
    state = intentionControlReducer(state, {
      type: "play-result",
      generation: 1,
      gameName: "Test Game",
      result: {
        ok: true,
        game: game({
          numPlays: 1,
          updatedAt: "2026-08-28T12:00:00.000Z",
          playCountEvidence: {
            status: "valid",
            value: 1,
            source: "manual",
            observedAt: "2026-08-28T12:00:00.000Z",
          },
        }),
        linkedIntentionTransition: intention({
          version: 2,
          resolution: {
            outcome: "completed",
            source: "observed-play-increase",
            resolvedAt: "2026-08-28T12:00:00.000Z",
          },
        }),
      },
    });
    expect(state.announcement).toContain("completed automatically");
    expect(state.activeIntention).toBeNull();

    state = intentionControlReducer(state, { type: "request-start", generation: 2 });
    state = intentionControlReducer(state, {
      type: "play-result",
      generation: 2,
      gameName: "Test Game",
      result: {
        ok: false,
        error: {
          code: "non-monotonic-observation",
          gameId: "game-1",
          attemptedObservedAt: "2026-08-28T11:00:00.000Z",
          latestAcceptedAt: "2026-08-28T12:00:00.000Z",
        },
      },
    });
    expect(state.error).toContain("Latest accepted evidence: 2026-08-28T12:00:00.000Z");
    expect(state.focusTarget).toBe("status");
  });
});

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
import {
  canonicalActiveIntention,
  canonicalIntentionMutationCases,
} from "../../shared/tests/fixtures/intention-mutation";

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
    manualValues: { playingTime: null, playerCount: null },
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
  test.each([...canonicalIntentionMutationCases])(
    "renders canonical $label without inventing a transport result",
    ({ command, result }) => {
      const startsActive = command.type !== "create";
      let state = createIntentionControlState(game(), {
        activeIntention: startsActive ? canonicalActiveIntention : null,
        resolvedHistory: [],
      });
      state = intentionControlReducer(state, { type: "play-count-input", value: "7" });
      state = intentionControlReducer(state, { type: "request-start", generation: 1 });
      state = intentionControlReducer(state, {
        type: "intention-result",
        generation: 1,
        gameName: "Test Game",
        result,
      });

      expect(state.playCountInput).toBe("7");
      expect(state.focusTarget).toBe("status");
      const html = renderToStaticMarkup(
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
      expect(html).toContain('class="intention-live-status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('tabindex="-1"');

      let focused: "status" | "play-count" | null = null;
      focusIntentionControlTarget(
        state.focusTarget,
        { current: { focus: () => (focused = "status") } },
        { current: { focus: () => (focused = "play-count") } },
      );
      expect(focused).toBe("status");

      if (result.ok) {
        expect(state.error).toBeNull();
        expect(state.announcement).not.toBeNull();
        expect(html).not.toContain('role="alert"');
        if (result.intention.resolution === null) {
          expect(state.activeIntention).toEqual(result.intention);
          expect(state.history).toEqual([]);
          expect(html).toContain("Mark complete from personal knowledge");
          expect(html).toContain("Retire intention");
          expect(html).toContain("Leave active (no change)");
        } else {
          expect(state.activeIntention).toBeNull();
          expect(state.history[0]).toMatchObject(result.intention);
          expect(html).not.toContain("Mark complete from personal knowledge");
        }
        return;
      }

      expect(state.announcement).toBeNull();
      expect(state.error).not.toBeNull();
      expect(html).toContain('role="alert"');
      if (result.error.code === "ineligible-game") {
        expect(html).toContain("not eligible for this intention");
        expect(html).toContain("Review ownership and current play evidence");
        expect(state.activeIntention).toBeNull();
        expect(state.history).toEqual([]);
        expect(html).not.toContain("intention created");
      } else if (result.error.code === "command-reuse") {
        expect(html).toContain("command identity was already used");
        expect(html).toContain("Refresh and review before trying again");
        expect(state.activeIntention).toBe(canonicalActiveIntention);
        expect(state.history).toEqual([]);
        expect(html).toContain("Mark complete from personal knowledge");
        expect(html).not.toContain("Intention retired");
      } else if (result.error.code === "stale-version") {
        expect(state.activeIntention).toBeNull();
        expect(state.history[0]).toMatchObject(result.error.current);
        expect(state.staleGuidance).toContain("will not retry automatically");
        expect(html).toContain("Refresh and review:");
        expect(html).toContain("Shelf Judge will not retry automatically.");
        expect(html).not.toContain("Mark complete from personal knowledge");
        expect(html).not.toContain("Intention completed");
      } else {
        throw new Error(`Unexpected canonical UI error: ${result.error.code}`);
      }
    },
  );

  test("ignores delayed generations after reopening correction", () => {
    let state = createIntentionControlState(game(), emptyDetail);
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

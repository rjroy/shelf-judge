import {
  AxisSchema,
  CollectionProfileResultSchema,
  GameDetailWithPurchaseUtilizationSchema,
  IntentionMutationResultSchema,
  calculatePurchaseUtilization,
  type CollectionProfileResult,
  type Game,
  type GameDetailWithPurchaseUtilization,
  type PlayIntention,
  type ResolvedPlayIntentionHistory,
} from "@shelf-judge/shared";
import {
  emptyUsefulProfileFixture,
  unavailableUsefulProfileFixture,
  warningUsefulProfileFixture,
} from "../../shared/tests/fixtures/useful-profile";

const socketPath = process.env.SHELF_JUDGE_SOCKET;
if (socketPath === undefined) throw new Error("SHELF_JUDGE_SOCKET is required");

const observedAt = "2026-08-28T10:00:00.000Z";
const createdAt = "2026-08-28T10:01:00.000Z";
const resolvedAt = "2026-08-28T12:00:00.000Z";
const gameId = "game-4";

type Scenario = "profile" | "empty" | "unavailable" | "create" | "active" | "stale";

const axis = AxisSchema.parse({
  id: "axis-enjoyment",
  name: "Enjoyment",
  description: "How much I enjoy playing",
  weight: 1,
  enabled: true,
  source: "personal",
  createdAt,
  updatedAt: createdAt,
});

const profileFixture: CollectionProfileResult = (() => {
  const profile = structuredClone(warningUsefulProfileFixture);
  profile.identity.axisDistributions = [
    {
      axisId: axis.id,
      axisName: axis.name,
      mean: 6,
      median: 6,
      standardDeviation: Math.sqrt(32 / 3),
      range: { min: 2, max: 10 },
      ratedGameCount: 3,
      histogram: [0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
    },
  ];
  return CollectionProfileResultSchema.parse(profile);
})();

function baseGame(): Game {
  const completeEmptyMetadata = {
    state: "complete" as const,
    entities: [],
    observedAt,
    refreshFailure: null,
    correctionDestination: null,
  };
  return {
    id: gameId,
    bggId: null,
    name: "Heat: Pedal to the Metal With A Deliberately Long Fixture Name",
    yearPublished: 2022,
    minPlayers: 1,
    maxPlayers: 6,
    bestPlayers: 5,
    playingTime: 60,
    imageUrl: null,
    bggData: null,
    numPlays: 0,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "valid", value: 0, source: "manual", observedAt },
    durationEvidence: { status: "valid", value: 60, source: "manual", observedAt },
    playerRangeEvidence: {
      status: "valid",
      value: { minPlayers: 1, maxPlayers: 6 },
      source: "manual",
      observedAt,
    },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt: null,
    },
    bestPlayersInvalidEvidence: null,
    entityMetadata: {
      mechanic: completeEmptyMetadata,
      designer: completeEmptyMetadata,
      artist: completeEmptyMetadata,
    },
    latestPlayCountCheck: null,
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: { [axis.id]: 6 },
    createdAt,
    updatedAt: createdAt,
  };
}

function activeIntention(id = "intention-browser-1"): PlayIntention {
  return {
    intentionId: id,
    gameId,
    kind: "first-play",
    baseline: { playCount: 0, evidenceSource: "manual", observedAt },
    createdAt,
    version: 1,
    resolution: null,
  };
}

let scenario: Scenario = "profile";
let game = baseGame();
let active: PlayIntention | null = activeIntention();
let history: ResolvedPlayIntentionHistory = [];
let staleOnce = false;
let intentionSequence = 1;

function reset(next: Scenario): void {
  scenario = next;
  game = baseGame();
  history = [];
  staleOnce = next === "stale";
  active = next === "active" || next === "stale" || next === "profile" ? activeIntention() : null;
  intentionSequence = 1;
}

function detail(): GameDetailWithPurchaseUtilization {
  return GameDetailWithPurchaseUtilizationSchema.parse({
    game,
    score: {
      score: 6,
      ratedAxisCount: 1,
      totalAxisCount: 1,
      breakdown: [],
      vetoed: false,
      vetoedBy: null,
      hypotheticalScore: null,
      predictionMeta: null,
      redundancyAdjustment: null,
    },
    bggDataStale: false,
    nichePosition: null,
    displayScore: "6.0",
    purchaseUtilization: calculatePurchaseUtilization({
      acquisition: game.acquisition,
      entertainmentBenchmark: null,
      playCount: game.playCountEvidence,
      duration: game.durationEvidence,
      playerRange: game.playerRangeEvidence,
      suggestedPlayerPoll: game.suggestedPlayerPoll,
      fitness: "6.0",
    }),
    intentions: { activeIntention: active, resolvedHistory: history },
  });
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const value = (await request.json()) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function resolveIntention(
  intention: PlayIntention,
  outcome: "completed" | "retired",
): PlayIntention {
  return {
    ...intention,
    version: intention.version + 1,
    resolution:
      outcome === "completed"
        ? { outcome, source: "owner-confirmed", resolvedAt }
        : { outcome, source: "owner-retired", resolvedAt },
  };
}

function resolvedHistoryItem(intention: PlayIntention) {
  if (intention.resolution === null) throw new Error("Expected a resolved fixture intention");
  return { ...intention, gameName: game.name, resolution: intention.resolution };
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/test/reset" && request.method === "POST") {
    const requested = (await body(request)).scenario;
    if (
      requested !== "profile" &&
      requested !== "empty" &&
      requested !== "unavailable" &&
      requested !== "create" &&
      requested !== "active" &&
      requested !== "stale"
    ) {
      return json({ error: "Unknown fixture scenario" }, 400);
    }
    reset(requested);
    return json({ scenario });
  }

  if (path === "/api/profile" && request.method === "GET") {
    const response =
      scenario === "empty"
        ? emptyUsefulProfileFixture
        : scenario === "unavailable"
          ? unavailableUsefulProfileFixture
          : profileFixture;
    return json(CollectionProfileResultSchema.parse(response));
  }

  if (path === `/api/games/${gameId}` && request.method === "GET") return json(detail());
  if (path === "/api/axes" && request.method === "GET") return json([axis]);
  if (path === "/api/shelf/config" && request.method === "GET") {
    return json({ units: [], createdAt, updatedAt: createdAt });
  }
  if (path === "/api/niches/settings" && request.method === "GET") {
    return json({ ignoredTags: [] });
  }
  if (path === `/api/tournament/games/${gameId}/stats` && request.method === "GET") {
    return json({ error: "No tournament stats" }, 404);
  }

  if (path === `/api/games/${gameId}/intention` && request.method === "POST") {
    const requestBody = await body(request);
    const commandId = String(requestBody.commandId);
    if (active !== null) {
      return json(
        IntentionMutationResultSchema.parse({
          ok: false,
          commandId,
          error: { code: "active-intention-conflict", gameId, current: active },
        }),
        409,
      );
    }
    intentionSequence += 1;
    active = activeIntention(`intention-browser-${intentionSequence}`);
    return json(
      IntentionMutationResultSchema.parse({
        ok: true,
        commandId,
        intention: active,
        linkedOwnershipTransition: null,
      }),
      201,
    );
  }

  const resolutionMatch = path.match(
    /^\/api\/games\/game-4\/intention\/([^/]+)\/(complete|retire)$/,
  );
  if (resolutionMatch !== null && request.method === "POST") {
    const [, intentionId, action] = resolutionMatch;
    const requestBody = await body(request);
    const commandId = String(requestBody.commandId);
    const expectedVersion = Number(requestBody.expectedVersion);
    if (active === null || active.intentionId !== intentionId) {
      return json(
        IntentionMutationResultSchema.parse({
          ok: false,
          commandId,
          error: { code: "intention-not-found", gameId, intentionId },
        }),
        404,
      );
    }
    if (staleOnce) {
      staleOnce = false;
      const current = resolveIntention(active, "completed");
      active = null;
      history = [resolvedHistoryItem(current)];
      return json(
        IntentionMutationResultSchema.parse({
          ok: false,
          commandId,
          error: { code: "stale-version", gameId, intentionId, expectedVersion, current },
        }),
        409,
      );
    }
    const resolved = resolveIntention(active, action === "complete" ? "completed" : "retired");
    active = null;
    history = [resolvedHistoryItem(resolved), ...history];
    return json(
      IntentionMutationResultSchema.parse({
        ok: true,
        commandId,
        intention: resolved,
        linkedOwnershipTransition: null,
      }),
    );
  }

  return json({ error: `No deterministic fixture route for ${request.method} ${path}` }, 404);
}

const socketServer = Bun.serve({ unix: socketPath, fetch: handle, idleTimeout: 0 as never });
const healthServer = Bun.serve({
  hostname: "127.0.0.1",
  port: 3101,
  fetch: () => new Response("ok"),
});

function shutdown(): void {
  void socketServer.stop();
  void healthServer.stop();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

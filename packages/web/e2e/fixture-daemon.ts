import {
  AttentionCommandReceiptSchema,
  AttentionDispositionCommandSchema,
  AttentionDispositionCommandResultSchema,
  AnalystCitationInspectRequestSchema,
  AnalystCitationInspectResultSchema,
  AnalystConfigurationSchema,
  AnalystTurnRequestSchema,
  CollectionProfileResultSchema,
  GameDetailWithPurchaseUtilizationSchema,
  IntentionMutationResultSchema,
  OwnerGameNoteClearRequestSchema,
  OwnerGameNoteMutationResultSchema,
  OwnerGameNoteSetRequestSchema,
  REFLECTION_QUESTION_IDS,
  REFLECTION_QUESTION_POLICIES,
  ReflectionGetResultSchema,
  attentionDispositionRequestFingerprint,
  calculatePurchaseUtilization,
  type AttentionDispositionCommand,
  type GameDetailWithPurchaseUtilization,
  type OwnerGameNote,
  type PlayIntention,
  type ResolvedPlayIntentionHistory,
  type ReflectionGetResult,
  type ReflectionQuestionId,
} from "@shelf-judge/shared";
import { lstatSync, readFileSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import {
  emptyUsefulProfileFixture,
  unavailableUsefulProfileFixture,
} from "../../shared/tests/fixtures/useful-profile";
import {
  createFixtureAxis,
  createProfileFixture,
  createRankedAttentionCards,
  baseGame,
  activeIntention,
  observedAt,
  externalObservedAt,
  createdAt,
  resolvedAt,
  gameId,
} from "./fixture/data";
import {
  collectionDefinitions,
  collectionGame,
  collectionEntries,
  createCollectionState,
  score,
  nichePosition,
  utilization,
  tournamentStats,
  type CollectionFixtureState,
} from "./fixture/collection";
import {
  createReflectionState,
  reflectionResult,
  guidedAbstention,
  isReflectionQuestionId,
} from "./fixture/reflections";
import {
  createOwnerNoteState,
  persistOwnerNoteState,
  reconstructOwnerNoteState,
  ownerNote,
  noteRequestMatches,
  ownerNoteRequestFingerprint,
  type NoteOperation,
  type OwnerNoteFixtureState,
} from "./fixture/owner-note-state";

const configuredSocketPath = process.env.SHELF_JUDGE_SOCKET;
if (configuredSocketPath === undefined) throw new Error("SHELF_JUDGE_SOCKET is required");
const socketPath: string = configuredSocketPath;
const healthPort = Number(process.env.SHELF_JUDGE_E2E_FIXTURE_PORT ?? "3101");
if (!Number.isSafeInteger(healthPort) || healthPort < 1 || healthPort > 65_535) {
  throw new Error("SHELF_JUDGE_E2E_FIXTURE_PORT must be a valid TCP port");
}
const ownerNotePersistencePath = `${socketPath}.owner-notes.json`;
const axis = createFixtureAxis();
const profileFixture = createProfileFixture(axis);
const rankedAttentionCards = createRankedAttentionCards(profileFixture);

type Scenario =
  | "profile"
  | "ranked-attention"
  | "empty"
  | "unavailable"
  | "create"
  | "active"
  | "stale"
  | "collection"
  | "manual-values"
  | "owner-notes";

interface ManualValuesFixtureState {
  blockNextMutation: boolean;
  blockNextDetail: boolean;
  failNextMutation: boolean;
  releaseMutation: (() => void) | null;
  releaseDetail: (() => void) | null;
  mutationBodies: Record<string, unknown>[];
  activeMutations: number;
  maxActiveMutations: number;
}

let scenario: Scenario = "profile";
let game = baseGame(axis);
let active: PlayIntention | null = activeIntention();
let history: ResolvedPlayIntentionHistory = [];
let staleOnce = false;
let intentionSequence = 1;
let collectionState: CollectionFixtureState = createCollectionState();
let manualValuesState: ManualValuesFixtureState = createManualValuesState();
let ownerNoteState: OwnerNoteFixtureState = createOwnerNoteState();
let reflectionState: ReflectionGetResult = createReflectionState();
let activeReflectionBatch: { batchId: string; questionIds: ReflectionQuestionId[] } | null = null;
let reflectionFixtureMode: "normal" | "malformed" | "configuration-race" = "normal";
let reflectionCurrentGameName: string | null = null;
let profileAttentionCardLimit = 6;
let attentionCommandBodies: Array<Record<string, unknown>> = [];
let attentionReceipts = new Map<string, ReturnType<typeof AttentionCommandReceiptSchema.parse>>();
let suppressedAttentionGames = new Set<string>();
let attentionProfileGets = 0;
let attentionConfigGets = 0;
let attentionConfigPuts = 0;
let attentionConfigPutBodies: Array<Record<string, unknown>> = [];
const analystCancelledConversations = new Set<string>();
const analystEofConversations = new Set<string>();
const currentDiscoveryInspectionConversations = new Set<string>();
let profileNavigationTelemetry = createProfileNavigationTelemetry();

function candidate(bggId: number, primaryName: string, identityCitationId: string) {
  return { bggId, primaryName, yearPublished: 2024, identityCitationId };
}

function previewFor(state: string, now: string): Record<string, unknown> {
  const score = {
    value: 7.4,
    label: state === "existing" ? "actual" : "predicted",
    readinessStage: state === "stage0" ? 0 : 2,
    confidence: state === "stage0" ? "insufficient" : "moderate",
    predictionUnavailable:
      state === "stage0" ? { reason: "stage-0", ratedGameCount: 0, gamesNeeded: 5 } : null,
    axes: [
      {
        axisId: "strategy",
        axisName: "Strategy",
        value: 7,
        source: "predicted",
        confidence: "moderate",
      },
    ],
    referenceGames: [{ gameId: "game-1", gameName: "Atlas Equal" }],
  };
  if (state === "unavailable")
    return {
      status: "unavailable",
      state,
      bggId: 174430,
      code: "PredictionUnavailable",
      retryable: false,
      predictionUnavailable: { reason: "stage-0", ratedGameCount: 0, gamesNeeded: 5 },
    };
  if (state === "ambiguous")
    return {
      status: "partial",
      state,
      bggId: 174430,
      collectionGameIds: ["game-1", "game-2"],
      code: "AmbiguousCollectionMatch",
    };
  if (state === "error") return { status: "error", code: "BggOutage", retryable: true };
  const common = {
    bggId: 174430,
    calculatedAt: now,
    sourceVersion: "fixture-source-v1",
    calculationCitationId: `calc-${state}`,
  };
  if (state === "local-unverified")
    return {
      ...common,
      status: "partial",
      state: "existing-local-unverified",
      bggLookup: { status: "failed", code: "BggOutage", retryable: true },
      collectionGameId: "game-1",
      collectionName: "Local Atlas",
      ownership: "owned",
      collectionCitationId: "collection-local",
      score: { ...score, label: "actual" },
    };
  return {
    ...common,
    status: "ok",
    state: state === "existing" ? "existing" : "predicted",
    primaryName: "Atlas Equal",
    bggLookup: { status: "verified", observedAt: now, factCitationId: `facts-${state}` },
    ...(state === "existing"
      ? {
          collectionGameId: "game-1",
          ownership: "previously-owned",
          collectionCitationId: "collection-existing",
        }
      : {}),
    score,
  };
}

function answerFor(ownerText: string, previewState?: string): string {
  const text = ownerText.toLowerCase();
  if (text.includes("zero-hit")) return "No matches in this title search.";
  if (text.includes("hot limited")) return "The checked Hot sample contains two candidates.";
  if (text.includes("truncated") || text.includes("partial"))
    return "Showing a bounded sample; more results were returned.";
  if (previewState === "predicted") return "A predicted fitness preview is available.";
  if (previewState === "existing") return "An existing collection score is available.";
  if (previewState === "local-unverified")
    return "A local score is available, but BGG identity could not be verified.";
  if (previewState === "stage0")
    return "The profile is at readiness stage 0; personal prediction is unavailable.";
  if (previewState === "unavailable") return "Fitness preview unavailable.";
  if (previewState === "ambiguous")
    return "Several collection entries may match; no score was selected.";
  if (previewState === "error") return "The BGG request failed; no preview is available.";
  return "Atlas Equal is supported by current validated collection evidence.";
}

interface ProfileNavigationTelemetry {
  profileGets: number;
  reflectionsGets: number;
  ownerNoteGets: number;
  reflectionRefreshes: number;
}

function createProfileNavigationTelemetry(): ProfileNavigationTelemetry {
  return { profileGets: 0, reflectionsGets: 0, ownerNoteGets: 0, reflectionRefreshes: 0 };
}

function createManualValuesState(): ManualValuesFixtureState {
  return {
    blockNextMutation: false,
    blockNextDetail: false,
    failNextMutation: false,
    releaseMutation: null,
    releaseDetail: null,
    mutationBodies: [],
    activeMutations: 0,
    maxActiveMutations: 0,
  };
}

async function waitForOwnerNoteRelease(): Promise<void> {
  if (!ownerNoteState.delayNextMutation) return;
  ownerNoteState.delayNextMutation = false;
  await new Promise<void>((resolve) => {
    ownerNoteState.releaseMutation = resolve;
  });
  ownerNoteState.releaseMutation = null;
}

async function waitForManualValuesRelease(kind: "mutation" | "detail"): Promise<void> {
  const blockKey = kind === "mutation" ? "blockNextMutation" : "blockNextDetail";
  const releaseKey = kind === "mutation" ? "releaseMutation" : "releaseDetail";
  if (!manualValuesState[blockKey]) return;
  manualValuesState[blockKey] = false;
  await new Promise<void>((resolve) => {
    manualValuesState[releaseKey] = resolve;
  });
  manualValuesState[releaseKey] = null;
}

function reset(next: Scenario): void {
  scenario = next;
  game = baseGame(axis);
  if (next === "active") {
    game.numPlays = 3;
    game.lastPlayedAt = "2026-08-26";
    game.recentPlayCount = 3;
    game.playCountEvidence = { status: "valid", value: 3, source: "bgg-plays", observedAt };
  }
  if (next === "create") {
    game.numPlays = null;
    game.lastPlayedAt = null;
    game.recentPlayCount = undefined;
    game.playCountEvidence = { status: "missing", source: "manual", observedAt: null };
  }
  history = [];
  staleOnce = next === "stale";
  active = next === "active" || next === "stale" || next === "profile" ? activeIntention() : null;
  intentionSequence = 1;
  collectionState = createCollectionState();
  manualValuesState = createManualValuesState();
  rmSync(ownerNotePersistencePath, { force: true });
  ownerNoteState = createOwnerNoteState();
  reflectionState = createReflectionState();
  activeReflectionBatch = null;
  reflectionFixtureMode = "normal";
  reflectionCurrentGameName = null;
  profileNavigationTelemetry = createProfileNavigationTelemetry();
  profileAttentionCardLimit = 6;
  attentionCommandBodies = [];
  attentionReceipts = new Map();
  suppressedAttentionGames = new Set();
  attentionProfileGets = 0;
  attentionConfigGets = 0;
  attentionConfigPuts = 0;
  attentionConfigPutBodies = [];
  analystCancelledConversations.clear();
  analystEofConversations.clear();
  currentDiscoveryInspectionConversations.clear();
  persistOwnerNoteState(ownerNoteState, ownerNotePersistencePath);
  if (next === "manual-values") {
    game.manualValues = {
      playingTime: { value: 90, source: "manual", confirmedAt: observedAt },
      playerCount: { value: 4, source: "manual", confirmedAt: observedAt },
    };
  }
}

function detail(requestedGameId = gameId): GameDetailWithPurchaseUtilization {
  const definition = collectionDefinitions.find(({ id }) => id === requestedGameId);
  const rankedAttentionCard =
    scenario === "ranked-attention"
      ? rankedAttentionCards.find(({ gameId: candidateId }) => candidateId === requestedGameId)
      : undefined;
  let detailGame =
    definition !== undefined
      ? collectionGame(definition, collectionState, axis)
      : rankedAttentionCard !== undefined
        ? { ...baseGame(axis), id: requestedGameId, name: rankedAttentionCard.gameName }
        : game;
  if (requestedGameId === "game-1" && reflectionCurrentGameName !== null) {
    detailGame = { ...detailGame, name: reflectionCurrentGameName };
  }
  const detailScore =
    definition === undefined
      ? {
          score: 6,
          ratedAxisCount: 1,
          totalAxisCount: 1,
          breakdown: [],
          vetoed: false,
          vetoedBy: null,
          hypotheticalScore: null,
          predictionMeta: null,
          redundancyAdjustment: null,
        }
      : score(definition, false);
  return GameDetailWithPurchaseUtilizationSchema.parse({
    game: {
      ...detailGame,
      ownerNote: ownerNote(ownerNoteState, requestedGameId),
    },
    score: detailScore,
    bggDataStale: false,
    nichePosition: definition === undefined ? null : nichePosition(definition),
    displayScore: detailScore?.score.toFixed(1) ?? null,
    purchaseUtilization:
      definition === undefined
        ? calculatePurchaseUtilization({
            acquisition: detailGame.acquisition,
            entertainmentBenchmark: null,
            playCount: detailGame.playCountEvidence,
            duration: detailGame.durationEvidence,
            playerRange: detailGame.playerRangeEvidence,
            suggestedPlayerPoll: detailGame.suggestedPlayerPoll,
            fitness: "6.0",
          })
        : utilization(detailGame, definition),
    intentions: {
      activeIntention:
        requestedGameId === gameId ? active : (rankedAttentionCard?.intention ?? null),
      resolvedHistory: requestedGameId === gameId ? history : [],
    },
  });
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function analystConfiguration() {
  return AnalystConfigurationSchema.parse({
    contractVersion: 4,
    manifestVersion: 4,
    disclosureVersion: 1,
    configuration: {
      status: "configured",
      identity: { providerId: "fixture-provider", modelId: "fixture-model", extensionIds: [] },
    },
    bgg: { status: "configured" },
    disclosure: {
      evidenceClasses: [
        "game-identity-ownership",
        "current-scoring",
        "imported-metadata",
        "play-acquisition",
        "collection-structure",
        "collection-summary",
        "profile-evidence",
        "owner-game-note",
        "bgg-search-observation",
        "bgg-hot-observation",
        "bgg-candidate-identity",
        "bgg-thing-facts",
        "bgg-preview-calculation",
      ],
      relevantOwnerNotesMayBeTransmitted: true,
      selectedOwnerTitleOrBggIdsMayBeSentToBgg: true,
      bggProcessingIsSeparateFromProviderProcessing: true,
      localRetention: "Shelf Judge does not persist Analyst conversations.",
      providerProcessingAndRetentionFollowProviderPolicy: true,
      applicationTokenCap: null,
      applicationMonetaryCap: null,
      cancellation: "Cancel the active request.",
      maximumTranscriptMessages: 32,
      maximumTranscriptCharacters: 48000,
    },
  });
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

async function mutateOwnerNote(
  request: Request,
  requestedGameId: string,
  operation: NoteOperation,
): Promise<Response> {
  const requestBody = await body(request);
  ownerNoteState.mutationBodies.push({
    method: request.method,
    gameId: requestedGameId,
    body: requestBody,
  });
  const parsedRequest =
    operation === "set"
      ? OwnerGameNoteSetRequestSchema.safeParse(requestBody)
      : OwnerGameNoteClearRequestSchema.safeParse(requestBody);
  if (!parsedRequest.success) {
    const commandId =
      typeof requestBody.commandId === "string" ? requestBody.commandId : crypto.randomUUID();
    return json(
      OwnerGameNoteMutationResultSchema.parse({
        ok: false,
        commandId,
        error: {
          code: "validation",
          issues: parsedRequest.error.issues.map((issue) => ({
            field: issue.path.join(".") || "request",
            message: issue.message,
          })),
        },
      }),
      400,
    );
  }

  const command = parsedRequest.data;
  const text: string | undefined =
    operation === "set" ? OwnerGameNoteSetRequestSchema.parse(requestBody).text : undefined;
  const receipt = ownerNoteState.receipts.get(command.commandId);
  if (receipt !== undefined) {
    if (!noteRequestMatches(receipt, operation, requestedGameId, command.expectedVersion, text)) {
      return json(
        OwnerGameNoteMutationResultSchema.parse({
          ok: false,
          commandId: command.commandId,
          error: { code: "command-reuse", commandId: command.commandId },
        }),
        409,
      );
    }
    return json(
      OwnerGameNoteMutationResultSchema.parse({
        ok: true,
        accepted: { ...receipt.accepted, replayed: true },
      }),
    );
  }

  if (ownerNoteState.failNextMutation) {
    ownerNoteState.failNextMutation = false;
    return json(
      OwnerGameNoteMutationResultSchema.parse({
        ok: false,
        commandId: command.commandId,
        error: {
          code: "persistence-failure",
          operation: `shelf.game.note.${operation}`,
          message: "Injected owner note persistence failure",
        },
      }),
      500,
    );
  }

  await waitForOwnerNoteRelease();
  const current = ownerNote(ownerNoteState, requestedGameId);
  if (current.version !== command.expectedVersion) {
    return json(
      OwnerGameNoteMutationResultSchema.parse({
        ok: false,
        commandId: command.commandId,
        error: {
          code: "stale-version",
          gameId: requestedGameId,
          expectedVersion: command.expectedVersion,
          current,
        },
      }),
      409,
    );
  }

  const alreadyClear = operation === "clear" && current.state !== "present";
  const version = alreadyClear ? current.version : current.version + 1;
  const updatedAt = alreadyClear
    ? current.updatedAt
    : `2026-08-28T13:${String(version).padStart(2, "0")}:00.000Z`;
  const next: OwnerGameNote =
    operation === "set"
      ? { state: "present", version, updatedAt: updatedAt ?? externalObservedAt, text: text ?? "" }
      : alreadyClear
        ? current
        : { state: "cleared", version, updatedAt: updatedAt ?? externalObservedAt };
  ownerNoteState.notes.set(requestedGameId, next);
  ownerNoteState.collectionRevision += 1;
  const accepted = OwnerGameNoteMutationResultSchema.parse({
    ok: true,
    accepted: {
      commandId: command.commandId,
      gameId: requestedGameId,
      operation,
      state: next.state,
      version: next.version,
      updatedAt: next.updatedAt,
      collectionRevision: ownerNoteState.collectionRevision,
      replayed: false,
      alreadyClear,
    },
  });
  if (!accepted.ok) throw new Error("Fixture accepted result was unexpectedly rejected");
  const { replayed: _replayed, ...storedAccepted } = accepted.accepted;
  void _replayed;
  ownerNoteState.receipts.set(command.commandId, {
    operation,
    gameId: requestedGameId,
    expectedVersion: command.expectedVersion,
    requestFingerprint: ownerNoteRequestFingerprint(
      operation,
      requestedGameId,
      command.expectedVersion,
      text,
    ),
    accepted: storedAccepted,
  });
  persistOwnerNoteState(ownerNoteState, ownerNotePersistencePath);

  if (ownerNoteState.dropNextAcceptedResponse) {
    ownerNoteState.dropNextAcceptedResponse = false;
    return new Response("accepted response intentionally dropped", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return json(accepted);
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/api/profile") {
    profileNavigationTelemetry.profileGets += 1;
  }
  if (request.method === "GET" && path === "/api/profile/reflections") {
    profileNavigationTelemetry.reflectionsGets += 1;
  }
  if (request.method === "GET" && /^\/api\/games\/[^/]+\/note$/.test(path)) {
    profileNavigationTelemetry.ownerNoteGets += 1;
  }
  if (request.method === "POST" && path === "/api/profile/reflections/refresh") {
    profileNavigationTelemetry.reflectionRefreshes += 1;
  }

  if (path === "/api/test/reset" && request.method === "POST") {
    const requested = (await body(request)).scenario;
    if (
      requested !== "profile" &&
      requested !== "ranked-attention" &&
      requested !== "empty" &&
      requested !== "unavailable" &&
      requested !== "create" &&
      requested !== "active" &&
      requested !== "stale" &&
      requested !== "collection" &&
      requested !== "manual-values" &&
      requested !== "owner-notes"
    ) {
      return json({ error: "Unknown fixture scenario" }, 400);
    }
    reset(requested);
    return json({ scenario });
  }

  if (path === "/api/test/profile-navigation-telemetry" && request.method === "GET") {
    return json(profileNavigationTelemetry);
  }

  if (path === "/api/test/attention-state" && request.method === "GET") {
    return json({
      profileGets: attentionProfileGets,
      configGets: attentionConfigGets,
      configPuts: attentionConfigPuts,
      configPutBodies: attentionConfigPutBodies,
      configLimit: profileAttentionCardLimit,
      commandBodies: attentionCommandBodies,
      suppressedGameIds: [...suppressedAttentionGames],
      receipts: [...attentionReceipts.values()],
    });
  }

  if (path === "/api/config" && request.method === "GET") {
    attentionConfigGets += 1;
    return json({ profileAttentionCardLimit });
  }

  if (path === "/api/config" && request.method === "PUT") {
    attentionConfigPuts += 1;
    const requestBody = await body(request);
    attentionConfigPutBodies.push(requestBody);
    const limit = requestBody.profileAttentionCardLimit;
    if (
      Object.keys(requestBody).length !== 1 ||
      typeof limit !== "number" ||
      !Number.isSafeInteger(limit) ||
      limit < 0 ||
      limit > 24
    ) {
      return json({ error: "profileAttentionCardLimit must be an integer from 0 to 24" }, 400);
    }
    profileAttentionCardLimit = limit;
    return json({ profileAttentionCardLimit });
  }

  if (path === "/api/collection/entertainment-benchmark" && request.method === "GET") {
    return json({ entertainmentBenchmark: null });
  }

  if (path === "/api/test/owner-note-state") {
    if (request.method === "GET") {
      return json({
        notes: Object.fromEntries(ownerNoteState.notes),
        receipts: Array.from(ownerNoteState.receipts, ([commandId, receipt]) => ({
          commandId,
          ...receipt,
        })),
        persistedState: JSON.parse(readFileSync(ownerNotePersistencePath, "utf8")) as unknown,
        collectionRevision: ownerNoteState.collectionRevision,
        mutationBodies: ownerNoteState.mutationBodies,
        restartCount: ownerNoteState.restartCount,
      });
    }
    if (request.method === "POST") {
      const requested = await body(request);
      if (typeof requested.failNextMutation === "boolean") {
        ownerNoteState.failNextMutation = requested.failNextMutation;
      }
      if (typeof requested.dropNextAcceptedResponse === "boolean") {
        ownerNoteState.dropNextAcceptedResponse = requested.dropNextAcceptedResponse;
      }
      if (typeof requested.delayNextMutation === "boolean") {
        ownerNoteState.delayNextMutation = requested.delayNextMutation;
      }
      if (requested.releaseMutation === true) ownerNoteState.releaseMutation?.();
      if (typeof requested.externalGameId === "string") {
        const current = ownerNote(ownerNoteState, requested.externalGameId);
        const version = current.version + 1;
        const next =
          typeof requested.externalText === "string"
            ? ({
                state: "present",
                version,
                updatedAt: externalObservedAt,
                text: requested.externalText,
              } satisfies OwnerGameNote)
            : ({
                state: "cleared",
                version,
                updatedAt: externalObservedAt,
              } satisfies OwnerGameNote);
        ownerNoteState.notes.set(requested.externalGameId, next);
        ownerNoteState.collectionRevision += 1;
        persistOwnerNoteState(ownerNoteState, ownerNotePersistencePath);
      }
      if (typeof requested.blockDeletionGameId === "string") {
        const ids = Array.isArray(requested.intentionIds)
          ? requested.intentionIds.filter((id): id is string => typeof id === "string")
          : ["intention-browser-blocker"];
        ownerNoteState.deletionBlockers.set(requested.blockDeletionGameId, ids);
      }
      if (typeof requested.unblockDeletionGameId === "string") {
        ownerNoteState.deletionBlockers.delete(requested.unblockDeletionGameId);
      }
      return json({ ok: true });
    }
  }

  if (path === "/api/test/owner-note-restart" && request.method === "POST") {
    const restartCount = ownerNoteState.restartCount + 1;
    ownerNoteState.releaseMutation?.();
    ownerNoteState = reconstructOwnerNoteState(ownerNotePersistencePath);
    ownerNoteState.restartCount = restartCount;
    return json({ ok: true, restartCount: ownerNoteState.restartCount });
  }

  if (path === "/api/test/manual-values-state") {
    if (request.method === "GET") {
      return json({
        mutationBodies: manualValuesState.mutationBodies,
        activeMutations: manualValuesState.activeMutations,
        maxActiveMutations: manualValuesState.maxActiveMutations,
      });
    }
    if (request.method === "POST") {
      const requested = await body(request);
      if (typeof requested.blockNextMutation === "boolean") {
        manualValuesState.blockNextMutation = requested.blockNextMutation;
      }
      if (typeof requested.blockNextDetail === "boolean") {
        manualValuesState.blockNextDetail = requested.blockNextDetail;
      }
      if (typeof requested.failNextMutation === "boolean") {
        manualValuesState.failNextMutation = requested.failNextMutation;
      }
      if (typeof requested.externalPlayingTime === "number") {
        game.manualValues.playingTime = {
          value: requested.externalPlayingTime,
          source: "manual",
          confirmedAt: externalObservedAt,
        };
      }
      if (typeof requested.externalPlayerCount === "number") {
        game.manualValues.playerCount = {
          value: requested.externalPlayerCount,
          source: "manual",
          confirmedAt: externalObservedAt,
        };
      }
      if (requested.releaseMutation === true) manualValuesState.releaseMutation?.();
      if (requested.releaseDetail === true) manualValuesState.releaseDetail?.();
      return json({ ok: true });
    }
  }

  if (path === "/api/test/collection-state" && request.method === "POST") {
    const requested = await body(request);
    if (Array.isArray(requested.deletedIds)) {
      collectionState.deletedIds = new Set(
        requested.deletedIds.filter((id): id is string => typeof id === "string"),
      );
    }
    if (Array.isArray(requested.previouslyOwnedIds)) {
      collectionState.previouslyOwnedIds = new Set(
        requested.previouslyOwnedIds.filter((id): id is string => typeof id === "string"),
      );
    }
    for (const field of [
      "thumbnails",
      "empty",
      "axesAvailable",
      "tournamentAvailable",
      "predictionsAvailable",
      "nichesAvailable",
      "integratedRedundancy",
    ] as const) {
      if (typeof requested[field] === "boolean") collectionState[field] = requested[field];
    }
    return json({ ok: true });
  }

  const attentionCommandMatch = path.match(/^\/api\/profile\/attention\/(not-now|intentional)$/);
  if (attentionCommandMatch !== null && request.method === "POST") {
    const requestBody = await body(request);
    attentionCommandBodies.push({ method: request.method, path, body: requestBody });
    const parsed = AttentionDispositionCommandSchema.safeParse(requestBody);
    const operation = attentionCommandMatch[1];
    if (!parsed.success || parsed.data.operation !== operation) {
      return json(
        AttentionDispositionCommandResultSchema.parse({
          outcome: "rejected",
          error: { code: "validation" },
        }),
        400,
      );
    }
    const command: AttentionDispositionCommand = parsed.data;
    const replay = attentionReceipts.get(command.commandId);
    if (replay !== undefined) {
      return json(
        AttentionDispositionCommandResultSchema.parse({ outcome: "replayed", receipt: replay }),
      );
    }
    const card = rankedAttentionCards.find(
      ({ gameId: candidateId }) => candidateId === command.gameId,
    );
    const template = card?.actions.find(({ action }) => action === command.operation)?.command;
    if (
      template === null ||
      template === undefined ||
      template.ruleId !== command.ruleId ||
      template.ruleVersion !== command.ruleVersion ||
      template.fingerprint !== command.fingerprint ||
      template.expectedVersion !== command.expectedVersion
    ) {
      return json(
        AttentionDispositionCommandResultSchema.parse({
          outcome: "rejected",
          error: { code: "candidate-mismatch", gameId: command.gameId },
        }),
        409,
      );
    }
    const accepted =
      command.operation === "not-now"
        ? {
            gameId: command.gameId,
            kind: "snoozed" as const,
            ruleId: command.ruleId,
            ruleVersion: command.ruleVersion,
            fingerprint: command.fingerprint,
            responseAt: "2026-08-28T10:00:00.000Z",
            expiresAt: "2026-09-27T10:00:00.000Z",
            version: command.expectedVersion + 1,
          }
        : {
            gameId: command.gameId,
            kind: "intentional" as const,
            ruleId: command.ruleId,
            ruleVersion: command.ruleVersion,
            fingerprint: command.fingerprint,
            version: command.expectedVersion + 1,
          };
    const receipt = AttentionCommandReceiptSchema.parse({
      receiptType: "attention-disposition",
      commandId: command.commandId,
      operation: command.operation,
      gameId: command.gameId,
      ruleId: command.ruleId,
      ruleVersion: command.ruleVersion,
      expectedVersion: command.expectedVersion,
      requestFingerprint: attentionDispositionRequestFingerprint(command),
      requestPayload: command,
      accepted,
    });
    attentionReceipts.set(command.commandId, receipt);
    suppressedAttentionGames.add(command.gameId);
    return json(AttentionDispositionCommandResultSchema.parse({ outcome: "accepted", receipt }));
  }

  if (path === "/api/profile" && request.method === "GET") {
    attentionProfileGets += 1;
    const response =
      scenario === "empty"
        ? emptyUsefulProfileFixture
        : scenario === "unavailable"
          ? unavailableUsefulProfileFixture
          : scenario === "ranked-attention"
            ? (() => {
                const profile = structuredClone(profileFixture);
                if (profile.status !== "available") return profile;
                for (const entityClass of ["mechanic", "designer", "artist"] as const) {
                  const result = profile.identity.classes[entityClass];
                  const exclusionTemplate = result.exclusions[0];
                  if (exclusionTemplate === undefined) {
                    throw new Error(`Expected ${entityClass} exclusion fixture`);
                  }
                  result.metadataReadiness.ownedGameCount += rankedAttentionCards.length;
                  result.metadataReadiness.completeGameCount += rankedAttentionCards.length;
                  result.exclusions.push(
                    ...rankedAttentionCards.map((card) => ({
                      ...structuredClone(exclusionTemplate),
                      gameId: card.gameId,
                      gameName: card.gameName,
                    })),
                  );
                }
                const cards = rankedAttentionCards
                  .filter(({ gameId: candidateId }) => !suppressedAttentionGames.has(candidateId))
                  .slice(0, profileAttentionCardLimit);
                profile.attention = {
                  state:
                    profileAttentionCardLimit === 0
                      ? "disabled"
                      : cards.length > 0
                        ? "ranked"
                        : "no-winner",
                  cardLimit: profileAttentionCardLimit,
                  cards,
                };
                return profile;
              })()
            : profileFixture;
    return json(CollectionProfileResultSchema.parse(response));
  }

  if (path === "/api/analyst/configuration" && request.method === "GET") {
    return json(analystConfiguration());
  }
  if (path === "/api/analyst/citations/inspect" && request.method === "POST") {
    const parsed = AnalystCitationInspectRequestSchema.safeParse(await body(request));
    if (!parsed.success) return json({ error: "Invalid citation inspection request" }, 400);
    const citationId = parsed.data.citation.citationId;
    const inspection = parsed.data.inspection;
    const inspectionDestination =
      inspection?.view.kind === "discovery"
        ? {
            operationId: "shelf.analyst.discovery.get",
            parameters: { citationId: inspection.citation.citationId },
          }
        : {
            operationId: "shelf.game.get",
            parameters: { gameId: "game-1" },
          };
    const result =
      citationId === "discovery-zero" && inspection !== undefined
        ? currentDiscoveryInspectionConversations.has(inspection.conversationId)
          ? {
              state: "historical",
              destination: inspectionDestination,
              inspectedAt: "2026-09-08T11:00:00.000Z",
              view: inspection.view,
              authenticationToken: inspection.authenticationToken,
            }
          : (currentDiscoveryInspectionConversations.add(inspection.conversationId),
            {
              state: "current",
              destination: inspectionDestination,
            })
        : citationId === "score-historical"
          ? {
              state: "historical",
              destination: {
                operationId: "shelf.analyst.discovery.get",
                parameters: { citationId: "historical-discovery" },
              },
              inspectedAt: "2026-09-08T11:00:00.000Z",
              view: {
                kind: "discovery",
                result: {
                  status: "ok",
                  source: "title",
                  observedAt: "2026-09-08T10:00:00.000Z",
                  returnedCount: 0,
                  emittedCount: 0,
                  truncated: false,
                  observationCitationId: "historical-discovery",
                  candidates: [],
                },
              },
              authenticationToken: "fixture-historical-authentication",
            }
          : citationId === "score-superseded"
            ? {
                state: "superseded",
                destination: {
                  operationId: "shelf.analyst.discovery.get",
                  parameters: { citationId: "superseded-discovery" },
                },
              }
            : {
                state: "current",
                destination: {
                  operationId: "shelf.game.get",
                  parameters: { gameId: "game-1" },
                },
              };
    return json(AnalystCitationInspectResultSchema.parse(result));
  }
  if (path === "/api/analyst/turns/cancel" && request.method === "POST") {
    return json({ outcome: "accepted", requestId: (await body(request)).requestId });
  }
  if (path === "/api/analyst/turns/stream" && request.method === "POST") {
    const requestBody = await body(request);
    const parsedRequest = AnalystTurnRequestSchema.safeParse(requestBody);
    if (!parsedRequest.success) return json({ error: "Invalid Analyst turn request" }, 400);
    const { requestId, conversationId, turnIndex } = parsedRequest.data;
    const now = "2026-09-08T10:00:00.000Z";
    const event = (sequence: number, value: Record<string, unknown>) =>
      `data: ${JSON.stringify({ version: 1, operationId: "fixture-analyst-operation", sequence, occurredAt: now, ...value })}\n\n`;
    const citation = {
      citationId: "score-1",
      sourceId: "game-1",
      sourceVersion: "1",
      evidenceClass: "current-scoring",
      canonicalSummary: "Current fitness score",
      testimony: false,
      destination: { operationId: "shelf.game.get", parameters: { gameId: "game-1" } },
    };
    const lastMessage = parsedRequest.data.messages.at(-1);
    const ownerText = lastMessage?.role === "owner" ? lastMessage.content : "";
    const discovery = ownerText.includes("zero-hit")
      ? [
          {
            status: "ok",
            source: "title",
            observedAt: now,
            returnedCount: 0,
            emittedCount: 0,
            truncated: false,
            observationCitationId: "discovery-zero",
            candidates: [],
          },
        ]
      : ownerText.includes("hot limited")
        ? [
            {
              status: "ok",
              source: "hot",
              observedAt: now,
              returnedCount: 2,
              emittedCount: 2,
              truncated: false,
              observationCitationId: "hot-limited",
              candidates: [
                candidate(174430, "Atlas Equal", "candidate-hot"),
                candidate(13, "Catan", "candidate-catan"),
              ],
            },
          ]
        : ownerText.includes("truncated") || ownerText.includes("partial")
          ? [
              {
                status: "ok",
                source: "title",
                observedAt: now,
                returnedCount: 12,
                emittedCount: 10,
                truncated: true,
                observationCitationId: "discovery-truncated",
                candidates: Array.from({ length: 10 }, (_, index) =>
                  candidate(
                    1000 + index,
                    `Fixture Candidate ${index + 1}`,
                    `candidate-${index + 1}`,
                  ),
                ),
              },
            ]
          : undefined;
    const previewState = [
      "predicted",
      "existing",
      "local-unverified",
      "stage0",
      "unavailable",
      "ambiguous",
      "error",
    ].find((state) => ownerText.toLowerCase().includes(state));
    const citations = [
      citation,
      ...[
        ["score-historical", "Historical fitness score", "game-historical", "2"],
        ["score-superseded", "Superseded fitness score", "game-superseded", "3"],
      ].map(([citationId, canonicalSummary, sourceId, sourceVersion]) => ({
        ...citation,
        citationId,
        canonicalSummary,
        sourceId,
        sourceVersion,
      })),
    ];
    const discoveryEvidence = discovery?.[0];
    const discoveryCitation =
      discoveryEvidence === undefined
        ? undefined
        : {
            citationId: String(discoveryEvidence.observationCitationId),
            sourceId: "fixture-discovery",
            sourceVersion: "1",
            evidenceClass:
              discoveryEvidence.source === "hot" ? "bgg-hot-observation" : "bgg-search-observation",
            observedAt: now,
            canonicalSummary:
              discoveryEvidence.source === "hot"
                ? "BGG Hot sample observation"
                : "BGG title search observation",
            testimony: false,
            destination: {
              operationId: "shelf.analyst.discovery.get",
              parameters: { citationId: String(discoveryEvidence.observationCitationId) },
            },
          };
    const finalCitations =
      discoveryCitation === undefined ? citations : [...citations, discoveryCitation];
    const result = {
      outcome: "answered",
      blocks: [
        {
          text: ownerText.includes("**owner literal**")
            ? "**bold**\n\n1. First\n2. Second"
            : answerFor(ownerText, previewState),
          citationIds: finalCitations.map(({ citationId }) => citationId),
        },
      ],
      citations: finalCitations,
      usage: { state: "unavailable" },
    };
    const discoveryIds = discovery?.flatMap((item) =>
      item.candidates.map(({ bggId }) => ({
        bggId,
        source: item.source === "title" ? "search" : "hot",
      })),
    );
    const receiptBatch = ownerText.match(/^receipt-batch-(\d+)$/i);
    const citationInspections =
      discoveryCitation === undefined || discoveryEvidence === undefined
        ? undefined
        : [
            {
              version: 1,
              conversationId,
              requestId,
              turnIndex,
              citation: discoveryCitation,
              view: { kind: "discovery", result: discoveryEvidence },
              attestationDigest: "A".repeat(43),
              authenticationToken: "fixture-inspection-authentication",
            },
          ];
    const discoveryReceipts =
      receiptBatch === null
        ? discovery === undefined
          ? undefined
          : discoveryIds?.map(({ bggId }) => `fixture-id-receipt-${bggId}`)
        : Array.from({ length: 5 }, (_, index) => `fixture-receipt-${receiptBatch[1]}-${index}`);
    if (
      ownerText.toLowerCase().includes("eof without terminal") &&
      !analystEofConversations.has(conversationId)
    ) {
      analystEofConversations.add(conversationId);
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                event(0, {
                  type: "accepted",
                  terminal: false,
                  conversationId,
                  requestId,
                  turnIndex,
                }),
              ),
            );
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    }
    if (
      JSON.stringify(requestBody).includes("cancel me") &&
      !analystCancelledConversations.has(conversationId)
    ) {
      analystCancelledConversations.add(conversationId);
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                event(0, {
                  type: "accepted",
                  terminal: false,
                  conversationId,
                  requestId,
                  turnIndex,
                }),
              ),
            );
            setTimeout(() => {
              try {
                controller.enqueue(
                  encoder.encode(
                    event(1, { type: "cancelled", terminal: true, conversationId, requestId }),
                  ),
                );
              } catch {
                return;
              }
            }, 150);
            setTimeout(() => {
              try {
                controller.enqueue(
                  encoder.encode(
                    event(2, {
                      type: "completed",
                      terminal: true,
                      conversationId,
                      requestId,
                      result,
                      ...(discovery === undefined
                        ? {}
                        : { discovery, discoveryIds, discoveryDigest: "A".repeat(43) }),
                      ...(discoveryReceipts === undefined ? {} : { discoveryReceipts }),
                      ...(citationInspections === undefined ? {} : { citationInspections }),
                      ...(previewState === undefined
                        ? {}
                        : { fitnessPreview: [previewFor(previewState, now)] }),
                      noteDependencies: [{ gameId: "game-1", noteVersion: 1 }],
                      validationAttestation: "stale-fixture-attestation",
                    }),
                  ),
                );
                controller.close();
              } catch {
                return;
              }
            }, 500);
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    }
    return new Response(
      event(0, { type: "accepted", terminal: false, conversationId, requestId, turnIndex }) +
        event(1, {
          type: "evidence-status",
          terminal: false,
          conversationId,
          requestId,
          status: "started",
          examinedItemCount: 0,
        }) +
        event(2, {
          type: "model-status",
          terminal: false,
          conversationId,
          requestId,
          status: "validating",
        }) +
        event(3, {
          type: "completed",
          terminal: true,
          conversationId,
          requestId,
          result,
          ...(discovery === undefined
            ? {}
            : { discovery, discoveryIds, discoveryDigest: "A".repeat(43) }),
          ...(discoveryReceipts === undefined ? {} : { discoveryReceipts }),
          ...(citationInspections === undefined ? {} : { citationInspections }),
          ...(previewState === undefined
            ? {}
            : { fitnessPreview: [previewFor(previewState, now)] }),
          noteDependencies: [{ gameId: "game-1", noteVersion: 1 }],
          validationAttestation: "fixture-attestation",
        }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  }

  if (path === "/api/profile/reflections" && request.method === "GET") {
    if (reflectionFixtureMode === "malformed") return json({ questions: "not-a-contract" });
    return json(reflectionState);
  }
  if (path === "/api/test/reflection-state" && request.method === "POST") {
    const requested = await body(request);
    const mode = requested.mode;
    reflectionFixtureMode = mode === "malformed" || mode === "configuration-race" ? mode : "normal";
    if (mode === "mutate-current") reflectionCurrentGameName = "Changed current game evidence";
    const firstQuestion = reflectionState.questions[0];
    if (firstQuestion === undefined)
      throw new Error("Reflection fixture requires its first question");
    if (mode === "abstention-guidance") {
      const guidanceKinds: Record<
        ReflectionQuestionId,
        "missing-current-testimony" | "existing-notes-not-examined" | "non-note-blocker"
      > = {
        "repeated-values": "non-note-blocker",
        "pattern-exceptions": "existing-notes-not-examined",
        "recurring-trade-offs": "missing-current-testimony",
      };
      reflectionState = ReflectionGetResultSchema.parse({
        ...reflectionState,
        questions: reflectionState.questions.map((question) => ({
          ...question,
          cache: {
            state: "current",
            result: guidedAbstention(question.questionId, guidanceKinds[question.questionId]),
          },
          attempt: { state: "idle" },
        })),
      });
    } else if (
      mode === "answered" ||
      mode === "abstained" ||
      mode === "stale" ||
      mode === "purge-note"
    ) {
      const result = reflectionResult(
        "repeated-values",
        mode === "abstained" ? "abstained" : "answered",
      );
      reflectionState = ReflectionGetResultSchema.parse({
        ...reflectionState,
        questions: [
          {
            ...firstQuestion,
            cache:
              mode === "stale"
                ? { state: "stale", changedCategories: ["metadata"], result }
                : mode === "purge-note"
                  ? { state: "none" }
                  : { state: "current", result },
            attempt:
              mode === "purge-note"
                ? { state: "purged", reason: "note-changed", occurredAt: observedAt }
                : { state: "idle" },
          },
          reflectionState.questions[1],
          reflectionState.questions[2],
        ],
      });
    }
    return json({ ok: true });
  }
  if (path === "/api/profile/reflections/settings" && request.method === "PUT") {
    const requestBody = await body(request);
    const questionId = requestBody.questionId;
    const enabled = requestBody.enabled;
    if (
      !REFLECTION_QUESTION_IDS.includes(questionId as (typeof REFLECTION_QUESTION_IDS)[number]) ||
      typeof enabled !== "boolean"
    ) {
      return json({ error: "Invalid reflection settings request" }, 400);
    }
    reflectionState = ReflectionGetResultSchema.parse({
      ...reflectionState,
      settings: {
        ...reflectionState.settings,
        questions: reflectionState.settings.questions.map((question) =>
          question.questionId === questionId ? { ...question, enabled } : question,
        ),
      },
      questions: reflectionState.questions.map((question) =>
        question.questionId === questionId
          ? { ...question, enabled, cache: { state: "none" }, attempt: { state: "idle" } }
          : question,
      ),
    });
    return json({ outcome: "accepted", requestId: requestBody.requestId });
  }
  if (path === "/api/profile/reflections" && request.method === "DELETE") {
    reflectionState = ReflectionGetResultSchema.parse({
      ...reflectionState,
      questions: reflectionState.questions.map((question) => ({
        ...question,
        cache: { state: "none" },
        attempt: question.enabled
          ? { state: "purged", reason: "owner-deleted", occurredAt: observedAt }
          : { state: "idle" },
      })),
    });
    const requestBody = await body(request);
    return json({ outcome: "accepted", requestId: requestBody.requestId });
  }
  if (path === "/api/profile/reflections/cancel" && request.method === "POST") {
    const requestBody = await body(request);
    if (activeReflectionBatch?.batchId === requestBody.batchId) {
      reflectionState = ReflectionGetResultSchema.parse({
        ...reflectionState,
        questions: reflectionState.questions.map((question) =>
          activeReflectionBatch?.questionIds.includes(question.questionId) &&
          question.attempt.state === "refreshing"
            ? { ...question, attempt: { state: "cancelled", occurredAt: observedAt } }
            : question,
        ),
      });
      activeReflectionBatch = null;
    }
    return json({ outcome: "accepted", requestId: requestBody.batchId });
  }
  if (path === "/api/profile/reflections/refresh" && request.method === "POST") {
    const requestBody = await body(request);
    const batchId = typeof requestBody.batchId === "string" ? requestBody.batchId : "invalid-batch";
    const questionIds: ReflectionQuestionId[] =
      requestBody.questionId === undefined
        ? [...REFLECTION_QUESTION_IDS]
        : isReflectionQuestionId(requestBody.questionId)
          ? [requestBody.questionId]
          : [...REFLECTION_QUESTION_IDS];
    const now = "2026-08-28T14:00:00.000Z";
    const accepted = {
      version: 1,
      operationId: "fixture-reflection-operation",
      sequence: 0,
      occurredAt: now,
      type: "accepted",
      terminal: false,
      batchId: requestBody.batchId,
      requestId: requestBody.requestId,
      cancellationCapability: requestBody.cancellationCapability,
      questionIds,
    };
    const questionStarted = {
      version: 1,
      operationId: "fixture-reflection-operation",
      sequence: 1,
      occurredAt: now,
      type: "question-started",
      terminal: false,
      batchId: requestBody.batchId,
      questionId: questionIds[0],
      questionVersion: REFLECTION_QUESTION_POLICIES[questionIds[0]].questionVersion,
    };
    const evidenceStarted = {
      version: 1,
      operationId: "fixture-reflection-operation",
      sequence: 2,
      occurredAt: now,
      type: "evidence-retrieval",
      terminal: false,
      batchId: requestBody.batchId,
      questionId: questionIds[0],
      status: "started",
      examinedItemCount: 0,
    };
    const failed = {
      version: 1,
      operationId: "fixture-reflection-operation",
      sequence: 3,
      occurredAt: now,
      type: "failed",
      terminal: true,
      batchId: requestBody.batchId,
      questionId: questionIds[0],
      reason: "provider-outage",
      safeDetail: "fixture-provider-unavailable",
    };
    if (reflectionFixtureMode === "configuration-race") {
      failed.reason = "model-configuration";
      failed.safeDetail = "fixture-model-changed";
    }
    activeReflectionBatch = { batchId, questionIds };
    reflectionState = ReflectionGetResultSchema.parse({
      ...reflectionState,
      questions: reflectionState.questions.map((question) =>
        questionIds.includes(question.questionId)
          ? {
              ...question,
              attempt: { state: "refreshing", batchId: requestBody.batchId, startedAt: now },
            }
          : question,
      ),
    });
    const event = (name: string, value: unknown) =>
      `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`;
    const encoder = new TextEncoder();
    let cancelled = false;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(event("accepted", accepted)));
          setTimeout(() => {
            if (!cancelled)
              controller.enqueue(encoder.encode(event("question-started", questionStarted)));
          }, 20);
          setTimeout(() => {
            if (!cancelled)
              controller.enqueue(encoder.encode(event("evidence-retrieval", evidenceStarted)));
          }, 50);
          setTimeout(() => {
            if (cancelled) return;
            if (activeReflectionBatch?.batchId === requestBody.batchId) {
              controller.enqueue(encoder.encode(event("failed", failed)));
              activeReflectionBatch = null;
              reflectionState = ReflectionGetResultSchema.parse({
                ...reflectionState,
                questions: reflectionState.questions.map((question) =>
                  question.questionId === failed.questionId
                    ? {
                        ...question,
                        attempt: {
                          state: "unavailable",
                          reason: "provider-outage",
                          safeDetail: "fixture-provider-unavailable",
                          occurredAt: now,
                        },
                      }
                    : question,
                ),
              });
            }
            controller.close();
          }, 250);
        },
        cancel() {
          cancelled = true;
          if (activeReflectionBatch?.batchId === batchId) {
            reflectionState = ReflectionGetResultSchema.parse({
              ...reflectionState,
              questions: reflectionState.questions.map((question) =>
                activeReflectionBatch?.questionIds.includes(question.questionId) &&
                question.attempt.state === "refreshing"
                  ? { ...question, attempt: { state: "cancelled", occurredAt: observedAt } }
                  : question,
              ),
            });
            activeReflectionBatch = null;
          }
        },
      }),
      {
        headers: { "Content-Type": "text/event-stream" },
      },
    );
  }

  if (path === "/api/games" && request.method === "GET") {
    const predicted = url.searchParams.get("includePredicted") === "true";
    const niches = url.searchParams.get("includeNiches") === "true";
    if (predicted && !collectionState.predictionsAvailable)
      return json({ error: "Predictions unavailable" }, 503);
    if (niches && !collectionState.nichesAvailable)
      return json({ error: "Niches unavailable" }, 503);
    return json(collectionEntries(collectionState, axis, { predicted, niches }));
  }
  const noteMatch = path.match(/^\/api\/games\/([^/]+)\/note$/);
  if (noteMatch !== null) {
    const requestedGameId = decodeURIComponent(noteMatch[1] ?? "");
    if (collectionState.deletedIds.has(requestedGameId)) {
      return json({ error: `Game not found: ${requestedGameId}` }, 404);
    }
    if (request.method === "GET") {
      return json({ gameId: requestedGameId, note: ownerNote(ownerNoteState, requestedGameId) });
    }
    if (request.method === "PUT") return mutateOwnerNote(request, requestedGameId, "set");
    if (request.method === "DELETE") return mutateOwnerNote(request, requestedGameId, "clear");
  }
  const detailMatch = path.match(/^\/api\/games\/([^/]+)$/);
  if (detailMatch !== null && request.method === "GET") {
    const requestedGameId = decodeURIComponent(detailMatch[1] ?? "");
    if (
      collectionState.deletedIds.has(requestedGameId) ||
      (scenario === "collection" && !collectionDefinitions.some(({ id }) => id === requestedGameId))
    ) {
      return json({ error: `Game not found: ${requestedGameId}` }, 404);
    }
    if (scenario === "manual-values") await waitForManualValuesRelease("detail");
    return json(detail(requestedGameId));
  }

  const ownershipMatch = path.match(/^\/api\/games\/([^/]+)\/ownership$/);
  if (ownershipMatch !== null && request.method === "PATCH") {
    const requestedGameId = decodeURIComponent(ownershipMatch[1] ?? "");
    const requestBody = await body(request);
    const ownership = requestBody.ownership;
    if (ownership !== "owned" && ownership !== "previously-owned") {
      return json({ error: "Invalid ownership" }, 400);
    }
    if (ownership === "previously-owned") {
      collectionState.previouslyOwnedIds.add(requestedGameId);
    } else {
      collectionState.previouslyOwnedIds.delete(requestedGameId);
    }
    if (requestedGameId === gameId) game = { ...game, ownership, updatedAt: externalObservedAt };
    const definition = collectionDefinitions.find(({ id }) => id === requestedGameId);
    const changedGame =
      definition === undefined ? game : collectionGame(definition, collectionState, axis);
    return json({ game: changedGame, linkedIntentionTransition: null });
  }

  if (detailMatch !== null && request.method === "DELETE") {
    const requestedGameId = decodeURIComponent(detailMatch[1] ?? "");
    const blockers = ownerNoteState.deletionBlockers.get(requestedGameId);
    if (blockers !== undefined) {
      return json(
        { code: "history-conflict", gameId: requestedGameId, intentionIds: blockers },
        409,
      );
    }
    collectionState.deletedIds.add(requestedGameId);
    ownerNoteState.notes.delete(requestedGameId);
    for (const [commandId, receipt] of ownerNoteState.receipts) {
      if (receipt.gameId === requestedGameId) ownerNoteState.receipts.delete(commandId);
    }
    persistOwnerNoteState(ownerNoteState, ownerNotePersistencePath);
    return new Response(null, { status: 204 });
  }

  if (path === `/api/games/${gameId}/manual-values` && request.method === "PUT") {
    const requestBody = await body(request);
    manualValuesState.mutationBodies.push(requestBody);
    manualValuesState.activeMutations += 1;
    manualValuesState.maxActiveMutations = Math.max(
      manualValuesState.maxActiveMutations,
      manualValuesState.activeMutations,
    );
    try {
      await waitForManualValuesRelease("mutation");
      if (manualValuesState.failNextMutation) {
        manualValuesState.failNextMutation = false;
        return json({ error: "Injected manual value failure" }, 503);
      }
      if (Object.hasOwn(requestBody, "playingTime")) {
        const value = requestBody.playingTime;
        game.manualValues.playingTime =
          typeof value === "number" ? { value, source: "manual", confirmedAt: observedAt } : null;
      }
      if (Object.hasOwn(requestBody, "playerCount")) {
        const value = requestBody.playerCount;
        game.manualValues.playerCount =
          typeof value === "number" ? { value, source: "manual", confirmedAt: observedAt } : null;
      }
      return json(game);
    } finally {
      manualValuesState.activeMutations -= 1;
    }
  }
  if (path === "/api/axes" && request.method === "GET") {
    return json(collectionState.axesAvailable ? [axis] : []);
  }
  if (path === "/api/shelf/config" && request.method === "GET") {
    return json({ units: [], createdAt, updatedAt: createdAt });
  }
  if (path === "/api/niches/settings" && request.method === "GET") {
    return json({ ignoredTags: [] });
  }
  if (path === "/api/redundancy/settings" && request.method === "GET") {
    return json({
      enabled: collectionState.integratedRedundancy,
      stage: collectionState.integratedRedundancy ? "integrated" : "annotation",
      similarityThreshold: 0.8,
      maxPenalty: 2,
      componentWeights: { binary: 1, continuous: 1, personalAxes: 1 },
      minNeighbors: 1,
      expectedNeighbors: 2,
    });
  }
  if (path === "/api/shelf/capacity" && request.method === "GET") {
    return json({
      configured: true,
      totalShelfCount: 1,
      gamesWithDimensions: 2,
      gamesWithoutDimensions: 4,
      overflowing: false,
      hasPlacementProblems: false,
      assignments: [],
      assignmentConflicts: [],
      unfittableGames: [],
      overflowGames: [],
    });
  }
  if (path === "/api/tournament/stats" && request.method === "GET") {
    if (!collectionState.tournamentAvailable) return json({ error: "Tournament unavailable" }, 503);
    return json(
      collectionDefinitions.map((definition) => ({
        gameId: definition.id,
        gameName: definition.name,
        stats: tournamentStats(definition),
      })),
    );
  }
  const tournamentMatch = path.match(/^\/api\/tournament\/games\/([^/]+)\/stats$/);
  if (tournamentMatch !== null && request.method === "GET") {
    const definition = collectionDefinitions.find(({ id }) => id === tournamentMatch[1]);
    if (!collectionState.tournamentAvailable || definition === undefined) {
      return json({ error: "No tournament stats" }, 404);
    }
    return json(tournamentStats(definition));
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
    active.kind = "want-to-play";
    if (game.playCountEvidence.status !== "valid" || game.playCountEvidence.observedAt === null) {
      active.baseline = null;
    }
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

function errorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

async function removeStaleSocket(): Promise<void> {
  try {
    if (!lstatSync(socketPath).isSocket()) {
      throw new Error(`Refusing to replace non-socket path: ${socketPath}`);
    }
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }

  const socket = createConnection(socketPath);
  const probe = await new Promise<"active" | "stale">((resolve, reject) => {
    socket.once("connect", () => resolve("active"));
    socket.once("error", (error: unknown) => {
      const code = errorCode(error);
      if (code === "ECONNREFUSED" || code === "ENOENT") {
        resolve("stale");
        return;
      }
      reject(
        error instanceof Error ? error : new Error(`Unable to probe Unix socket: ${socketPath}`),
      );
    });
  });
  socket.destroy();

  if (probe === "active") {
    throw new Error(`Refusing to replace active Unix socket: ${socketPath}`);
  }
  rmSync(socketPath);
}

// The generated Playwright socket path is unique to its invocation. If a prior
// fixture died after creating it, clear only a socket that no longer accepts a
// connection; never unlink a live daemon's socket.
await removeStaleSocket();
const socketServer = Bun.serve({ unix: socketPath, fetch: handle, idleTimeout: 0 as never });
const healthServer = Bun.serve({
  hostname: "127.0.0.1",
  port: healthPort,
  fetch: () => new Response("ok"),
});

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  rmSync(ownerNotePersistencePath, { force: true });
  await socketServer.stop();
  await healthServer.stop();
  rmSync(socketPath, { force: true });
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

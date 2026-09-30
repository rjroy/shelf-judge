import { randomUUID } from "node:crypto";
import {
  semanticDisclosureManifestDigest,
  type Collection,
  type SemanticDisclosureManifest,
  type SemanticSignalScope,
  type SemanticSourceIdentity,
} from "@shelf-judge/shared";
import type { GameWithScore } from "@shelf-judge/shared";
import { ownedPredictedCandidates } from "./displayed-fitness-service.js";
import { profileSourceCoordinatorFor, canonicalSha256 } from "./profile-source-coordinator.js";
import {
  semanticDescriptionSourceFingerprint,
  semanticOwnerNoteSourceFingerprint,
  collectionRedundancyEvidenceIdentity,
  type SemanticDisclosureCapture,
  type SemanticRedundancyStateService,
  type SemanticStateMutationResult,
} from "./semantic-redundancy-state-service.js";
import {
  semanticGenerationSourceIdentity,
  type SemanticGenerationSourceIdentity,
  type SourceVector,
} from "./source-vector.js";
import type { GameService } from "./game-service.js";
import type { PredictionService } from "./prediction-service.js";
import type { StorageService } from "./storage-service.js";
import type {
  SemanticPairSource,
  SemanticRefreshPairAuthority,
  SemanticGenerationAuthority,
  SemanticRefreshGenerationAuthority,
  SemanticRefreshManifestAuthority,
  SemanticSourceIdentityAuthority,
} from "./semantic-refresh-contracts.js";

export interface SemanticRefreshCaptureOptions {
  providerId: string;
  modelId: string;
  rubricVersion: number;
  scoringVersion: number;
  maxSourceTextChars: number;
}

export interface SemanticRefreshCaptureRequest {
  signalScope: SemanticSignalScope;
  budget: SemanticDisclosureManifest["budget"];
  /** Freshly-created expiry for this disclosure, never captured at service construction. */
  expiresAt: string;
  id?: string;
}

export const SEMANTIC_CAPTURE_POLICY = {
  defaultBudget: {
    maxRequests: 19_900,
    maxTokens: 250_000_000,
    maxDurationMs: 24 * 60 * 60 * 1_000,
  },
  limits: {
    maxRequests: 19_900,
    maxTokens: 1_000_000_000,
    maxDurationMs: 7 * 24 * 60 * 60 * 1_000,
    maxSourceTextChars: 100_000,
    maxExpiryMs: 30 * 24 * 60 * 60 * 1_000,
    maxManifestIdChars: 128,
  },
} as const;

export class SemanticRefreshCaptureError extends Error {
  constructor(
    readonly reason:
      | "source-unavailable"
      | "source-changed"
      | "scoring-unavailable"
      | "too-many-eligible-games"
      | "request-budget-exceeded"
      | "source-text-too-large"
      | "invalid-capture",
    message: string,
  ) {
    super(message);
    this.name = "SemanticRefreshCaptureError";
  }
}

export interface SemanticRefreshCaptureService
  extends
    SemanticRefreshPairAuthority,
    SemanticRefreshGenerationAuthority,
    SemanticRefreshManifestAuthority,
    SemanticSourceIdentityAuthority {
  captureAndDisclose(
    request: SemanticRefreshCaptureRequest,
  ): Promise<SemanticStateMutationResult<{ id: string; digest: string }>>;
}

interface SourceCapture {
  collection: Collection;
  tournament: Awaited<ReturnType<StorageService["loadTournament"]>>;
  predictionSettings: Awaited<ReturnType<StorageService["loadPredictionSettings"]>>;
  redundancySettings: Awaited<ReturnType<StorageService["loadRedundancySettings"]>>;
  vector: SourceVector;
  generationIdentity: SemanticGenerationSourceIdentity;
  verificationIdentity: string;
  sourceIdentity: SemanticSourceIdentity;
}

function requiredGenerationIdentity(vector: SourceVector): SemanticGenerationSourceIdentity {
  const identity = semanticGenerationSourceIdentity(vector);
  if (identity === null)
    throw new SemanticRefreshCaptureError(
      "source-unavailable",
      "Durable semantic source identity is unavailable",
    );
  return identity;
}

function toManifestSourceIdentity(
  capture: Omit<SourceCapture, "verificationIdentity" | "sourceIdentity">,
): SemanticSourceIdentity {
  return {
    collectionId: capture.generationIdentity.collectionId,
    collectionSchemaVersion: 9,
    // Schema placeholder: collection write revisions are deliberately not semantic freshness identity.
    collectionRevision: 0,
    evidenceEpoch: capture.generationIdentity.evidenceEpoch,
    consentEpoch: capture.generationIdentity.consentEpoch,
    factualWeightsEpoch: capture.generationIdentity.factualWeightsEpoch,
    factualWeightsFingerprint: capture.generationIdentity.fencedFactualWeightsFingerprint,
    tournamentHash: canonicalSha256({
      revision: capture.generationIdentity.tournamentRevision,
      data: capture.tournament,
    }),
    predictionSettingsHash: canonicalSha256({
      revision: capture.generationIdentity.predictionSettingsRevision,
      settings: capture.predictionSettings,
    }),
    redundancySettingsHash: canonicalSha256({
      currentFactualWeightsFingerprint: capture.generationIdentity.currentFactualWeightsFingerprint,
      settings: capture.redundancySettings,
    }),
  };
}

function sourceVerificationIdentity(input: {
  generationIdentity: SemanticGenerationSourceIdentity;
  collection: Collection;
  tournament: SourceCapture["tournament"];
  predictionSettings: SourceCapture["predictionSettings"];
  redundancySettings: SourceCapture["redundancySettings"];
}): string {
  return canonicalSha256({
    generationIdentity: input.generationIdentity,
    collectionEvidence: collectionRedundancyEvidenceIdentity(input.collection),
    collectionSemanticSettings: input.collection.semanticRedundancy.settings,
    tournament: input.tournament,
    predictionSettings: input.predictionSettings,
    redundancySettings: input.redundancySettings,
  });
}

function isEligible(entry: GameWithScore): boolean {
  return (
    entry.game.ownership !== "previously-owned" &&
    entry.score !== null &&
    !entry.score.vetoed &&
    entry.score.score > 0
  );
}

function presentOwnerNote(game: Collection["games"][number]) {
  const note = game.ownerNote;
  return note.state === "present" && note.version > 0 ? note : null;
}

function expectedPairs(games: Collection["games"]): SemanticDisclosureManifest["pairs"] {
  const pairs: SemanticDisclosureManifest["pairs"] = [];
  for (let left = 0; left < games.length; left += 1) {
    for (let right = left + 1; right < games.length; right += 1) {
      const gameA = games[left];
      const gameB = games[right];
      const noteA = presentOwnerNote(gameA)?.version ?? null;
      const noteB = presentOwnerNote(gameB)?.version ?? null;
      pairs.push({
        gameA: gameA.id,
        gameB: gameB.id,
        hasDescriptionA: semanticDescriptionSourceFingerprint(gameA) !== null,
        hasDescriptionB: semanticDescriptionSourceFingerprint(gameB) !== null,
        hasOwnerNoteA: noteA !== null,
        hasOwnerNoteB: noteB !== null,
        descriptionFingerprintA: semanticDescriptionSourceFingerprint(gameA),
        descriptionFingerprintB: semanticDescriptionSourceFingerprint(gameB),
        noteVersionA: noteA,
        noteVersionB: noteB,
      });
    }
  }
  return pairs;
}

function canonicalPair(pair: SemanticDisclosureManifest["pairs"][number]): string {
  return pair.gameA < pair.gameB
    ? canonicalSha256(pair)
    : canonicalSha256({
        gameA: pair.gameB,
        gameB: pair.gameA,
        hasDescriptionA: pair.hasDescriptionB,
        hasDescriptionB: pair.hasDescriptionA,
        hasOwnerNoteA: pair.hasOwnerNoteB,
        hasOwnerNoteB: pair.hasOwnerNoteA,
        descriptionFingerprintA: pair.descriptionFingerprintB,
        descriptionFingerprintB: pair.descriptionFingerprintA,
        noteVersionA: pair.noteVersionB,
        noteVersionB: pair.noteVersionA,
      });
}

function verifyManifestDigest(manifest: SemanticDisclosureManifest): boolean {
  const { id, digest, ...unsigned } = manifest;
  void id;
  return semanticDisclosureManifestDigest(unsigned) === digest;
}

function addEstimatedChars(current: number, addition: number): number {
  if (
    !Number.isSafeInteger(addition) ||
    addition < 0 ||
    current > Number.MAX_SAFE_INTEGER - addition
  )
    throw new SemanticRefreshCaptureError(
      "request-budget-exceeded",
      "Semantic source token estimate exceeds safe numeric bounds",
    );
  return current + addition;
}

export function createSemanticRefreshCaptureService(deps: {
  storageService: StorageService;
  gameService: GameService;
  predictionService: PredictionService;
  stateService: SemanticRedundancyStateService;
  options: SemanticRefreshCaptureOptions;
  now?: () => number;
}): SemanticRefreshCaptureService {
  const { storageService, gameService, predictionService, stateService, options } = deps;
  const coordinator = profileSourceCoordinatorFor(storageService);
  const now = deps.now ?? Date.now;

  async function captureSources(): Promise<SourceCapture> {
    const before = storageService.sourceVector?.();
    if (before === undefined || !before.available)
      throw new SemanticRefreshCaptureError(
        "source-unavailable",
        "Semantic sources are unavailable",
      );
    const [collection, tournament, predictionSettings, redundancySettings] = await Promise.all([
      storageService.loadCollection(),
      storageService.loadTournament(),
      storageService.loadPredictionSettings(),
      storageService.loadRedundancySettings(),
    ]);
    const after = storageService.sourceVector?.();
    if (after === undefined || !after.available)
      throw new SemanticRefreshCaptureError(
        "source-unavailable",
        "Semantic sources are unavailable",
      );
    const generationIdentity = requiredGenerationIdentity(after);
    const beforeGeneration = requiredGenerationIdentity(before);
    if (canonicalSha256(beforeGeneration) !== canonicalSha256(generationIdentity))
      throw new SemanticRefreshCaptureError(
        "source-changed",
        "Semantic sources changed during capture",
      );
    if (
      collection.id !== generationIdentity.collectionId ||
      collection.schemaVersion !== generationIdentity.collectionSchemaVersion ||
      collection.semanticRedundancy.evidenceEpoch !== generationIdentity.evidenceEpoch ||
      collection.semanticRedundancy.consentEpoch !== generationIdentity.consentEpoch ||
      collection.semanticRedundancy.factualWeightsEpoch !== generationIdentity.factualWeightsEpoch
    )
      throw new SemanticRefreshCaptureError(
        "source-changed",
        "Collection identity does not match source vector",
      );
    const partial = {
      collection,
      tournament,
      predictionSettings,
      redundancySettings,
      vector: after,
      generationIdentity,
    };
    const verificationIdentity = sourceVerificationIdentity(partial);
    const sourceIdentity = toManifestSourceIdentity(partial);
    return { ...partial, verificationIdentity, sourceIdentity };
  }

  function validateOptions(request: SemanticRefreshCaptureRequest): void {
    if (
      !["description-only", "owner-notes-only", "description-and-owner-notes"].includes(
        request.signalScope,
      ) ||
      !Number.isSafeInteger(options.rubricVersion) ||
      options.rubricVersion < 1 ||
      !Number.isSafeInteger(options.scoringVersion) ||
      options.scoringVersion < 1 ||
      !Number.isSafeInteger(options.maxSourceTextChars) ||
      options.maxSourceTextChars < 1 ||
      options.maxSourceTextChars > SEMANTIC_CAPTURE_POLICY.limits.maxSourceTextChars ||
      typeof request.expiresAt !== "string" ||
      request.expiresAt.length > 32 ||
      !Number.isFinite(Date.parse(request.expiresAt)) ||
      new Date(Date.parse(request.expiresAt)).toISOString() !== request.expiresAt ||
      Date.parse(request.expiresAt) <= now() ||
      Date.parse(request.expiresAt) - now() > SEMANTIC_CAPTURE_POLICY.limits.maxExpiryMs ||
      !Number.isSafeInteger(request.budget.maxRequests) ||
      request.budget.maxRequests < 0 ||
      request.budget.maxRequests > SEMANTIC_CAPTURE_POLICY.limits.maxRequests ||
      !Number.isSafeInteger(request.budget.maxTokens) ||
      request.budget.maxTokens < 0 ||
      request.budget.maxTokens > SEMANTIC_CAPTURE_POLICY.limits.maxTokens ||
      !Number.isSafeInteger(request.budget.maxDurationMs) ||
      request.budget.maxDurationMs < 1 ||
      request.budget.maxDurationMs > SEMANTIC_CAPTURE_POLICY.limits.maxDurationMs ||
      (request.id !== undefined &&
        (request.id.trim().length === 0 ||
          request.id.length > SEMANTIC_CAPTURE_POLICY.limits.maxManifestIdChars)) ||
      options.providerId.trim().length === 0 ||
      options.modelId.trim().length === 0
    )
      throw new SemanticRefreshCaptureError(
        "invalid-capture",
        "Semantic capture options are invalid",
      );
  }

  return {
    async validateSourceIdentity(collection, expected) {
      return coordinator.runExclusive(async () => {
        try {
          const current = await captureSources();
          return (
            canonicalSha256({ ...current.sourceIdentity, collectionRevision: 0 }) ===
              canonicalSha256({ ...expected, collectionRevision: 0 }) &&
            collection.id === current.collection.id &&
            collection.schemaVersion === current.collection.schemaVersion &&
            collection.semanticRedundancy.evidenceEpoch ===
              current.collection.semanticRedundancy.evidenceEpoch &&
            collection.semanticRedundancy.consentEpoch ===
              current.collection.semanticRedundancy.consentEpoch &&
            collection.semanticRedundancy.factualWeightsEpoch ===
              current.collection.semanticRedundancy.factualWeightsEpoch &&
            collection.semanticRedundancy.factualWeightsFingerprint ===
              current.collection.semanticRedundancy.factualWeightsFingerprint &&
            canonicalSha256(collection.semanticRedundancy.settings) ===
              canonicalSha256(current.collection.semanticRedundancy.settings) &&
            collectionRedundancyEvidenceIdentity(collection) ===
              collectionRedundancyEvidenceIdentity(current.collection)
          );
        } catch (error) {
          if (error instanceof SemanticRefreshCaptureError) return false;
          throw error;
        }
      });
    },

    async captureAndDisclose(request) {
      validateOptions(request);
      const captured = await coordinator.runExclusive(captureSources);

      const descriptionEnabled =
        captured.collection.semanticRedundancy.settings.enabled &&
        captured.collection.semanticRedundancy.settings.weights.description > 0;
      const ownerNotesEnabled =
        captured.collection.semanticRedundancy.settings.enabled &&
        captured.collection.semanticRedundancy.settings.weights.ownerNote > 0 &&
        captured.collection.semanticRedundancy.settings.cachedOwnerNoteUse;
      const descriptionRequested = request.signalScope !== "owner-notes-only";
      const notesRequested = request.signalScope !== "description-only";
      if ((descriptionRequested && !descriptionEnabled) || (notesRequested && !ownerNotesEnabled))
        throw new SemanticRefreshCaptureError(
          "invalid-capture",
          "Requested semantic signal scope does not match enabled positive-weight settings",
        );

      if (
        !gameService.listRawGamesFromSnapshot ||
        !predictionService.preparePredictionListFromSnapshot
      )
        throw new SemanticRefreshCaptureError(
          "scoring-unavailable",
          "Snapshot scoring or prediction preparation is unavailable",
        );
      const ordinary = gameService.listRawGamesFromSnapshot(
        captured.collection,
        captured.tournament,
      );
      const ordinaryScores = new Map(ordinary.map((entry) => [entry.game.id, entry.score]));
      const prepared = await predictionService.preparePredictionListFromSnapshot(
        captured.collection,
        captured.tournament,
        captured.predictionSettings,
      );
      const predicted = prepared.listGames(ordinaryScores);
      const eligible = ownedPredictedCandidates(predicted).filter(isEligible);
      if (eligible.length > 200)
        throw new SemanticRefreshCaptureError(
          "too-many-eligible-games",
          "Semantic capture exceeds the 200-game bound",
        );
      const canonicalEligible = [...eligible].sort((a, b) =>
        a.game.id < b.game.id ? -1 : a.game.id > b.game.id ? 1 : 0,
      );
      const durableGamesById = new Map(captured.collection.games.map((game) => [game.id, game]));
      const eligibleWithDurableSource = canonicalEligible.map((entry) => {
        const durableGame = durableGamesById.get(entry.game.id);
        if (durableGame === undefined || durableGame.id !== entry.game.id)
          throw new SemanticRefreshCaptureError(
            "invalid-capture",
            `Scored game ${entry.game.id} is missing from the captured durable collection`,
          );
        if (durableGame.ownership !== entry.game.ownership)
          throw new SemanticRefreshCaptureError(
            "invalid-capture",
            `Scored game ${entry.game.id} ownership does not match its durable source`,
          );
        return { entry, game: durableGame };
      });
      const eligibleGameIds = eligibleWithDurableSource.map(({ game }) => game.id);
      if (new Set(eligibleGameIds).size !== eligibleGameIds.length)
        throw new SemanticRefreshCaptureError(
          "invalid-capture",
          "Prediction universe contains duplicate game IDs",
        );
      const pairs = expectedPairs(eligibleWithDurableSource.map(({ game }) => game));
      if (pairs.length > 19_900)
        throw new SemanticRefreshCaptureError(
          "too-many-eligible-games",
          "Semantic capture exceeds the 19,900-pair bound",
        );

      const requestPairs = pairs.filter(
        (pair) =>
          (descriptionRequested && pair.hasDescriptionA && pair.hasDescriptionB) ||
          (notesRequested && pair.hasOwnerNoteA && pair.hasOwnerNoteB),
      );
      let estimatedInputChars = 0;
      for (const pair of requestPairs) {
        const gameA = durableGamesById.get(pair.gameA)!;
        const gameB = durableGamesById.get(pair.gameB)!;
        if (descriptionRequested && pair.hasDescriptionA && pair.hasDescriptionB) {
          estimatedInputChars = addEstimatedChars(
            estimatedInputChars,
            gameA.bggData?.description?.length ?? 0,
          );
          estimatedInputChars = addEstimatedChars(
            estimatedInputChars,
            gameB.bggData?.description?.length ?? 0,
          );
        }
        if (notesRequested && pair.hasOwnerNoteA && pair.hasOwnerNoteB) {
          estimatedInputChars = addEstimatedChars(
            estimatedInputChars,
            presentOwnerNote(gameA)?.text.length ?? 0,
          );
          estimatedInputChars = addEstimatedChars(
            estimatedInputChars,
            presentOwnerNote(gameB)?.text.length ?? 0,
          );
        }
      }
      const estimatedInputTokens = Math.ceil(estimatedInputChars / 4);
      if (
        requestPairs.length > 19_900 ||
        requestPairs.length > request.budget.maxRequests ||
        estimatedInputTokens > request.budget.maxTokens
      )
        throw new SemanticRefreshCaptureError(
          "request-budget-exceeded",
          "Semantic capture exceeds its disclosed request or token budget",
        );

      for (const { game } of eligibleWithDurableSource) {
        const description = game.bggData?.description;
        const note = presentOwnerNote(game)?.text ?? null;
        if (
          (descriptionRequested &&
            description &&
            description.length > options.maxSourceTextChars) ||
          (notesRequested && note && note.length > options.maxSourceTextChars)
        )
          throw new SemanticRefreshCaptureError(
            "source-text-too-large",
            "A semantic source text exceeds the configured per-source limit",
          );
      }

      const unsigned = {
        sourceIdentity: captured.sourceIdentity,
        scoringVersion: options.scoringVersion,
        signalScope: request.signalScope,
        providerId: options.providerId,
        modelId: options.modelId,
        rubricVersion: options.rubricVersion,
        budget: request.budget,
        expiresAt: request.expiresAt,
        eligibleGameIds,
        pairs,
      };
      const manifest: SemanticDisclosureManifest = {
        id: request.id ?? randomUUID(),
        digest: semanticDisclosureManifestDigest(unsigned),
        ...unsigned,
      };
      const stateCapture: SemanticDisclosureCapture = {
        manifest,
        sourceIdentity: captured.sourceIdentity,
      };

      return coordinator.runExclusive(async () => {
        const current = await captureSources();
        if (current.verificationIdentity !== captured.verificationIdentity)
          throw new SemanticRefreshCaptureError(
            "source-changed",
            "Semantic sources changed before disclosure persistence",
          );
        return stateService.createDisclosure(stateCapture, async (collection, expected) => {
          const authoritative = await captureSources();
          return (
            authoritative.verificationIdentity === captured.verificationIdentity &&
            canonicalSha256({ ...authoritative.sourceIdentity, collectionRevision: 0 }) ===
              canonicalSha256({ ...expected, collectionRevision: 0 }) &&
            collection.id === authoritative.collection.id &&
            collection.schemaVersion === authoritative.collection.schemaVersion &&
            collection.semanticRedundancy.evidenceEpoch ===
              authoritative.collection.semanticRedundancy.evidenceEpoch &&
            collection.semanticRedundancy.consentEpoch ===
              authoritative.collection.semanticRedundancy.consentEpoch &&
            collection.semanticRedundancy.factualWeightsEpoch ===
              authoritative.collection.semanticRedundancy.factualWeightsEpoch &&
            collection.semanticRedundancy.factualWeightsFingerprint ===
              authoritative.collection.semanticRedundancy.factualWeightsFingerprint &&
            canonicalSha256(collection.semanticRedundancy.settings) ===
              canonicalSha256(authoritative.collection.semanticRedundancy.settings) &&
            collectionRedundancyEvidenceIdentity(collection) ===
              collectionRedundancyEvidenceIdentity(authoritative.collection)
          );
        });
      });
    },

    async withCurrentGeneration<Value>(input: {
      executionId: string;
      manifest: SemanticDisclosureManifest;
      operation: (authority: SemanticGenerationAuthority) => Promise<Value>;
    }): Promise<Value> {
      return this.withCurrentManifest(input);
    },

    async withCurrentManifest<Value>(input: {
      manifest: SemanticDisclosureManifest;
      operation: (authority: SemanticGenerationAuthority) => Promise<Value>;
    }): Promise<Value> {
      return coordinator.runExclusive(async () => {
        const captured = await captureSources();
        const manifest = input.manifest;
        if (
          options.scoringVersion !== manifest.scoringVersion ||
          !verifyManifestDigest(manifest) ||
          canonicalSha256({ ...captured.sourceIdentity, collectionRevision: 0 }) !==
            canonicalSha256({ ...manifest.sourceIdentity, collectionRevision: 0 })
        )
          throw new SemanticRefreshCaptureError(
            "source-changed",
            "Current semantic identity or disclosure manifest is invalid",
          );
        if (
          !gameService.listRawGamesFromSnapshot ||
          !predictionService.preparePredictionListFromSnapshot
        )
          throw new SemanticRefreshCaptureError(
            "scoring-unavailable",
            "Snapshot scoring or prediction preparation is unavailable",
          );
        // Ordinary scores are the factual context for prediction preparation. Keep the full
        // collection/scoring snapshot here; only the resulting owned candidates are eligible.
        const ordinary = gameService.listRawGamesFromSnapshot(
          captured.collection,
          captured.tournament,
        );
        const ordinaryScores = new Map(ordinary.map((entry) => [entry.game.id, entry.score]));
        const prepared = await predictionService.preparePredictionListFromSnapshot(
          captured.collection,
          captured.tournament,
          captured.predictionSettings,
        );
        const eligible = ownedPredictedCandidates(prepared.listGames(ordinaryScores)).filter(
          isEligible,
        );
        const durableGamesById = new Map(captured.collection.games.map((game) => [game.id, game]));
        const eligibleGames = eligible
          .map(({ game: scoredGame }) => {
            const durableGame = durableGamesById.get(scoredGame.id);
            if (!durableGame || durableGame.ownership !== scoredGame.ownership)
              throw new SemanticRefreshCaptureError(
                "source-changed",
                `Eligible game ${scoredGame.id} no longer matches its durable source`,
              );
            return durableGame;
          })
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const eligibleGameIds = eligibleGames.map(({ id }) => id);
        if (
          new Set(eligibleGameIds).size !== eligibleGameIds.length ||
          eligibleGameIds.length > 200 ||
          canonicalSha256(eligibleGameIds) !== canonicalSha256(manifest.eligibleGameIds)
        )
          throw new SemanticRefreshCaptureError(
            "source-changed",
            "Disclosed eligible prediction universe is no longer current",
          );
        const expected = expectedPairs(eligibleGames);
        const suppliedPairs = manifest.pairs;
        if (
          expected.length !== suppliedPairs.length ||
          new Set(suppliedPairs.map(canonicalPair)).size !== expected.length ||
          expected.some(
            (pair, index) =>
              suppliedPairs[index] === undefined ||
              canonicalPair(pair) !== canonicalPair(suppliedPairs[index]),
          )
        )
          throw new SemanticRefreshCaptureError(
            "source-changed",
            "Disclosure pair coverage or source flags are not exact",
          );
        return input.operation({ sourceIdentity: captured.sourceIdentity, eligibleGameIds });
      });
    },

    async withCurrentPair<Value>(input: {
      executionId: string;
      manifest: SemanticDisclosureManifest;
      pair: SemanticDisclosureManifest["pairs"][number];
      operation: (source: SemanticPairSource) => Promise<Value>;
    }): Promise<Value> {
      return coordinator.runExclusive(async () => {
        const captured = await captureSources();
        const currentIdentity = { ...captured.sourceIdentity, collectionRevision: 0 };
        const frozenIdentity = { ...input.manifest.sourceIdentity, collectionRevision: 0 };
        if (
          canonicalSha256(currentIdentity) !== canonicalSha256(frozenIdentity) ||
          !input.manifest.pairs.some(
            ({ gameA, gameB }) => gameA === input.pair.gameA && gameB === input.pair.gameB,
          )
        )
          throw new SemanticRefreshCaptureError(
            "source-changed",
            "Current semantic identity does not match the disclosed execution",
          );
        if (
          !gameService.listRawGamesFromSnapshot ||
          !predictionService.preparePredictionListFromSnapshot
        )
          throw new SemanticRefreshCaptureError(
            "scoring-unavailable",
            "Snapshot scoring or prediction preparation is unavailable",
          );
        const ordinary = gameService.listRawGamesFromSnapshot(
          captured.collection,
          captured.tournament,
        );
        const ordinaryScores = new Map(ordinary.map((entry) => [entry.game.id, entry.score]));
        const prepared = await predictionService.preparePredictionListFromSnapshot(
          captured.collection,
          captured.tournament,
          captured.predictionSettings,
        );
        const eligible = ownedPredictedCandidates(prepared.listGames(ordinaryScores)).filter(
          isEligible,
        );
        const eligibleIds = new Set(eligible.map(({ game }) => game.id));
        const currentEligibleGameIds = [...eligibleIds].sort();
        if (
          canonicalSha256(currentEligibleGameIds) !==
            canonicalSha256(input.manifest.eligibleGameIds) ||
          !eligibleIds.has(input.pair.gameA) ||
          !eligibleIds.has(input.pair.gameB)
        )
          throw new SemanticRefreshCaptureError(
            "source-changed",
            "Disclosed pair is no longer in the eligible prediction universe",
          );
        const durableById = new Map(captured.collection.games.map((game) => [game.id, game]));
        const gameA = durableById.get(input.pair.gameA);
        const gameB = durableById.get(input.pair.gameB);
        if (!gameA || !gameB)
          throw new SemanticRefreshCaptureError(
            "source-changed",
            "Disclosed pair no longer has durable collection sources",
          );
        const descriptionA = semanticDescriptionSourceFingerprint(gameA);
        const descriptionB = semanticDescriptionSourceFingerprint(gameB);
        const ownerNoteA = semanticOwnerNoteSourceFingerprint(gameA);
        const ownerNoteB = semanticOwnerNoteSourceFingerprint(gameB);
        const ownerNoteSourceA = presentOwnerNote(gameA);
        const ownerNoteSourceB = presentOwnerNote(gameB);
        const noteVersionA = ownerNoteSourceA?.version ?? null;
        const noteVersionB = ownerNoteSourceB?.version ?? null;
        if (
          descriptionA !== input.pair.descriptionFingerprintA ||
          descriptionB !== input.pair.descriptionFingerprintB ||
          noteVersionA !== input.pair.noteVersionA ||
          noteVersionB !== input.pair.noteVersionB
        )
          throw new SemanticRefreshCaptureError(
            "source-changed",
            "Disclosed pair source provenance changed",
          );
        const source: SemanticPairSource = {
          sourceIdentity: captured.sourceIdentity,
          descriptionA:
            descriptionA === null
              ? null
              : { name: gameA.name, text: gameA.bggData!.description!, fingerprint: descriptionA },
          descriptionB:
            descriptionB === null
              ? null
              : { name: gameB.name, text: gameB.bggData!.description!, fingerprint: descriptionB },
          ownerNoteA:
            ownerNoteA === null || ownerNoteSourceA === null
              ? null
              : {
                  name: gameA.name,
                  text: ownerNoteSourceA.text,
                  fingerprint: ownerNoteA,
                  version: ownerNoteSourceA.version,
                },
          ownerNoteB:
            ownerNoteB === null || ownerNoteSourceB === null
              ? null
              : {
                  name: gameB.name,
                  text: ownerNoteSourceB.text,
                  fingerprint: ownerNoteB,
                  version: ownerNoteSourceB.version,
                },
        };
        return input.operation(source);
      });
    },
  };
}

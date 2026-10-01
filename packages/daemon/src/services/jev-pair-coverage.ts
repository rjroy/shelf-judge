import type {
  Collection,
  DurableGame,
  GameWithScore,
  RedundancyComponentWeights,
} from "@shelf-judge/shared";
import { JEV_JUDGMENT_CONTRACT } from "./jev/jev-judgment-contract.js";
import { createRedundancyFactualContext } from "./redundancy-factual.js";
import { canonicalSha256 } from "./profile-source-coordinator.js";
import type { JevPairJudgment, JevPairKey } from "./jev-pair-cache-service.js";
import { validateJevCachedRow, type JevRowValidationGame } from "./jev-pair-read-proof.js";

export const JEV_ACTIVATION_DIGEST_VERSION = "jev-activation-coverage-v4" as const;

/** Durable identities for the exact capture; volatile process-local tokens do not belong here. */
export interface JevPredictionCaptureIdentity {
  readonly sourceVectorIdentity: string;
  readonly tournamentIdentity: string;
  readonly predictionCaptureIdentity: string;
}

export interface JevCoverageCacheReader {
  lookup(key: JevPairKey): JevPairJudgment | null;
}

export interface JevCoverageOptions {
  collection: Collection;
  /** Complete unfiltered output of listGamesWithPredictions(), including null/vetoed predictions. */
  predictionCapture: readonly GameWithScore[];
  captureIdentity: JevPredictionCaptureIdentity;
  /** Factual display weights; semantic description/note weights come only from collection settings. */
  factualWeights: RedundancyComponentWeights;
  cache: JevCoverageCacheReader;
}

export type JevPairSignalCoverage =
  | { state: "unavailable"; reason: "disabled" | "zero-weight" | "missing-source" }
  | { state: "blocked"; reason: "note-use-not-permitted" }
  | { state: "covered"; rowIdentity: string; score: number }
  | { state: "missing-row" }
  | { state: "invalid-row" };

export interface JevPairCoverageEntry {
  gameAId: string;
  gameBId: string;
  factualScore: number;
  C: JevPairSignalCoverage;
  D: JevPairSignalCoverage;
}

export interface JevPairCoverageDigest {
  version: typeof JEV_ACTIVATION_DIGEST_VERSION;
  complete: boolean;
  identity: string;
  eligibleGameIds: readonly string[];
  pairs: readonly JevPairCoverageEntry[];
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isArray(value: unknown): boolean {
  return Array.isArray(value);
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function validJevFactualWeights(weights: RedundancyComponentWeights): boolean {
  return (
    Number.isFinite(weights.binary) &&
    weights.binary >= 0 &&
    Number.isFinite(weights.continuous) &&
    weights.continuous >= 0
  );
}

/** Validates a full capture and returns the minimal owned score projection used by identity. */
export function projectJevOwnedPredictionCapture(
  collection: Collection,
  predictionCapture: readonly GameWithScore[],
):
  | {
      ok: true;
      ownedGameIds: string[];
      predictionScores: {
        gameId: string;
        score: number | null;
        vetoed: boolean | null;
        actualAxisCount: number | null;
      }[];
    }
  | { ok: false; reason: string } {
  if (!collection?.id || !Array.isArray(collection.games) || !Array.isArray(predictionCapture))
    return { ok: false, reason: "invalid collection or prediction capture" };
  const captures = predictionCapture as readonly GameWithScore[];
  const collectionById = new Map<string, DurableGame>();
  for (const game of collection.games) {
    if (!isText(game.id) || collectionById.has(game.id))
      return { ok: false, reason: "invalid or duplicate collection game ID" };
    collectionById.set(game.id, game);
  }
  const ownedGames = collection.games
    .filter((game) => game.ownership === "owned")
    .sort((a, b) => compareIds(a.id, b.id));
  const captureById = new Map<string, GameWithScore>();
  for (const result of captures) {
    if (!result || !result.game || !isText(result.game.id))
      return { ok: false, reason: "prediction capture contains an empty entry" };
    const source = collectionById.get(result.game.id);
    if (!source || captureById.has(source.id) || result.game.ownership !== source.ownership)
      return {
        ok: false,
        reason: "prediction capture contains unknown, duplicate, or ownership-mismatched game",
      };
    if (result.score !== null) {
      const { ratedAxisCount, predictionMeta } = result.score;
      const actualAxisCount =
        predictionMeta === null ? ratedAxisCount : predictionMeta.actualAxisCount;
      if (
        !Number.isFinite(result.score.score) ||
        typeof result.score.vetoed !== "boolean" ||
        !Number.isSafeInteger(ratedAxisCount) ||
        ratedAxisCount < 0 ||
        !Number.isSafeInteger(actualAxisCount) ||
        actualAxisCount < 0 ||
        (predictionMeta !== null && predictionMeta.actualAxisCount !== ratedAxisCount)
      )
        return { ok: false, reason: "prediction capture contains non-finite or invalid score" };
    }
    captureById.set(source.id, result);
  }
  if (ownedGames.some((game) => !captureById.has(game.id)))
    return { ok: false, reason: "prediction capture is incomplete for owned collection games" };
  return {
    ok: true,
    ownedGameIds: ownedGames.map((game) => game.id),
    predictionScores: ownedGames.map(({ id }) => {
      const score = captureById.get(id)!.score;
      return {
        gameId: id,
        score: score?.score ?? null,
        vetoed: score?.vetoed ?? null,
        actualAxisCount:
          score === null ? null : (score.predictionMeta?.actualAxisCount ?? score.ratedAxisCount),
      };
    }),
  };
}

function proofGame(game: DurableGame): JevRowValidationGame {
  return {
    id: game.id,
    name: game.name,
    bggData: game.bggData ? { description: game.bggData.description } : null,
    ownerNote: game.ownerNote,
  };
}

/**
 * Computes cache coverage from a COMPLETE prediction capture. The scorer's
 * listGamesWithPredictions() returns every collection game when called without target IDs; this
 * kernel requires that capture to contain every currently-owned collection ID, including null,
 * vetoed, and nonpositive results. A target/page subset is rejected before any lookup. Game
 * source fields always come from collection.games, never the public prediction payload.
 */
export function computeJevPairCoverage(options: JevCoverageOptions): JevPairCoverageDigest {
  const { collection, predictionCapture, captureIdentity, factualWeights, cache } = options;
  if (
    !collection?.id ||
    !Array.isArray(collection.games) ||
    !isArray(predictionCapture) ||
    !captureIdentity ||
    !isText(captureIdentity.sourceVectorIdentity) ||
    !isText(captureIdentity.tournamentIdentity) ||
    !isText(captureIdentity.predictionCaptureIdentity) ||
    !validJevFactualWeights(factualWeights)
  ) {
    throw new TypeError("Invalid Jev coverage input or prediction capture identity");
  }
  const state = collection.semanticRedundancy;
  const settings = state?.settings;
  if (
    !state ||
    !settings ||
    typeof settings.enabled !== "boolean" ||
    !settings.weights ||
    ![settings.weights.factual, settings.weights.description, settings.weights.ownerNote].every(
      (weight) => Number.isFinite(weight) && weight >= 0,
    ) ||
    !Number.isSafeInteger(state.evidenceEpoch) ||
    state.evidenceEpoch < 0 ||
    !Number.isSafeInteger(state.consentEpoch) ||
    state.consentEpoch < 0 ||
    !Number.isSafeInteger(state.factualWeightsEpoch) ||
    state.factualWeightsEpoch < 0
  ) {
    throw new TypeError("Invalid Jev collection semantic authority or policy");
  }

  const projected = projectJevOwnedPredictionCapture(collection, predictionCapture);
  if (!projected.ok) throw new TypeError(projected.reason);
  const ownedGames = collection.games
    .filter((game) => game.ownership === "owned")
    .sort((a, b) => compareIds(a.id, b.id));
  const ownedIds = ownedGames.map((game) => game.id);

  // The production scorer returns collection rows in its full (targetGameIds omitted) call.
  // Require exact owned-ID coverage; non-owned extras are allowed only if they match collection.
  const captureById = new Map(predictionCapture.map((result) => [result.game.id, result]));

  const scoredOwned = ownedGames.map((game) => ({ game, score: captureById.get(game.id)!.score }));
  const eligible = scoredOwned.filter(
    ({ score }) =>
      score !== null && Number.isFinite(score.score) && !score.vetoed && score.score > 0,
  );
  const eligibleIds = eligible.map(({ game }) => game.id);

  // Factual vectors use the complete collection's BGG universe, including noneligible games.
  const factual = createRedundancyFactualContext(collection.games, factualWeights);
  const noteAllowed = settings.cachedOwnerNoteUse === true;
  let complete = true;
  const pairs: JevPairCoverageEntry[] = [];
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i].game;
      const b = eligible[j].game;
      const aProof = proofGame(a);
      const bProof = proofGame(b);
      const hasDescriptions = [a, b].every(
        (game) =>
          typeof game.bggData?.description === "string" &&
          game.bggData.description.trim().length > 0,
      );
      const hasNotes = [a.ownerNote, b.ownerNote].every(
        (note) =>
          note.state === "present" &&
          Number.isSafeInteger(note.version) &&
          note.version > 0 &&
          note.text.trim().length > 0,
      );
      const inspect = (
        signal: "C" | "D",
        weight: number,
        sourceAvailable: boolean,
      ): JevPairSignalCoverage => {
        if (!settings.enabled) return { state: "unavailable", reason: "disabled" };
        if (weight <= 0) return { state: "unavailable", reason: "zero-weight" };
        if (signal === "D" && !noteAllowed) {
          // Positive D weight is still required; permission cannot silently remove/renormalize it.
          complete = false;
          return { state: "blocked", reason: "note-use-not-permitted" };
        }
        if (!sourceAvailable) return { state: "unavailable", reason: "missing-source" };
        const checked = validateJevCachedRow(
          cache.lookup({ gameAId: a.id, gameBId: b.id, signal }),
          collection,
          aProof,
          bProof,
          signal,
        );
        if (!checked.valid) {
          complete = false;
          return { state: checked.reason === "missing-row" ? "missing-row" : "invalid-row" };
        }
        return { state: "covered", rowIdentity: checked.identity, score: checked.value };
      };
      pairs.push({
        gameAId: a.id,
        gameBId: b.id,
        factualScore: factual.similarity(a, b),
        C: inspect("C", settings.weights.description, hasDescriptions),
        D: inspect("D", settings.weights.ownerNote, hasNotes),
      });
    }
  }

  const identity = computeJevActivationIdentity({
    collectionId: collection.id,
    evidenceEpoch: state.evidenceEpoch,
    consentEpoch: state.consentEpoch,
    factualWeightsEpoch: state.factualWeightsEpoch,
    factualWeightsFingerprint: state.factualWeightsFingerprint,
    settings,
    factualWeights,
    ownedGameIds: ownedIds,
    predictionScores: projected.predictionScores,
    eligibleGameIds: eligibleIds,
    captureIdentity,
    contract: JEV_JUDGMENT_CONTRACT,
    pairs,
  });
  return {
    version: JEV_ACTIVATION_DIGEST_VERSION,
    complete,
    identity,
    eligibleGameIds: eligibleIds,
    pairs,
  };
}

/** Shared deterministic identity primitive for future activation writers and readers. */
export function computeJevActivationIdentity(input: {
  collectionId: string;
  evidenceEpoch: number;
  consentEpoch: number;
  factualWeightsEpoch: number;
  factualWeightsFingerprint: string | null;
  settings: Collection["semanticRedundancy"]["settings"];
  factualWeights: RedundancyComponentWeights;
  ownedGameIds: readonly string[];
  predictionScores: readonly {
    gameId: string;
    score: number | null;
    vetoed: boolean | null;
    actualAxisCount?: number | null;
  }[];
  eligibleGameIds: readonly string[];
  captureIdentity: JevPredictionCaptureIdentity;
  contract: typeof JEV_JUDGMENT_CONTRACT;
  pairs: readonly JevPairCoverageEntry[];
}): string {
  return canonicalSha256({
    version: JEV_ACTIVATION_DIGEST_VERSION,
    collectionId: input.collectionId,
    authority: {
      evidenceEpoch: input.evidenceEpoch,
      consentEpoch: input.consentEpoch,
      factualWeightsEpoch: input.factualWeightsEpoch,
      factualWeightsFingerprint: input.factualWeightsFingerprint,
    },
    semanticSettings: input.settings,
    factualWeights: input.factualWeights,
    ownedGameIds: [...input.ownedGameIds].sort(compareIds),
    predictionScores: [...input.predictionScores].sort((a, b) => compareIds(a.gameId, b.gameId)),
    eligibleGameIds: [...input.eligibleGameIds].sort(compareIds),
    captureIdentity: input.captureIdentity,
    contract: input.contract,
    pairs: input.pairs,
  });
}

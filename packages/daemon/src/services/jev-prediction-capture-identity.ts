import type {
  Collection,
  GameWithScore,
  PredictionSettings,
  RedundancyComponentWeights,
  TournamentData,
} from "@shelf-judge/shared";
import type { JevPredictionCaptureIdentity } from "./jev-pair-coverage.js";
import { canonicalSha256 } from "./profile-source-coordinator.js";
import { projectJevOwnedPredictionCapture, validJevFactualWeights } from "./jev-pair-coverage.js";
import { semanticGenerationSourceIdentity, type SourceVector } from "./source-vector.js";

export interface JevPredictionCaptureIdentityInput {
  collection: Collection;
  sourceVector: SourceVector;
  tournament: TournamentData;
  predictionSettings: PredictionSettings;
  factualWeights: RedundancyComponentWeights;
  predictionCapture: readonly GameWithScore[];
}

export type JevPredictionCaptureIdentityResult =
  | { ok: true; identity: JevPredictionCaptureIdentity }
  | { ok: false; reason: string };

/** Builds a durable identity for the semantic prediction capture, excluding live process tokens and presentation. */
export function buildJevPredictionCaptureIdentity(
  input: JevPredictionCaptureIdentityInput,
): JevPredictionCaptureIdentityResult {
  const {
    collection,
    sourceVector: vector,
    tournament,
    predictionSettings,
    factualWeights,
    predictionCapture,
  } = input;
  if (
    !collection ||
    !vector ||
    !tournament ||
    !predictionSettings ||
    !validJevFactualWeights(factualWeights)
  )
    return { ok: false, reason: "invalid identity input" };
  const durableVector = semanticGenerationSourceIdentity(vector);
  if (!durableVector) return { ok: false, reason: "source vector unavailable or incomplete" };
  const state = collection.semanticRedundancy;
  if (
    !state ||
    !Number.isSafeInteger(state.evidenceEpoch) ||
    !Number.isSafeInteger(state.consentEpoch) ||
    !Number.isSafeInteger(state.factualWeightsEpoch)
  )
    return { ok: false, reason: "collection semantic authority is invalid" };
  if (
    durableVector.collectionId !== collection.id ||
    durableVector.collectionSchemaVersion !== collection.schemaVersion ||
    vector.collectionRevision !== collection.revision ||
    durableVector.evidenceEpoch !== state.evidenceEpoch ||
    durableVector.consentEpoch !== state.consentEpoch ||
    durableVector.factualWeightsEpoch !== state.factualWeightsEpoch ||
    durableVector.fencedFactualWeightsFingerprint !== state.factualWeightsFingerprint
  )
    return { ok: false, reason: "source vector does not match collection semantic authority" };
  const factualFingerprint = canonicalSha256(factualWeights);
  if (durableVector.currentFactualWeightsFingerprint !== factualFingerprint)
    return {
      ok: false,
      reason: "source vector factual weights do not match current factual weights",
    };
  const projection = projectJevOwnedPredictionCapture(collection, predictionCapture);
  if (!projection.ok) return projection;
  const sourceVectorIdentity = {
    collectionId: durableVector.collectionId,
    collectionSchemaVersion: durableVector.collectionSchemaVersion,
    evidenceEpoch: durableVector.evidenceEpoch,
    consentEpoch: durableVector.consentEpoch,
    predictionSettingsRevision: durableVector.predictionSettingsRevision,
    factualWeightsEpoch: durableVector.factualWeightsEpoch,
    fencedFactualWeightsFingerprint: durableVector.fencedFactualWeightsFingerprint,
    currentFactualWeightsFingerprint: durableVector.currentFactualWeightsFingerprint,
  };
  return {
    ok: true,
    identity: {
      sourceVectorIdentity: canonicalSha256({
        domain: "jev-source-vector-identity-v1",
        sourceVector: sourceVectorIdentity,
        predictionSettingsRevision: vector.predictionSettingsRevision,
        predictionSettingsFingerprint: canonicalSha256(predictionSettings),
        factualWeightsFingerprint: factualFingerprint,
      }),
      tournamentIdentity: canonicalSha256({
        domain: "jev-tournament-identity-v1",
        revision: vector.tournamentRevision,
        dataFingerprint: canonicalSha256(tournament),
      }),
      predictionCaptureIdentity: canonicalSha256({
        domain: "jev-owned-prediction-capture-v1",
        ownedGames: projection.predictionScores.map((score) => {
          return {
            gameId: score.gameId,
            score: score.score,
            vetoed: score.vetoed,
            actualAxisCount: score.actualAxisCount,
          };
        }),
      }),
    },
  };
}

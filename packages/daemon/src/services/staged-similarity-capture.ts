import type {
  Collection,
  PredictionSettings,
  TournamentData,
  WishlistBggSourceSnapshot,
} from "@shelf-judge/shared";
import type { SimilaritySettings } from "./unified-similarity.js";
import type { SourceVector } from "./source-vector.js";
import { canonicalSha256 } from "./profile-source-coordinator.js";

export interface StagedWishlistCandidateSource {
  readonly bggId: number;
  readonly name: string;
  readonly bggSource: WishlistBggSourceSnapshot;
}

/** A private, coherent set of raw inputs. It deliberately contains no predicted results. */
export interface StagedSimilaritySources {
  readonly collection: Collection;
  readonly tournament: TournamentData;
  readonly predictionSettings: PredictionSettings;
  readonly similaritySettings: SimilaritySettings;
  readonly sourceVector: SourceVector;
  /** Wishlist BGG source snapshots selected by the caller; no derived fitness is included. */
  readonly wishlistCandidates?: readonly StagedWishlistCandidateSource[];
}

export interface StagedSimilaritySourceReader {
  /** Must reread current authoritative storage/source state, not return a captured boolean. */
  readCurrent(): StagedSimilaritySources | null;
}

export interface StagedSimilarityCapture {
  readonly sources: StagedSimilaritySources;
  /** Durable content identity; excludes process epoch, change token, and cache revision. */
  readonly durableIdentity: string;
  /** Current source/provenance authority check. Cache currentness is fenced separately. */
  isSourceCurrent(): boolean;
}

export interface ProposedStagedSimilarityCapture extends StagedSimilarityCapture {
  readonly kind: "proposed-collection";
  readonly baselineIdentity: string;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const immutableDurableIdentityCache = new WeakMap<object, string>();

function validSimilaritySettings(settings: SimilaritySettings): boolean {
  const weights = [
    settings?.factual?.binary,
    settings?.factual?.continuous,
    settings?.semantic?.factual,
    settings?.semantic?.description,
    settings?.semantic?.ownerNote,
  ];
  return (
    typeof settings?.semantic?.enabled === "boolean" &&
    weights.every((weight) => Number.isFinite(weight) && weight >= 0) &&
    settings.factual.binary + settings.factual.continuous > 0
  );
}

function sourceVectorIsCoherent(sources: StagedSimilaritySources): boolean {
  const { collection, sourceVector: vector } = sources;
  const semantic = collection.semanticRedundancy;
  const semanticSettings = semantic?.settings;
  const expectedFactualWeightsFingerprint = canonicalSha256(sources.similaritySettings.factual);
  if (
    !semanticSettings ||
    typeof semanticSettings.enabled !== "boolean" ||
    typeof semanticSettings.cachedOwnerNoteUse !== "boolean" ||
    ![
      semanticSettings.weights?.factual,
      semanticSettings.weights?.description,
      semanticSettings.weights?.ownerNote,
    ].every((weight) => Number.isFinite(weight) && weight >= 0)
  ) {
    return false;
  }
  const expectedDescriptionWeight = semanticSettings.enabled
    ? semanticSettings.weights.description
    : 0;
  const expectedOwnerNoteWeight =
    semanticSettings.enabled && semanticSettings.cachedOwnerNoteUse
      ? semanticSettings.weights.ownerNote
      : 0;
  return (
    vector.available === true &&
    typeof vector.processEpoch === "string" &&
    vector.processEpoch.length > 0 &&
    Number.isSafeInteger(vector.changeToken) &&
    vector.changeToken >= 0 &&
    vector.collectionId === collection.id &&
    vector.collectionSchemaVersion === collection.schemaVersion &&
    vector.collectionRevision === collection.revision &&
    Number.isSafeInteger(vector.tournamentRevision) &&
    Number.isSafeInteger(vector.predictionSettingsRevision) &&
    vector.redundancyWeightsFingerprint === expectedFactualWeightsFingerprint &&
    sources.similaritySettings.semantic.enabled === semanticSettings.enabled &&
    sources.similaritySettings.semantic.factual === semanticSettings.weights.factual &&
    sources.similaritySettings.semantic.description === expectedDescriptionWeight &&
    sources.similaritySettings.semantic.ownerNote === expectedOwnerNoteWeight &&
    vector.semanticEvidenceEpoch === semantic.evidenceEpoch &&
    vector.semanticConsentEpoch === semantic.consentEpoch &&
    vector.factualWeightsEpoch === semantic.factualWeightsEpoch &&
    Number.isSafeInteger(semantic.evidenceEpoch) &&
    Number.isSafeInteger(semantic.consentEpoch) &&
    Number.isSafeInteger(semantic.factualWeightsEpoch)
  );
}

function durableSourcesIdentity(sources: StagedSimilaritySources): string {
  if (Object.isFrozen(sources)) {
    const cached = immutableDurableIdentityCache.get(sources);
    if (cached) return cached;
  }
  const collection = sources.collection;
  const semantic = collection.semanticRedundancy;
  const identityValue = {
    domain: "staged-unified-similarity-source-v2",
    algorithmVersion: "unified-jaccard-manhattan-jev-v1",
    factualContext: {
      collectionId: collection.id,
      schemaVersion: collection.schemaVersion,
      revision: collection.revision,
      // Full collection factual universe, including previously-owned and noncandidate games.
      games: collection.games.map((game) => ({
        id: game.id,
        name: game.name,
        bggId: game.bggId,
        ownership: game.ownership,
        minPlayers: game.minPlayers,
        maxPlayers: game.maxPlayers,
        bestPlayers: game.bestPlayers,
        playingTime: game.playingTime,
        bggData: game.bggData,
        actualRatings: game.ratings,
        ownerNote: {
          state: game.ownerNote.state,
          version: game.ownerNote.version,
          textDigest:
            game.ownerNote.state === "present" ? canonicalSha256(game.ownerNote.text) : null,
        },
      })),
      actualAxes: collection.axes,
    },
    tournament: sources.tournament,
    predictionSettings: sources.predictionSettings,
    similaritySettings: sources.similaritySettings,
    permissions: semantic
      ? {
          settings: semantic.settings,
          evidenceEpoch: semantic.evidenceEpoch,
          consentEpoch: semantic.consentEpoch,
          ownerNoteConsentEpoch: semantic.ownerNoteConsentEpoch ?? null,
          factualWeightsEpoch: semantic.factualWeightsEpoch,
          factualWeightsFingerprint: semantic.factualWeightsFingerprint,
        }
      : null,
    durableSourceRevisions: {
      collectionId: sources.sourceVector.collectionId,
      collectionSchemaVersion: sources.sourceVector.collectionSchemaVersion,
      collectionRevision: sources.sourceVector.collectionRevision,
      semanticEvidenceEpoch: sources.sourceVector.semanticEvidenceEpoch ?? null,
      semanticConsentEpoch: sources.sourceVector.semanticConsentEpoch ?? null,
      factualWeightsEpoch: sources.sourceVector.factualWeightsEpoch ?? null,
      tournamentRevision: sources.sourceVector.tournamentRevision,
      predictionSettingsRevision: sources.sourceVector.predictionSettingsRevision,
    },
    wishlistCandidates: [...(sources.wishlistCandidates ?? [])]
      .sort((left, right) => left.bggId - right.bggId)
      .map((candidate) => ({
        bggId: candidate.bggId,
        name: candidate.name,
        bggSource: candidate.bggSource,
      })),
  };
  // Collection-axis optionals can be represented as explicit `undefined` by an
  // in-memory mutation candidate even though the durable schema omits them.
  const identity = canonicalSha256(JSON.parse(JSON.stringify(identityValue)) as unknown);
  if (Object.isFrozen(sources)) immutableDurableIdentityCache.set(sources, identity);
  return identity;
}

function sameLiveFence(left: SourceVector, right: SourceVector): boolean {
  return (
    left.processEpoch === right.processEpoch &&
    left.changeToken === right.changeToken &&
    left.available === right.available
  );
}

/**
 * Captures immutable source facts and their content identity. The `reader` is an authority
 * seam that must read current persisted sources; it is not a caller-supplied permission boolean.
 */
export function captureStagedSimilaritySources(
  input: StagedSimilaritySources,
  reader: StagedSimilaritySourceReader,
): StagedSimilarityCapture {
  if (
    !input.collection?.id ||
    !Array.isArray(input.collection.games) ||
    !Array.isArray(input.collection.axes) ||
    !input.tournament ||
    !input.predictionSettings ||
    !validSimilaritySettings(input.similaritySettings) ||
    !sourceVectorIsCoherent(input)
  ) {
    throw new TypeError("Staged similarity sources are unavailable or incoherent");
  }
  const sources = deepFreeze(structuredClone(input));
  const durableIdentity = durableSourcesIdentity(sources);
  let authoritative: StagedSimilaritySources | null;
  try {
    authoritative = reader.readCurrent();
  } catch {
    authoritative = null;
  }
  if (
    !authoritative ||
    !sourceVectorIsCoherent(authoritative) ||
    durableSourcesIdentity(authoritative) !== durableIdentity ||
    !sameLiveFence(sources.sourceVector, authoritative.sourceVector)
  ) {
    throw new TypeError(
      "Staged similarity source capture is not current with authoritative storage",
    );
  }
  const capture: StagedSimilarityCapture = {
    sources,
    durableIdentity,
    isSourceCurrent(): boolean {
      try {
        const current = reader.readCurrent();
        if (!current || !sourceVectorIsCoherent(current)) return false;
        return (
          durableSourcesIdentity(current) === durableIdentity &&
          sameLiveFence(sources.sourceVector, current.sourceVector)
        );
      } catch {
        return false;
      }
    },
  };
  return Object.freeze(capture);
}

/**
 * Captures a private uncommitted collection proposal while retaining the persisted source as
 * its authority fence. This capability is not a current-source publication or run token.
 */
export function captureProposedStagedSimilaritySources(
  proposedInput: StagedSimilaritySources,
  baselineInput: StagedSimilaritySources,
  reader: StagedSimilaritySourceReader,
): ProposedStagedSimilarityCapture {
  if (
    !proposedInput.collection?.id ||
    !Array.isArray(proposedInput.collection.games) ||
    !Array.isArray(proposedInput.collection.axes) ||
    !validSimilaritySettings(proposedInput.similaritySettings) ||
    !sourceVectorIsCoherent(proposedInput) ||
    !sourceVectorIsCoherent(baselineInput) ||
    proposedInput.collection.id !== baselineInput.collection.id ||
    proposedInput.collection.schemaVersion !== baselineInput.collection.schemaVersion ||
    proposedInput.collection.revision !== baselineInput.collection.revision ||
    proposedInput.sourceVector.processEpoch !== baselineInput.sourceVector.processEpoch ||
    proposedInput.sourceVector.changeToken !== baselineInput.sourceVector.changeToken ||
    proposedInput.sourceVector.available !== baselineInput.sourceVector.available ||
    proposedInput.sourceVector.tournamentRevision !==
      baselineInput.sourceVector.tournamentRevision ||
    proposedInput.sourceVector.predictionSettingsRevision !==
      baselineInput.sourceVector.predictionSettingsRevision ||
    proposedInput.sourceVector.redundancyWeightsFingerprint !==
      baselineInput.sourceVector.redundancyWeightsFingerprint
  ) {
    throw new TypeError("Proposed similarity sources do not match the captured baseline fence");
  }
  const sources = deepFreeze(structuredClone(proposedInput));
  const baseline = deepFreeze(structuredClone(baselineInput));
  const baselineIdentity = durableSourcesIdentity(baseline);
  const durableIdentity = durableSourcesIdentity(sources);
  const currentBaseline = (): StagedSimilaritySources | null => {
    try {
      const current = reader.readCurrent();
      if (
        !current ||
        !sourceVectorIsCoherent(current) ||
        durableSourcesIdentity(current) !== baselineIdentity ||
        !sameLiveFence(baseline.sourceVector, current.sourceVector)
      )
        return null;
      return current;
    } catch {
      return null;
    }
  };
  if (!currentBaseline())
    throw new TypeError("Proposed similarity baseline is not current with authoritative storage");
  return Object.freeze({
    kind: "proposed-collection" as const,
    sources,
    durableIdentity,
    baselineIdentity,
    isSourceCurrent: () => currentBaseline() !== null,
  });
}

import type {
  Collection,
  GameWithScore,
  PredictionSettings,
  RedundancyComponentWeights,
  RedundancySettings,
  TournamentData,
} from "@shelf-judge/shared";
import type { JevRunCapture, JevRunCurrentState } from "./jev-run-service.js";
import { buildJevPredictionCaptureIdentity } from "./jev-prediction-capture-identity.js";
import { validJevFactualWeights } from "./jev-pair-coverage.js";
import { canonicalSha256, profileSourceCoordinatorFor } from "./profile-source-coordinator.js";
import { JEV_JUDGMENT_CONTRACT } from "./jev/jev-judgment-contract.js";
import type { SourceVector } from "./source-vector.js";

export interface JevRunSourceStorage {
  loadCollection(): Promise<Collection>;
  loadTournament(): Promise<TournamentData>;
  loadPredictionSettings(): Promise<PredictionSettings>;
  loadRedundancySettings(): Promise<RedundancySettings>;
  sourceVector?(): SourceVector;
}

export interface JevRunSnapshotPredictionService {
  /** Target IDs are deliberately not supplied: this must capture every collection game. */
  listGamesWithPredictionsFromSnapshot(
    collection: Collection,
    tournament: TournamentData,
    settings: PredictionSettings,
    targetGameIds?: readonly string[],
  ): Promise<GameWithScore[]>;
}

export interface JevRunSourceAdapterOptions {
  storageService: JevRunSourceStorage;
  predictionService: JevRunSnapshotPredictionService;
  maxCaptureRetries?: number;
}

export interface JevRunSourceAdapter {
  loadCapture(): Promise<JevRunCapture>;
  readCurrent(): Promise<JevRunCurrentState>;
}

interface CapturedSources {
  collection: Collection;
  tournament: TournamentData;
  predictionSettings: PredictionSettings;
  redundancySettings: RedundancySettings;
  factualWeights: RedundancyComponentWeights;
  sourceVector: SourceVector;
  sourceVectorIdentity: string;
  policyIdentity: string;
}

const DEFAULT_CAPTURE_RETRIES = 2;

export class JevRunSourceUnavailableError extends Error {
  constructor() {
    super("Current Jev run sources are unavailable or incoherent");
    this.name = "JevRunSourceUnavailableError";
  }
}

/** Connects authoritative storage/prediction sources to the inactive Jev run worker. */
export function createJevRunSourceAdapter(
  options: JevRunSourceAdapterOptions,
): JevRunSourceAdapter {
  const { storageService, predictionService } = options;
  const coordinator = profileSourceCoordinatorFor(storageService);
  const maxCaptureRetries = options.maxCaptureRetries ?? DEFAULT_CAPTURE_RETRIES;

  async function readSources(): Promise<CapturedSources> {
    const vectorBefore = storageService.sourceVector?.();
    if (!isUsableVector(vectorBefore)) throw new JevRunSourceUnavailableError();
    const [collection, tournament, predictionSettings, redundancySettings] = await Promise.all([
      storageService.loadCollection(),
      storageService.loadTournament(),
      storageService.loadPredictionSettings(),
      storageService.loadRedundancySettings(),
    ]);
    const vectorAfter = storageService.sourceVector?.();
    if (
      !isUsableVector(vectorAfter) ||
      sourceVectorIdentity(vectorBefore) !== sourceVectorIdentity(vectorAfter) ||
      vectorAfter.collectionId !== collection.id ||
      vectorAfter.collectionSchemaVersion !== collection.schemaVersion ||
      vectorAfter.collectionRevision !== collection.revision
    )
      throw new JevRunSourceUnavailableError();
    const factualWeights = redundancySettings.componentWeights;
    return {
      collection,
      tournament,
      predictionSettings,
      redundancySettings,
      factualWeights,
      sourceVector: vectorAfter,
      sourceVectorIdentity: sourceVectorIdentity(vectorAfter),
      policyIdentity: policyIdentity(collection, predictionSettings, factualWeights, vectorAfter),
    };
  }

  async function loadCapture(): Promise<JevRunCapture> {
    for (let attempt = 0; attempt <= maxCaptureRetries; attempt++) {
      let sources: CapturedSources;
      try {
        sources = await coordinator.runExclusive(readSources);
      } catch {
        if (attempt === maxCaptureRetries) throw new JevRunSourceUnavailableError();
        continue;
      }

      let predictionCapture: GameWithScore[];
      try {
        // Provider-free scoring is intentionally outside the collection coordinator.
        predictionCapture = await predictionService.listGamesWithPredictionsFromSnapshot(
          sources.collection,
          sources.tournament,
          sources.predictionSettings,
        );
      } catch {
        throw new JevRunSourceUnavailableError();
      }
      const durableIdentity = buildJevPredictionCaptureIdentity({
        collection: sources.collection,
        sourceVector: sources.sourceVector,
        tournament: sources.tournament,
        predictionSettings: sources.predictionSettings,
        factualWeights: sources.factualWeights,
        predictionCapture,
      });
      if (!durableIdentity.ok) throw new JevRunSourceUnavailableError();

      let current: CapturedSources;
      try {
        current = await coordinator.runExclusive(readSources);
      } catch {
        if (attempt === maxCaptureRetries) throw new JevRunSourceUnavailableError();
        continue;
      }
      if (
        current.sourceVectorIdentity !== sources.sourceVectorIdentity ||
        current.policyIdentity !== sources.policyIdentity
      ) {
        if (attempt === maxCaptureRetries) throw new JevRunSourceUnavailableError();
        continue;
      }
      return {
        collection: sources.collection,
        predictionCapture,
        captureIdentity: durableIdentity.identity,
        factualWeights: sources.factualWeights,
        sourceVectorIdentity: sources.sourceVectorIdentity,
        policyIdentity: sources.policyIdentity,
      };
    }
    throw new JevRunSourceUnavailableError();
  }

  async function readCurrent(): Promise<JevRunCurrentState> {
    try {
      return await coordinator.runExclusive(async () => {
        const vectorBefore = storageService.sourceVector?.();
        if (!isUsableVector(vectorBefore)) throw new JevRunSourceUnavailableError();
        const [collection, predictionSettings, redundancySettings] = await Promise.all([
          storageService.loadCollection(),
          storageService.loadPredictionSettings(),
          storageService.loadRedundancySettings(),
        ]);
        const vectorAfter = storageService.sourceVector?.();
        if (
          !isUsableVector(vectorAfter) ||
          sourceVectorIdentity(vectorBefore) !== sourceVectorIdentity(vectorAfter) ||
          vectorAfter.collectionId !== collection.id ||
          vectorAfter.collectionSchemaVersion !== collection.schemaVersion ||
          vectorAfter.collectionRevision !== collection.revision
        )
          throw new JevRunSourceUnavailableError();
        const factualWeights = redundancySettings.componentWeights;
        const policy = policyIdentity(collection, predictionSettings, factualWeights, vectorAfter);
        const semantic = collection.semanticRedundancy;
        return {
          collection,
          sourceVectorIdentity: sourceVectorIdentity(vectorAfter),
          policyIdentity: policy,
          canTransmitNotes: semantic.settings.cachedOwnerNoteUse === true,
        };
      });
    } catch {
      throw new JevRunSourceUnavailableError();
    }
  }

  return {
    // The worker invokes this outside the coordinator. Its internal source reads
    // are serialized briefly; prediction computation starts only after that lock exits.
    loadCapture,
    readCurrent,
  };
}

function sourceVectorIdentity(vector: SourceVector): string {
  return canonicalSha256(vector);
}

function isUsableVector(vector: SourceVector | undefined): vector is SourceVector {
  return Boolean(vector?.available && vector.collectionId && vector.collectionRevision !== null);
}

function policyIdentity(
  collection: Collection,
  predictionSettings: PredictionSettings,
  factualWeights: RedundancyComponentWeights,
  vector: SourceVector,
): string {
  const semantic = collection.semanticRedundancy;
  if (
    !semantic?.settings ||
    !validJevFactualWeights(factualWeights) ||
    !validEpoch(semantic.consentEpoch) ||
    !validEpoch(semantic.factualWeightsEpoch) ||
    !validEpoch(vector.predictionSettingsRevision) ||
    !validEpoch(vector.redundancySettingsRevision)
  )
    throw new JevRunSourceUnavailableError();
  return canonicalSha256({
    domain: "jev-run-policy-identity-v1",
    semanticSettings: semantic.settings,
    consentEpoch: semantic.consentEpoch,
    factualWeights,
    factualWeightsEpoch: semantic.factualWeightsEpoch,
    predictionSettings,
    predictionSettingsRevision: vector.predictionSettingsRevision,
    redundancySettingsRevision: vector.redundancySettingsRevision,
    judgmentContract: JEV_JUDGMENT_CONTRACT,
  });
}

function validEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

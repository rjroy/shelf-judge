import { randomUUID } from "node:crypto";

export interface SourceVector {
  available: boolean;
  unavailableSources: string[];
  processEpoch: string;
  changeToken: number;
  collectionId: string | null;
  collectionSchemaVersion: number | null;
  collectionRevision: number | null;
  semanticEvidenceEpoch?: number | null;
  semanticConsentEpoch?: number | null;
  factualWeightsEpoch?: number | null;
  factualWeightsFingerprint?: string | null;
  redundancyWeightsFingerprint?: string | null;
  tournamentRevision: number | null;
  predictionSettingsRevision: number | null;
  nicheSettingsRevision: number | null;
  redundancySettingsRevision: number | null;
  shelfConfigRevision: number | null;
  representationVersion: 1;
  algorithmVersion: 1;
}

export interface SourceVectorService {
  read(): SourceVector;
  publish(source: RevisionedSourceKind, revision: number): void;
  publishRedundancyWeightsFingerprint(fingerprint: string): void;
  publishCollection(identity: CollectionSourceIdentity): void;
  hydrate(identity: CollectionSourceIdentity, revisions: SourceVectorRevisions): void;
  markUnavailable(source: SourceVectorAvailabilitySource): void;
}

export interface CollectionSourceIdentity {
  id: string;
  schemaVersion: number;
  revision: number;
  semanticEvidenceEpoch?: number;
  semanticConsentEpoch?: number;
  factualWeightsEpoch?: number;
  factualWeightsFingerprint?: string | null;
}

export interface SemanticGenerationSourceIdentity {
  collectionId: string;
  collectionSchemaVersion: number;
  evidenceEpoch: number;
  consentEpoch: number;
  tournamentRevision: number;
  predictionSettingsRevision: number;
  factualWeightsEpoch: number;
  fencedFactualWeightsFingerprint: string | null;
  currentFactualWeightsFingerprint: string;
}

/** Durable semantic freshness identity; deliberately excludes write/process tokens. */
export function semanticGenerationSourceIdentity(
  vector: SourceVector,
): SemanticGenerationSourceIdentity | null {
  if (
    !vector.available ||
    vector.collectionId === null ||
    vector.collectionSchemaVersion === null ||
    vector.semanticEvidenceEpoch == null ||
    vector.semanticConsentEpoch == null ||
    vector.tournamentRevision === null ||
    vector.predictionSettingsRevision === null ||
    vector.factualWeightsEpoch == null
  )
    return null;
  const currentFactualWeightsFingerprint = vector.redundancyWeightsFingerprint;
  if (currentFactualWeightsFingerprint == null) return null;
  return {
    collectionId: vector.collectionId,
    collectionSchemaVersion: vector.collectionSchemaVersion,
    evidenceEpoch: vector.semanticEvidenceEpoch,
    consentEpoch: vector.semanticConsentEpoch,
    tournamentRevision: vector.tournamentRevision,
    predictionSettingsRevision: vector.predictionSettingsRevision,
    factualWeightsEpoch: vector.factualWeightsEpoch,
    fencedFactualWeightsFingerprint: vector.factualWeightsFingerprint ?? null,
    currentFactualWeightsFingerprint,
  };
}

export type SourceVectorAvailabilitySource =
  | RevisionedSourceKind
  | "collection"
  | "startup"
  | "startup-hydration";

export type RevisionedSourceKind =
  | "tournament"
  | "prediction-settings"
  | "niche-settings"
  | "redundancy-settings"
  | "shelf-config";

export interface SourceVectorRevisions {
  tournament: number;
  predictionSettings: number;
  nicheSettings: number;
  redundancySettings: number;
  shelfConfig: number;
}

interface InternalSourceVectorState {
  identity: CollectionSourceIdentity | null;
  revisions: Partial<SourceVectorRevisions>;
  redundancyWeightsFingerprint: string | null;
  unavailableSources: SourceVectorAvailabilitySource[];
}

const REVISION_KEY: Record<RevisionedSourceKind, keyof SourceVectorRevisions> = {
  tournament: "tournament",
  "prediction-settings": "predictionSettings",
  "niche-settings": "nicheSettings",
  "redundancy-settings": "redundancySettings",
  "shelf-config": "shelfConfig",
};

export function createSourceVectorService(): SourceVectorService {
  const processEpoch = randomUUID();
  let changeToken = 0;
  let identity: CollectionSourceIdentity | null = null;
  const revisions: Partial<SourceVectorRevisions> = {};
  let redundancyWeightsFingerprint: string | null = null;
  const unavailable = new Set<SourceVectorAvailabilitySource>(["startup"]);

  function mutate(): void {
    if (changeToken < Number.MAX_SAFE_INTEGER) changeToken += 1;
  }

  return {
    read(): SourceVector {
      return readVector();
    },
    publish(source, revision) {
      const before = readInternalState();
      const key = REVISION_KEY[source];
      revisions[key] = revision;
      unavailable.delete(source);
      if (!sameInternalState(before, readInternalState())) mutate();
    },
    publishRedundancyWeightsFingerprint(fingerprint) {
      if (redundancyWeightsFingerprint === fingerprint) return;
      redundancyWeightsFingerprint = fingerprint;
      mutate();
    },
    publishCollection(nextIdentity) {
      const before = readInternalState();
      identity = { ...nextIdentity };
      unavailable.delete("collection");
      if (!sameInternalState(before, readInternalState())) mutate();
    },
    hydrate(collection, nextRevisions) {
      const before = readInternalState();
      identity = { ...collection };
      Object.assign(revisions, nextRevisions);
      unavailable.clear();
      if (!sameInternalState(before, readInternalState())) mutate();
    },
    markUnavailable(source) {
      if (unavailable.has(source)) return;
      unavailable.add(source);
      mutate();
    },
  };

  function readVector(): SourceVector {
    const ready =
      identity !== null &&
      unavailable.size === 0 &&
      revisions.tournament !== undefined &&
      revisions.predictionSettings !== undefined &&
      revisions.nicheSettings !== undefined &&
      revisions.redundancySettings !== undefined &&
      revisions.shelfConfig !== undefined;
    return {
      available: ready,
      unavailableSources: [...unavailable].sort(),
      processEpoch,
      changeToken,
      collectionId: ready ? (identity?.id ?? null) : null,
      collectionSchemaVersion: ready ? (identity?.schemaVersion ?? null) : null,
      collectionRevision: ready ? (identity?.revision ?? null) : null,
      semanticEvidenceEpoch: ready ? (identity?.semanticEvidenceEpoch ?? null) : null,
      semanticConsentEpoch: ready ? (identity?.semanticConsentEpoch ?? null) : null,
      factualWeightsEpoch: ready ? (identity?.factualWeightsEpoch ?? null) : null,
      factualWeightsFingerprint: ready ? (identity?.factualWeightsFingerprint ?? null) : null,
      redundancyWeightsFingerprint: ready ? redundancyWeightsFingerprint : null,
      tournamentRevision: ready ? (revisions.tournament ?? null) : null,
      predictionSettingsRevision: ready ? (revisions.predictionSettings ?? null) : null,
      nicheSettingsRevision: ready ? (revisions.nicheSettings ?? null) : null,
      redundancySettingsRevision: ready ? (revisions.redundancySettings ?? null) : null,
      shelfConfigRevision: ready ? (revisions.shelfConfig ?? null) : null,
      representationVersion: 1,
      algorithmVersion: 1,
    };
  }

  function readInternalState(): InternalSourceVectorState {
    return {
      identity: identity ? { ...identity } : null,
      revisions: { ...revisions },
      redundancyWeightsFingerprint,
      unavailableSources: [...unavailable].sort(),
    };
  }

  function sameInternalState(
    left: InternalSourceVectorState,
    right: InternalSourceVectorState,
  ): boolean {
    return (
      left.identity?.id === right.identity?.id &&
      left.identity?.schemaVersion === right.identity?.schemaVersion &&
      left.identity?.revision === right.identity?.revision &&
      left.identity?.semanticEvidenceEpoch === right.identity?.semanticEvidenceEpoch &&
      left.identity?.semanticConsentEpoch === right.identity?.semanticConsentEpoch &&
      left.identity?.factualWeightsEpoch === right.identity?.factualWeightsEpoch &&
      left.identity?.factualWeightsFingerprint === right.identity?.factualWeightsFingerprint &&
      left.revisions.tournament === right.revisions.tournament &&
      left.revisions.predictionSettings === right.revisions.predictionSettings &&
      left.revisions.nicheSettings === right.revisions.nicheSettings &&
      left.revisions.redundancySettings === right.revisions.redundancySettings &&
      left.revisions.shelfConfig === right.revisions.shelfConfig &&
      left.redundancyWeightsFingerprint === right.redundancyWeightsFingerprint &&
      left.unavailableSources.length === right.unavailableSources.length &&
      left.unavailableSources.every(
        (source, index) => source === right.unavailableSources[index],
      ) &&
      (left.identity === null) === (right.identity === null)
    );
  }
}

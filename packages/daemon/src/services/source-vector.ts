import { randomUUID } from "node:crypto";

export interface SourceVector {
  available: boolean;
  unavailableSources: string[];
  processEpoch: string;
  changeToken: number;
  collectionId: string | null;
  collectionSchemaVersion: number | null;
  collectionRevision: number | null;
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
  publishCollection(identity: { id: string; schemaVersion: number; revision: number }): void;
  hydrate(
    identity: { id: string; schemaVersion: number; revision: number },
    revisions: SourceVectorRevisions,
  ): void;
  markUnavailable(source: SourceVectorAvailabilitySource): void;
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
  identity: { id: string; schemaVersion: number; revision: number } | null;
  revisions: Partial<SourceVectorRevisions>;
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
  let identity: { id: string; schemaVersion: number; revision: number } | null = null;
  const revisions: Partial<SourceVectorRevisions> = {};
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
      left.revisions.tournament === right.revisions.tournament &&
      left.revisions.predictionSettings === right.revisions.predictionSettings &&
      left.revisions.nicheSettings === right.revisions.nicheSettings &&
      left.revisions.redundancySettings === right.revisions.redundancySettings &&
      left.revisions.shelfConfig === right.revisions.shelfConfig &&
      left.unavailableSources.length === right.unavailableSources.length &&
      left.unavailableSources.every(
        (source, index) => source === right.unavailableSources[index],
      ) &&
      (left.identity === null) === (right.identity === null)
    );
  }
}

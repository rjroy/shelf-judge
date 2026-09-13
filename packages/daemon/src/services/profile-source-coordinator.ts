import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  CollectionProfileCollectionSource,
  PredictionSettings,
  ProfileSourceIdentity,
  RedundancySettings,
  TournamentData,
} from "@shelf-judge/shared";

export interface ProfileSources {
  collection: CollectionProfileCollectionSource;
  tournament: TournamentData;
  predictionSettings: PredictionSettings;
  redundancySettings: RedundancySettings;
}

export interface ProfileSourceCoordinator {
  runExclusive<Value>(operation: () => Promise<Value>): Promise<Value>;
}

const coordinators = new WeakMap<object, ProfileSourceCoordinator>();
const activeCoordinator = new AsyncLocalStorage<ProfileSourceCoordinator>();

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Canonical JSON cannot contain non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
      .join(",")}}`;
  }
  throw new Error(`Canonical JSON cannot encode ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function profileSourceIdentity(sources: ProfileSources): ProfileSourceIdentity {
  return {
    collectionId: sources.collection.id,
    collectionSchemaVersion: sources.collection.schemaVersion,
    collectionRevision: sources.collection.revision,
    tournamentHash: canonicalSha256(sources.tournament),
    predictionSettingsHash: canonicalSha256(sources.predictionSettings),
    redundancySettingsHash: canonicalSha256(sources.redundancySettings),
  };
}

export function sameProfileSourceIdentity(
  left: ProfileSourceIdentity,
  right: ProfileSourceIdentity,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function profileSourceCoordinatorFor(storageService: object): ProfileSourceCoordinator {
  const existing = coordinators.get(storageService);
  if (existing) return existing;

  let operations: Promise<void> = Promise.resolve();
  const coordinator: ProfileSourceCoordinator = {
    runExclusive<Value>(operation: () => Promise<Value>): Promise<Value> {
      if (activeCoordinator.getStore() === coordinator) return operation();
      const run = () => activeCoordinator.run(coordinator, operation);
      const result = operations.then(run, run);
      operations = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
  coordinators.set(storageService, coordinator);
  return coordinator;
}

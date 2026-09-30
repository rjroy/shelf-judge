/** Pure storage-only revision decoding and migration for independently stored sources. */
import {
  PredictionSettingsSchema,
  RedundancySettingsSchema,
  ShelfConfigurationSchema,
  TournamentDataSchema,
  type NicheSettings,
  type PredictionSettings,
  type RedundancySettings,
  type ShelfConfiguration,
  type TournamentData,
} from "@shelf-judge/shared";
import { z } from "zod";
import { DEFAULT_PREDICTION_SETTINGS } from "./prediction-engine.js";
import { DEFAULT_NICHE_SETTINGS } from "./niche-engine.js";
import { DEFAULT_REDUNDANCY_SETTINGS } from "./redundancy-engine.js";
import { migrateTournamentData } from "./tournament-migration.js";

export const SourceRevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const NicheSettingsSchema = z.object({
  ignoredTags: z.array(
    z.object({ type: z.enum(["mechanic", "category", "family"]), name: z.string() }).strict(),
  ),
});

export type RevisionedSourceKind =
  | "tournament"
  | "prediction-settings"
  | "niche-settings"
  | "redundancy-settings"
  | "shelf-config";

export type RevisionedSourceData =
  | TournamentData
  | PredictionSettings
  | NicheSettings
  | RedundancySettings
  | ShelfConfiguration;

export interface DecodedStoredSource<T extends RevisionedSourceData = RevisionedSourceData> {
  data: T;
  stored: Record<string, unknown>;
  revision: number;
  migrated: boolean;
  redundancyWeightsMigrated?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSource(kind: RevisionedSourceKind, value: unknown): RevisionedSourceData {
  switch (kind) {
    case "tournament":
      return TournamentDataSchema.parse(value);
    case "prediction-settings": {
      if (!isRecord(value)) return PredictionSettingsSchema.parse(value);
      const withoutLegacyField = Object.fromEntries(
        Object.entries(value).filter(([key]) => key !== "tournamentStabilityBoost"),
      );
      return PredictionSettingsSchema.parse(withoutLegacyField);
    }
    case "niche-settings":
      return NicheSettingsSchema.parse(value);
    case "redundancy-settings":
      return RedundancySettingsSchema.parse(normalizeRedundancySettings(value));
    case "shelf-config":
      return ShelfConfigurationSchema.parse(value);
  }
}

/** Remove the historical personal-axis weight while retaining the factual ratio. */
function normalizeRedundancySettings(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.componentWeights)) return value;
  const {
    binary,
    continuous,
    personalAxes: _personalAxes,
    ...unknownWeights
  } = value.componentWeights;
  void _personalAxes;
  const fallback = binary === 0 && continuous === 0;
  return {
    ...value,
    componentWeights: {
      ...unknownWeights,
      binary: fallback ? 4 / 7 : binary,
      continuous: fallback ? 3 / 7 : continuous,
    },
  };
}

function parseDefault(kind: RevisionedSourceKind, now: string): RevisionedSourceData {
  switch (kind) {
    case "tournament":
      return TournamentDataSchema.parse({
        settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
        sessions: [],
        gameStats: {},
      });
    case "prediction-settings":
      return PredictionSettingsSchema.parse(DEFAULT_PREDICTION_SETTINGS);
    case "niche-settings":
      return NicheSettingsSchema.parse(DEFAULT_NICHE_SETTINGS);
    case "redundancy-settings":
      return RedundancySettingsSchema.parse(DEFAULT_REDUNDANCY_SETTINGS);
    case "shelf-config":
      return ShelfConfigurationSchema.parse({ units: [], createdAt: now, updatedAt: now });
  }
}

/** Decode existing flat source JSON, keeping revision metadata out of domain data. */
export function decodeStoredSource(kind: RevisionedSourceKind, raw: unknown): DecodedStoredSource {
  if (!isRecord(raw)) throw new Error(`Malformed stored ${kind}: expected an object`);
  const hasRevision = Object.hasOwn(raw, "revision");
  let revision = hasRevision ? SourceRevisionSchema.parse(raw.revision) : 0;
  const sourceValue = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "revision"));
  let migrated = !hasRevision;
  let data: RevisionedSourceData;

  if (kind === "tournament") {
    const result = migrateTournamentData(sourceValue);
    data = TournamentDataSchema.parse(result.data);
    migrated ||= result.migrated;
  } else {
    data = parseSource(kind, sourceValue);
  }

  const redundancyWeightsMigrated =
    kind === "redundancy-settings" &&
    isRecord(sourceValue.componentWeights) &&
    (Object.hasOwn(sourceValue.componentWeights, "personalAxes") ||
      ((sourceValue.componentWeights.binary as number) === 0 &&
        (sourceValue.componentWeights.continuous as number) === 0));

  // This also detects old-field removal, defaults applied by schemas, tournament
  // migration, and stripped non-domain metadata. Revisionless files start at 0;
  // already-versioned files advance once if the accepted stored representation
  // must be normalized. A second decode then sees the canonical representation.
  const normalized = !deepEqual(sourceValue, data);
  migrated ||= normalized;
  if (hasRevision && normalized) revision = nextSourceRevision(revision);

  const stored = { ...(data as unknown as Record<string, unknown>), revision };
  return {
    data,
    stored,
    revision,
    migrated,
    ...(redundancyWeightsMigrated ? { redundancyWeightsMigrated: true } : {}),
  };
}

function nextSourceRevision(revision: number): number {
  if (revision >= Number.MAX_SAFE_INTEGER) throw new Error("Stored source revision overflow");
  return revision + 1;
}

/** Prepare an absent source without performing I/O; caller persists this only when needed. */
export function prepareMissingStoredSource(
  kind: RevisionedSourceKind,
  now: string,
): DecodedStoredSource {
  const data = parseDefault(kind, now);
  return {
    data,
    stored: { ...(data as unknown as Record<string, unknown>), revision: 0 },
    revision: 0,
    migrated: true,
  };
}

/** Return unchanged revision for semantic no-ops; throw rather than wrapping on overflow. */
export function prepareStoredSourceUpdate<T extends RevisionedSourceData>(
  current: DecodedStoredSource<T>,
  nextData: T,
): { data: T; stored: Record<string, unknown>; revision: number; changed: boolean } {
  const validated = parseDataLikeCurrent(current, nextData);
  if (deepEqual(current.data, validated)) {
    return {
      data: current.data,
      stored: current.stored,
      revision: current.revision,
      changed: false,
    };
  }
  const revision = nextSourceRevision(current.revision);
  return {
    data: validated,
    stored: { ...(validated as unknown as Record<string, unknown>), revision },
    revision,
    changed: true,
  };
}

function parseDataLikeCurrent<T extends RevisionedSourceData>(
  current: DecodedStoredSource<T>,
  value: T,
): T {
  // Infer the source validator from its data shape so callers cannot accidentally persist invalid data.
  if ("gameStats" in value) return TournamentDataSchema.parse(value) as T;
  if ("stageThresholds" in value) return PredictionSettingsSchema.parse(value) as T;
  if ("ignoredTags" in value) return NicheSettingsSchema.parse(value) as T;
  if ("componentWeights" in value) return RedundancySettingsSchema.parse(value) as T;
  if ("units" in value && "createdAt" in value && "updatedAt" in value)
    return ShelfConfigurationSchema.parse(value) as T;
  throw new Error(`Unsupported stored source update at revision ${current.revision}`);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null)
    return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => deepEqual(item, right[index]))
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && deepEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

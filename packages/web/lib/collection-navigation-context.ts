import type { FilterState, SortState } from "@/lib/collection-utils";

export const COLLECTION_NAVIGATION_CONTEXT_VERSION = 1 as const;
export const COLLECTION_NAVIGATION_CONTEXT_PREFIX = "shelf-judge-collection-navigation:v1:";
export const COLLECTION_NAVIGATION_CONTEXT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_COLLECTION_NAVIGATION_CONTEXTS = 20;

const LOCK_NAME = "shelf-judge-collection-navigation";
const MAX_KEY_GENERATION_ATTEMPTS = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CollectionNavigationEntry {
  readonly id: string;
  readonly name: string;
}

export interface CollectionNavigationScope {
  readonly showPreviouslyOwned: boolean;
  readonly missingDimensionsOnly: boolean;
}

export interface CollectionNavigationProjection {
  readonly sort: Readonly<SortState>;
  readonly filters: Readonly<FilterState>;
  readonly predictionsOn: boolean;
  readonly effectivePredictionsOn: boolean;
  readonly nichesOn: boolean;
}

export interface CollectionNavigationContextV1 {
  readonly version: 1;
  readonly key: string;
  readonly entries: readonly CollectionNavigationEntry[];
  readonly collectionScope: CollectionNavigationScope;
  readonly projection: CollectionNavigationProjection;
  readonly lastAccessedAt: number;
}

export type CreateCollectionNavigationContextInput = Omit<
  CollectionNavigationContextV1,
  "version" | "key" | "lastAccessedAt"
>;

export interface CollectionNavigationStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type CollectionNavigationClock = () => number;
export type CollectionNavigationKeyGenerator = () => string;
export type CollectionNavigationExclusiveLockRunner = <Result>(
  name: string,
  operation: () => Promise<Result>,
) => Promise<Result>;

export interface CollectionNavigationContextDependencies {
  readonly storage?: CollectionNavigationStorage;
  readonly clock?: CollectionNavigationClock;
  readonly generateKey?: CollectionNavigationKeyGenerator;
  readonly runExclusive?: CollectionNavigationExclusiveLockRunner;
}

export interface ResolveCollectionNavigationContextOptions extends CollectionNavigationContextDependencies {
  readonly currentId?: string;
  readonly originId?: string;
}

interface ResolvedDependencies {
  readonly storage: CollectionNavigationStorage | null;
  readonly clock: CollectionNavigationClock;
  readonly generateKey: CollectionNavigationKeyGenerator;
  readonly runExclusive: CollectionNavigationExclusiveLockRunner | null;
}

interface StoredRecord {
  readonly storageKey: string;
  readonly context: CollectionNavigationContextV1;
}

function isExactObject(value: unknown, keys: readonly string[]): value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => actualKeys.includes(key));
}

function property(value: object, key: string): unknown {
  return Reflect.get(value, key);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function parseEntry(value: unknown): CollectionNavigationEntry | null {
  if (!isExactObject(value, ["id", "name"])) return null;
  const id = property(value, "id");
  const name = property(value, "name");
  return isNonemptyString(id) && isNonemptyString(name) ? { id, name } : null;
}

function parseEntries(value: unknown): readonly CollectionNavigationEntry[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const entries: CollectionNavigationEntry[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    const entry = parseEntry(candidate);
    if (entry === null || ids.has(entry.id)) return null;
    ids.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

function parseScope(value: unknown): CollectionNavigationScope | null {
  if (!isExactObject(value, ["showPreviouslyOwned", "missingDimensionsOnly"])) return null;
  const showPreviouslyOwned = property(value, "showPreviouslyOwned");
  const missingDimensionsOnly = property(value, "missingDimensionsOnly");
  if (typeof showPreviouslyOwned !== "boolean" || typeof missingDimensionsOnly !== "boolean") {
    return null;
  }
  return { showPreviouslyOwned, missingDimensionsOnly };
}

function parseSort(value: unknown): Readonly<SortState> | null {
  if (!isExactObject(value, ["field", "direction"])) return null;
  const field = property(value, "field");
  const direction = property(value, "direction");
  if (!isNonemptyString(field) || (direction !== "asc" && direction !== "desc")) return null;
  return { field, direction };
}

function parseFilters(value: unknown): Readonly<FilterState> | null {
  if (!isExactObject(value, ["search", "ratedStatus", "playedStatus", "playerCount"])) {
    return null;
  }
  const search = property(value, "search");
  const ratedStatus = property(value, "ratedStatus");
  const playedStatus = property(value, "playedStatus");
  const playerCount = property(value, "playerCount");
  if (
    typeof search !== "string" ||
    (ratedStatus !== "all" && ratedStatus !== "rated" && ratedStatus !== "unrated") ||
    (playedStatus !== "all" && playedStatus !== "played" && playedStatus !== "unplayed") ||
    !(playerCount === null || (typeof playerCount === "number" && Number.isFinite(playerCount)))
  ) {
    return null;
  }
  return { search, ratedStatus, playedStatus, playerCount };
}

function parseProjection(value: unknown): CollectionNavigationProjection | null {
  if (
    !isExactObject(value, [
      "sort",
      "filters",
      "predictionsOn",
      "effectivePredictionsOn",
      "nichesOn",
    ])
  ) {
    return null;
  }
  const sort = parseSort(property(value, "sort"));
  const filters = parseFilters(property(value, "filters"));
  const predictionsOn = property(value, "predictionsOn");
  const effectivePredictionsOn = property(value, "effectivePredictionsOn");
  const nichesOn = property(value, "nichesOn");
  if (
    sort === null ||
    filters === null ||
    typeof predictionsOn !== "boolean" ||
    typeof effectivePredictionsOn !== "boolean" ||
    typeof nichesOn !== "boolean"
  ) {
    return null;
  }
  return { sort, filters, predictionsOn, effectivePredictionsOn, nichesOn };
}

function parseContext(value: unknown): CollectionNavigationContextV1 | null {
  if (
    !isExactObject(value, [
      "version",
      "key",
      "entries",
      "collectionScope",
      "projection",
      "lastAccessedAt",
    ])
  ) {
    return null;
  }
  const version = property(value, "version");
  const key = property(value, "key");
  const entries = parseEntries(property(value, "entries"));
  const collectionScope = parseScope(property(value, "collectionScope"));
  const projection = parseProjection(property(value, "projection"));
  const lastAccessedAt = property(value, "lastAccessedAt");
  if (
    version !== COLLECTION_NAVIGATION_CONTEXT_VERSION ||
    !isUuid(key) ||
    entries === null ||
    collectionScope === null ||
    projection === null ||
    typeof lastAccessedAt !== "number" ||
    !Number.isFinite(lastAccessedAt)
  ) {
    return null;
  }
  return { version, key, entries, collectionScope, projection, lastAccessedAt };
}

function parseJsonContext(raw: string): CollectionNavigationContextV1 | null {
  try {
    return parseContext(JSON.parse(raw));
  } catch {
    return null;
  }
}

function storageRecordKey(key: string): string {
  return `${COLLECTION_NAVIGATION_CONTEXT_PREFIX}${key}`;
}

function readContext(
  storage: CollectionNavigationStorage,
  key: string,
): CollectionNavigationContextV1 | null {
  try {
    const raw = storage.getItem(storageRecordKey(key));
    if (raw === null) return null;
    const context = parseJsonContext(raw);
    return context?.key === key ? context : null;
  } catch {
    return null;
  }
}

function safeRemove(storage: CollectionNavigationStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Storage cleanup is best-effort and must never affect navigation.
  }
}

function isExpired(context: CollectionNavigationContextV1, now: number): boolean {
  return now - context.lastAccessedAt >= COLLECTION_NAVIGATION_CONTEXT_TTL_MS;
}

function hasRequestedMembership(
  context: CollectionNavigationContextV1,
  currentId: string | undefined,
  originId: string | undefined,
): boolean {
  for (const requestedId of [currentId, originId]) {
    if (requestedId === undefined) continue;
    if (!isNonemptyString(requestedId)) return false;
    let occurrences = 0;
    for (const entry of context.entries) {
      if (entry.id === requestedId) occurrences += 1;
    }
    if (occurrences !== 1) return false;
  }
  return true;
}

function collectStorageKeys(storage: CollectionNavigationStorage): string[] {
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(COLLECTION_NAVIGATION_CONTEXT_PREFIX)) keys.push(key);
    }
  } catch {
    return keys;
  }
  return keys;
}

function cleanupContexts(
  storage: CollectionNavigationStorage,
  now: number,
  preferredKey?: string,
): void {
  const valid: StoredRecord[] = [];
  for (const storageKey of collectStorageKeys(storage)) {
    let raw: string | null;
    try {
      raw = storage.getItem(storageKey);
    } catch {
      continue;
    }
    const context = raw === null ? null : parseJsonContext(raw);
    if (
      context === null ||
      storageKey !== storageRecordKey(context.key) ||
      isExpired(context, now)
    ) {
      safeRemove(storage, storageKey);
    } else {
      valid.push({ storageKey, context });
    }
  }

  valid.sort((left, right) => {
    const recency = right.context.lastAccessedAt - left.context.lastAccessedAt;
    if (recency !== 0) return recency;
    if (left.context.key === preferredKey) return -1;
    if (right.context.key === preferredKey) return 1;
    return left.context.key.localeCompare(right.context.key);
  });
  for (const record of valid.slice(MAX_COLLECTION_NAVIGATION_CONTEXTS)) {
    safeRemove(storage, record.storageKey);
  }
}

async function defaultRunExclusive<Result>(
  name: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  if (typeof navigator === "undefined" || navigator.locks === undefined) {
    throw new Error("Web Locks are unavailable");
  }
  return navigator.locks.request(name, { mode: "exclusive" }, operation);
}

function resolveDependencies(
  dependencies: CollectionNavigationContextDependencies,
): ResolvedDependencies {
  let storage: CollectionNavigationStorage | null = dependencies.storage ?? null;
  if (storage === null) {
    try {
      storage = globalThis.localStorage ?? null;
    } catch {
      storage = null;
    }
  }

  let generateKey = dependencies.generateKey;
  if (generateKey === undefined) {
    generateKey = () => crypto.randomUUID();
  }

  return {
    storage,
    clock: dependencies.clock ?? Date.now,
    generateKey,
    runExclusive: dependencies.runExclusive ?? defaultRunExclusive,
  };
}

function serialize(context: CollectionNavigationContextV1): string | null {
  try {
    return JSON.stringify(context);
  } catch {
    return null;
  }
}

function writeAndConfirm(
  storage: CollectionNavigationStorage,
  context: CollectionNavigationContextV1,
): boolean {
  const raw = serialize(context);
  if (raw === null) return false;
  try {
    storage.setItem(storageRecordKey(context.key), raw);
    return storage.getItem(storageRecordKey(context.key)) === raw;
  } catch {
    return false;
  }
}

function validCreationInput(
  input: CreateCollectionNavigationContextInput,
): CreateCollectionNavigationContextInput | null {
  if (!isExactObject(input, ["entries", "collectionScope", "projection"])) return null;
  const entries = parseEntries(property(input, "entries"));
  const collectionScope = parseScope(property(input, "collectionScope"));
  const projection = parseProjection(property(input, "projection"));
  return entries === null || collectionScope === null || projection === null
    ? null
    : { entries, collectionScope, projection };
}

export async function createCollectionNavigationContext(
  input: CreateCollectionNavigationContextInput,
  dependencies: CollectionNavigationContextDependencies = {},
): Promise<string | null> {
  let validatedInput: CreateCollectionNavigationContextInput | null;
  try {
    validatedInput = validCreationInput(input);
  } catch {
    return null;
  }
  const resolved = resolveDependencies(dependencies);
  if (validatedInput === null || resolved.storage === null || resolved.runExclusive === null) {
    return null;
  }
  const storage = resolved.storage;
  const runExclusive = resolved.runExclusive;

  try {
    return await runExclusive(LOCK_NAME, () =>
      Promise.resolve().then(() => {
        const now = resolved.clock();
        if (!Number.isFinite(now)) return null;

        for (let attempt = 0; attempt < MAX_KEY_GENERATION_ATTEMPTS; attempt += 1) {
          let key: string;
          try {
            key = resolved.generateKey();
          } catch {
            return null;
          }
          if (!isUuid(key)) return null;

          const recordKey = storageRecordKey(key);
          try {
            if (storage.getItem(recordKey) !== null) continue;
          } catch {
            return null;
          }

          const context: CollectionNavigationContextV1 = {
            version: COLLECTION_NAVIGATION_CONTEXT_VERSION,
            key,
            ...validatedInput,
            lastAccessedAt: now,
          };
          if (!writeAndConfirm(storage, context)) {
            safeRemove(storage, recordKey);
            return null;
          }
          cleanupContexts(storage, now, key);
          return readContext(storage, key) === null ? null : key;
        }
        return null;
      }),
    );
  } catch {
    return null;
  }
}

function readValidResolution(
  storage: CollectionNavigationStorage,
  key: string,
  now: number,
  currentId: string | undefined,
  originId: string | undefined,
): CollectionNavigationContextV1 | null {
  const context = readContext(storage, key);
  if (
    context === null ||
    isExpired(context, now) ||
    !hasRequestedMembership(context, currentId, originId)
  ) {
    return null;
  }
  return context;
}

export async function resolveCollectionNavigationContext(
  key: string,
  options: ResolveCollectionNavigationContextOptions = {},
): Promise<CollectionNavigationContextV1 | null> {
  if (!isUuid(key)) return null;
  const { currentId, originId, ...dependencies } = options;
  const resolved = resolveDependencies(dependencies);
  if (resolved.storage === null) return null;
  const storage = resolved.storage;

  const readOnly = (): CollectionNavigationContextV1 | null => {
    let now: number;
    try {
      now = resolved.clock();
    } catch {
      return null;
    }
    if (!Number.isFinite(now)) return null;
    return readValidResolution(storage, key, now, currentId, originId);
  };

  if (resolved.runExclusive === null) return readOnly();
  try {
    return await resolved.runExclusive(LOCK_NAME, () =>
      Promise.resolve().then(() => {
        let now: number;
        try {
          now = resolved.clock();
        } catch {
          return null;
        }
        if (!Number.isFinite(now)) return null;

        const initial = readContext(storage, key);
        if (initial === null) {
          cleanupContexts(storage, now, key);
          return null;
        }
        if (isExpired(initial, now)) {
          safeRemove(storage, storageRecordKey(key));
          cleanupContexts(storage, now, key);
          return null;
        }
        if (!hasRequestedMembership(initial, currentId, originId)) {
          cleanupContexts(storage, now, key);
          return null;
        }

        const refreshed: CollectionNavigationContextV1 = {
          ...initial,
          lastAccessedAt: Math.max(initial.lastAccessedAt, now),
        };
        let result = initial;
        if (writeAndConfirm(storage, refreshed)) {
          result = readContext(storage, key) ?? initial;
        }
        cleanupContexts(storage, now, key);
        return result;
      }),
    );
  } catch {
    return readOnly();
  }
}

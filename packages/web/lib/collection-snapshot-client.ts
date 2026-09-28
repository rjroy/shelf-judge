import { CollectionSnapshotSchema, type CollectionSnapshot } from "@shelf-judge/shared";

const DATABASE_NAME = "shelf-judge-collection-snapshot";
const STORE_NAME = "snapshots";
const RECORD_KEY = "collection";

export interface PersistedCollectionSnapshot {
  readonly snapshot: CollectionSnapshot;
  readonly etag: string;
}

export interface SnapshotStore {
  /** Return the persisted value untouched; the client owns validation of this untrusted boundary. */
  read(): Promise<unknown>;
  replace(record: PersistedCollectionSnapshot): Promise<void>;
  clear(): Promise<void>;
}

export interface CollectionSnapshotLoad {
  readonly snapshot: CollectionSnapshot;
  readonly source: "network" | "not-modified";
  readonly etag: string | null;
}

export interface CollectionSnapshotClient {
  load(options?: { readonly signal?: AbortSignal }): Promise<CollectionSnapshotLoad>;
  /** Discard all in-flight responses and require the next load to ask for a body. */
  onCommittedMutation(): void;
  cancel(): void;
}

export interface CollectionSnapshotClientOptions {
  readonly fetch?: typeof fetch;
  readonly store?: SnapshotStore;
  readonly endpoint?: string;
}

export class CollectionSnapshotSupersededError extends Error {
  constructor() {
    super("Collection snapshot response was superseded by a newer load or mutation.");
    this.name = "CollectionSnapshotSupersededError";
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open snapshot database"));
    request.onblocked = () => reject(new Error("Snapshot database upgrade is blocked"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export const indexedDbSnapshotStore: SnapshotStore = {
  async read() {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const done = transactionDone(transaction);
      const request = transaction.objectStore(STORE_NAME).get(RECORD_KEY);
      const raw: unknown = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Snapshot read failed"));
      });
      await done;
      return raw ?? null;
    } finally {
      database.close();
    }
  },
  async replace(record) {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const done = transactionDone(transaction);
      const store = transaction.objectStore(STORE_NAME);
      // Clearing and writing the one key in one transaction also removes entries from older versions.
      store.clear();
      store.put(record, RECORD_KEY);
      await done;
    } finally {
      database.close();
    }
  },
  async clear() {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const done = transactionDone(transaction);
      transaction.objectStore(STORE_NAME).clear();
      await done;
    } finally {
      database.close();
    }
  },
};

function parseSnapshot(value: unknown): CollectionSnapshot {
  return CollectionSnapshotSchema.parse(value);
}

function cacheableResponse(response: Response): boolean {
  return !/\bno-store\b/i.test(response.headers.get("Cache-Control") ?? "");
}

function isValidEntityTag(value: string): boolean {
  // RFC 9110 entity-tag: optional weak prefix and a quoted opaque-tag. The opaque value
  // permits obs-text, but excludes DQUOTE, spaces, and all control characters.
  return /^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(value);
}

export function createCollectionSnapshotClient(
  options: CollectionSnapshotClientOptions = {},
): CollectionSnapshotClient {
  const fetcher = options.fetch ?? fetch;
  const store = options.store ?? indexedDbSnapshotStore;
  const endpoint = options.endpoint ?? "/api/daemon/collection/snapshot";
  let generation = 0;
  let forceBody = false;

  const current = (token: number, signal?: AbortSignal) => {
    if (token !== generation || signal?.aborted) throw new CollectionSnapshotSupersededError();
  };

  async function load(
    loadOptions: { readonly signal?: AbortSignal } = {},
  ): Promise<CollectionSnapshotLoad> {
    const token = ++generation;
    const signal = loadOptions.signal;
    let persisted: PersistedCollectionSnapshot | null = null;
    const bodyRequired = forceBody;
    if (!bodyRequired) {
      try {
        const candidate: unknown = await store.read();
        if (typeof candidate === "object" && candidate !== null) {
          const record = candidate as Record<string, unknown>;
          if (typeof record.etag === "string" && isValidEntityTag(record.etag)) {
            const parsed = CollectionSnapshotSchema.safeParse(record.snapshot);
            if (parsed.success) persisted = { snapshot: parsed.data, etag: record.etag };
          }
        }
      } catch {
        // Storage is an optimization only. Continue with an unconditional network request.
      }
    }
    current(token, signal);
    const conditional = persisted !== null && !bodyRequired;
    forceBody = false;
    const headers = new Headers();
    if (conditional && persisted) headers.set("If-None-Match", persisted.etag);
    let response = await fetcher(endpoint, { method: "GET", headers, signal });
    current(token, signal);
    if (response.status === 304) {
      const returnedEtag = response.headers.get("ETag");
      if (
        conditional &&
        persisted &&
        returnedEtag === persisted.etag &&
        persisted.snapshot.status === "complete" &&
        persisted.snapshot.representationVersion === 1 &&
        persisted.snapshot.serverId.length > 0 &&
        persisted.snapshot.collectionId.length > 0
      ) {
        return { snapshot: persisted.snapshot, source: "not-modified", etag: persisted.etag };
      }
      // A 304 without the exact validated body/validator pair is not renderable; retry without a validator.
      response = await fetcher(endpoint, { method: "GET", headers: new Headers(), signal });
      current(token, signal);
    }
    if (!response.ok) throw new Error(`Collection snapshot request failed (${response.status}).`);
    const snapshot = parseSnapshot(await response.json());
    current(token, signal);
    const etag = response.headers.get("ETag");
    if (snapshot.status === "complete" && etag && cacheableResponse(response)) {
      try {
        await store.replace({ snapshot, etag });
      } catch {
        // Quota, private-mode and unavailable IndexedDB must not block rendering this validated response.
      }
      current(token, signal);
    }
    return { snapshot, source: "network", etag: snapshot.status === "complete" ? etag : null };
  }

  return {
    load,
    onCommittedMutation() {
      generation++;
      forceBody = true;
    },
    cancel() {
      generation++;
    },
  };
}

import type { CollectionSnapshot } from "@shelf-judge/shared";
import { performance } from "node:perf_hooks";
import { canonicalSha256 } from "./profile-source-coordinator.js";
import { createLogger, type Logger } from "./logger.js";
import {
  CollectionSnapshotUnavailableError,
  type CollectionSnapshotBuildResult,
} from "./collection-snapshot-service.js";
import type { SourceVector } from "./source-vector.js";

export type BuiltCollectionSnapshot = Pick<
  CollectionSnapshotBuildResult,
  "snapshot" | "sourceVector" | "evaluatedAtMs" | "expiresAtMs" | "semanticRead"
>;

export interface CollectionSnapshotBuilder {
  buildSnapshot(context?: {
    requestId: string;
    operationId: string;
  }): Promise<BuiltCollectionSnapshot>;
}

export interface CollectionSnapshotCacheStorage {
  sourceVector?(): SourceVector | undefined;
  loadCollection?(): Promise<{ semanticRedundancy?: { settings?: { enabled?: boolean } } }>;
}

export interface CollectionSnapshotCacheCoordinator {
  runExclusive<Value>(operation: () => Promise<Value>): Promise<Value>;
}

export interface CollectionSnapshotCacheDeps {
  builder: CollectionSnapshotBuilder;
  storageService: CollectionSnapshotCacheStorage;
  coordinator: CollectionSnapshotCacheCoordinator;
  clock?: { now(): number };
  logger?: Logger;
  serialize?: (snapshot: CollectionSnapshot) => string;
}

export interface CollectionSnapshotResponseDecision {
  status: 200 | 304;
  body: string | null;
  etag: string | null;
  cacheable: boolean;
  snapshotStatus?: CollectionSnapshot["status"];
  gameCount?: number;
}

export interface CollectionSnapshotCacheService {
  resolve(
    ifNoneMatch?: string | null,
    requestId?: string,
  ): Promise<CollectionSnapshotResponseDecision>;
}

interface CacheEntry {
  sourceVector: SourceVector;
  evaluatedAtMs: number;
  expiresAtMs: number | null;
  serializedBody: string;
  etag: string;
  gameCount: number;
}

interface BuildFlight {
  id: string;
  semanticEnabled: boolean;
  promise: Promise<CompletedBuild>;
  resolve(value: CompletedBuild): void;
  reject(error: unknown): void;
}

interface CompletedBuild {
  decision: CollectionSnapshotResponseDecision;
  sourceVector: SourceVector;
  evaluatedAtMs: number;
  expiresAtMs: number | null;
  semanticEnabled: boolean;
  semanticRead: BuiltCollectionSnapshot["semanticRead"];
}

type Reservation =
  | { kind: "hit"; decision: CollectionSnapshotResponseDecision }
  | { kind: "join"; flight: BuildFlight }
  | { kind: "build"; flight: BuildFlight };

const DEFAULT_CLOCK = { now: () => Date.now() };

export function createCollectionSnapshotCacheService(
  deps: CollectionSnapshotCacheDeps,
): CollectionSnapshotCacheService {
  const clock = deps.clock ?? DEFAULT_CLOCK;
  const logger = deps.logger ?? createLogger("collection-snapshot-cache");
  const serialize = deps.serialize ?? ((snapshot) => JSON.stringify(snapshot));
  let entry: CacheEntry | null = null;
  let flight: BuildFlight | null = null;
  let operationSequence = 0;
  let flightSequence = 0;
  let reservationSequence = 0;

  function createFlight(semanticEnabled: boolean, id: string): BuildFlight {
    let resolve!: (value: CompletedBuild) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<CompletedBuild>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { id, semanticEnabled, promise, resolve, reject };
  }

  async function semanticEnabled(): Promise<boolean> {
    const collection = await deps.storageService.loadCollection?.();
    return collection?.semanticRedundancy?.settings?.enabled === true;
  }

  function isUsable(candidate: CacheEntry | null, current: SourceVector | undefined, now: number) {
    if (
      !candidate ||
      !candidate.sourceVector.available ||
      !current?.available ||
      !Number.isFinite(now) ||
      now < candidate.evaluatedAtMs ||
      (candidate.expiresAtMs !== null && now >= candidate.expiresAtMs)
    ) {
      return false;
    }
    return sameSourceVector(candidate.sourceVector, current);
  }

  function decisionForEntry(candidate: CacheEntry, ifNoneMatch?: string | null) {
    const notModified =
      ifNoneMatch !== null &&
      ifNoneMatch !== undefined &&
      matchesIfNoneMatch(ifNoneMatch, candidate.etag);
    logger.debug?.("collection snapshot cache hit completed", {
      outcome: notModified ? "not-modified" : "body",
      gameCount: candidate.gameCount,
      bytes: notModified ? 0 : Buffer.byteLength(candidate.serializedBody),
    });
    return {
      status: notModified ? 304 : 200,
      body: notModified ? null : candidate.serializedBody,
      etag: candidate.etag,
      cacheable: true,
      snapshotStatus: "complete",
      gameCount: candidate.gameCount,
    } satisfies CollectionSnapshotResponseDecision;
  }

  async function reserve(
    ifNoneMatch: string | null | undefined,
    requestId: string,
  ): Promise<Reservation> {
    const enqueuedAt = performance.now();
    const reservationId = `snapshot-reservation-${++reservationSequence}`;
    const queuedFlightId = flight?.id ?? null;
    const candidateFlightId = queuedFlightId ?? `snapshot-flight-${flightSequence + 1}`;
    logger.debug?.("collection snapshot reservation enqueue", {
      requestId,
      reservationId,
      flightId: queuedFlightId,
      candidateFlightId,
      operation: "reserve",
    });
    return deps.coordinator.runExclusive(async () => {
      logger.debug?.("collection snapshot reservation entered", {
        requestId,
        reservationId,
        flightId: flight?.id ?? null,
        candidateFlightId,
        waitMs: Math.max(0, performance.now() - enqueuedAt),
        operation: "reserve",
      });
      await Promise.resolve();
      const semanticIsEnabled = await semanticEnabled();
      const current = deps.storageService.sourceVector?.();
      const now = clock.now();
      if (!semanticIsEnabled && isUsable(entry, current, now)) {
        return { kind: "hit", decision: decisionForEntry(entry!, ifNoneMatch) };
      }
      if (entry && (semanticIsEnabled || !isUsable(entry, current, now))) {
        logger.debug?.("collection snapshot cache invalidation", {
          outcome: "invalidated",
          cachedChangeToken: entry.sourceVector.changeToken,
          currentChangeToken: current?.changeToken ?? null,
          reason: semanticIsEnabled
            ? "semantic-redundancy-enabled"
            : !current?.available
              ? "sources-unavailable"
              : "source-or-time-mismatch",
        });
        entry = null;
      }
      if (flight && flight.semanticEnabled === semanticIsEnabled) {
        logger.debug?.("collection snapshot cache miss", {
          requestId,
          reservationId,
          flightId: flight.id,
          elapsedMs: Math.max(0, performance.now() - enqueuedAt),
          outcome: "joined-in-flight",
          currentChangeToken: current?.changeToken ?? null,
        });
        return { kind: "join", flight };
      }
      const created = createFlight(semanticIsEnabled, `snapshot-flight-${++flightSequence}`);
      flight = created;
      logger.debug?.("collection snapshot cache miss", {
        requestId,
        reservationId,
        flightId: created.id,
        elapsedMs: Math.max(0, performance.now() - enqueuedAt),
        outcome: "build-reserved",
        currentChangeToken: current?.changeToken ?? null,
        available: current?.available ?? false,
      });
      return { kind: "build", flight: created };
    });
  }

  async function finishBuild(
    buildFlight: BuildFlight,
    requestId: string,
    operationId: string,
  ): Promise<void> {
    const startedAt = performance.now();
    logger.debug?.("collection snapshot cache build attempt", {
      requestId,
      operationId,
      flightId: buildFlight.id,
      outcome: "started",
    });
    try {
      const built = await deps.builder.buildSnapshot({ requestId, operationId });
      const serializedBody = serialize(built.snapshot);
      const publicationEnqueuedAt = performance.now();
      logger.debug?.("collection snapshot cache publication enqueue", {
        requestId,
        operationId,
        flightId: buildFlight.id,
        phase: "cache-publication",
      });
      const result = await deps.coordinator
        .runExclusive(async (): Promise<CompletedBuild> => {
          logger.debug?.("collection snapshot cache publication entered", {
            requestId,
            operationId,
            flightId: buildFlight.id,
            phase: "cache-publication",
            waitMs: Math.max(0, performance.now() - publicationEnqueuedAt),
          });
          await Promise.resolve();
          const semanticIsEnabled = await semanticEnabled();
          const current = deps.storageService.sourceVector?.();
          if (semanticIsEnabled !== buildFlight.semanticEnabled) {
            throw new CollectionSnapshotUnavailableError(
              "Collection snapshot semantic settings changed before publication",
            );
          }
          if (!sameSourceVector(built.sourceVector, current)) {
            logger.warn("collection snapshot cache build discarded", {
              outcome: "source-changed",
              capturedChangeToken: built.sourceVector.changeToken,
              currentChangeToken: current?.changeToken ?? null,
            });
            throw new CollectionSnapshotUnavailableError(
              "Collection snapshot sources changed before cache publication",
            );
          }
          if (built.snapshot.status === "complete" && !built.sourceVector.available) {
            throw new CollectionSnapshotUnavailableError(
              "Complete collection snapshot has unavailable sources",
            );
          }
          const now = clock.now();
          if (!freshAt(built.evaluatedAtMs, built.expiresAtMs, now)) {
            logger.warn("collection snapshot cache build discarded", {
              outcome: "time-changed",
              evaluatedAtMs: built.evaluatedAtMs,
              expiresAtMs: built.expiresAtMs,
              semanticEnabled: semanticIsEnabled,
              semanticRead: built.semanticRead,
              now,
            });
            throw new CollectionSnapshotUnavailableError(
              "Collection snapshot freshness changed before publication",
            );
          }
          if (built.snapshot.status !== "complete") {
            if (flight === buildFlight) flight = null;
            logger.debug?.("collection snapshot cache build completed", {
              outcome: "degraded-not-cached",
              gameCount: built.snapshot.games.length,
              bytes: Buffer.byteLength(serializedBody),
            });
            return {
              decision: {
                status: 200,
                body: serializedBody,
                etag: null,
                cacheable: false,
                snapshotStatus: "degraded",
                gameCount: built.snapshot.games.length,
              } satisfies CollectionSnapshotResponseDecision,
              sourceVector: built.sourceVector,
              evaluatedAtMs: built.evaluatedAtMs,
              expiresAtMs: built.expiresAtMs,
              semanticEnabled: semanticIsEnabled,
              semanticRead: built.semanticRead,
            };
          }
          if (semanticIsEnabled) {
            if (flight === buildFlight) flight = null;
            logger.debug?.("collection snapshot cache build completed", {
              outcome: "semantic-redundancy-no-store",
              gameCount: built.snapshot.games.length,
              bytes: Buffer.byteLength(serializedBody),
            });
            return {
              decision: {
                status: 200,
                body: serializedBody,
                etag: null,
                cacheable: false,
                snapshotStatus: "complete",
                gameCount: built.snapshot.games.length,
              },
              sourceVector: built.sourceVector,
              evaluatedAtMs: built.evaluatedAtMs,
              expiresAtMs: built.expiresAtMs,
              semanticEnabled: true,
              semanticRead: built.semanticRead,
            };
          }
          const etag = createSnapshotEtag(built);
          entry = {
            sourceVector: built.sourceVector,
            evaluatedAtMs: built.evaluatedAtMs,
            expiresAtMs: built.expiresAtMs,
            serializedBody,
            etag,
            gameCount: built.snapshot.games.length,
          };
          logger.debug?.("collection snapshot cache build completed", {
            outcome: "published",
            changeToken: built.sourceVector.changeToken,
            gameCount: built.snapshot.games.length,
            bytes: Buffer.byteLength(serializedBody),
            expiresAtMs: built.expiresAtMs,
          });
          if (flight === buildFlight) flight = null;
          return {
            decision: {
              status: 200,
              body: serializedBody,
              etag,
              cacheable: true,
              snapshotStatus: "complete",
              gameCount: built.snapshot.games.length,
            },
            sourceVector: built.sourceVector,
            evaluatedAtMs: built.evaluatedAtMs,
            expiresAtMs: built.expiresAtMs,
            semanticEnabled: semanticIsEnabled,
            semanticRead: built.semanticRead,
          };
        })
        .then(
          (completed) => {
            logger.debug?.("collection snapshot cache publication completed", {
              requestId,
              operationId,
              flightId: buildFlight.id,
              phase: "cache-publication",
              elapsedMs: Math.max(0, performance.now() - publicationEnqueuedAt),
              outcome: completed.decision.snapshotStatus === "degraded" ? "degraded" : "published",
            });
            return completed;
          },
          (error: unknown) => {
            logger.warn("collection snapshot cache publication failed", {
              requestId,
              operationId,
              flightId: buildFlight.id,
              phase: "cache-publication",
              elapsedMs: Math.max(0, performance.now() - publicationEnqueuedAt),
              outcome: "rejected",
              errorClass: error instanceof Error ? error.name : "UnknownError",
            });
            throw error;
          },
        );
      // Publication/removal is atomic with source validation; resolve outside the
      // lock only after no later caller can join this completed flight.
      buildFlight.resolve(result);
      logger.debug?.("collection snapshot cache build completed", {
        requestId,
        operationId,
        flightId: buildFlight.id,
        elapsedMs: Math.max(0, performance.now() - startedAt),
        outcome: "built",
      });
    } catch (error) {
      await deps.coordinator.runExclusive(async () => {
        await Promise.resolve();
        if (flight === buildFlight) flight = null;
      });
      logger.error("collection snapshot cache build failed", {
        requestId,
        operationId,
        flightId: buildFlight.id,
        elapsedMs: Math.max(0, performance.now() - startedAt),
        outcome: "failed",
        errorClass: error instanceof Error ? error.name : "UnknownError",
      });
      buildFlight.reject(error);
    }
  }

  return {
    async resolve(
      ifNoneMatch?: string | null,
      suppliedRequestId?: string,
    ): Promise<CollectionSnapshotResponseDecision> {
      const requestId = suppliedRequestId ?? `snapshot-${++operationSequence}`;
      const startedAt = performance.now();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const reservation = await reserve(ifNoneMatch, requestId);
        if (reservation.kind === "hit") {
          logger.debug?.("collection snapshot resolve completed", {
            requestId,
            elapsedMs: Math.max(0, performance.now() - startedAt),
            cache: "hit",
            outcome: "success",
          });
          return reservation.decision;
        }
        if (reservation.kind === "build") {
          // Launch after reserve's coordinator callback to avoid ALS reentrancy.
          void finishBuild(reservation.flight, requestId, `snapshot-build-${++operationSequence}`);
        }
        let completed: CompletedBuild;
        try {
          completed = await reservation.flight.promise;
        } catch (error) {
          if (error instanceof CollectionSnapshotUnavailableError && attempt === 0) continue;
          throw error;
        }
        const validationEnqueuedAt = performance.now();
        logger.debug?.("collection snapshot response validation enqueue", {
          requestId,
          flightId: reservation.flight.id,
          phase: "response-validation",
          attempt,
        });
        const decision = await deps.coordinator
          .runExclusive(async () => {
            logger.debug?.("collection snapshot response validation entered", {
              requestId,
              flightId: reservation.flight.id,
              phase: "response-validation",
              attempt,
              waitMs: Math.max(0, performance.now() - validationEnqueuedAt),
            });
            await Promise.resolve();
            const semanticIsEnabled = await semanticEnabled();
            // Read the vector only after the authoritative semantic setting has
            // settled; loading it can cross an activation/commit boundary.
            const current = deps.storageService.sourceVector?.();
            const now = clock.now();
            if (
              semanticIsEnabled !== completed.semanticEnabled ||
              !sameSourceVector(completed.sourceVector, current) ||
              !freshAt(completed.evaluatedAtMs, completed.expiresAtMs, now)
            ) {
              if (entry && !sameSourceVector(entry.sourceVector, current)) entry = null;
              logger.warn("collection snapshot cache result superseded", {
                outcome: "retry",
                capturedChangeToken: completed.sourceVector.changeToken,
                currentChangeToken: current?.changeToken ?? null,
                now,
              });
              return null;
            }
            if (
              completed.semanticEnabled &&
              completed.semanticRead?.status !== "verified" &&
              completed.semanticRead?.status !== "unified-v2" &&
              hasReadySemanticData(completed.decision.body)
            ) {
              throw new CollectionSnapshotUnavailableError(
                "Semantic snapshot result has no current read proof",
              );
            }
            if (
              completed.semanticEnabled &&
              (completed.semanticRead?.status === "verified" ||
                completed.semanticRead?.status === "unified-v2") &&
              !completed.semanticRead.isCurrent()
            ) {
              logger.warn("collection snapshot semantic result superseded", {
                outcome: "retry",
                proofStatus:
                  completed.semanticRead.status === "verified"
                    ? completed.semanticRead.proof.status
                    : "unified-v2",
                currentChangeToken: current?.changeToken ?? null,
              });
              return null;
            }
            if (completed.decision.snapshotStatus === "degraded") {
              return completed.decision;
            }
            if (completed.semanticEnabled) return completed.decision;
            if (!current?.available || !entry || !sameSourceVector(entry.sourceVector, current)) {
              return null;
            }
            return decisionForEntry(entry, ifNoneMatch);
          })
          .then(
            (validated) => {
              logger.debug?.("collection snapshot response validation completed", {
                requestId,
                flightId: reservation.flight.id,
                phase: "response-validation",
                attempt,
                elapsedMs: Math.max(0, performance.now() - validationEnqueuedAt),
                outcome: validated === null ? "retry" : "accepted",
              });
              return validated;
            },
            (error: unknown) => {
              logger.warn("collection snapshot response validation failed", {
                requestId,
                flightId: reservation.flight.id,
                phase: "response-validation",
                attempt,
                elapsedMs: Math.max(0, performance.now() - validationEnqueuedAt),
                outcome: "rejected",
                errorClass: error instanceof Error ? error.name : "UnknownError",
              });
              throw error;
            },
          );
        if (decision) {
          logger.debug?.("collection snapshot resolve completed", {
            requestId,
            elapsedMs: Math.max(0, performance.now() - startedAt),
            flightId: reservation.flight.id,
            cache: reservation.kind,
            attempt,
            outcome: "success",
          });
          return decision;
        }
      }
      logger.warn("collection snapshot resolve rejected", {
        requestId,
        elapsedMs: Math.max(0, performance.now() - startedAt),
        outcome: "stale-retries-exhausted",
      });
      throw new CollectionSnapshotUnavailableError(
        "Collection snapshot sources or freshness changed repeatedly",
      );
    },
  };
}

function hasReadySemanticData(body: string | null): boolean {
  if (body === null) return false;
  try {
    const snapshot = JSON.parse(body) as {
      games?: Array<{ redundancySimilarityInfo?: { status?: unknown } }>;
    };
    return (
      snapshot.games?.some((game) => game.redundancySimilarityInfo?.status === "ready") ?? false
    );
  } catch {
    return false;
  }
}

function freshAt(evaluatedAtMs: number, expiresAtMs: number | null, now: number): boolean {
  return (
    Number.isFinite(now) &&
    Number.isFinite(evaluatedAtMs) &&
    now >= evaluatedAtMs &&
    (expiresAtMs === null || (Number.isFinite(expiresAtMs) && now < expiresAtMs))
  );
}

function sameSourceVector(left: SourceVector, right: SourceVector | undefined): boolean {
  return (
    !!right &&
    left.available === right.available &&
    left.processEpoch === right.processEpoch &&
    left.changeToken === right.changeToken &&
    left.collectionId === right.collectionId &&
    left.collectionSchemaVersion === right.collectionSchemaVersion &&
    left.collectionRevision === right.collectionRevision &&
    left.semanticEvidenceEpoch === right.semanticEvidenceEpoch &&
    left.semanticConsentEpoch === right.semanticConsentEpoch &&
    left.factualWeightsEpoch === right.factualWeightsEpoch &&
    left.factualWeightsFingerprint === right.factualWeightsFingerprint &&
    left.redundancyWeightsFingerprint === right.redundancyWeightsFingerprint &&
    left.tournamentRevision === right.tournamentRevision &&
    left.predictionSettingsRevision === right.predictionSettingsRevision &&
    left.nicheSettingsRevision === right.nicheSettingsRevision &&
    left.redundancySettingsRevision === right.redundancySettingsRevision &&
    left.shelfConfigRevision === right.shelfConfigRevision &&
    left.representationVersion === right.representationVersion &&
    left.algorithmVersion === right.algorithmVersion
  );
}

function createSnapshotEtag(built: BuiltCollectionSnapshot): string {
  const vector = built.sourceVector;
  const hash = canonicalSha256({
    processEpoch: vector.processEpoch,
    collectionId: vector.collectionId,
    collectionSchemaVersion: vector.collectionSchemaVersion,
    collectionRevision: vector.collectionRevision,
    semanticEvidenceEpoch: vector.semanticEvidenceEpoch ?? null,
    semanticConsentEpoch: vector.semanticConsentEpoch ?? null,
    factualWeightsEpoch: vector.factualWeightsEpoch ?? null,
    factualWeightsFingerprint: vector.factualWeightsFingerprint ?? null,
    redundancyWeightsFingerprint: vector.redundancyWeightsFingerprint ?? null,
    tournamentRevision: vector.tournamentRevision,
    predictionSettingsRevision: vector.predictionSettingsRevision,
    nicheSettingsRevision: vector.nicheSettingsRevision,
    redundancySettingsRevision: vector.redundancySettingsRevision,
    shelfConfigRevision: vector.shelfConfigRevision,
    changeToken: vector.changeToken,
    representationVersion: vector.representationVersion,
    algorithmVersion: vector.algorithmVersion,
    nextTimeTransition: built.expiresAtMs,
  });
  return `W/"cs1-${hash}"`;
}

function matchesIfNoneMatch(header: string, etag: string): boolean {
  if (header.trim() === "*") return true;
  const tags = splitEntityTagList(header);
  if (tags.length === 0 || tags.some((tag) => !isEntityTag(tag))) return false;
  const target = weakComparable(etag);
  return tags.some((tag) => weakComparable(tag) === target);
}

function splitEntityTagList(header: string): string[] {
  const tags: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < header.length; index += 1) {
    if (header[index] === '"') quoted = !quoted;
    else if (header[index] === "," && !quoted) {
      tags.push(header.slice(start, index).trim());
      start = index + 1;
    }
  }
  tags.push(header.slice(start).trim());
  return tags.filter((tag) => tag.length > 0);
}

function isEntityTag(value: string): boolean {
  return /^(?:W\/)?"[\x21\x23-\x7E\x80-\xFF]*"$/.test(value);
}

function weakComparable(value: string): string {
  return value.startsWith("W/") ? value.slice(2) : value;
}

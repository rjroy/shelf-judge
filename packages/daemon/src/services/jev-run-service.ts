import type { Collection, GameWithScore, RedundancyComponentWeights } from "@shelf-judge/shared";
import type { JevPairCache, JevRunProgress, JevRunStopReason } from "./jev-pair-cache-service.js";
import { computeJevPairCoverage, type JevPredictionCaptureIdentity } from "./jev-pair-coverage.js";
import {
  profileSourceCoordinatorFor,
  runOutsideProfileSourceCoordinator,
  type ProfileSourceCoordinator,
} from "./profile-source-coordinator.js";
import { mapJevPairResult, prepareJevRunPair } from "./jev-run-pair.js";
import {
  jevRunPairSourcesChanged,
  planJevRunScope,
  type JevRunPair,
  type JevRunScope,
} from "./jev-run-scope.js";
import {
  JevGatewayError,
  type JevAttemptAdmission,
  type JevDispatchReceipt,
  type JevGateway,
} from "./jev/jev-gateway.js";

export interface JevRunCapture {
  collection: Collection;
  predictionCapture: readonly GameWithScore[];
  captureIdentity: JevPredictionCaptureIdentity;
  factualWeights: RedundancyComponentWeights;
  sourceVectorIdentity: string;
  policyIdentity: string;
}

export interface JevRunCurrentState {
  collection: Collection;
  sourceVectorIdentity: string;
  policyIdentity: string;
  canTransmitNotes: boolean;
}

export interface JevRunServiceOptions {
  storageService: object;
  cache: JevPairCache;
  /** Returns one internally coherent, complete prediction capture. Never call under coordinator. */
  loadCapture(): Promise<JevRunCapture>;
  /** Cheap authoritative state read, safe under the profile-source coordinator. */
  readCurrent(): Promise<JevRunCurrentState>;
  createGateway(
    admitAndDispatch: (attempt: JevAttemptAdmission) => Promise<JevDispatchReceipt>,
  ): JevGateway;
  /** Optional instrumentation seam; production defaults to the canonical planner. */
  planScope?: typeof planJevRunScope;
  now?: () => Date;
  maxPairs?: number;
  maxRunMs?: number;
  finalCaptureRetries?: number;
}

export interface JevRunHandle {
  runId: string;
  completion: Promise<JevRunProgress>;
  cancel(): void;
}

export interface JevPreparedRunInput {
  capture: JevRunCapture;
  scope: JevRunScope;
  noteTransmissionAuthorized: boolean;
}

declare const validatedPreparedRunBrand: unique symbol;
export type ValidatedPreparedJevRun = { readonly [validatedPreparedRunBrand]: true };

interface PreparedRunData {
  capture: JevRunCapture;
  scope: JevRunScope;
  noteTransmissionAuthorized: boolean;
}

export interface JevRunEffectiveLimits {
  maxEligiblePairs: number;
  maxRunDurationMs: number;
}

const DEFAULT_MAX_PAIRS = 25_000;
const DEFAULT_MAX_RUN_MS = 30 * 60_000;
const DEFAULT_FINAL_CAPTURE_RETRIES = 2;
const activeRuns = new WeakMap<object, JevRunHandle>();
type ReadyAdmission = Extract<ReturnType<typeof prepareJevRunPair>, { status: "ready" }>;

/** Explicit-start only. Persisted progress is observability, never authority to perform inference. */
export class JevRunService {
  private readonly coordinator: ProfileSourceCoordinator;
  private readonly now: () => Date;
  private readonly maxPairs: number;
  private readonly maxRunMs: number;
  private readonly finalCaptureRetries: number;
  private readonly planScope: typeof planJevRunScope;
  private readonly preparedRuns = new WeakMap<object, PreparedRunData>();

  constructor(private readonly options: JevRunServiceOptions) {
    this.coordinator = profileSourceCoordinatorFor(options.storageService);
    this.now = options.now ?? (() => new Date());
    this.maxPairs = options.maxPairs ?? DEFAULT_MAX_PAIRS;
    this.maxRunMs = options.maxRunMs ?? DEFAULT_MAX_RUN_MS;
    this.finalCaptureRetries = options.finalCaptureRetries ?? DEFAULT_FINAL_CAPTURE_RETRIES;
    this.planScope = options.planScope ?? planJevRunScope;
  }

  get effectiveLimits(): JevRunEffectiveLimits {
    return { maxEligiblePairs: this.maxPairs, maxRunDurationMs: this.maxRunMs };
  }

  startRun(input: { noteTransmissionAuthorized: boolean }): JevRunHandle {
    return this.reserveRun(input.noteTransmissionAuthorized);
  }

  /**
   * Validates and privately owns an already authorized snapshot before the short admission lock.
   * Pair-scope correspondence is checked in bounded asynchronous slices outside the coordinator.
   */
  prepareValidatedPreparedRun(input: JevPreparedRunInput): Promise<ValidatedPreparedJevRun | null> {
    return runOutsideProfileSourceCoordinator(async () => {
      try {
        if (typeof input.noteTransmissionAuthorized !== "boolean") return null;
        const capture = structuredClone(input.capture);
        const planned = this.planScope(capture.collection, capture.predictionCapture);
        if (
          !planned.ok ||
          planned.scope.totalEligiblePairs > this.maxPairs ||
          !(await this.scopeMatchesCapture(input.scope, planned.scope))
        )
          return null;
        const reservation = Object.freeze({});
        this.preparedRuns.set(reservation, {
          capture,
          scope: planned.scope,
          noteTransmissionAuthorized: input.noteTransmissionAuthorized,
        });
        return reservation as ValidatedPreparedJevRun;
      } catch {
        return null;
      }
    });
  }

  /** Constant-time, one-shot active-run reservation for a previously validated input. */
  reserveValidatedPreparedRun(reservation: ValidatedPreparedJevRun): JevRunHandle {
    const key = reservation as object;
    const prepared = this.preparedRuns.get(key);
    if (!prepared) throw new Error("Prepared Jev reservation is invalid or already consumed");
    if (activeRuns.has(this.options.storageService)) throw new Error("A Jev run is already active");
    this.preparedRuns.delete(key);
    return this.reserveRun(prepared.noteTransmissionAuthorized, prepared);
  }

  private reserveRun(noteAuthorized: boolean, prepared?: PreparedRunData): JevRunHandle {
    if (activeRuns.has(this.options.storageService)) throw new Error("A Jev run is already active");
    const runId = crypto.randomUUID();
    const controller = new AbortController();
    const completion = runOutsideProfileSourceCoordinator(() =>
      this.execute(runId, noteAuthorized, controller, prepared),
    );
    const handle: JevRunHandle = { runId, completion, cancel: () => controller.abort() };
    activeRuns.set(this.options.storageService, handle);
    void completion
      .finally(() => {
        if (activeRuns.get(this.options.storageService) === handle)
          activeRuns.delete(this.options.storageService);
      })
      .catch(() => {});
    return handle;
  }

  /** Marks a durable interrupted marker only. This method never creates a gateway or sends. */
  reconcileInterruptedProgress(): Promise<JevRunProgress | null> {
    if (activeRuns.has(this.options.storageService))
      return Promise.resolve(this.options.cache.getRunProgress());
    const prior = this.options.cache.getRunProgress();
    if (!prior || prior.state !== "running") return Promise.resolve(prior);
    const interrupted: JevRunProgress = {
      ...prior,
      state: "interrupted",
      updatedAt: this.now().toISOString(),
    };
    this.options.cache.saveRunProgress(interrupted);
    return Promise.resolve(interrupted);
  }

  private async execute(
    runId: string,
    noteAuthorized: boolean,
    controller: AbortController,
    prepared?: PreparedRunData,
  ): Promise<JevRunProgress> {
    const startedAt = this.now().getTime();
    let progress: JevRunProgress = {
      runId,
      state: "running",
      pairCount: 0,
      completedPairs: 0,
      cacheHits: 0,
      cacheMisses: 0,
      failedPairs: 0,
      updatedAt: this.now().toISOString(),
    };
    let capture: JevRunCapture;
    let originalScope: JevRunScope;
    let terminalStopReason: JevRunStopReason | undefined;
    try {
      if (prepared) {
        capture = prepared.capture;
        originalScope = prepared.scope;
      } else {
        capture = await this.options.loadCapture();
        const planned = this.planScope(capture.collection, capture.predictionCapture);
        if (!planned.ok) throw new Error("Invalid Jev capture");
        originalScope = planned.scope;
      }
      if (originalScope.totalEligiblePairs > this.maxPairs)
        throw new Error("Jev run exceeds configured pair limit");
      progress = this.nextProgress(progress, { pairCount: originalScope.totalEligiblePairs });
      await this.coordinator.runExclusive(async () => {
        const current = await this.options.readCurrent();
        if (this.stopped(controller, startedAt)) throw new Error("Jev run stopped");
        if (!sameAuthority(capture, current))
          throw new Error("Jev sources changed before run start");
        this.options.cache.saveRunProgress(progress);
      });

      let activeAdmission: { pair: JevRunPair; ready: ReadyAdmission } | null = null;
      let latestCapture = capture;
      let latestScope = originalScope;
      let gateway: JevGateway | null = null;
      const getGateway = (): JevGateway => {
        if (gateway) return gateway;
        gateway = this.options.createGateway((attempt) => {
          const bound = activeAdmission;
          if (!bound) return Promise.reject(new Error("No active Jev pair admission"));
          return this.admitAttempt({
            runId,
            noteAuthorized,
            controller,
            startedAt,
            originalCapture: capture,
            originalScope,
            getLatest: () => latestCapture,
            setLatest: (next, scope) => {
              latestCapture = next;
              latestScope = scope;
            },
            getLatestScope: () => latestScope,
            pair: bound.pair,
            ready: bound.ready,
            attempt,
          });
        });
        return gateway;
      };

      for (const originalPair of originalScope.pairs()) {
        if (this.stopped(controller, startedAt)) break;
        const previousCapture = latestCapture;
        const currentCapture = await this.refreshForCurrentVector(previousCapture);
        const captureChanged =
          currentCapture.sourceVectorIdentity !== previousCapture.sourceVectorIdentity;
        if (currentCapture.policyIdentity !== capture.policyIdentity)
          throw new Error("Jev policy changed during run");
        const currentScopeResult = captureChanged
          ? this.planScope(currentCapture.collection, currentCapture.predictionCapture)
          : { ok: true as const, scope: latestScope };
        if (!currentScopeResult.ok) throw new Error("Jev refreshed capture could not be planned");
        // Publish capture and its matching scope together before any pair-specific early return.
        latestCapture = currentCapture;
        latestScope = currentScopeResult.scope;
        if (!pairForIds(currentScopeResult.scope, originalPair)) {
          progress = this.persistOutcome(progress, { completedPairs: 1, failedPairs: 1 });
          continue;
        }
        const currentPair = pairForIds(currentScopeResult.scope, originalPair)!;
        const prepared = prepareJevRunPair({
          plannedPair: originalPair,
          scope: originalScope,
          collection: currentCapture.collection,
          cache: this.options.cache,
          noteTransmissionAuthorized: noteAuthorized,
        });
        if (prepared.status === "skip") {
          const noRequiredSignal = prepared.reason === "no-required-signal";
          progress = this.persistOutcome(progress, {
            completedPairs: 1,
            cacheHits: prepared.reason === "both-cached" ? 1 : 0,
            failedPairs: prepared.reason === "both-cached" || noRequiredSignal ? 0 : 1,
          });
          continue;
        }
        if (prepared.status !== "ready") {
          progress = this.persistOutcome(progress, { completedPairs: 1, failedPairs: 1 });
          continue;
        }
        const ready = prepared;
        progress = this.persistOutcome(progress, { cacheMisses: 1 });
        activeAdmission = { pair: currentPair, ready };
        let result: Awaited<ReturnType<JevGateway["evaluatePair"]>>;
        try {
          result = await getGateway().evaluatePair(ready.request, controller.signal);
        } catch (error) {
          activeAdmission = null;
          if (!controller.signal.aborted) {
            progress = this.persistOutcome(progress, { completedPairs: 1, failedPairs: 1 });
            terminalStopReason = terminalStopReasonFor(error);
            if (terminalStopReason) break;
          }
          continue;
        }
        const mapped = mapJevPairResult(ready, result, this.now().toISOString());
        if (!mapped || mapped.length < 1 || mapped.length > 2) {
          activeAdmission = null;
          progress = this.persistOutcome(progress, { completedPairs: 1, failedPairs: 1 });
          continue;
        }
        let checkpointed = false;
        let checkpointStorageFailure = false;
        try {
          checkpointed = await this.checkpointMappedPair({
            originalCapture: capture,
            originalScope,
            originalPair,
            ready,
            mapped,
            controller,
            startedAt,
            getLatest: () => latestCapture,
            setLatest: (next, scope) => {
              latestCapture = next;
              latestScope = scope;
            },
            getLatestScope: () => latestScope,
            getProgress: () => progress,
            setProgress: (next) => {
              progress = next;
            },
            onStorageFailure: () => {
              checkpointStorageFailure = true;
            },
          });
        } catch {
          if (checkpointStorageFailure) throw new Error("Jev cache checkpoint failed");
        } finally {
          activeAdmission = null;
        }
        if (!checkpointed && !controller.signal.aborted)
          progress = this.persistOutcome(progress, { completedPairs: 1, failedPairs: 1 });
      }

      const state: JevRunProgress["state"] = this.stopped(controller, startedAt)
        ? "interrupted"
        : progress.failedPairs
          ? "failed"
          : "completed";
      const terminal = this.nextProgress(progress, {}, state);
      if (state === "failed" && terminalStopReason) terminal.stopReason = terminalStopReason;
      if (state !== "completed") {
        return this.finishTerminal(terminal, controller, startedAt, state);
      }
      return await this.finishWithCurrentCoverage(terminal, capture, controller, startedAt);
    } catch {
      const terminal = this.nextProgress(
        progress,
        {},
        controller.signal.aborted || this.expired(startedAt) ? "interrupted" : "failed",
      );
      try {
        this.options.cache.finishRun({ activation: null, progress: terminal });
      } catch {
        /* preserve fail-closed state */
      }
      return terminal;
    }
  }

  private async refreshForCurrentVector(capture: JevRunCapture): Promise<JevRunCapture> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.options.readCurrent();
      if (current.policyIdentity !== capture.policyIdentity)
        throw new Error("Jev policy changed during run");
      if (current.sourceVectorIdentity === capture.sourceVectorIdentity) return capture;
      const refreshed = await this.options.loadCapture();
      if (refreshed.policyIdentity !== capture.policyIdentity)
        throw new Error("Jev policy changed during source refresh");
      if (refreshed.sourceVectorIdentity === current.sourceVectorIdentity) return refreshed;
    }
    throw new Error("Jev source vector changed repeatedly during refresh");
  }

  private async scopeMatchesCapture(scope: JevRunScope, expected: JevRunScope): Promise<boolean> {
    try {
      if (
        !Object.isFrozen(scope) ||
        !Object.isFrozen(scope.eligibleGameIds) ||
        !Number.isSafeInteger(scope.totalEligiblePairs) ||
        scope.totalEligiblePairs < 0 ||
        scope.totalEligiblePairs > this.maxPairs
      )
        return false;
      if (
        JSON.stringify(scope.eligibleGameIds) !== JSON.stringify(expected.eligibleGameIds) ||
        scope.totalEligiblePairs !== expected.totalEligiblePairs ||
        scope.descriptionBearingPairCount !== expected.descriptionBearingPairCount ||
        scope.ownerNoteBearingPairCount !== expected.ownerNoteBearingPairCount ||
        scope.ownerNoteSignalBlocked !== expected.ownerNoteSignalBlocked ||
        scope.cachedOwnerNoteUse !== expected.cachedOwnerNoteUse
      )
        return false;
      for (const gameId of expected.eligibleGameIds) {
        if (
          JSON.stringify(scope.sourceForGame(gameId)) !==
          JSON.stringify(expected.sourceForGame(gameId))
        )
          return false;
      }
      const expectedPairs = expected.pairs();
      const suppliedPairs = scope.pairs();
      for (let index = 0; index < expected.totalEligiblePairs; index++) {
        const expectedPair = expectedPairs.next();
        const suppliedPair = suppliedPairs.next();
        if (
          expectedPair.done ||
          suppliedPair.done ||
          JSON.stringify(expectedPair.value) !== JSON.stringify(suppliedPair.value)
        )
          return false;
        const pairLookup = scope.pairForIds(expectedPair.value.gameAId, expectedPair.value.gameBId);
        if (JSON.stringify(pairLookup) !== JSON.stringify(expectedPair.value)) return false;
        if ((index & 0xff) === 0) await new Promise<void>((resolve) => setImmediate(resolve));
      }
      return expectedPairs.next().done === true && suppliedPairs.next().done === true;
    } catch {
      return false;
    }
  }

  private async admitAttempt(input: {
    runId: string;
    noteAuthorized: boolean;
    controller: AbortController;
    startedAt: number;
    originalCapture: JevRunCapture;
    originalScope: JevRunScope;
    getLatest: () => JevRunCapture;
    setLatest: (capture: JevRunCapture, scope: JevRunScope) => void;
    getLatestScope: () => JevRunScope;
    pair: JevRunPair;
    ready: ReadyAdmission;
    attempt: JevAttemptAdmission;
  }): Promise<JevDispatchReceipt> {
    for (let refresh = 0; refresh < 3; refresh++) {
      if (this.stopped(input.controller, input.startedAt)) throw new Error("Jev run stopped");
      // A coherent eligibility refresh is required independently for every initial/retry attempt.
      const refreshed = await this.refreshForCurrentVector(input.getLatest());
      const freshScopeResult =
        refreshed === input.getLatest()
          ? { ok: true as const, scope: input.getLatestScope() }
          : this.planScope(refreshed.collection, refreshed.predictionCapture);
      if (
        !freshScopeResult.ok ||
        refreshed.policyIdentity !== input.originalCapture.policyIdentity ||
        !pairForIds(freshScopeResult.scope, input.pair) ||
        !originalSourcesMatch(input.originalScope, input.ready, refreshed.collection)
      )
        throw new Error("Jev pair is no longer eligible or authorized");
      input.setLatest(refreshed, freshScopeResult.scope);
      const result = await this.coordinator.runExclusive(async () => {
        const current = await this.options.readCurrent();
        if (this.stopped(input.controller, input.startedAt)) throw new Error("Jev run stopped");
        if (current.policyIdentity !== input.originalCapture.policyIdentity)
          throw new Error("Jev policy changed before dispatch");
        // A newer unrelated edit raced the fresh capture. Release the lock and recapture instead
        // of rejecting an otherwise unchanged pair.
        if (refreshed.sourceVectorIdentity !== current.sourceVectorIdentity)
          return { retryCapture: true as const };
        if (
          !pairForIds(freshScopeResult.scope, input.pair) ||
          !originalSourcesMatch(input.originalScope, input.ready, current.collection) ||
          (input.ready.dependencyKind !== "C_ONLY" &&
            (!input.noteAuthorized || !current.canTransmitNotes))
        )
          throw new Error("Jev dispatch fenced by current authority");
        return { retryCapture: false as const, receipt: input.attempt.start() };
      });
      if (!result.retryCapture) return result.receipt;
    }
    throw new Error("Jev sources changed repeatedly before dispatch");
  }

  private async finishWithCurrentCoverage(
    terminal: JevRunProgress,
    original: JevRunCapture,
    controller: AbortController,
    startedAt: number,
  ): Promise<JevRunProgress> {
    for (let attempt = 0; attempt <= this.finalCaptureRetries; attempt++) {
      if (this.stopped(controller, startedAt))
        return this.finishTerminal(terminal, controller, startedAt);
      const capture = await this.options.loadCapture();
      if (this.stopped(controller, startedAt))
        return this.finishTerminal(terminal, controller, startedAt);
      if (capture.policyIdentity !== original.policyIdentity)
        return this.finishTerminal(terminal, controller, startedAt, "failed");
      const cacheRevisionBefore = this.options.cache.mutationRevision();
      if (cacheRevisionBefore === null)
        return this.finishTerminal(terminal, controller, startedAt, "failed");
      const digest = computeJevPairCoverage({
        collection: capture.collection,
        predictionCapture: capture.predictionCapture,
        captureIdentity: capture.captureIdentity,
        factualWeights: capture.factualWeights,
        cache: this.options.cache,
      });
      const cacheRevisionAfter = this.options.cache.mutationRevision();
      if (cacheRevisionAfter === null || cacheRevisionAfter !== cacheRevisionBefore) continue;
      const result = await this.coordinator.runExclusive(async () => {
        const current = await this.options.readCurrent();
        if (this.stopped(controller, startedAt))
          return {
            retry: false,
            complete: false,
            persisted: false,
            terminalState: "interrupted" as const,
          };
        if (current.policyIdentity !== original.policyIdentity)
          return {
            retry: false,
            complete: false,
            persisted: false,
            terminalState: "failed" as const,
          };
        if (current.sourceVectorIdentity !== capture.sourceVectorIdentity)
          return {
            retry: true,
            complete: false,
            persisted: false,
            terminalState: "failed" as const,
          };
        const committedRevision = this.options.cache.mutationRevision();
        if (committedRevision === null || committedRevision !== cacheRevisionAfter)
          return {
            retry: true,
            complete: false,
            persisted: false,
            terminalState: "failed" as const,
          };
        const activation = digest.complete
          ? { identity: digest.identity, activatedAt: this.now().toISOString() }
          : null;
        const finalProgress = digest.complete
          ? terminal
          : { ...terminal, state: "failed" as const };
        this.options.cache.finishRun({ activation, progress: finalProgress });
        return {
          retry: false,
          complete: digest.complete,
          persisted: true,
          terminalState: digest.complete ? ("completed" as const) : ("failed" as const),
        };
      });
      if (result.retry) continue;
      if (result.terminalState === "interrupted")
        return this.finishTerminal(terminal, controller, startedAt, "interrupted");
      if (!result.persisted) return this.finishTerminal(terminal, controller, startedAt, "failed");
      return result.complete ? terminal : { ...terminal, state: "failed" };
    }
    return this.finishTerminal(terminal, controller, startedAt, "failed");
  }

  private async finishTerminal(
    progress: JevRunProgress,
    controller: AbortController,
    startedAt: number,
    requestedState?: "failed" | "interrupted",
  ): Promise<JevRunProgress> {
    let terminal = progress;
    await this.coordinator.runExclusive(async () => {
      // The read creates a barrier for cancellation/source mutations; cancellation wins after it.
      await this.options.readCurrent();
      const state = this.stopped(controller, startedAt)
        ? "interrupted"
        : (requestedState ?? "failed");
      terminal = { ...progress, state, updatedAt: this.now().toISOString() };
      if (state !== "failed") delete terminal.stopReason;
      this.options.cache.finishRun({ activation: null, progress: terminal });
    });
    return terminal;
  }

  private async checkpointMappedPair(input: {
    originalCapture: JevRunCapture;
    originalScope: JevRunScope;
    originalPair: JevRunPair;
    ready: ReadyAdmission;
    mapped: NonNullable<ReturnType<typeof mapJevPairResult>>;
    controller: AbortController;
    startedAt: number;
    getLatest: () => JevRunCapture;
    setLatest: (capture: JevRunCapture, scope: JevRunScope) => void;
    getLatestScope: () => JevRunScope;
    getProgress: () => JevRunProgress;
    setProgress: (progress: JevRunProgress) => void;
    onStorageFailure: () => void;
  }): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const checkpointCapture = await this.refreshForCurrentVector(input.getLatest());
      const checkpointPlan =
        checkpointCapture === input.getLatest()
          ? { ok: true as const, scope: input.getLatestScope() }
          : this.planScope(checkpointCapture.collection, checkpointCapture.predictionCapture);
      if (
        checkpointCapture.policyIdentity !== input.originalCapture.policyIdentity ||
        !checkpointPlan.ok ||
        !pairForIds(checkpointPlan.scope, input.originalPair) ||
        !originalSourcesMatch(input.originalScope, input.ready, checkpointCapture.collection)
      )
        return false;
      const result = await this.coordinator.runExclusive(async () => {
        const current = await this.options.readCurrent();
        if (this.stopped(input.controller, input.startedAt)) return { retry: false, saved: false };
        if (current.policyIdentity !== input.originalCapture.policyIdentity)
          return { retry: false, saved: false };
        if (current.sourceVectorIdentity !== checkpointCapture.sourceVectorIdentity)
          return { retry: true, saved: false };
        if (
          !pairForIds(checkpointPlan.scope, input.originalPair) ||
          !originalSourcesMatch(input.originalScope, input.ready, current.collection) ||
          (input.ready.dependencyKind !== "C_ONLY" && !current.canTransmitNotes)
        )
          return { retry: false, saved: false };
        const next = this.nextProgress(input.getProgress(), { completedPairs: 1 });
        try {
          this.options.cache.checkpointPair({
            judgments: tupleJudgments(input.mapped),
            progress: next,
          });
        } catch (error) {
          input.onStorageFailure();
          throw error;
        }
        input.setProgress(next);
        return { retry: false, saved: true };
      });
      if (result.saved) {
        input.setLatest(checkpointCapture, checkpointPlan.scope);
        return true;
      }
      if (!result.retry) return false;
    }
    return false;
  }

  private persistOutcome(
    progress: JevRunProgress,
    delta: Partial<
      Pick<JevRunProgress, "completedPairs" | "cacheHits" | "cacheMisses" | "failedPairs">
    >,
  ): JevRunProgress {
    const next = this.nextProgress(progress, delta);
    this.options.cache.saveRunProgress(next);
    return next;
  }

  private nextProgress(
    progress: JevRunProgress,
    delta: Partial<
      Pick<
        JevRunProgress,
        "pairCount" | "completedPairs" | "cacheHits" | "cacheMisses" | "failedPairs"
      >
    >,
    state: JevRunProgress["state"] = progress.state,
  ): JevRunProgress {
    return {
      ...progress,
      ...Object.fromEntries(
        Object.entries(delta).map(([key, value]) => [
          key,
          (progress[key as keyof JevRunProgress] as number) + (value ?? 0),
        ]),
      ),
      state,
      updatedAt: this.now().toISOString(),
    };
  }

  private stopped(controller: AbortController, startedAt: number): boolean {
    return controller.signal.aborted || this.expired(startedAt);
  }
  private expired(startedAt: number): boolean {
    return this.now().getTime() - startedAt >= this.maxRunMs;
  }
}

function pairForIds(scope: JevRunScope, pair: JevRunPair): JevRunPair | undefined {
  return scope.pairForIds(pair.gameAId, pair.gameBId);
}

function terminalStopReasonFor(error: unknown): JevRunStopReason | undefined {
  if (!(error instanceof JevGatewayError)) return undefined;
  if (error.code === "budget-exhausted") return "provider-limit";
  if (error.code === "not-configured") return "provider-unconfigured";
  return undefined;
}

function sameAuthority(capture: JevRunCapture, current: JevRunCurrentState): boolean {
  return (
    capture.collection.id === current.collection.id &&
    capture.sourceVectorIdentity === current.sourceVectorIdentity &&
    capture.policyIdentity === current.policyIdentity
  );
}

function originalSourcesMatch(
  scope: JevRunScope,
  ready: ReadyAdmission,
  collection: Collection,
): boolean {
  return !jevRunPairSourcesChanged(
    scope,
    collection,
    ready.gameAId,
    ready.gameBId,
    ready.dependencyKind,
  );
}

function tupleJudgments<T>(rows: T[]): [T] | [T, T] {
  if (rows.length === 1) return [rows[0]];
  if (rows.length === 2) return [rows[0], rows[1]];
  throw new TypeError("A Jev checkpoint must contain one or two judgments");
}

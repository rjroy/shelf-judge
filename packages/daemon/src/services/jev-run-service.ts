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
import {
  DEFAULT_JEV_RUN_BUDGET,
  isValidJevRunBudget,
  type JevRunBudget,
} from "./jev-run-budget.js";
import { createLogger, type Logger } from "./logger.js";

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
    providerBudget: Readonly<
      Pick<JevRunBudget, "maxProviderAttempts" | "reportedTokenStopThreshold">
    >,
  ): JevGateway;
  /** Optional instrumentation seam; production defaults to the canonical planner. */
  planScope?: typeof planJevRunScope;
  now?: () => Date;
  maxPairs?: number;
  maxRunMs?: number;
  finalCaptureRetries?: number;
  logger?: Pick<Logger, "log" | "error">;
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
  providerBudget?: Readonly<JevRunBudget>;
}

declare const validatedPreparedRunBrand: unique symbol;
export type ValidatedPreparedJevRun = { readonly [validatedPreparedRunBrand]: true };

interface PreparedRunData {
  capture: JevRunCapture;
  scope: JevRunScope;
  noteTransmissionAuthorized: boolean;
  providerBudget: Readonly<JevRunBudget>;
}

export interface JevRunEffectiveLimits {
  maxEligiblePairs: number;
  maxRunDurationMs: number;
}

const DEFAULT_MAX_PAIRS = 25_000;
const DEFAULT_MAX_RUN_MS = DEFAULT_JEV_RUN_BUDGET.maxRunDurationMs;
const DEFAULT_FINAL_CAPTURE_RETRIES = 2;
const activeRuns = new WeakMap<object, JevRunHandle>();
type ReadyAdmission = Extract<ReturnType<typeof prepareJevRunPair>, { status: "ready" }>;

interface RunControl {
  runId: string;
  controller: AbortController;
  startedAt: number;
  progress: JevRunProgress;
  resolveCompletion(progress: JevRunProgress): void;
  terminalCause?: "cancelled" | "deadline";
  completionSettled: boolean;
  successCommitted: boolean;
  deadlineTimer: ReturnType<typeof setTimeout>;
  terminalPersistenceFailed?: boolean;
}

/** Explicit-start only. Persisted progress is observability, never authority to perform inference. */
export class JevRunService {
  private readonly coordinator: ProfileSourceCoordinator;
  private readonly now: () => Date;
  private readonly maxPairs: number;
  private readonly maxRunMs: number;
  private readonly finalCaptureRetries: number;
  private readonly planScope: typeof planJevRunScope;
  private readonly logger: Pick<Logger, "log" | "error">;
  private readonly preparedRuns = new WeakMap<object, PreparedRunData>();
  private readonly runDurations = new WeakMap<AbortController, number>();
  private readonly deadlineControllers = new WeakSet<AbortController>();
  private readonly runControls = new WeakMap<AbortController, RunControl>();

  constructor(private readonly options: JevRunServiceOptions) {
    this.coordinator = profileSourceCoordinatorFor(options.storageService);
    this.now = options.now ?? (() => new Date());
    this.maxPairs = options.maxPairs ?? DEFAULT_MAX_PAIRS;
    this.maxRunMs = options.maxRunMs ?? DEFAULT_MAX_RUN_MS;
    this.finalCaptureRetries = options.finalCaptureRetries ?? DEFAULT_FINAL_CAPTURE_RETRIES;
    this.planScope = options.planScope ?? planJevRunScope;
    this.logger = options.logger ?? createLogger("jev-run");
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
        const providerBudget = input.providerBudget ?? {
          ...DEFAULT_JEV_RUN_BUDGET,
          maxRunDurationMs: this.maxRunMs,
        };
        if (!isValidJevRunBudget(providerBudget)) return null;
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
          providerBudget: Object.freeze({ ...providerBudget }),
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
    const startedAt = this.now().getTime();
    const duration = prepared?.providerBudget.maxRunDurationMs ?? this.maxRunMs;
    const budget = prepared?.providerBudget ?? {
      ...DEFAULT_JEV_RUN_BUDGET,
      maxRunDurationMs: this.maxRunMs,
    };
    let resolveCompletion!: (progress: JevRunProgress) => void;
    const completion = new Promise<JevRunProgress>((resolve) => {
      resolveCompletion = resolve;
    });
    const control = {
      runId,
      controller,
      startedAt,
      progress: {
        runId,
        state: "running" as const,
        pairCount: 0,
        completedPairs: 0,
        cacheHits: 0,
        cacheMisses: 0,
        failedPairs: 0,
        updatedAt: this.now().toISOString(),
      },
      resolveCompletion,
      completionSettled: false,
      successCommitted: false,
      deadlineTimer: setTimeout(() => this.terminateRun(control, "deadline"), duration),
    } satisfies RunControl;
    control.deadlineTimer.unref?.();
    this.runDurations.set(controller, duration);
    this.runControls.set(controller, control);
    const handle: JevRunHandle = {
      runId,
      completion,
      cancel: () => this.terminateRun(control, "cancelled"),
    };
    activeRuns.set(this.options.storageService, handle);
    try {
      this.logger.log("Jev run started", {
        runId,
        trigger: "owner-explicit",
        authorizedSignalScope: noteAuthorized ? "yes" : "no",
        maxProviderAttempts: budget.maxProviderAttempts,
        reportedTokenStopThreshold: budget.reportedTokenStopThreshold,
        maxRunDurationMs: budget.maxRunDurationMs,
        eligiblePairs: prepared?.scope.totalEligiblePairs ?? null,
      });
    } catch {
      // Lifecycle diagnostics are best-effort and must not strand a reserved Run.
    }
    void runOutsideProfileSourceCoordinator(() =>
      this.execute(control, noteAuthorized, prepared),
    ).then(
      (progress) => this.settleRun(control, progress),
      () => this.settleRun(control, control.progress),
    );
    return handle;
  }

  private terminateRun(control: RunControl, cause: "cancelled" | "deadline"): void {
    if (control.terminalCause || control.completionSettled || control.successCommitted) return;
    control.terminalCause = cause;
    if (cause === "deadline") this.deadlineControllers.add(control.controller);
    control.controller.abort();
    const terminal: JevRunProgress = {
      ...control.progress,
      state: cause === "deadline" ? "failed" : "interrupted",
      updatedAt: this.now().toISOString(),
      ...(cause === "deadline" ? { stopReason: "application-deadline" as const } : {}),
    };
    if (cause !== "deadline") delete terminal.stopReason;
    control.progress = terminal;
    clearTimeout(control.deadlineTimer);
    let terminalPersistenceFailed = false;
    try {
      this.options.cache.finishRun({ activation: null, progress: terminal });
    } catch {
      terminalPersistenceFailed = true;
      // Completion is fail-closed even when terminal status persistence is unavailable.
    }
    control.terminalPersistenceFailed = terminalPersistenceFailed;
    this.settleRun(control, terminal);
  }

  private settleRun(control: RunControl, progress: JevRunProgress): void {
    if (control.completionSettled) return;
    control.completionSettled = true;
    clearTimeout(control.deadlineTimer);
    control.progress = progress;
    control.resolveCompletion(progress);
    const handle = activeRuns.get(this.options.storageService);
    if (handle?.runId === control.runId) activeRuns.delete(this.options.storageService);
    const terminalFields = {
      runId: control.runId,
      state: progress.state,
      stopReason:
        progress.stopReason ?? (control.terminalCause === "cancelled" ? "owner-cancelled" : null),
      completedPairs: progress.completedPairs,
      failedPairs: progress.failedPairs,
      cacheHits: progress.cacheHits,
      durationMs: Math.max(0, this.now().getTime() - control.startedAt),
    };
    try {
      if (control.terminalPersistenceFailed) {
        this.logger.error("Jev run terminal", {
          ...terminalFields,
          persistenceFailureReason: "terminal-status-persistence-failed",
        });
      } else {
        this.logger.log("Jev run terminal", terminalFields);
      }
    } catch {
      // Logging must not affect completion or active-run cleanup.
    }
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
    control: RunControl,
    noteAuthorized: boolean,
    prepared?: PreparedRunData,
  ): Promise<JevRunProgress> {
    const { runId, controller, startedAt } = control;
    const providerBudget = prepared?.providerBudget ?? {
      ...DEFAULT_JEV_RUN_BUDGET,
      maxRunDurationMs: this.maxRunMs,
    };
    let progress = control.progress;
    let capture: JevRunCapture;
    let originalScope: JevRunScope;
    let terminalStopReason: JevRunStopReason | undefined;
    try {
      if (prepared) {
        capture = prepared.capture;
        originalScope = prepared.scope;
      } else {
        capture = await this.options.loadCapture();
        if (!this.runCanContinue(control)) return control.progress;
        const planned = this.planScope(capture.collection, capture.predictionCapture);
        if (!planned.ok) throw new Error("Invalid Jev capture");
        originalScope = planned.scope;
      }
      if (!this.runCanContinue(control)) return control.progress;
      if (originalScope.totalEligiblePairs > this.maxPairs)
        throw new Error("Jev run exceeds configured pair limit");
      progress = this.nextProgress(progress, { pairCount: originalScope.totalEligiblePairs });
      control.progress = progress;
      await this.coordinator.runExclusive(async () => {
        if (!this.runCanContinue(control) || this.stopped(controller, startedAt))
          throw new Error("Jev run stopped");
        const current = await this.options.readCurrent();
        if (!this.runCanContinue(control) || this.stopped(controller, startedAt))
          throw new Error("Jev run stopped");
        if (!sameAuthority(capture, current))
          throw new Error("Jev sources changed before run start");
        this.options.cache.saveRunProgress(progress);
      });
      if (!this.runCanContinue(control)) return control.progress;

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
            control,
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
        }, providerBudget);
        return gateway;
      };

      for (const originalPair of originalScope.pairs()) {
        if (!this.runCanContinue(control) || this.stopped(controller, startedAt)) break;
        const previousCapture = latestCapture;
        const currentCapture = await this.refreshForCurrentVector(previousCapture, control);
        if (!this.runCanContinue(control)) return control.progress;
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
          control.progress = progress;
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
          control.progress = progress;
          continue;
        }
        if (prepared.status !== "ready") {
          progress = this.persistOutcome(progress, { completedPairs: 1, failedPairs: 1 });
          control.progress = progress;
          continue;
        }
        const ready = prepared;
        progress = this.persistOutcome(progress, { cacheMisses: 1 });
        control.progress = progress;
        activeAdmission = { pair: currentPair, ready };
        let result: Awaited<ReturnType<JevGateway["evaluatePair"]>>;
        try {
          result = await getGateway().evaluatePair(ready.request, controller.signal);
        } catch (error) {
          activeAdmission = null;
          if (!this.runCanContinue(control)) return control.progress;
          if (!controller.signal.aborted) {
            progress = this.persistOutcome(progress, { completedPairs: 1, failedPairs: 1 });
            control.progress = progress;
            terminalStopReason = terminalStopReasonFor(error);
            if (terminalStopReason) break;
          }
          continue;
        }
        if (!this.runCanContinue(control)) return control.progress;
        const mapped = mapJevPairResult(ready, result, this.now().toISOString());
        if (!mapped || mapped.length < 1 || mapped.length > 2) {
          activeAdmission = null;
          progress = this.persistOutcome(progress, { completedPairs: 1, failedPairs: 1 });
          control.progress = progress;
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
              control.progress = next;
            },
            onStorageFailure: () => {
              checkpointStorageFailure = true;
            },
            control,
          });
        } catch {
          if (checkpointStorageFailure) throw new Error("Jev cache checkpoint failed");
        } finally {
          activeAdmission = null;
        }
        if (!this.runCanContinue(control)) return control.progress;
        if (!checkpointed && !controller.signal.aborted)
          progress = this.persistOutcome(progress, { completedPairs: 1, failedPairs: 1 });
        control.progress = progress;
        if (checkpointed && result.stopReason) {
          terminalStopReason = result.stopReason;
          break;
        }
      }

      if (!this.runCanContinue(control)) return control.progress;

      const state: JevRunProgress["state"] = this.deadlineReached(controller, startedAt)
        ? "failed"
        : this.stopped(controller, startedAt)
          ? "interrupted"
          : terminalStopReason || progress.failedPairs
            ? "failed"
            : "completed";
      const terminal = this.nextProgress(progress, {}, state);
      if (state === "failed" && terminalStopReason) terminal.stopReason = terminalStopReason;
      if (this.deadlineReached(controller, startedAt)) terminal.stopReason = "application-deadline";
      if (state !== "completed") {
        control.progress = terminal;
        return this.finishTerminal(terminal, controller, startedAt, state, control);
      }
      return await this.finishWithCurrentCoverage(
        terminal,
        capture,
        controller,
        startedAt,
        control,
      );
    } catch {
      if (control.terminalCause) return control.progress;
      const deadlineReached = this.deadlineReached(controller, startedAt);
      const terminal = this.nextProgress(
        progress,
        {},
        deadlineReached ? "failed" : controller.signal.aborted ? "interrupted" : "failed",
      );
      if (deadlineReached) terminal.stopReason = "application-deadline";
      control.progress = terminal;
      let terminalPersistenceFailed = false;
      try {
        if (!control.terminalCause)
          this.options.cache.finishRun({ activation: null, progress: terminal });
      } catch {
        terminalPersistenceFailed = true;
        /* preserve fail-closed state */
      }
      control.terminalPersistenceFailed = terminalPersistenceFailed;
      return terminal;
    }
  }

  private async refreshForCurrentVector(
    capture: JevRunCapture,
    control?: RunControl,
  ): Promise<JevRunCapture> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.options.readCurrent();
      if (control && !this.runCanContinue(control)) throw new Error("Jev run stopped");
      if (current.policyIdentity !== capture.policyIdentity)
        throw new Error("Jev policy changed during run");
      if (current.sourceVectorIdentity === capture.sourceVectorIdentity) return capture;
      const refreshed = await this.options.loadCapture();
      if (control && !this.runCanContinue(control)) throw new Error("Jev run stopped");
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
    control?: RunControl;
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
      if (
        (input.control && !this.runCanContinue(input.control)) ||
        this.stopped(input.controller, input.startedAt)
      )
        throw new Error("Jev run stopped");
      // A coherent eligibility refresh is required independently for every initial/retry attempt.
      const refreshed = await this.refreshForCurrentVector(input.getLatest(), input.control);
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
        if (
          (input.control && !this.runCanContinue(input.control)) ||
          this.stopped(input.controller, input.startedAt)
        )
          throw new Error("Jev run stopped");
        const current = await this.options.readCurrent();
        if (
          (input.control && !this.runCanContinue(input.control)) ||
          this.stopped(input.controller, input.startedAt)
        )
          throw new Error("Jev run stopped");
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
    control: RunControl,
  ): Promise<JevRunProgress> {
    for (let attempt = 0; attempt <= this.finalCaptureRetries; attempt++) {
      if (!this.runCanContinue(control)) return control.progress;
      if (this.stopped(controller, startedAt))
        return this.finishTerminal(terminal, controller, startedAt, undefined, control);
      const capture = await this.options.loadCapture();
      if (!this.runCanContinue(control)) return control.progress;
      if (this.stopped(controller, startedAt))
        return this.finishTerminal(terminal, controller, startedAt, undefined, control);
      if (capture.policyIdentity !== original.policyIdentity)
        return this.finishTerminal(terminal, controller, startedAt, "failed", control);
      const cacheRevisionBefore = this.options.cache.mutationRevision();
      if (cacheRevisionBefore === null)
        return this.finishTerminal(terminal, controller, startedAt, "failed", control);
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
        if (!this.runCanContinue(control) || this.stopped(controller, startedAt))
          return {
            retry: false,
            complete: false,
            persisted: false,
            terminalState: "interrupted" as const,
          };
        const current = await this.options.readCurrent();
        if (!this.runCanContinue(control) || this.stopped(controller, startedAt))
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
        // Activation is only an advisory complete-universe marker. A Run succeeds
        // when its authorized scope completed; unrelated/uncovered pairs do not
        // rewrite that execution outcome as failed.
        control.progress = terminal;
        this.options.cache.finishRun({ activation, progress: terminal });
        control.successCommitted = true;
        return {
          retry: false,
          complete: digest.complete,
          persisted: true,
          terminalState: "completed" as const,
        };
      });
      if (control.terminalCause) return control.progress;
      if (result.retry) continue;
      if (result.terminalState === "interrupted")
        return this.finishTerminal(terminal, controller, startedAt, "interrupted", control);
      if (!result.persisted)
        return this.finishTerminal(terminal, controller, startedAt, "failed", control);
      return terminal;
    }
    return this.finishTerminal(terminal, controller, startedAt, "failed", control);
  }

  private finishTerminal(
    progress: JevRunProgress,
    controller: AbortController,
    startedAt: number,
    requestedState: "failed" | "interrupted" | undefined,
    control: RunControl,
  ): Promise<JevRunProgress> {
    if (control.completionSettled || control.terminalCause)
      return Promise.resolve(control.progress);
    if (this.deadlineReached(controller, startedAt)) return Promise.resolve(control.progress);
    const state = this.stopped(controller, startedAt)
      ? "interrupted"
      : (requestedState ?? "failed");
    const terminal: JevRunProgress = { ...progress, state, updatedAt: this.now().toISOString() };
    if (state !== "failed") delete terminal.stopReason;
    control.progress = terminal;
    let terminalPersistenceFailed = false;
    try {
      this.options.cache.finishRun({ activation: null, progress: terminal });
    } catch {
      terminalPersistenceFailed = true;
      // Completion is fail-closed even when terminal status persistence is unavailable.
    }
    control.terminalPersistenceFailed = terminalPersistenceFailed;
    this.settleRun(control, terminal);
    return Promise.resolve(terminal);
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
    control: RunControl;
  }): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!this.runCanContinue(input.control)) return false;
      const checkpointCapture = await this.refreshForCurrentVector(
        input.getLatest(),
        input.control,
      );
      if (!this.runCanContinue(input.control)) return false;
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
        if (!this.runCanContinue(input.control) || this.stopped(input.controller, input.startedAt))
          return { retry: false, saved: false };
        const current = await this.options.readCurrent();
        if (!this.runCanContinue(input.control) || this.stopped(input.controller, input.startedAt))
          return { retry: false, saved: false };
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
    return controller.signal.aborted || this.expired(startedAt, controller);
  }

  private runCanContinue(control: RunControl): boolean {
    return !control.terminalCause && !control.completionSettled && !control.successCommitted;
  }

  private deadlineReached(controller: AbortController, startedAt: number): boolean {
    return this.deadlineControllers.has(controller) || this.expired(startedAt, controller);
  }
  private expired(startedAt: number, controller: AbortController): boolean {
    const duration = this.runDurations.get(controller) ?? this.maxRunMs;
    if (this.now().getTime() - startedAt < duration) return false;
    this.deadlineControllers.add(controller);
    const control = this.runControls.get(controller);
    if (control) this.terminateRun(control, "deadline");
    else controller.abort();
    return true;
  }
}

function pairForIds(scope: JevRunScope, pair: JevRunPair): JevRunPair | undefined {
  return scope.pairForIds(pair.gameAId, pair.gameBId);
}

function terminalStopReasonFor(error: unknown): JevRunStopReason | undefined {
  if (!(error instanceof JevGatewayError)) return undefined;
  if (error.code === "attempt-limit-exhausted") return "application-attempt-limit";
  if (error.code === "reported-token-threshold") return "application-token-threshold";
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

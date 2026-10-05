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
  createJevRunCollectionLookup,
  jevRunPairSourcesChanged,
  type JevRunCollectionLookup,
  type JevRunScope,
} from "./jev-run-scope.js";
import {
  JevGatewayError,
  type JevAttemptAdmission,
  type JevDispatchReceipt,
  type JevGateway,
  type JevGatewayErrorCode,
} from "./jev/jev-gateway.js";
import {
  DEFAULT_JEV_RUN_BUDGET,
  isValidJevRunBudget,
  type JevRunBudget,
} from "./jev-run-budget.js";
import { createLogger, type Logger } from "./logger.js";
import type { PreparedWishlistRun, FrozenWishlistRunPair } from "./wishlist-run-preparation.js";
import type { PreparedUnifiedRun } from "./unified-jev-run-preparation.js";
import { createWishlistPairReadinessInspector } from "./wishlist-pair-readiness.js";
import {
  encodeOwnedLocalMember,
  encodeWishlistBggMember,
  buildJevPairDependencies,
} from "./jev-pair-identity.js";
import { JEV_JUDGMENT_CONTRACT } from "./jev/jev-judgment-contract.js";

export interface JevRunCapture {
  collection: Collection;
  predictionCapture: readonly GameWithScore[];
  captureIdentity: JevPredictionCaptureIdentity;
  factualWeights: RedundancyComponentWeights;
  sourceVectorIdentity: string;
  policyIdentity: string;
  /** Revision identity for prediction/eligibility inputs, excluding collection write tokens. */
  eligibilityIdentity?: string;
}

export interface JevRunCurrentState {
  collection: Collection;
  sourceVectorIdentity: string;
  policyIdentity: string;
  canTransmitNotes: boolean;
  /** Revision identity for prediction/eligibility inputs, excluding collection write tokens. */
  eligibilityIdentity?: string;
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
  scopeKind?: "collection";
  capture: JevRunCapture;
  scope: JevRunScope;
  noteTransmissionAuthorized: boolean;
  wishlistPreparation?: never;
  unifiedPreparation: PreparedUnifiedRun;
}

export interface JevPreparedWishlistRunInput {
  scopeKind: "wishlist";
  wishlistPreparation: PreparedWishlistRun;
  unifiedPreparation: PreparedUnifiedRun;
  noteTransmissionAuthorized: false;
}

declare const validatedPreparedRunBrand: unique symbol;
export type ValidatedPreparedJevRun = { readonly [validatedPreparedRunBrand]: true };

type PreparedRunData =
  | {
      scopeKind: "collection";
      capture: JevRunCapture;
      scope: JevRunScope;
      noteTransmissionAuthorized: boolean;
      unifiedPreparation: PreparedUnifiedRun;
    }
  | {
      scopeKind: "wishlist";
      wishlistPreparation: PreparedWishlistRun;
      capture: JevRunCapture;
      noteTransmissionAuthorized: false;
      unifiedPreparation: PreparedUnifiedRun;
    };

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

/** Unified prepared execution only; persisted progress never authorizes inference. */
export class JevRunService {
  private readonly coordinator: ProfileSourceCoordinator;
  private readonly now: () => Date;
  private readonly maxPairs: number;
  private readonly maxRunMs: number;
  private readonly finalCaptureRetries: number;
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
    this.logger = options.logger ?? createLogger("jev-run");
  }

  get effectiveLimits(): JevRunEffectiveLimits {
    return { maxEligiblePairs: this.maxPairs, maxRunDurationMs: this.maxRunMs };
  }

  /**
   * Validates and privately owns an already authorized snapshot before the short admission lock.
   * Pair-scope correspondence is checked in bounded asynchronous slices outside the coordinator.
   */
  prepareValidatedPreparedRun(
    input: JevPreparedRunInput | JevPreparedWishlistRunInput,
  ): Promise<ValidatedPreparedJevRun | null> {
    return runOutsideProfileSourceCoordinator(async () => {
      try {
        if (input.scopeKind === "wishlist") {
          const unifiedPreparation = input.unifiedPreparation;
          const providerBudget = unifiedPreparation.run.disclosure.budget;
          if (
            input.noteTransmissionAuthorized !== false ||
            input.wishlistPreparation.scope !== "wishlist" ||
            !(await input.wishlistPreparation.isCurrent()) ||
            unifiedPreparation.scopeKind !== "wishlist" ||
            unifiedPreparation.wishlistPreparation !== input.wishlistPreparation ||
            unifiedPreparation.capture !== input.wishlistPreparation.capture ||
            !unifiedPreparation.isAuthorized() ||
            !(await unifiedPreparation.isSourceCurrent()) ||
            !isValidJevRunBudget(providerBudget) ||
            input.wishlistPreparation.pairs.length > this.maxPairs
          )
            return null;
          const reservation = Object.freeze({});
          this.preparedRuns.set(reservation, {
            scopeKind: "wishlist",
            wishlistPreparation: input.wishlistPreparation,
            capture: input.wishlistPreparation.capture,
            noteTransmissionAuthorized: false,
            unifiedPreparation,
          });
          return reservation as ValidatedPreparedJevRun;
        }
        const capture = structuredClone(input.capture);
        const unifiedPreparation = input.unifiedPreparation;
        if (
          unifiedPreparation.scopeKind !== "collection" ||
          unifiedPreparation.capture !== input.capture ||
          unifiedPreparation.collectionScope !== input.scope ||
          !unifiedPreparation.isAuthorized() ||
          !(await unifiedPreparation.isSourceCurrent())
        )
          return null;
        const providerBudget = unifiedPreparation.run.disclosure.budget;
        if (!isValidJevRunBudget(providerBudget)) return null;
        const scope = input.scope;
        if (scope.totalEligiblePairs > this.maxPairs) return null;
        const reservation = Object.freeze({});
        this.preparedRuns.set(reservation, {
          scopeKind: "collection",
          capture,
          scope,
          noteTransmissionAuthorized: input.noteTransmissionAuthorized,
          unifiedPreparation,
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
    prepared.unifiedPreparation.beginExecution();
    this.preparedRuns.delete(key);
    return this.reserveRun(prepared);
  }

  private reserveRun(prepared: PreparedRunData): JevRunHandle {
    if (activeRuns.has(this.options.storageService)) throw new Error("A Jev run is already active");
    const runId = crypto.randomUUID();
    const controller = new AbortController();
    const startedAt = this.now().getTime();
    const budget = prepared.unifiedPreparation.run.disclosure.budget;
    const duration = budget.maxRunDurationMs;
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
        scope: prepared.scopeKind,
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
        authorizedSignalScope: prepared.noteTransmissionAuthorized ? "yes" : "no",
        maxProviderAttempts: budget.maxProviderAttempts,
        reportedTokenStopThreshold: budget.reportedTokenStopThreshold,
        maxRunDurationMs: budget.maxRunDurationMs,
        eligiblePairs:
          prepared.scopeKind === "collection"
            ? prepared.scope.totalEligiblePairs
            : prepared.wishlistPreparation.pairs.length,
      });
    } catch {
      // Lifecycle diagnostics are best-effort and must not strand a reserved Run.
    }
    void runOutsideProfileSourceCoordinator(() => this.execute(control, prepared)).then(
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

  private async execute(control: RunControl, prepared: PreparedRunData): Promise<JevRunProgress> {
    if (prepared.scopeKind === "wishlist") return this.executeWishlist(control, prepared);
    const { controller, startedAt } = control;
    const noteAuthorized = prepared.noteTransmissionAuthorized;
    const providerBudget = prepared.unifiedPreparation.run.disclosure.budget;
    let progress = control.progress;
    const capture = prepared.capture;
    const originalScope = prepared.scope;
    const unifiedPreparation = prepared.unifiedPreparation;
    let terminalStopReason: JevRunStopReason | undefined;
    try {
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
        if (!(await unifiedPreparation.isSourceCurrent()))
          throw new Error("Jev prepared sources changed before run start");
        if (!this.runCanContinue(control) || this.stopped(controller, startedAt))
          throw new Error("Jev run stopped");
        this.options.cache.saveRunProgress(progress);
      });
      if (!this.runCanContinue(control)) return control.progress;

      let activeAdmission: { ready: ReadyAdmission } | null = null;
      let collectionLookup: JevRunCollectionLookup | undefined;
      const collectionLookupForRun = () =>
        (collectionLookup ??= createJevRunCollectionLookup(capture.collection));
      let gateway: JevGateway | null = null;
      const getGateway = (): JevGateway => {
        if (gateway) return gateway;
        gateway = this.options.createGateway((attempt) => {
          const bound = activeAdmission;
          if (!bound) return Promise.reject(new Error("No active Jev pair admission"));
          return this.admitAttempt({
            noteAuthorized,
            controller,
            control,
            startedAt,
            originalCapture: capture,
            originalScope,
            unifiedPreparation,
            ready: bound.ready,
            attempt,
          });
        }, providerBudget);
        return gateway;
      };

      for (const originalPair of originalScope.pairs()) {
        if (!this.runCanContinue(control) || this.stopped(controller, startedAt)) break;
        await this.refreshForCurrentVector(capture, control, startedAt, unifiedPreparation);
        if (!this.runCanContinue(control)) return control.progress;
        if (this.stopped(controller, startedAt)) break;
        const pairReady = prepareJevRunPair({
          plannedPair: originalPair,
          scope: originalScope,
          collection: capture.collection,
          getCollectionLookup: collectionLookupForRun,
          cache: this.options.cache,
          noteTransmissionAuthorized: noteAuthorized,
        });
        if (pairReady.status === "skip") {
          const noRequiredSignal = pairReady.reason === "no-required-signal";
          progress = this.persistOutcome(progress, {
            completedPairs: 1,
            cacheHits: pairReady.reason === "both-cached" ? 1 : 0,
            failedPairs: pairReady.reason === "both-cached" || noRequiredSignal ? 0 : 1,
          });
          control.progress = progress;
          continue;
        }
        if (pairReady.status !== "ready") {
          progress = this.persistOutcome(progress, { completedPairs: 1, failedPairs: 1 });
          control.progress = progress;
          continue;
        }
        const ready = pairReady;
        progress = this.persistOutcome(progress, { cacheMisses: 1 });
        control.progress = progress;
        activeAdmission = { ready };
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
            this.logger.error("Jev pair outcome", {
              outcome: "pair-failed",
              disposition: terminalStopReason ? "stop" : "continue",
              reason: stablePairFailureReason(error),
            });
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
            ready,
            mapped,
            controller,
            startedAt,
            unifiedPreparation,
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

  /** Executes only the frozen candidate-domain C_ONLY misses authorized by Phase 5a. */
  private async executeWishlist(
    control: RunControl,
    prepared: Extract<PreparedRunData, { scopeKind: "wishlist" }>,
  ): Promise<JevRunProgress> {
    const { controller, startedAt } = control;
    const frozen = prepared.wishlistPreparation;
    let progress = this.nextProgress(control.progress, { pairCount: frozen.pairs.length });
    control.progress = progress;
    let gateway: JevGateway | null = null;
    let active: {
      pair: FrozenWishlistRunPair;
      request: ReadyAdmission;
      proofRequest: import("./wishlist-candidate-read-proof.js").WishlistDescriptionPairRequest;
      cacheHitAtDispatch: { value: boolean };
    } | null = null;
    let stop = false;

    const inspectPair = createWishlistPairReadinessInspector(frozen, this.options.cache);

    const getGateway = (): JevGateway => {
      if (gateway) return gateway;
      gateway = this.options.createGateway(async (attempt) => {
        const bound = active;
        if (!bound) throw new Error("No active wishlist Jev admission");
        return this.coordinator.runExclusive(async () => {
          if (!this.runCanContinue(control) || this.stopped(controller, startedAt))
            throw new Error("Wishlist Jev run stopped");
          if (!(await frozen.isSourceCurrent()))
            throw new Error("Wishlist Jev sources changed before dispatch");
          if (!this.runCanContinue(control) || this.stopped(controller, startedAt))
            throw new Error("Wishlist Jev run stopped");
          const current = inspectPair(bound.pair);
          if (current.state === "current-hit") {
            bound.cacheHitAtDispatch.value = true;
            throw new Error("A valid C_ONLY judgment appeared before dispatch");
          }
          return attempt.start();
        });
      }, prepared.unifiedPreparation.run.disclosure.budget);
      return gateway;
    };

    try {
      if (!this.options.cache.available || !(await frozen.isCurrent()))
        throw new Error("Wishlist Jev preparation became stale before admission");
      await this.coordinator.runExclusive(async () => {
        if (!this.runCanContinue(control) || this.stopped(controller, startedAt))
          throw new Error("Wishlist Jev run stopped");
        if (!(await frozen.isCurrent())) throw new Error("Wishlist Jev preparation became stale");
        if (!this.runCanContinue(control) || this.stopped(controller, startedAt))
          throw new Error("Wishlist Jev run stopped");
        this.options.cache.saveRunProgress(progress);
      });

      for (const pair of frozen.pairs) {
        if (!this.runCanContinue(control) || this.stopped(controller, startedAt)) break;
        const readiness = inspectPair(pair);
        if (readiness.state === "missing-source") {
          progress = this.persistOutcome(progress, { completedPairs: 1, failedPairs: 1 });
          control.progress = progress;
          if (pair.state === "sendable-miss") continue;
          continue;
        }

        let currentHit = false;
        let lookupFailed = false;
        await this.coordinator.runExclusive(async () => {
          if (!this.runCanContinue(control) || this.stopped(controller, startedAt)) return;
          if (!(await frozen.isSourceCurrent())) {
            lookupFailed = true;
            return;
          }
          try {
            currentHit = inspectPair(pair).state === "current-hit";
          } catch {
            lookupFailed = true;
          }
        });
        if (!this.runCanContinue(control)) return control.progress;
        if (lookupFailed) {
          progress = this.persistOutcome(progress, { completedPairs: 1, failedPairs: 1 });
          control.progress = progress;
          stop = true;
          break;
        }
        if (currentHit) {
          progress = this.persistOutcome(progress, { completedPairs: 1, cacheHits: 1 });
          control.progress = progress;
          continue;
        }
        // Transmission authority comes from the frozen preparation, not mutable cache state
        // observed before the coordinated currentness check.
        if (pair.state === "unavailable") {
          progress = this.persistOutcome(progress, { completedPairs: 1 });
          control.progress = progress;
          continue;
        }
        if (pair.state !== "sendable-miss") {
          progress = this.persistOutcome(progress, { completedPairs: 1, failedPairs: 1 });
          control.progress = progress;
          continue;
        }

        const candidateMember = encodeWishlistBggMember(
          frozen.capture.collection.id,
          String(readiness.proofRequest.candidate.bggId),
        );
        const ownedMember = encodeOwnedLocalMember(
          frozen.capture.collection.id,
          readiness.proofRequest.ownedGame.id,
        );
        const dependencies = buildJevPairDependencies(
          "C_ONLY",
          {
            gameId: candidateMember,
            name: readiness.proofRequest.candidate.name,
            description: readiness.proofRequest.candidate.bggSource.description ?? undefined,
          },
          {
            gameId: ownedMember,
            name: readiness.proofRequest.ownedGame.name,
            description: readiness.proofRequest.ownedGame.description ?? undefined,
          },
        );
        const ready: ReadyAdmission = {
          status: "ready",
          request: {
            mode: "description-only",
            gameA: {
              name: readiness.proofRequest.candidate.name,
              bggDescription: readiness.proofRequest.candidate.bggSource.description ?? "",
            },
            gameB: {
              name: readiness.proofRequest.ownedGame.name,
              bggDescription: readiness.proofRequest.ownedGame.description ?? "",
            },
          },
          dependencyKind: "C_ONLY",
          signals: ["C"],
          gameAId: candidateMember,
          gameBId: ownedMember,
          collectionId: frozen.capture.collection.id,
          dependencies,
          contract: JEV_JUDGMENT_CONTRACT,
        };
        progress = this.persistOutcome(progress, { cacheMisses: 1 });
        control.progress = progress;
        const cacheHitAtDispatch = { value: false };
        active = {
          pair,
          request: ready,
          proofRequest: readiness.proofRequest,
          cacheHitAtDispatch,
        };

        let result: Awaited<ReturnType<JevGateway["evaluatePair"]>>;
        try {
          result = await getGateway().evaluatePair(ready.request, controller.signal);
        } catch (error) {
          active = null;
          if (!this.runCanContinue(control)) return control.progress;
          if (cacheHitAtDispatch.value) {
            progress = this.persistOutcome(progress, {
              completedPairs: 1,
              cacheHits: 1,
              cacheMisses: -1,
            });
            control.progress = progress;
            continue;
          }
          progress = this.persistOutcome(progress, { completedPairs: 1, failedPairs: 1 });
          control.progress = progress;
          const reason = terminalStopReasonFor(error);
          if (reason) {
            stop = true;
            progress = { ...progress, stopReason: reason };
            control.progress = progress;
            break;
          }
          continue;
        }
        active = null;
        if (!this.runCanContinue(control)) return control.progress;
        const mapped = mapJevPairResult(ready, result, this.now().toISOString());
        if (!mapped || mapped.length !== 1) {
          progress = this.persistOutcome(progress, { completedPairs: 1, failedPairs: 1 });
          control.progress = progress;
          continue;
        }
        const judgment = {
          ...mapped[0],
          pairDomain: "wishlist-candidate" as const,
          gameAId: pair.gameAId,
          gameBId: pair.gameBId,
        };
        const outcome: { value: "saved" | "hit" | "stale" } = { value: "stale" };
        await this.coordinator.runExclusive(async () => {
          if (!this.runCanContinue(control) || this.stopped(controller, startedAt)) return;
          if (!(await frozen.isSourceCurrent())) return;
          if (!this.runCanContinue(control) || this.stopped(controller, startedAt)) return;
          try {
            if (inspectPair(pair).state === "current-hit") {
              outcome.value = "hit";
              progress = this.nextProgress(progress, { completedPairs: 1, cacheHits: 1 });
              this.options.cache.saveRunProgress(progress);
              control.progress = progress;
              return;
            }
            const next = this.nextProgress(progress, { completedPairs: 1 });
            this.options.cache.checkpointPair({ judgments: [judgment], progress: next });
            progress = next;
            control.progress = next;
            outcome.value = "saved";
          } catch (error) {
            throw new Error("Wishlist Jev checkpoint failed", { cause: error });
          }
        });
        if (!this.runCanContinue(control)) return control.progress;
        if (outcome.value === "stale") {
          progress = this.persistOutcome(progress, { completedPairs: 1, failedPairs: 1 });
          control.progress = progress;
          stop = true;
        }
        if (stop) break;
        if (result.stopReason) {
          stop = true;
          progress = { ...progress, stopReason: result.stopReason };
          control.progress = progress;
          break;
        }
      }

      if (!this.runCanContinue(control)) return control.progress;
      const state: JevRunProgress["state"] = this.deadlineReached(controller, startedAt)
        ? "failed"
        : this.stopped(controller, startedAt)
          ? "interrupted"
          : stop || progress.failedPairs || progress.stopReason
            ? "failed"
            : "completed";
      const terminal = this.nextProgress(progress, {}, state);
      if (state === "completed") {
        await this.coordinator.runExclusive(async () => {
          if (!this.runCanContinue(control) || !(await frozen.isSourceCurrent()))
            throw new Error("Wishlist Jev sources changed at completion");
          if (!this.runCanContinue(control) || this.stopped(controller, startedAt))
            throw new Error("Wishlist Jev run stopped");
          this.options.cache.finishRun({ activation: null, progress: terminal });
          control.successCommitted = true;
        });
      } else {
        this.options.cache.finishRun({ activation: null, progress: terminal });
      }
      return terminal;
    } catch {
      if (control.terminalCause) return control.progress;
      const state = this.deadlineReached(controller, startedAt) ? "failed" : "failed";
      const terminal = this.nextProgress(progress, {}, state);
      control.progress = terminal;
      try {
        if (!control.terminalCause)
          this.options.cache.finishRun({ activation: null, progress: terminal });
      } catch {
        control.terminalPersistenceFailed = true;
      }
      return terminal;
    }
  }

  private async refreshForCurrentVector(
    capture: JevRunCapture,
    control: RunControl,
    startedAt: number,
    unifiedPreparation: PreparedUnifiedRun,
  ): Promise<void> {
    if (!this.runCanContinue(control) || this.stopped(control.controller, startedAt))
      throw new Error("Jev run stopped");
    const current = await this.options.readCurrent();
    if (!this.runCanContinue(control) || this.stopped(control.controller, startedAt))
      throw new Error("Jev run stopped");
    if (!sameAuthority(capture, current)) throw new Error("Frozen Jev sources changed");
    const sourceCurrent = await unifiedPreparation.isSourceCurrent();
    if (!this.runCanContinue(control) || this.stopped(control.controller, startedAt))
      throw new Error("Jev run stopped");
    if (!sourceCurrent) throw new Error("Frozen unified run sources changed");
  }

  private async admitAttempt(input: {
    noteAuthorized: boolean;
    controller: AbortController;
    control: RunControl;
    startedAt: number;
    originalCapture: JevRunCapture;
    originalScope: JevRunScope;
    unifiedPreparation: PreparedUnifiedRun;
    ready: ReadyAdmission;
    attempt: JevAttemptAdmission;
  }): Promise<JevDispatchReceipt> {
    if (!this.runCanContinue(input.control) || this.stopped(input.controller, input.startedAt))
      throw new Error("Jev run stopped");
    await this.refreshForCurrentVector(
      input.originalCapture,
      input.control,
      input.startedAt,
      input.unifiedPreparation,
    );
    if (!this.runCanContinue(input.control) || this.stopped(input.controller, input.startedAt))
      throw new Error("Jev run stopped");
    return this.coordinator.runExclusive(async () => {
      if (!this.runCanContinue(input.control) || this.stopped(input.controller, input.startedAt))
        throw new Error("Jev run stopped");
      const current = await this.options.readCurrent();
      if (!this.runCanContinue(input.control) || this.stopped(input.controller, input.startedAt))
        throw new Error("Jev run stopped");
      if (
        current.policyIdentity !== input.originalCapture.policyIdentity ||
        current.sourceVectorIdentity !== input.originalCapture.sourceVectorIdentity ||
        !originalSourcesMatch(input.originalScope, input.ready, current.collection) ||
        (input.ready.dependencyKind !== "C_ONLY" &&
          (!input.noteAuthorized || !current.canTransmitNotes))
      )
        throw new Error("Jev dispatch fenced by current authority");
      return input.attempt.start();
    });
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
    ready: ReadyAdmission;
    mapped: NonNullable<ReturnType<typeof mapJevPairResult>>;
    controller: AbortController;
    startedAt: number;
    unifiedPreparation: PreparedUnifiedRun;
    getProgress: () => JevRunProgress;
    setProgress: (progress: JevRunProgress) => void;
    onStorageFailure: () => void;
    control: RunControl;
  }): Promise<boolean> {
    if (!this.runCanContinue(input.control)) return false;
    await this.refreshForCurrentVector(
      input.originalCapture,
      input.control,
      input.startedAt,
      input.unifiedPreparation,
    );
    if (!this.runCanContinue(input.control) || this.stopped(input.controller, input.startedAt))
      return false;
    return this.coordinator.runExclusive(async () => {
      if (!this.runCanContinue(input.control) || this.stopped(input.controller, input.startedAt))
        return false;
      const current = await this.options.readCurrent();
      if (!this.runCanContinue(input.control) || this.stopped(input.controller, input.startedAt))
        return false;
      if (
        current.policyIdentity !== input.originalCapture.policyIdentity ||
        current.sourceVectorIdentity !== input.originalCapture.sourceVectorIdentity ||
        !originalSourcesMatch(input.originalScope, input.ready, current.collection) ||
        (input.ready.dependencyKind !== "C_ONLY" && !current.canTransmitNotes)
      )
        return false;
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
      return true;
    });
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

function terminalStopReasonFor(error: unknown): JevRunStopReason | undefined {
  if (!(error instanceof JevGatewayError)) return undefined;
  if (error.code === "attempt-limit-exhausted") return "application-attempt-limit";
  if (error.code === "reported-token-threshold") return "application-token-threshold";
  if (error.code === "budget-exhausted") return "provider-limit";
  if (error.code === "not-configured") return "provider-unconfigured";
  return undefined;
}

function stablePairFailureReason(error: unknown): JevGatewayErrorCode | "provider-failure" {
  return error instanceof JevGatewayError ? error.code : "provider-failure";
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

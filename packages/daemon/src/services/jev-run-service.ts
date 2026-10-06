import type {
  Collection,
  GameWithScore,
  JevRunPublication,
  RedundancyComponentWeights,
  WishlistEntry,
} from "@shelf-judge/shared";
import type {
  JevPairCache,
  JevPairJudgment,
  JevPairKey,
  JevRunProgress,
  JevRunStopReason,
} from "./jev-pair-cache-service.js";
import type { JevPredictionCaptureIdentity } from "./jev-pair-coverage.js";
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
import { validateJevCachedRow } from "./jev-pair-read-proof.js";
import {
  validateWishlistCandidateCOnlyRow,
  type WishlistCandidateMembershipIndex,
} from "./wishlist-candidate-read-proof.js";
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
  parseWishlistCandidateMember,
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
  loadWishlist?(): Promise<readonly WishlistEntry[]>;
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
  completion: Promise<JevRunCompletion>;
  cancel(): void;
}

export type JevRunCompletion = JevRunProgress & { publication: JevRunPublication };

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
  resolveCompletion(progress: JevRunCompletion): void;
  terminalCause?: "cancelled" | "deadline";
  completionSettled: boolean;
  successCommitted: boolean;
  deadlineTimer: ReturnType<typeof setTimeout>;
  terminalPersistenceFailed?: boolean;
  prepared: PreparedRunData;
  finalizationPromise?: Promise<JevRunCompletion>;
  sealCommitted: boolean;
}

interface PendingFinalization {
  progress: JevRunProgress;
  prepared?: PreparedRunData;
  processLocalCompletion?: JevRunCompletion;
}

function completionFromProgress(progress: JevRunProgress): JevRunCompletion | null {
  const publication = progress.publication;
  return publication ? { ...progress, publication } : null;
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
  private readonly pendingFinalizations = new Map<string, PendingFinalization>();
  private readonly retryingFinalizations = new Map<string, Promise<JevRunCompletion | null>>();

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

  /** Volatile terminal observation when durable sealing failed; never a persisted claim. */
  getProcessPendingProgress(): JevRunCompletion | null {
    for (const [runId, pending] of this.pendingFinalizations) {
      if (pending.processLocalCompletion?.publication.outcomePersistence === "unpersisted") {
        const batch = this.getRunBatch();
        if (batch?.runId === runId) return pending.processLocalCompletion;
        this.pendingFinalizations.delete(runId);
      }
    }
    return null;
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
    const initialProgress: JevRunProgress = {
      runId,
      state: "running",
      scope: prepared.scopeKind,
      pairCount: 0,
      completedPairs: 0,
      cacheHits: 0,
      cacheMisses: 0,
      failedPairs: 0,
      updatedAt: this.now().toISOString(),
    };
    const reserveBatch = this.options.cache.reserveRunBatch?.bind(this.options.cache);
    if (
      !reserveBatch ||
      !this.options.cache.checkpointStagedPair ||
      !this.options.cache.lookupForRun ||
      !this.options.cache.stagedSnapshot ||
      !this.options.cache.getRunBatch ||
      !this.options.cache.sealRunBatch ||
      !this.options.cache.promoteRunBatch
    )
      throw new Error("Jev run cache lacks staged publication support");
    reserveBatch(initialProgress);
    prepared.unifiedPreparation.beginExecution();
    let resolveCompletion!: (progress: JevRunCompletion) => void;
    const completion = new Promise<JevRunCompletion>((resolve) => {
      resolveCompletion = resolve;
    });
    const control = {
      runId,
      controller,
      startedAt,
      progress: initialProgress,
      resolveCompletion,
      completionSettled: false,
      successCommitted: false,
      sealCommitted: false,
      prepared,
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
      (progress) => {
        if (!control.completionSettled) void this.finalizeRun(control, progress, prepared);
      },
      () => {
        if (!control.completionSettled)
          void this.finalizeRun(
            control,
            this.nextProgress(control.progress, {}, "failed"),
            prepared,
          );
      },
    );
    return handle;
  }

  private terminateRun(control: RunControl, cause: "cancelled" | "deadline"): void {
    if (control.sealCommitted && !control.completionSettled) {
      const completion = this.pendingCompletion(
        control.progress,
        "validate",
        "sealed",
        "publication-pending",
      );
      this.settleRun(control, completion);
      return;
    }
    if (
      control.terminalCause ||
      control.completionSettled ||
      control.successCommitted ||
      control.sealCommitted
    )
      return;
    control.terminalCause = cause;
    if (cause === "deadline") this.deadlineControllers.add(control.controller);
    control.controller.abort();
    const terminal: JevRunProgress = {
      ...control.progress,
      state: cause === "deadline" ? "failed" : "interrupted",
      updatedAt: this.now().toISOString(),
      ...(cause === "deadline"
        ? { stopReason: "application-deadline" as const }
        : { stopReason: "owner-cancelled" as const }),
    };
    control.progress = terminal;
    clearTimeout(control.deadlineTimer);
    void this.finalizeRun(control, terminal, control.prepared);
  }

  private settleRun(control: RunControl, progress: JevRunCompletion): void {
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
      publication: progress.publication.state,
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

  /** Provider-free startup reconciliation and publication retry. */
  async reconcileInterruptedProgress(): Promise<JevRunProgress | null> {
    if (activeRuns.has(this.options.storageService)) return this.options.cache.getRunProgress();
    const batch = this.getRunBatch();
    if (!batch) {
      const progress = this.options.cache.getRunProgress();
      if (progress?.state !== "running") return progress;
      const interrupted: JevRunProgress = {
        ...progress,
        state: "interrupted",
        updatedAt: this.now().toISOString(),
      };
      try {
        this.options.cache.saveRunProgress(interrupted);
      } catch {
        // Legacy progress has no staged evidence to recover; report the safe interrupted state.
      }
      return interrupted;
    }
    let progress = batch.progress;
    if (batch.state === "active") {
      progress = {
        ...progress,
        state: "interrupted",
        updatedAt: this.now().toISOString(),
      };
      try {
        await this.coordinator.runExclusive(() => Promise.resolve(this.sealRunBatch(progress)));
      } catch {
        const observed: JevRunCompletion = {
          ...progress,
          publication: {
            state: "pending",
            phase: "seal",
            outcomePersistence: "unpersisted",
            reason: "seal-failed",
          },
        };
        this.trackPendingFinalization(batch.runId, progress, undefined, observed);
        return observed;
      }
    }
    return this.publishSealedBatch(batch.runId, progress, undefined);
  }

  /** Explicit provider-free retry for the single unresolved durable batch. */
  retryPublication(runId: string): Promise<JevRunCompletion | null> {
    const active = activeRuns.get(this.options.storageService);
    if (active?.runId === runId) return Promise.resolve(null);
    const concurrent = this.retryingFinalizations.get(runId);
    if (concurrent) return concurrent;
    const pending = this.pendingFinalizations.get(runId);
    const operation = (async () => {
      if (pending) {
        const batch = this.getRunBatch();
        if (!batch || batch.runId !== runId) {
          this.pendingFinalizations.delete(runId);
          const progress = this.options.cache.getRunProgress();
          return progress?.runId === runId ? completionFromProgress(progress) : null;
        }
        if (batch.state === "active") {
          try {
            await this.coordinator.runExclusive(() =>
              Promise.resolve(this.sealRunBatch(pending.progress)),
            );
          } catch {
            const observed = this.pendingCompletion(
              pending.progress,
              "seal",
              "unpersisted",
              "seal-failed",
            );
            this.trackPendingFinalization(runId, pending.progress, pending.prepared, observed);
            return observed;
          }
        }
        const result = await this.publishSealedBatch(runId, pending.progress, pending.prepared);
        if (result.publication.state !== "pending") this.pendingFinalizations.delete(runId);
        return result;
      }
      const batch = this.getRunBatch();
      if (!batch || batch.runId !== runId) {
        const progress = this.options.cache.getRunProgress();
        return progress?.runId === runId ? completionFromProgress(progress) : null;
      }
      let progress = batch.progress;
      if (batch.state === "active") {
        progress = { ...progress, state: "interrupted", updatedAt: this.now().toISOString() };
        try {
          await this.coordinator.runExclusive(() => Promise.resolve(this.sealRunBatch(progress)));
        } catch {
          const observed = this.pendingCompletion(progress, "seal", "unpersisted", "seal-failed");
          this.trackPendingFinalization(runId, progress, undefined, observed);
          return observed;
        }
      }
      return await this.publishSealedBatch(runId, progress, undefined);
    })();
    this.retryingFinalizations.set(runId, operation);
    void operation.finally(() => {
      if (this.retryingFinalizations.get(runId) === operation)
        this.retryingFinalizations.delete(runId);
    });
    return operation;
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
          cache: { lookup: (key) => this.lookupForRun(control.runId, key) },
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
        return await this.finalizeRun(control, terminal, prepared);
      }
      return await this.finalizeRun(control, terminal, prepared);
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
      return this.finalizeRun(control, terminal, prepared);
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

    const inspectPair = createWishlistPairReadinessInspector(frozen, {
      lookup: (key) => this.lookupForRun(control.runId, key),
    });

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
            this.checkpointStaged(control.runId, [judgment], next);
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
      return this.finalizeRun(control, terminal, prepared);
    } catch {
      if (control.terminalCause) return control.progress;
      const state = this.deadlineReached(controller, startedAt) ? "failed" : "failed";
      const terminal = this.nextProgress(progress, {}, state);
      control.progress = terminal;
      return this.finalizeRun(control, terminal, prepared);
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

  private finalizeRun(
    control: RunControl,
    proposed: JevRunProgress,
    prepared: PreparedRunData,
  ): Promise<JevRunCompletion> {
    if (control.finalizationPromise) return control.finalizationPromise;
    let terminal = proposed;
    clearTimeout(control.deadlineTimer);
    control.finalizationPromise = (async () => {
      try {
        const executionOutcome = control.terminalCause
          ? control.terminalCause === "cancelled"
            ? {
                ...control.progress,
                state: "interrupted" as const,
                stopReason: "owner-cancelled" as const,
              }
            : {
                ...control.progress,
                state: "failed" as const,
                stopReason: "application-deadline" as const,
              }
          : proposed;
        terminal = { ...executionOutcome, updatedAt: this.now().toISOString() };
        control.progress = terminal;
        this.sealRunBatch(terminal);
        control.sealCommitted = true;
        if (control.terminalCause) {
          const pending = this.pendingCompletion(
            terminal,
            "validate",
            "sealed",
            "publication-pending",
          );
          this.trackPendingFinalization(control.runId, terminal, prepared, pending);
          this.settleRun(control, pending);
          void this.publishSealedBatch(control.runId, terminal, prepared).then((result) => {
            if (result.publication.state === "pending")
              this.trackPendingFinalization(control.runId, terminal, prepared, result);
            else this.pendingFinalizations.delete(control.runId);
          });
          return pending;
        }
        const result = await this.publishSealedBatch(control.runId, terminal, prepared);
        if (result.publication.state === "pending")
          this.trackPendingFinalization(control.runId, terminal, prepared, result);
        else this.pendingFinalizations.delete(control.runId);
        this.settleRun(control, result);
        return result;
      } catch {
        const sealed = control.sealCommitted;
        const result = this.pendingCompletion(
          terminal,
          sealed ? "validate" : "seal",
          sealed ? "sealed" : "unpersisted",
          sealed ? "publication-pending" : "seal-failed",
        );
        this.trackPendingFinalization(control.runId, terminal, prepared, result);
        control.terminalPersistenceFailed = !sealed;
        this.settleRun(control, result);
        return result;
      }
    })();
    return control.finalizationPromise;
  }

  private getRunBatch() {
    return this.options.cache.getRunBatch?.() ?? null;
  }

  private sealRunBatch(progress: JevRunProgress): void {
    const seal = this.options.cache.sealRunBatch?.bind(this.options.cache);
    if (!seal) throw new Error("Jev cache cannot seal run batches");
    seal(progress);
  }

  private lookupForRun(runId: string, key: JevPairKey): JevPairJudgment | null {
    const lookup = this.options.cache.lookupForRun?.bind(this.options.cache);
    if (!lookup) throw new Error("Jev cache cannot read run-owned staging");
    return lookup(runId, key);
  }

  private checkpointStaged(
    runId: string,
    judgments: [JevPairJudgment] | [JevPairJudgment, JevPairJudgment],
    progress: JevRunProgress,
  ): void {
    const checkpoint = this.options.cache.checkpointStagedPair?.bind(this.options.cache);
    if (!checkpoint) throw new Error("Jev cache cannot stage run judgments");
    checkpoint({ judgments, progress: { ...progress, runId } });
  }

  private pendingCompletion(
    progress: JevRunProgress,
    phase: "seal" | "validate" | "promote",
    outcomePersistence: "sealed" | "unpersisted",
    reason: string,
  ): JevRunCompletion {
    const completion: JevRunCompletion = {
      ...progress,
      publication: { state: "pending", phase, outcomePersistence, reason },
    };
    if (outcomePersistence === "sealed") {
      try {
        this.options.cache.saveSealedRunProgressIfOwned?.(completion);
      } catch {
        // The immutable execution outcome is already durable in the seal; publication remains pending.
      }
    }
    return completion;
  }

  private trackPendingFinalization(
    runId: string,
    progress: JevRunProgress,
    prepared: PreparedRunData | undefined,
    processLocalCompletion?: JevRunCompletion,
  ): void {
    if (this.getRunBatch()?.runId !== runId) {
      this.pendingFinalizations.delete(runId);
      return;
    }
    this.pendingFinalizations.set(runId, { progress, prepared, processLocalCompletion });
  }

  private async publishSealedBatch(
    runId: string,
    progress: JevRunProgress,
    prepared?: PreparedRunData,
  ): Promise<JevRunCompletion> {
    for (let attempt = 0; attempt <= this.finalCaptureRetries; attempt++) {
      try {
        const existingBatch = this.getRunBatch();
        if (!existingBatch) {
          const existingProgress = this.options.cache.getRunProgress();
          if (existingProgress?.runId === runId) {
            const completed = completionFromProgress(existingProgress);
            if (completed && completed.publication.state !== "pending") return completed;
          }
        }
        const batch = this.getRunBatch();
        const snapshot = this.options.cache.stagedSnapshot?.(runId);
        if (!batch || batch.runId !== runId || batch.state !== "sealed" || !snapshot)
          return this.pendingCompletion(progress, "validate", "sealed", "staging-unavailable");
        if (snapshot.judgments.length === 0) {
          const emptyPromotion = await this.coordinator.runExclusive(() =>
            Promise.resolve(
              (() => {
                const latestBatch = this.getRunBatch();
                const latestSnapshot = this.options.cache.stagedSnapshot?.(runId);
                if (
                  !latestBatch ||
                  latestBatch.runId !== runId ||
                  latestBatch.state !== "sealed" ||
                  !latestSnapshot ||
                  latestSnapshot.revision !== snapshot.revision
                )
                  return null;
                return (
                  this.options.cache.promoteRunBatch?.({
                    runId,
                    expectedStagingRevision: snapshot.revision,
                    eligibleJudgments: [],
                    progress,
                  }) ?? null
                );
              })(),
            ),
          );
          if (emptyPromotion) return emptyPromotion.progress as JevRunCompletion;
          continue;
        }
        const capture = await this.options.loadCapture();
        const promoted = await this.coordinator.runExclusive(async () => {
          const current = await this.options.readCurrent();
          const wishlist = snapshot.judgments.some((row) => row.pairDomain === "wishlist-candidate")
            ? await this.options.loadWishlist?.()
            : undefined;
          const currentBatch = this.getRunBatch();
          const currentSnapshot = this.options.cache.stagedSnapshot?.(runId);
          if (
            !sameAuthority(capture, current) ||
            !currentBatch ||
            currentBatch.runId !== runId ||
            currentBatch.state !== "sealed" ||
            !currentSnapshot ||
            currentSnapshot.revision !== snapshot.revision
          )
            return null;
          const eligible =
            prepared && capture.policyIdentity !== prepared.capture.policyIdentity
              ? []
              : this.validateStagedRows(
                  snapshot.judgments,
                  { ...capture, collection: current.collection },
                  prepared,
                  wishlist,
                );
          const permitted = current.canTransmitNotes
            ? eligible
            : eligible.filter((row) => row.dependencyKind === "C_ONLY");
          const promote = this.options.cache.promoteRunBatch?.bind(this.options.cache);
          if (!promote) throw new Error("Jev cache cannot promote run batches");
          return promote({
            runId,
            expectedStagingRevision: snapshot.revision,
            eligibleJudgments: permitted,
            progress,
          });
        });
        if (promoted) {
          return {
            ...promoted.progress,
            publication: promoted.progress.publication ?? {
              state: promoted.status === "unchanged" ? "unchanged" : "published",
              outcomePersistence: "finalized",
            },
          };
        }
      } catch {
        // Keep sealed evidence and retry provider-free at the next explicit opportunity.
      }
    }
    return this.pendingCompletion(progress, "validate", "sealed", "source-or-stage-changed");
  }

  private validateStagedRows(
    rows: readonly JevPairJudgment[],
    capture: JevRunCapture,
    prepared?: PreparedRunData,
    wishlist?: readonly WishlistEntry[],
  ): JevPairJudgment[] {
    const eligible: JevPairJudgment[] = [];
    const lookup = createJevRunCollectionLookup(capture.collection);
    const candidates = new Map((wishlist ?? []).map((entry) => [entry.bggId, entry]));
    const ownedIds = new Set(capture.collection.games.map((game) => game.id));
    const membership: WishlistCandidateMembershipIndex = {
      candidateBggIds: new Set(candidates.keys()),
      eligibleOwnedIds: ownedIds,
    };
    for (const row of rows) {
      if (row.pairDomain === "wishlist-candidate") {
        const memberA = parseWishlistCandidateMember(row.gameAId);
        const memberB = parseWishlistCandidateMember(row.gameBId);
        const candidate = memberA?.kind === "wishlist-bgg" ? memberA : memberB;
        const owned = memberA?.kind === "owned-local" ? memberA : memberB;
        if (
          !candidate ||
          candidate.kind !== "wishlist-bgg" ||
          candidate.collectionId !== capture.collection.id ||
          !owned ||
          owned.kind !== "owned-local" ||
          owned.collectionId !== capture.collection.id
        )
          continue;
        const entry = candidates.get(Number(candidate.bggId));
        const game = lookup.gameForId(owned.localGameId);
        if (!entry?.bggSource || !game || !wishlist) continue;
        if (
          prepared?.scopeKind === "wishlist" &&
          !prepared.wishlistPreparation.pairs.some(
            (pair) =>
              (pair.gameAId === row.gameAId && pair.gameBId === row.gameBId) ||
              (pair.gameAId === row.gameBId && pair.gameBId === row.gameAId),
          )
        )
          continue;
        const pair = {
          candidate: { bggId: entry.bggId, name: entry.name, bggSource: entry.bggSource },
          ownedGame: {
            id: game.id,
            bggId: game.bggId,
            name: game.name,
            description: game.bggData?.description ?? null,
          },
        };
        if (validateWishlistCandidateCOnlyRow(row, capture.collection.id, pair, membership).valid)
          eligible.push(row);
        continue;
      }
      const gameA = lookup.gameForId(row.gameAId);
      const gameB = lookup.gameForId(row.gameBId);
      if (!gameA || !gameB) continue;
      if (prepared?.scopeKind === "collection") {
        const pair = prepared.scope.pairForIds(row.gameAId, row.gameBId);
        if (!pair) continue;
        const kind = row.dependencyKind;
        if (
          jevRunPairSourcesChanged(
            prepared.scope,
            capture.collection,
            row.gameAId,
            row.gameBId,
            kind,
          )
        )
          continue;
      }
      if (
        (row.dependencyKind === "D_ONLY" || row.dependencyKind === "SHARED_CD") &&
        capture.collection.semanticRedundancy.settings.cachedOwnerNoteUse !== true
      )
        continue;
      const proof = validateJevCachedRow(row, capture.collection, gameA, gameB, row.signal);
      if (proof.valid) eligible.push(row);
    }
    return eligible;
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
        this.checkpointStaged(input.control.runId, tupleJudgments(input.mapped), next);
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

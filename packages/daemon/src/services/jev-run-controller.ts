import { randomBytes, randomUUID } from "node:crypto";
import type {
  Collection,
  JevRunPreviewBase,
  JevWishlistCandidateSelection,
  JevWishlistRunPreview,
  RedundancySettings,
} from "@shelf-judge/shared";
import type { JevPairCache } from "./jev-pair-cache-service.js";
import type { JevRunCapture, JevRunHandle, JevRunService } from "./jev-run-service.js";
import type { JevRunSourceAdapter } from "./jev-run-source-adapter.js";
import type { UnifiedScoringService } from "./unified-scoring-service.js";
import { prepareUnifiedJevRun, type PreparedUnifiedRun } from "./unified-jev-run-preparation.js";
import type {
  PreparedWishlistRun,
  WishlistRunPreparationService,
} from "./wishlist-run-preparation.js";
import {
  createJevRunCollectionLookup,
  planJevRunScope,
  type JevRunCollectionLookup,
  type JevRunScope,
} from "./jev-run-scope.js";
import { prepareJevRunPair } from "./jev-run-pair.js";
import {
  JEV_GATEWAY_LIMITS,
  JEV_MODEL_ID,
  JEV_RETENTION_CAVEAT,
  isJevGatewayConfigured,
} from "./jev/jev-gateway.js";
import {
  canonicalSha256,
  profileSourceCoordinatorFor,
  runOutsideProfileSourceCoordinator,
} from "./profile-source-coordinator.js";
import {
  DEFAULT_JEV_RUN_BUDGET,
  isValidJevRunBudget,
  type JevRunBudget,
} from "./jev-run-budget.js";

const DEFAULT_PRECONDITION_TTL_MS = 2 * 60_000;
const DEFAULT_RECEIPT_TTL_MS = 10 * 60_000;
const MAX_RECEIPTS = 256;

export type JevRunControllerPreview = JevRunPreviewBase;
export type JevWishlistRunControllerPreview = JevWishlistRunPreview;

interface ControllerErrorBody {
  error:
    | "status-unavailable"
    | "run-unavailable"
    | "precondition-failed"
    | "run-conflict"
    | "scope-over-limit"
    | "run-not-found"
    | "invalid-budget";
}

export type JevRunControllerPreviewResponse =
  | { status: 200; body: JevRunControllerPreview | JevWishlistRunControllerPreview }
  | { status: 400 | 409 | 412 | 503; body: ControllerErrorBody };

export type JevRunControllerStartResponse =
  | { status: 200; body: { state: "started"; runId: string } }
  | { status: 409 | 412 | 503; body: ControllerErrorBody };

export type JevRunControllerCancelResponse =
  | { status: 200; body: { state: "cancellation-requested" } }
  | { status: 404 | 409; body: ControllerErrorBody };

interface AuthorizationRecord {
  requestId: string;
  precondition: string;
  sourceVectorIdentity: string;
  policyIdentity: string;
  scopeIdentity: string;
  limitsIdentity: string;
  providerBudget: Readonly<JevRunBudget>;
  expiresAtMs: number;
  consumed: boolean;
  scopeKind: "collection" | "wishlist";
  wishlistPreparation?: PreparedWishlistRun;
  unifiedPreparation?: PreparedUnifiedRun;
}

interface Receipt {
  fingerprint: string;
  promise: Promise<JevRunControllerStartResponse>;
  expiresAtMs: number;
  state: "pending" | "active" | "replay";
}

export interface JevRunControllerStorage {
  loadRedundancySettings(): Promise<RedundancySettings>;
}

/** Process-local explicit disclosure/precondition/idempotency boundary; it never persists authorization. */
export class JevRunController {
  private readonly coordinator;
  private readonly authorizations = new Map<string, AuthorizationRecord>();
  private readonly receipts = new Map<string, Receipt>();
  private activeHandle: JevRunHandle | null = null;
  private activeRunScope: {
    handle: JevRunHandle;
    scope: "collection" | "wishlist";
  } | null = null;

  constructor(
    private readonly options: {
      storageService: JevRunControllerStorage & object;
      sourceAdapter: JevRunSourceAdapter;
      cache: JevPairCache;
      runService: JevRunService;
      now?: () => Date;
      preconditionTtlMs?: number;
      receiptTtlMs?: number;
      gatewayConfigured?: () => boolean;
      wishlistPreparation?: Pick<WishlistRunPreparationService, "prepare" | "hydrateSources">;
      unifiedScoringService?: UnifiedScoringService;
      maxReceipts?: number;
    },
  ) {
    this.coordinator = profileSourceCoordinatorFor(options.storageService);
  }

  async preview(
    budget: JevRunBudget = DEFAULT_JEV_RUN_BUDGET,
  ): Promise<JevRunControllerPreviewResponse> {
    if (!isValidJevRunBudget(budget)) return { status: 400, body: { error: "invalid-budget" } };
    if (!this.cacheAvailable()) return { status: 503, body: { error: "run-unavailable" } };
    if (this.options.unifiedScoringService) return this.previewUnifiedCollection(budget);
    let capture: JevRunCapture;
    try {
      capture = await runOutsideProfileSourceCoordinator(() =>
        this.options.sourceAdapter.loadCapture(),
      );
    } catch {
      return { status: 503, body: { error: "status-unavailable" } };
    }
    const planned = planJevRunScope(capture.collection, capture.predictionCapture);
    if (!planned.ok) return { status: 503, body: { error: "status-unavailable" } };
    const scope = planned.scope;
    const providerBudget = Object.freeze({ ...budget });
    const limits = this.limitsIdentity(providerBudget);
    const scopeIdentity = this.scopeIdentity(capture, scope);
    const authority = await this.readCurrentAuthority();
    if (!authority) return { status: 503, body: { error: "status-unavailable" } };
    if (!this.enabled(capture.collection, authority.redundancySettings))
      return { status: 503, body: { error: "run-unavailable" } };
    if (
      authority.source.sourceVectorIdentity !== capture.sourceVectorIdentity ||
      authority.source.policyIdentity !== capture.policyIdentity
    )
      return { status: 412, body: { error: "precondition-failed" } };
    if (authority.cacheRevision === null)
      return { status: 503, body: { error: "run-unavailable" } };

    this.expireRecords();
    const now = this.now();
    const requestId = randomUUID();
    const expiresAtMs = now.getTime() + this.preconditionTtlMs();
    const precondition = randomBytes(32).toString("base64url");
    this.authorizations.set(precondition, {
      requestId,
      precondition,
      sourceVectorIdentity: capture.sourceVectorIdentity,
      policyIdentity: capture.policyIdentity,
      scopeIdentity,
      limitsIdentity: limits.identity,
      providerBudget,
      expiresAtMs,
      consumed: false,
      scopeKind: "collection",
    });
    this.trimAuthorizations();
    const semantic = capture.collection.semanticRedundancy.settings;
    return {
      status: 200,
      body: {
        requestId,
        precondition,
        provider: "TypeSafe",
        modelId: JEV_MODEL_ID,
        eligibleGameCount: scope.eligibleGameIds.length,
        pairCount: scope.totalEligiblePairs,
        descriptionBearingPairCount: scope.descriptionBearingPairCount,
        noteBearingPairCount: scope.ownerNoteBearingPairCount,
        noteTransmissionPermitted: authority.source.canTransmitNotes,
        providerConfigured: this.isGatewayConfigured(),
        signalScope: {
          description: semantic.enabled && semantic.weights.description > 0,
          ownerNotes: semantic.enabled && semantic.weights.ownerNote > 0,
        },
        scoringEffect:
          authority.redundancySettings.stage === "integrated" &&
          (semantic.weights.description > 0 || semantic.weights.ownerNote > 0)
            ? "integrated-fitness"
            : "annotation-only",
        retentionCaveat: JEV_RETENTION_CAVEAT,
        limits: {
          maxEligiblePairs: limits.run.maxEligiblePairs,
          maxProviderAttempts: providerBudget.maxProviderAttempts,
          maxRetriesPerEvaluation: JEV_GATEWAY_LIMITS.maxRetriesPerEvaluation,
          maxRunDurationMs: providerBudget.maxRunDurationMs,
          reportedTokenStopThreshold: providerBudget.reportedTokenStopThreshold,
          reportedTokenThresholdIsBilledCeiling: false,
        },
        withinPairLimit: scope.totalEligiblePairs <= limits.run.maxEligiblePairs,
        expiresAt: new Date(expiresAtMs).toISOString(),
      },
    };
  }

  /** Internal wishlist preview boundary. Public route selection is wired in Phase 6. */
  async previewWishlist(
    selection?: JevWishlistCandidateSelection,
    budget: JevRunBudget = DEFAULT_JEV_RUN_BUDGET,
  ): Promise<JevRunControllerPreviewResponse> {
    if (!isValidJevRunBudget(budget)) return { status: 400, body: { error: "invalid-budget" } };
    if (!this.options.wishlistPreparation)
      return { status: 503, body: { error: "run-unavailable" } };
    if (this.options.unifiedScoringService) return this.previewUnifiedWishlist(selection, budget);

    let prepared: PreparedWishlistRun;
    try {
      prepared = await this.options.wishlistPreparation.prepare(selection);
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      if (code === "invalid-selection")
        return { status: 400, body: { error: "precondition-failed" } };
      if (code === "scope-changed") return { status: 412, body: { error: "precondition-failed" } };
      return { status: 503, body: { error: "status-unavailable" } };
    }
    if (!(await prepared.isCurrent()))
      return { status: 412, body: { error: "precondition-failed" } };
    if (
      prepared.disclosure.comparisonPairCount >
      this.options.runService.effectiveLimits.maxEligiblePairs
    )
      return { status: 409, body: { error: "scope-over-limit" } };

    const now = this.now();
    const requestId = randomUUID();
    const expiresAtMs = now.getTime() + this.preconditionTtlMs();
    const precondition = randomBytes(32).toString("base64url");
    const providerBudget = Object.freeze({ ...budget });
    const limits = this.limitsIdentity(providerBudget);
    const publication = await this.coordinator.runExclusive(async () => {
      if (!(await prepared.isCurrent())) return { status: 412 as const };
      const currentAuthority = await this.readCurrentAuthority();
      if (!currentAuthority) return { status: 503 as const };
      if (!this.enabled(prepared.capture.collection, currentAuthority.redundancySettings))
        return { status: 503 as const };
      if (
        currentAuthority.source.policyIdentity !== prepared.capture.policyIdentity ||
        (prepared.cacheRevision !== null &&
          currentAuthority.cacheRevision !== prepared.cacheRevision)
      )
        return { status: 412 as const };

      this.expireRecords();
      this.authorizations.set(precondition, {
        requestId,
        precondition,
        sourceVectorIdentity: prepared.capture.sourceVectorIdentity,
        policyIdentity: prepared.capture.policyIdentity,
        scopeIdentity: prepared.identity,
        limitsIdentity: limits.identity,
        providerBudget,
        expiresAtMs,
        consumed: false,
        scopeKind: "wishlist",
        wishlistPreparation: prepared,
      });
      this.trimAuthorizations();
      return { status: 200 as const, authority: currentAuthority };
    });
    if (publication.status === 412) return { status: 412, body: { error: "precondition-failed" } };
    if (publication.status === 503) return { status: 503, body: { error: "status-unavailable" } };
    const authority = publication.authority;

    const semantic = prepared.capture.collection.semanticRedundancy.settings;
    const body: JevWishlistRunControllerPreview = {
      requestId,
      precondition,
      provider: "TypeSafe",
      modelId: JEV_MODEL_ID,
      eligibleGameCount: prepared.disclosure.eligibleCandidateCount,
      pairCount: prepared.disclosure.sendablePairCount,
      descriptionBearingPairCount:
        prepared.disclosure.sendablePairCount + prepared.disclosure.cachedHitPairCount,
      noteBearingPairCount: 0,
      noteTransmissionPermitted: false,
      providerConfigured: this.isGatewayConfigured(),
      signalScope: {
        description: semantic.enabled && semantic.weights.description > 0,
        ownerNotes: false,
      },
      scoringEffect:
        authority.redundancySettings.stage === "integrated" && semantic.weights.description > 0
          ? "integrated-fitness"
          : "annotation-only",
      retentionCaveat: JEV_RETENTION_CAVEAT,
      limits: {
        maxEligiblePairs: limits.run.maxEligiblePairs,
        maxProviderAttempts: providerBudget.maxProviderAttempts,
        maxRetriesPerEvaluation: JEV_GATEWAY_LIMITS.maxRetriesPerEvaluation,
        maxRunDurationMs: providerBudget.maxRunDurationMs,
        reportedTokenStopThreshold: providerBudget.reportedTokenStopThreshold,
        reportedTokenThresholdIsBilledCeiling: false,
      },
      withinPairLimit: prepared.disclosure.comparisonPairCount <= limits.run.maxEligiblePairs,
      expiresAt: new Date(expiresAtMs).toISOString(),
      scope: prepared.disclosure,
      selection: prepared.selection,
      unavailableCandidateBggIds: prepared.unavailableCandidateBggIds,
    };
    return { status: 200, body };
  }

  start(input: {
    requestId: string;
    precondition: string;
    noteTransmissionAuthorized: boolean;
  }): Promise<JevRunControllerStartResponse> {
    if (
      !validRequestId(input.requestId) ||
      typeof input.precondition !== "string" ||
      input.precondition.length > 256 ||
      typeof input.noteTransmissionAuthorized !== "boolean"
    )
      return Promise.resolve({ status: 412, body: { error: "precondition-failed" } });
    this.expireRecords();
    const fingerprint = canonicalSha256({
      precondition: input.precondition,
      noteTransmissionAuthorized: input.noteTransmissionAuthorized,
    });
    const existing = this.receipts.get(input.requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        return Promise.resolve({ status: 409, body: { error: "run-conflict" } });
      return existing.promise;
    }
    const authorization = this.authorizations.get(input.precondition);
    if (
      !authorization ||
      authorization.requestId !== input.requestId ||
      authorization.expiresAtMs <= this.now().getTime()
    )
      return Promise.resolve({ status: 412, body: { error: "precondition-failed" } });
    if (this.receipts.size >= this.maxReceipts())
      return Promise.resolve({ status: 503, body: { error: "run-unavailable" } });
    const receipt: Receipt = {
      fingerprint,
      promise: Promise.resolve({ status: 503, body: { error: "run-unavailable" } }),
      expiresAtMs: this.now().getTime() + this.receiptTtlMs(),
      state: "pending",
    };
    this.receipts.set(input.requestId, receipt);
    receipt.promise = this.startPrepared(input).then(
      (response) => {
        if (response.status !== 200) {
          if (this.receipts.get(input.requestId) === receipt) this.receipts.delete(input.requestId);
        } else if (receipt.state !== "active") {
          receipt.state = "replay";
          receipt.expiresAtMs = this.now().getTime() + this.receiptTtlMs();
        }
        return response;
      },
      () => {
        if (this.receipts.get(input.requestId) === receipt) this.receipts.delete(input.requestId);
        return { status: 503, body: { error: "run-unavailable" } };
      },
    );
    return receipt.promise;
  }

  cancel(input: { runId: string }): JevRunControllerCancelResponse {
    if (!input || typeof input.runId !== "string" || input.runId.length > 100)
      return { status: 404, body: { error: "run-not-found" } };
    const active = this.activeHandle;
    if (!active || active.runId !== input.runId)
      return { status: 409, body: { error: "run-conflict" } };
    active.cancel();
    return { status: 200, body: { state: "cancellation-requested" } };
  }

  /** Returns process-local live run identity; durable progress is not run authority. */
  activeRun(): { runId: string; scope?: "collection" | "wishlist" } | null {
    const active = this.activeHandle;
    if (!active) return null;
    const scope = this.activeRunScope?.handle === active ? this.activeRunScope.scope : undefined;
    return { runId: active.runId, ...(scope ? { scope } : {}) };
  }

  private async startPrepared(input: {
    requestId: string;
    precondition: string;
    noteTransmissionAuthorized: boolean;
  }): Promise<JevRunControllerStartResponse> {
    const authorization = this.authorizations.get(input.precondition);
    if (
      !authorization ||
      authorization.requestId !== input.requestId ||
      authorization.expiresAtMs <= this.now().getTime() ||
      authorization.precondition !== input.precondition
    )
      return { status: 412, body: { error: "precondition-failed" } };
    if (authorization.consumed) return { status: 409, body: { error: "run-conflict" } };
    if (authorization.unifiedPreparation)
      return this.startUnifiedPrepared(input, authorization, authorization.unifiedPreparation);
    if (authorization.scopeKind === "wishlist") {
      const prepared = authorization.wishlistPreparation;
      if (input.noteTransmissionAuthorized)
        return { status: 412, body: { error: "precondition-failed" } };
      if (!prepared || !this.available())
        return { status: 503, body: { error: "run-unavailable" } };
      if (!(await prepared.isCurrent()))
        return { status: 412, body: { error: "precondition-failed" } };
      if (
        prepared.pairs.some((pair) => pair.state === "sendable-miss") &&
        !this.isGatewayConfigured()
      )
        return { status: 503, body: { error: "run-unavailable" } };
      const validated = await runOutsideProfileSourceCoordinator(() =>
        this.options.runService.prepareValidatedPreparedRun({
          scopeKind: "wishlist",
          wishlistPreparation: prepared,
          noteTransmissionAuthorized: false,
          providerBudget: authorization.providerBudget,
        }),
      );
      if (!validated) return { status: 412, body: { error: "precondition-failed" } };
      try {
        return await this.coordinator.runExclusive(async () => {
          if (authorization.expiresAtMs <= this.now().getTime() || !(await prepared.isCurrent()))
            return { status: 412 as const, body: { error: "precondition-failed" as const } };
          const authority = await this.readCurrentAuthority();
          if (!authority || !this.available() || authority.cacheRevision === null)
            return { status: 503 as const, body: { error: "run-unavailable" as const } };
          if (!this.enabled(prepared.capture.collection, authority.redundancySettings))
            return { status: 503 as const, body: { error: "run-unavailable" as const } };
          if (
            authority.source.policyIdentity !== authorization.policyIdentity ||
            this.limitsIdentity(authorization.providerBudget).identity !==
              authorization.limitsIdentity
          )
            return { status: 412 as const, body: { error: "precondition-failed" as const } };
          if (this.activeHandle)
            return { status: 409 as const, body: { error: "run-conflict" as const } };
          if (authorization.consumed)
            return { status: 409 as const, body: { error: "run-conflict" as const } };
          const handle = this.options.runService.reserveValidatedPreparedRun(validated);
          authorization.consumed = true;
          this.activeHandle = handle;
          this.activeRunScope = { handle, scope: authorization.scopeKind };
          const receipt = this.receipts.get(input.requestId);
          if (receipt) {
            receipt.state = "active";
            receipt.expiresAtMs = Number.POSITIVE_INFINITY;
          }
          void handle.completion
            .finally(() => {
              if (this.activeHandle === handle) {
                this.activeHandle = null;
                if (this.activeRunScope?.handle === handle) this.activeRunScope = null;
              }
              if (receipt && this.receipts.get(input.requestId) === receipt) {
                receipt.state = "replay";
                receipt.expiresAtMs = this.now().getTime() + this.receiptTtlMs();
              }
            })
            .catch(() => {});
          return { status: 200 as const, body: { state: "started" as const, runId: handle.runId } };
        });
      } catch {
        return { status: 409, body: { error: "run-conflict" } };
      }
    }
    if (!this.available()) return { status: 503, body: { error: "run-unavailable" } };

    let capture: JevRunCapture;
    try {
      // Prediction capture is deliberately outside the coordinator.
      capture = await runOutsideProfileSourceCoordinator(() =>
        this.options.sourceAdapter.loadCapture(),
      );
    } catch {
      return { status: 412, body: { error: "precondition-failed" } };
    }
    const planned = planJevRunScope(capture.collection, capture.predictionCapture);
    if (
      !planned.ok ||
      this.scopeIdentity(capture, planned.scope) !== authorization.scopeIdentity ||
      capture.sourceVectorIdentity !== authorization.sourceVectorIdentity ||
      capture.policyIdentity !== authorization.policyIdentity ||
      this.limitsIdentity(authorization.providerBudget).identity !== authorization.limitsIdentity
    )
      return { status: 412, body: { error: "precondition-failed" } };
    if (planned.scope.totalEligiblePairs > this.options.runService.effectiveLimits.maxEligiblePairs)
      return { status: 409, body: { error: "scope-over-limit" } };

    if (!this.isGatewayConfigured()) {
      let collectionLookup: JevRunCollectionLookup | undefined;
      for (const pair of planned.scope.pairs()) {
        const prepared = prepareJevRunPair({
          plannedPair: pair,
          scope: planned.scope,
          collection: capture.collection,
          cache: this.options.cache,
          noteTransmissionAuthorized: input.noteTransmissionAuthorized,
          getCollectionLookup: () =>
            (collectionLookup ??= createJevRunCollectionLookup(capture.collection)),
        });
        if (prepared.status === "ready") return { status: 503, body: { error: "run-unavailable" } };
      }
    }

    const preparedRun = await runOutsideProfileSourceCoordinator(() =>
      this.options.runService.prepareValidatedPreparedRun({
        capture,
        scope: planned.scope,
        noteTransmissionAuthorized: input.noteTransmissionAuthorized,
        providerBudget: authorization.providerBudget,
      }),
    );
    if (!preparedRun) return { status: 412, body: { error: "precondition-failed" } };

    try {
      const response = await this.coordinator.runExclusive(async () => {
        if (authorization.expiresAtMs <= this.now().getTime())
          return { status: 412 as const, body: { error: "precondition-failed" as const } };
        const authority = await this.readCurrentAuthority();
        if (authorization.expiresAtMs <= this.now().getTime())
          return { status: 412 as const, body: { error: "precondition-failed" as const } };
        if (!authority || !this.available() || authority.cacheRevision === null)
          return { status: 503 as const, body: { error: "run-unavailable" as const } };
        if (!this.enabled(capture.collection, authority.redundancySettings))
          return { status: 503 as const, body: { error: "run-unavailable" as const } };
        if (
          authority.source.sourceVectorIdentity !== authorization.sourceVectorIdentity ||
          authority.source.policyIdentity !== authorization.policyIdentity ||
          this.limitsIdentity(authorization.providerBudget).identity !==
            authorization.limitsIdentity ||
          (input.noteTransmissionAuthorized &&
            planned.scope.ownerNoteBearingPairCount > 0 &&
            !authority.source.canTransmitNotes)
        )
          return { status: 412 as const, body: { error: "precondition-failed" as const } };
        if (this.activeHandle)
          return { status: 409 as const, body: { error: "run-conflict" as const } };
        if (authorization.consumed)
          return { status: 409 as const, body: { error: "run-conflict" as const } };

        // The opaque reservation was copied and scope-validated outside this lock.
        // This operation only consumes the token and reserves process-local activity.
        const handle = this.options.runService.reserveValidatedPreparedRun(preparedRun);
        authorization.consumed = true;
        this.activeHandle = handle;
        this.activeRunScope = { handle, scope: authorization.scopeKind };
        const receipt = this.receipts.get(input.requestId);
        if (receipt) {
          receipt.state = "active";
          receipt.expiresAtMs = Number.POSITIVE_INFINITY;
        }
        void handle.completion
          .finally(() => {
            if (this.activeHandle === handle) {
              this.activeHandle = null;
              if (this.activeRunScope?.handle === handle) this.activeRunScope = null;
            }
            if (receipt && this.receipts.get(input.requestId) === receipt) {
              receipt.state = "replay";
              receipt.expiresAtMs = this.now().getTime() + this.receiptTtlMs();
            }
          })
          .catch(() => {});
        return { status: 200 as const, body: { state: "started" as const, runId: handle.runId } };
      });
      return response;
    } catch {
      return { status: 409, body: { error: "run-conflict" } };
    }
  }

  private async startUnifiedPrepared(
    input: { requestId: string; precondition: string; noteTransmissionAuthorized: boolean },
    authorization: AuthorizationRecord,
    prepared: PreparedUnifiedRun,
  ): Promise<JevRunControllerStartResponse> {
    if (
      (prepared.scopeKind === "wishlist" && input.noteTransmissionAuthorized) ||
      prepared.scopeKind !== authorization.scopeKind ||
      !prepared.isAuthorized() ||
      !(await prepared.isSourceCurrent())
    )
      return { status: 412, body: { error: "precondition-failed" } };
    if (prepared.scopeKind === "collection") {
      const scope = prepared.collectionScope;
      if (
        !scope ||
        (input.noteTransmissionAuthorized &&
          scope.ownerNoteBearingPairCount > 0 &&
          !(await this.options.sourceAdapter.readCurrent()).canTransmitNotes)
      )
        return { status: 412, body: { error: "precondition-failed" } };
    }
    const preparedRun = await runOutsideProfileSourceCoordinator(() =>
      this.options.runService.prepareValidatedPreparedRun(
        prepared.scopeKind === "wishlist"
          ? {
              scopeKind: "wishlist",
              wishlistPreparation: prepared.wishlistPreparation!,
              unifiedPreparation: prepared,
              noteTransmissionAuthorized: false,
              providerBudget: authorization.providerBudget,
            }
          : {
              capture: prepared.capture,
              scope: prepared.collectionScope!,
              unifiedPreparation: prepared,
              noteTransmissionAuthorized: input.noteTransmissionAuthorized,
              providerBudget: authorization.providerBudget,
            },
      ),
    );
    if (!preparedRun) return { status: 412, body: { error: "precondition-failed" } };
    try {
      return await this.coordinator.runExclusive(async () => {
        if (authorization.expiresAtMs <= this.now().getTime())
          return { status: 412 as const, body: { error: "precondition-failed" as const } };
        const authority = await this.readCurrentAuthority();
        if (!authority || !this.available() || authority.cacheRevision === null)
          return { status: 503 as const, body: { error: "run-unavailable" as const } };
        if (
          authority.source.sourceVectorIdentity !== authorization.sourceVectorIdentity ||
          authority.source.policyIdentity !== authorization.policyIdentity ||
          this.limitsIdentity(authorization.providerBudget).identity !==
            authorization.limitsIdentity ||
          (input.noteTransmissionAuthorized &&
            prepared.collectionScope?.ownerNoteBearingPairCount &&
            !authority.source.canTransmitNotes)
        )
          return { status: 412 as const, body: { error: "precondition-failed" as const } };
        if (!this.enabled(prepared.capture.collection, authority.redundancySettings))
          return { status: 503 as const, body: { error: "run-unavailable" as const } };
        if (this.activeHandle)
          return { status: 409 as const, body: { error: "run-conflict" as const } };
        if (authorization.consumed)
          return { status: 409 as const, body: { error: "run-conflict" as const } };
        const handle = this.options.runService.reserveValidatedPreparedRun(preparedRun);
        authorization.consumed = true;
        this.activeHandle = handle;
        this.activeRunScope = { handle, scope: prepared.scopeKind };
        const receipt = this.receipts.get(input.requestId);
        if (receipt) {
          receipt.state = "active";
          receipt.expiresAtMs = Number.POSITIVE_INFINITY;
        }
        void handle.completion
          .finally(() => {
            if (this.activeHandle === handle) {
              this.activeHandle = null;
              if (this.activeRunScope?.handle === handle) this.activeRunScope = null;
            }
            if (receipt && this.receipts.get(input.requestId) === receipt) {
              receipt.state = "replay";
              receipt.expiresAtMs = this.now().getTime() + this.receiptTtlMs();
            }
          })
          .catch(() => {});
        return { status: 200 as const, body: { state: "started" as const, runId: handle.runId } };
      });
    } catch {
      return { status: 409, body: { error: "run-conflict" } };
    }
  }

  private async previewUnifiedCollection(
    budget: JevRunBudget,
  ): Promise<JevRunControllerPreviewResponse> {
    let prepared: PreparedUnifiedRun;
    try {
      prepared = await prepareUnifiedJevRun({
        scoring: this.options.unifiedScoringService!,
        sourceAdapter: this.options.sourceAdapter,
        cache: this.options.cache,
        request: { scope: "collection-all" },
        budget,
      });
    } catch {
      return { status: 503, body: { error: "status-unavailable" } };
    }
    const scope = prepared.collectionScope;
    if (!scope || !(await prepared.isSourceCurrent()) || !prepared.run.isAuthorized())
      return { status: 412, body: { error: "precondition-failed" } };
    const authority = await this.readCurrentAuthority();
    if (!authority) return { status: 503, body: { error: "status-unavailable" } };
    if (!this.enabled(prepared.capture.collection, authority.redundancySettings))
      return { status: 503, body: { error: "run-unavailable" } };
    if (
      authority.source.sourceVectorIdentity !== prepared.capture.sourceVectorIdentity ||
      authority.source.policyIdentity !== prepared.capture.policyIdentity ||
      authority.cacheRevision === null ||
      !prepared.run.isCalculationCurrent()
    )
      return { status: 412, body: { error: "precondition-failed" } };
    const run = prepared.run;
    const disclosure = run.disclosure;
    const now = this.now();
    const requestId = randomUUID();
    const expiresAtMs = now.getTime() + this.preconditionTtlMs();
    const precondition = randomBytes(32).toString("base64url");
    const providerBudget = Object.freeze({ ...budget });
    const limits = this.limitsIdentity(providerBudget);
    const scopeIdentity = disclosure.authorizationIdentity;
    this.authorizations.set(precondition, {
      requestId,
      precondition,
      sourceVectorIdentity: prepared.capture.sourceVectorIdentity,
      policyIdentity: prepared.capture.policyIdentity,
      scopeIdentity,
      limitsIdentity: limits.identity,
      providerBudget,
      expiresAtMs,
      consumed: false,
      scopeKind: "collection",
      unifiedPreparation: prepared,
    });
    this.trimAuthorizations();
    const semantic = prepared.capture.collection.semanticRedundancy.settings;
    return {
      status: 200,
      body: {
        requestId,
        precondition,
        provider: "TypeSafe",
        modelId: JEV_MODEL_ID,
        eligibleGameCount: scope.eligibleGameIds.length,
        pairCount: scope.totalEligiblePairs,
        descriptionBearingPairCount: scope.descriptionBearingPairCount,
        noteBearingPairCount: scope.ownerNoteBearingPairCount,
        noteTransmissionPermitted: authority.source.canTransmitNotes,
        providerConfigured: this.isGatewayConfigured(),
        signalScope: {
          description: semantic.enabled && semantic.weights.description > 0,
          ownerNotes: semantic.enabled && semantic.weights.ownerNote > 0,
        },
        scoringEffect:
          authority.redundancySettings.stage === "integrated" &&
          (semantic.weights.description > 0 || semantic.weights.ownerNote > 0)
            ? "integrated-fitness"
            : "annotation-only",
        retentionCaveat: JEV_RETENTION_CAVEAT,
        limits: {
          maxEligiblePairs: limits.run.maxEligiblePairs,
          maxProviderAttempts: providerBudget.maxProviderAttempts,
          maxRetriesPerEvaluation: JEV_GATEWAY_LIMITS.maxRetriesPerEvaluation,
          maxRunDurationMs: providerBudget.maxRunDurationMs,
          reportedTokenStopThreshold: providerBudget.reportedTokenStopThreshold,
          reportedTokenThresholdIsBilledCeiling: false,
        },
        withinPairLimit: scope.totalEligiblePairs <= limits.run.maxEligiblePairs,
        expiresAt: new Date(expiresAtMs).toISOString(),
      },
    };
  }

  private async previewUnifiedWishlist(
    selection: JevWishlistCandidateSelection | undefined,
    budget: JevRunBudget,
  ): Promise<JevRunControllerPreviewResponse> {
    let normalizedSelection: JevWishlistCandidateSelection;
    try {
      normalizedSelection = normalizeWishlistSelection(selection);
    } catch {
      return { status: 400, body: { error: "precondition-failed" } };
    }
    try {
      await this.options.wishlistPreparation?.hydrateSources?.(normalizedSelection);
    } catch {
      return { status: 503, body: { error: "status-unavailable" } };
    }
    let prepared: PreparedUnifiedRun;
    try {
      prepared = await prepareUnifiedJevRun({
        scoring: this.options.unifiedScoringService!,
        sourceAdapter: this.options.sourceAdapter,
        cache: this.options.cache,
        request: { scope: "wishlist", selectedBggIds: [] },
        wishlistSelection: normalizedSelection,
        budget,
      });
    } catch {
      return { status: 503, body: { error: "status-unavailable" } };
    }
    const wishlist = prepared.wishlistPreparation;
    if (!wishlist || !(await prepared.isSourceCurrent()) || !prepared.run.isAuthorized())
      return { status: 412, body: { error: "precondition-failed" } };
    if (
      wishlist.disclosure.comparisonPairCount >
      this.options.runService.effectiveLimits.maxEligiblePairs
    )
      return { status: 409, body: { error: "scope-over-limit" } };
    const authority = await this.readCurrentAuthority();
    if (!authority) return { status: 503, body: { error: "status-unavailable" } };
    if (!this.enabled(prepared.capture.collection, authority.redundancySettings))
      return { status: 503, body: { error: "run-unavailable" } };
    if (
      authority.source.sourceVectorIdentity !== prepared.capture.sourceVectorIdentity ||
      authority.source.policyIdentity !== prepared.capture.policyIdentity ||
      authority.cacheRevision === null ||
      !prepared.run.isCalculationCurrent()
    )
      return { status: 412, body: { error: "precondition-failed" } };
    const requestId = randomUUID();
    const expiresAtMs = this.now().getTime() + this.preconditionTtlMs();
    const precondition = randomBytes(32).toString("base64url");
    const providerBudget = Object.freeze({ ...budget });
    const limits = this.limitsIdentity(providerBudget);
    this.authorizations.set(precondition, {
      requestId,
      precondition,
      sourceVectorIdentity: prepared.capture.sourceVectorIdentity,
      policyIdentity: prepared.capture.policyIdentity,
      scopeIdentity: prepared.run.disclosure.authorizationIdentity,
      limitsIdentity: limits.identity,
      providerBudget,
      expiresAtMs,
      consumed: false,
      scopeKind: "wishlist",
      wishlistPreparation: wishlist,
      unifiedPreparation: prepared,
    });
    this.trimAuthorizations();
    const semantic = prepared.capture.collection.semanticRedundancy.settings;
    return {
      status: 200,
      body: {
        requestId,
        precondition,
        provider: "TypeSafe",
        modelId: JEV_MODEL_ID,
        eligibleGameCount: wishlist.disclosure.eligibleCandidateCount,
        pairCount: wishlist.disclosure.comparisonPairCount,
        descriptionBearingPairCount:
          wishlist.disclosure.cachedHitPairCount + wishlist.disclosure.sendablePairCount,
        noteBearingPairCount: 0,
        noteTransmissionPermitted: false,
        providerConfigured: this.isGatewayConfigured(),
        signalScope: {
          description: semantic.enabled && semantic.weights.description > 0,
          ownerNotes: false,
        },
        scoringEffect:
          authority.redundancySettings.stage === "integrated" && semantic.weights.description > 0
            ? "integrated-fitness"
            : "annotation-only",
        retentionCaveat: JEV_RETENTION_CAVEAT,
        limits: {
          maxEligiblePairs: limits.run.maxEligiblePairs,
          maxProviderAttempts: providerBudget.maxProviderAttempts,
          maxRetriesPerEvaluation: JEV_GATEWAY_LIMITS.maxRetriesPerEvaluation,
          maxRunDurationMs: providerBudget.maxRunDurationMs,
          reportedTokenStopThreshold: providerBudget.reportedTokenStopThreshold,
          reportedTokenThresholdIsBilledCeiling: false,
        },
        withinPairLimit: wishlist.disclosure.comparisonPairCount <= limits.run.maxEligiblePairs,
        expiresAt: new Date(expiresAtMs).toISOString(),
        scope: wishlist.disclosure,
        selection: normalizedSelection,
        unavailableCandidateBggIds: wishlist.unavailableCandidateBggIds,
      },
    };
  }

  private async readCurrentAuthority(): Promise<{
    source: Awaited<ReturnType<JevRunSourceAdapter["readCurrent"]>>;
    redundancySettings: RedundancySettings;
    cacheRevision: number | null;
  } | null> {
    try {
      return await this.coordinator.runExclusive(async () => {
        const [source, redundancySettings] = await Promise.all([
          this.options.sourceAdapter.readCurrent(),
          this.options.storageService.loadRedundancySettings(),
        ]);
        return {
          source,
          redundancySettings,
          cacheRevision: this.options.cache.mutationRevision(),
        };
      });
    } catch {
      return null;
    }
  }

  private enabled(collection: Collection, redundancy: RedundancySettings): boolean {
    const settings = collection.semanticRedundancy.settings;
    return (
      redundancy.enabled &&
      settings.enabled &&
      (settings.weights.description > 0 || settings.weights.ownerNote > 0)
    );
  }

  private available(): boolean {
    return this.cacheAvailable();
  }

  private cacheAvailable(): boolean {
    return this.options.cache.available;
  }

  private isGatewayConfigured(): boolean {
    return this.options.gatewayConfigured?.() ?? isJevGatewayConfigured();
  }

  private limitsIdentity(providerBudget: Readonly<JevRunBudget>) {
    const run = this.options.runService.effectiveLimits;
    return {
      run,
      identity: canonicalSha256({ run, gateway: JEV_GATEWAY_LIMITS, providerBudget }),
    };
  }

  private scopeIdentity(capture: JevRunCapture, scope: JevRunScope): string {
    return canonicalSha256({
      sourceVectorIdentity: capture.sourceVectorIdentity,
      policyIdentity: capture.policyIdentity,
      captureIdentity: capture.captureIdentity,
      eligibleGameIds: scope.eligibleGameIds,
      sources: scope.eligibleGameIds.map((gameId) => scope.sourceForGame(gameId)),
      totalEligiblePairs: scope.totalEligiblePairs,
      descriptionBearingPairCount: scope.descriptionBearingPairCount,
      ownerNoteBearingPairCount: scope.ownerNoteBearingPairCount,
      ownerNoteSignalBlocked: scope.ownerNoteSignalBlocked,
      cachedOwnerNoteUse: scope.cachedOwnerNoteUse,
    });
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private preconditionTtlMs(): number {
    return this.options.preconditionTtlMs ?? DEFAULT_PRECONDITION_TTL_MS;
  }

  private receiptTtlMs(): number {
    return this.options.receiptTtlMs ?? DEFAULT_RECEIPT_TTL_MS;
  }

  private expireRecords(): void {
    const now = this.now().getTime();
    for (const [key, value] of this.authorizations)
      if (value.expiresAtMs <= now) this.authorizations.delete(key);
    for (const [key, value] of this.receipts)
      if (value.state === "replay" && value.expiresAtMs <= now) this.receipts.delete(key);
  }

  private trimAuthorizations(): void {
    while (this.authorizations.size > MAX_RECEIPTS) {
      const oldest = this.authorizations.keys().next().value;
      if (oldest === undefined) return;
      this.authorizations.delete(oldest);
    }
  }

  private maxReceipts(): number {
    return this.options.maxReceipts ?? MAX_RECEIPTS;
  }
}

function validRequestId(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 100;
}

function normalizeWishlistSelection(
  selection: JevWishlistCandidateSelection | undefined,
): JevWishlistCandidateSelection {
  if (selection === undefined) return Object.freeze({ kind: "all" });
  if (selection.kind === "all") return Object.freeze({ kind: "all" });
  if (
    selection.kind !== "selected" ||
    !Array.isArray(selection.bggIds) ||
    selection.bggIds.length === 0 ||
    selection.bggIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    new Set(selection.bggIds).size !== selection.bggIds.length
  )
    throw new TypeError("Invalid wishlist selection");
  const bggIds: readonly number[] = selection.bggIds as readonly number[];
  return Object.freeze({
    kind: "selected",
    bggIds: Object.freeze([...bggIds].sort((a, b) => a - b)),
  });
}

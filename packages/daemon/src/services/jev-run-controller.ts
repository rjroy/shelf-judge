import { randomBytes, randomUUID } from "node:crypto";
import type {
  Collection,
  JevRunPreviewBase,
  JevWishlistCandidateSelection,
  JevWishlistRunPreview,
  RedundancySettings,
} from "@shelf-judge/shared";
import type { JevPairCache } from "./jev-pair-cache-service.js";
import type { JevRunHandle, JevRunService, ValidatedPreparedJevRun } from "./jev-run-service.js";
import type { JevRunSourceAdapter } from "./jev-run-source-adapter.js";
import type { UnifiedScoringService } from "./unified-scoring-service.js";
import { prepareUnifiedJevRun, type PreparedUnifiedRun } from "./unified-jev-run-preparation.js";
import type { WishlistRunPreparationService } from "./wishlist-run-preparation.js";
import { createJevRunCollectionLookup, type JevRunCollectionLookup } from "./jev-run-scope.js";
import { prepareJevRunPair } from "./jev-run-pair.js";
import { createWishlistPairReadinessInspector } from "./wishlist-pair-readiness.js";
import { JEV_GATEWAY_LIMITS, JEV_MODEL_ID, isJevGatewayConfigured } from "./jev/jev-gateway.js";
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
const MAX_PROVIDER_READINESS_ATTEMPTS = 3;

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
  limitsIdentity: string;
  providerBudget: Readonly<JevRunBudget>;
  expiresAtMs: number;
  consumed: boolean;
  scopeKind: "collection" | "wishlist";
  unifiedPreparation: PreparedUnifiedRun;
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
      sourceAdapter: Pick<JevRunSourceAdapter, "readCurrent">;
      cache: JevPairCache;
      runService: JevRunService;
      now?: () => Date;
      preconditionTtlMs?: number;
      receiptTtlMs?: number;
      gatewayConfigured?: () => boolean;
      wishlistPreparation?: Pick<WishlistRunPreparationService, "hydrateSources">;
      unifiedScoringService: UnifiedScoringService;
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
    return this.previewUnifiedCollection(budget);
  }

  /** Previews an explicitly scoped unified wishlist run. */
  async previewWishlist(
    selection?: JevWishlistCandidateSelection,
    budget: JevRunBudget = DEFAULT_JEV_RUN_BUDGET,
  ): Promise<JevRunControllerPreviewResponse> {
    if (!isValidJevRunBudget(budget)) return { status: 400, body: { error: "invalid-budget" } };
    if (!this.cacheAvailable()) return { status: 503, body: { error: "run-unavailable" } };
    return this.previewUnifiedWishlist(selection, budget);
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
    receipt.promise = this.startUnifiedPrepared(
      input,
      authorization,
      authorization.unifiedPreparation,
    ).then(
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

  private async startUnifiedPrepared(
    input: { requestId: string; precondition: string; noteTransmissionAuthorized: boolean },
    authorization: AuthorizationRecord,
    prepared: PreparedUnifiedRun,
  ): Promise<JevRunControllerStartResponse> {
    if (
      (prepared.scopeKind === "wishlist" && input.noteTransmissionAuthorized) ||
      prepared.scopeKind !== authorization.scopeKind ||
      (prepared.scopeKind === "wishlist" && !prepared.wishlistPreparation) ||
      (prepared.scopeKind === "collection" && !prepared.collectionScope) ||
      !prepared.isAuthorized() ||
      !(await prepared.isSourceCurrent())
    )
      return { status: 412, body: { error: "precondition-failed" } };
    const eligiblePairs =
      prepared.scopeKind === "collection"
        ? prepared.collectionScope?.totalEligiblePairs
        : prepared.wishlistPreparation?.disclosure.comparisonPairCount;
    if (
      eligiblePairs === undefined ||
      eligiblePairs > this.options.runService.effectiveLimits.maxEligiblePairs
    )
      return { status: 409, body: { error: "scope-over-limit" } };
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
    const preparedRun = await runOutsideProfileSourceCoordinator(async () => {
      if (prepared.scopeKind === "wishlist") {
        const wishlistPreparation = prepared.wishlistPreparation;
        if (!wishlistPreparation) return null;
        return this.options.runService.prepareValidatedPreparedRun({
          scopeKind: "wishlist",
          wishlistPreparation,
          unifiedPreparation: prepared,
          noteTransmissionAuthorized: false,
        });
      }
      const scope = prepared.collectionScope;
      if (!scope) return null;
      return this.options.runService.prepareValidatedPreparedRun({
        capture: prepared.capture,
        scope,
        unifiedPreparation: prepared,
        noteTransmissionAuthorized: input.noteTransmissionAuthorized,
      });
    });
    if (!preparedRun) return { status: 412, body: { error: "precondition-failed" } };
    try {
      for (let attempt = 0; attempt < MAX_PROVIDER_READINESS_ATTEMPTS; attempt++) {
        const configuredBeforeScan = this.isGatewayConfigured();
        const readiness = configuredBeforeScan
          ? null
          : this.scanUnifiedProviderReadiness(prepared, input.noteTransmissionAuthorized);
        if (readiness?.state === "retry") continue;
        const outcome = await this.coordinator.runExclusive(async () => {
          if (authorization.expiresAtMs <= this.now().getTime())
            return { status: 412 as const, body: { error: "precondition-failed" as const } };
          const authority = await this.readCurrentAuthority();
          if (authorization.expiresAtMs <= this.now().getTime())
            return { status: 412 as const, body: { error: "precondition-failed" as const } };
          if (!authority || !this.cacheAvailable() || authority.cacheRevision === null)
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
          const configuredAtAdmission = this.isGatewayConfigured();
          if (configuredAtAdmission !== configuredBeforeScan) return { retry: true as const };
          if (!configuredAtAdmission) {
            const currentRevision = this.options.cache.mutationRevision();
            if (
              !readiness ||
              readiness.state !== "stable" ||
              currentRevision === null ||
              currentRevision !== readiness.revision
            )
              return { retry: true as const };
            if (readiness.requiresProvider)
              return { status: 503 as const, body: { error: "run-unavailable" as const } };
          }
          return this.acceptValidatedRun(
            input.requestId,
            authorization,
            preparedRun,
            prepared.scopeKind,
          );
        });
        if ("retry" in outcome) continue;
        return outcome;
      }
      return { status: 503, body: { error: "run-unavailable" } };
    } catch {
      return { status: 409, body: { error: "run-conflict" } };
    }
  }

  private scanUnifiedProviderReadiness(
    prepared: PreparedUnifiedRun,
    noteTransmissionAuthorized: boolean,
  ): { state: "stable"; revision: number; requiresProvider: boolean } | { state: "retry" } {
    try {
      const before = this.options.cache.mutationRevision();
      if (before === null) return { state: "retry" };
      let requiresProvider = false;
      if (prepared.scopeKind === "collection") {
        const scope = prepared.collectionScope;
        if (!scope) return { state: "retry" };
        let collectionLookup: JevRunCollectionLookup | undefined;
        for (const pair of scope.pairs()) {
          const result = prepareJevRunPair({
            plannedPair: pair,
            scope,
            collection: prepared.capture.collection,
            cache: this.options.cache,
            noteTransmissionAuthorized,
            getCollectionLookup: () =>
              (collectionLookup ??= createJevRunCollectionLookup(prepared.capture.collection)),
          });
          if (result.status === "ready") {
            requiresProvider = true;
            break;
          }
        }
      } else {
        const wishlist = prepared.wishlistPreparation;
        if (!wishlist) return { state: "retry" };
        const inspectPair = createWishlistPairReadinessInspector(wishlist, this.options.cache);
        for (const pair of wishlist.pairs) {
          if (inspectPair(pair).state === "executable-miss") {
            requiresProvider = true;
            break;
          }
        }
      }
      const after = this.options.cache.mutationRevision();
      if (after === null || after !== before) return { state: "retry" };
      return { state: "stable", revision: before, requiresProvider };
    } catch {
      return { state: "retry" };
    }
  }

  private acceptValidatedRun(
    requestId: string,
    authorization: AuthorizationRecord,
    reservation: ValidatedPreparedJevRun,
    scope: AuthorizationRecord["scopeKind"],
  ): JevRunControllerStartResponse {
    const handle = this.options.runService.reserveValidatedPreparedRun(reservation);
    authorization.consumed = true;
    this.activeHandle = handle;
    this.activeRunScope = { handle, scope };
    const receipt = this.receipts.get(requestId);
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
        if (receipt && this.receipts.get(requestId) === receipt) {
          receipt.state = "replay";
          receipt.expiresAtMs = this.now().getTime() + this.receiptTtlMs();
        }
      })
      .catch(() => {});
    return { status: 200, body: { state: "started", runId: handle.runId } };
  }

  private async previewUnifiedCollection(
    budget: JevRunBudget,
  ): Promise<JevRunControllerPreviewResponse> {
    let prepared: PreparedUnifiedRun;
    try {
      prepared = await prepareUnifiedJevRun({
        scoring: this.options.unifiedScoringService,
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
    const now = this.now();
    const requestId = randomUUID();
    const expiresAtMs = now.getTime() + this.preconditionTtlMs();
    const precondition = randomBytes(32).toString("base64url");
    const providerBudget = Object.freeze({ ...budget });
    const limits = this.limitsIdentity(providerBudget);
    this.authorizations.set(precondition, {
      requestId,
      precondition,
      sourceVectorIdentity: prepared.capture.sourceVectorIdentity,
      policyIdentity: prepared.capture.policyIdentity,
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
        scoring: this.options.unifiedScoringService,
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
      limitsIdentity: limits.identity,
      providerBudget,
      expiresAtMs,
      consumed: false,
      scopeKind: "wishlist",
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

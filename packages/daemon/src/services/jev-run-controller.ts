import { randomBytes, randomUUID } from "node:crypto";
import type { Collection, RedundancySettings } from "@shelf-judge/shared";
import type { JevPairCache } from "./jev-pair-cache-service.js";
import type { JevRunCapture, JevRunHandle, JevRunService } from "./jev-run-service.js";
import type { JevRunSourceAdapter } from "./jev-run-source-adapter.js";
import { planJevRunScope, type JevRunScope } from "./jev-run-scope.js";
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

export interface JevRunControllerPreview {
  requestId: string;
  precondition: string;
  provider: "TypeSafe";
  modelId: typeof JEV_MODEL_ID;
  eligibleGameCount: number;
  pairCount: number;
  descriptionBearingPairCount: number;
  noteBearingPairCount: number;
  noteTransmissionPermitted: boolean;
  providerConfigured: boolean;
  signalScope: { description: boolean; ownerNotes: boolean };
  scoringEffect: "integrated-fitness" | "annotation-only";
  retentionCaveat: string;
  limits: {
    maxEligiblePairs: number;
    maxProviderAttempts: number;
    maxRetriesPerEvaluation: number;
    maxRunDurationMs: number;
    reportedTokenStopThreshold: number;
    reportedTokenThresholdIsBilledCeiling: false;
  };
  withinPairLimit: boolean;
  expiresAt: string;
}

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
  | { status: 200; body: JevRunControllerPreview }
  | { status: 400 | 412 | 503; body: ControllerErrorBody };

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

  /** Returns only the process-local live run ID; durable progress is not run authority. */
  activeRun(): { runId: string } | null {
    const active = this.activeHandle;
    return active ? { runId: active.runId } : null;
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
      for (const pair of planned.scope.pairs()) {
        const prepared = prepareJevRunPair({
          plannedPair: pair,
          scope: planned.scope,
          collection: capture.collection,
          cache: this.options.cache,
          noteTransmissionAuthorized: input.noteTransmissionAuthorized,
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
        const receipt = this.receipts.get(input.requestId);
        if (receipt) {
          receipt.state = "active";
          receipt.expiresAtMs = Number.POSITIVE_INFINITY;
        }
        void handle.completion
          .finally(() => {
            if (this.activeHandle === handle) this.activeHandle = null;
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

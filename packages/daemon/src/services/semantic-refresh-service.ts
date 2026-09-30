import type {
  SemanticDisclosureManifest,
  SemanticPairJudgment,
  SemanticSignalScope,
  SemanticSourceIdentity,
} from "@shelf-judge/shared";
import type {
  SemanticPairSource,
  SemanticRefreshGenerationAuthority,
  SemanticRefreshPairAuthority,
} from "./semantic-refresh-contracts.js";
import {
  JEV_MODEL_ID,
  JEV_QUESTION_VERSION,
  JEV_RUBRIC_VERSION,
  JevGatewayError,
  type JevGateway,
  type JevAttemptAdmission,
  type JevDispatchReceipt,
  type JevPairRequest,
  type JevPairResult,
} from "./jev/jev-gateway.js";
import { canonicalSha256 } from "./profile-source-coordinator.js";
import type {
  SemanticRedundancyStateService,
  SemanticStateMutationResult,
} from "./semantic-redundancy-state-service.js";
import { createLogger, type Logger } from "./logger.js";

export interface SemanticRefreshService {
  run(executionId: string): Promise<SemanticStateMutationResult<void>>;
  cancel(executionId: string): Promise<SemanticStateMutationResult<void>>;
}

export interface SemanticRefreshExecutionSnapshot {
  execution: {
    commandId: string;
    manifestDigest: string;
    sourceIdentity: SemanticSourceIdentity;
    signalScope: SemanticSignalScope;
    noteTransmissionAuthorized: boolean;
    cachedOwnerNoteUseAuthorized: boolean;
    status: string;
    startedAt: string | null;
    deadlineAt: string;
  };
  manifest: SemanticDisclosureManifest;
  authorizationId: string;
  deliveryComplete: boolean;
  authorizationActive: boolean;
}

function requiredMode(
  manifest: SemanticDisclosureManifest,
  pair: SemanticDisclosureManifest["pairs"][number],
  noteTransmissionAuthorized: boolean,
): JevPairRequest["mode"] | null {
  const description =
    manifest.signalScope !== "owner-notes-only" && pair.hasDescriptionA && pair.hasDescriptionB;
  const notes =
    manifest.signalScope !== "description-only" &&
    noteTransmissionAuthorized &&
    pair.hasOwnerNoteA &&
    pair.hasOwnerNoteB;
  if (description && notes) return "description-and-owner-notes";
  if (description) return "description-only";
  if (notes) return "owner-notes-only";
  return null;
}

function requestFor(mode: JevPairRequest["mode"], source: SemanticPairSource): JevPairRequest {
  if (mode === "description-only") {
    if (!source.descriptionA || !source.descriptionB)
      throw new Error("Description source is missing");
    return {
      mode,
      gameA: { name: source.descriptionA.name, bggDescription: source.descriptionA.text },
      gameB: { name: source.descriptionB.name, bggDescription: source.descriptionB.text },
    };
  }
  if (mode === "owner-notes-only") {
    if (!source.ownerNoteA || !source.ownerNoteB) throw new Error("Owner-note source is missing");
    return {
      mode,
      gameA: { name: source.ownerNoteA.name, ownerNote: source.ownerNoteA.text },
      gameB: { name: source.ownerNoteB.name, ownerNote: source.ownerNoteB.text },
    };
  }
  if (!source.descriptionA || !source.descriptionB || !source.ownerNoteA || !source.ownerNoteB)
    throw new Error("Combined signal sources are missing");
  return {
    mode,
    gameA: {
      name: source.descriptionA.name,
      bggDescription: source.descriptionA.text,
      ownerNote: source.ownerNoteA.text,
    },
    gameB: {
      name: source.descriptionB.name,
      bggDescription: source.descriptionB.text,
      ownerNote: source.ownerNoteB.text,
    },
  };
}

function sourceMatchesManifest(
  source: SemanticPairSource,
  manifest: SemanticDisclosureManifest,
  pair: SemanticDisclosureManifest["pairs"][number],
): boolean {
  return (
    canonicalSha256({ ...source.sourceIdentity, collectionRevision: 0 }) ===
      canonicalSha256({ ...manifest.sourceIdentity, collectionRevision: 0 }) &&
    (source.descriptionA?.fingerprint ?? null) === pair.descriptionFingerprintA &&
    (source.descriptionB?.fingerprint ?? null) === pair.descriptionFingerprintB &&
    (source.ownerNoteA?.version ?? null) === pair.noteVersionA &&
    (source.ownerNoteB?.version ?? null) === pair.noteVersionB &&
    (source.ownerNoteA !== null) === pair.hasOwnerNoteA &&
    (source.ownerNoteB !== null) === pair.hasOwnerNoteB &&
    (source.descriptionA !== null) === pair.hasDescriptionA &&
    (source.descriptionB !== null) === pair.hasDescriptionB
  );
}

let activeWorkers = 0;
const MAX_ACTIVE_WORKERS = 1;
type SemanticRefreshTimer = ReturnType<typeof setTimeout> | number;

function judgmentsFor(
  manifest: SemanticDisclosureManifest,
  pair: SemanticDisclosureManifest["pairs"][number],
  source: SemanticPairSource,
  mode: JevPairRequest["mode"],
  result: JevPairResult,
): SemanticPairJudgment {
  const requestContext =
    mode === "description-only"
      ? { kind: "description-only" as const, descriptionRepresentationVersion: 1 as const }
      : mode === "owner-notes-only"
        ? { kind: "owner-notes-only" as const, ownerNoteRepresentationVersion: 1 as const }
        : {
            kind: "description-and-owner-notes" as const,
            descriptionRepresentationVersion: 1 as const,
            ownerNoteRepresentationVersion: 1 as const,
            descriptionFingerprintA: pair.descriptionFingerprintA!,
            descriptionFingerprintB: pair.descriptionFingerprintB!,
          };
  const description = result.description
    ? {
        status: "scored" as const,
        score: result.description.score,
        confidence: result.description.confidence,
        modelId: result.description.modelId,
        rubricVersion: result.description.rubricVersion,
        sourceFingerprintA: source.descriptionA!.fingerprint,
        sourceFingerprintB: source.descriptionB!.fingerprint,
        noteVersionA: mode === "description-and-owner-notes" ? source.ownerNoteA!.version : null,
        noteVersionB: mode === "description-and-owner-notes" ? source.ownerNoteB!.version : null,
        requestContext,
      }
    : null;
  let ownerNote: SemanticPairJudgment["ownerNote"] = null;
  if (mode !== "description-only" && result.ownerNote) {
    ownerNote = {
      status: "scored",
      score: result.ownerNote.score,
      confidence: result.ownerNote.confidence,
      modelId: result.ownerNote.modelId,
      rubricVersion: result.ownerNote.rubricVersion,
      sourceFingerprintA: source.ownerNoteA!.fingerprint,
      sourceFingerprintB: source.ownerNoteB!.fingerprint,
      noteVersionA: source.ownerNoteA!.version,
      noteVersionB: source.ownerNoteB!.version,
      requestContext,
    };
  }
  return { gameA: pair.gameA, gameB: pair.gameB, description, ownerNote };
}

function validatePairResult(
  mode: JevPairRequest["mode"],
  result: JevPairResult,
  manifest: SemanticDisclosureManifest,
): void {
  if (
    (mode !== "owner-notes-only" && result.description === null) ||
    (mode !== "description-only" && result.ownerNote === null) ||
    (result.description !== null &&
      (result.description.modelId !== manifest.modelId ||
        result.description.rubricVersion !== manifest.rubricVersion ||
        result.description.questionVersion !== JEV_QUESTION_VERSION)) ||
    (result.ownerNote !== null &&
      (result.ownerNote.modelId !== manifest.modelId ||
        result.ownerNote.rubricVersion !== manifest.rubricVersion ||
        result.ownerNote.questionVersion !== JEV_QUESTION_VERSION))
  )
    throw new JevGatewayError(
      "response-invalid",
      "Provider result does not match the frozen rubric",
    );
}

export function createSemanticRefreshService(deps: {
  stateService: SemanticRedundancyStateService;
  loadExecution: (executionId: string) => Promise<SemanticRefreshExecutionSnapshot | null>;
  /** Process-local start receipt; false after restart so a persisted running row cannot resend. */
  isExecutionStartCurrentProcess: (executionId: string) => boolean;
  pairAuthority: SemanticRefreshPairAuthority;
  generationAuthority: SemanticRefreshGenerationAuthority;
  gatewayFactory: (options: {
    admitAndDispatch: (input: JevAttemptAdmission) => Promise<JevDispatchReceipt>;
    maxRequests: number;
    maxReportedTokens: number;
  }) => JevGateway;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => SemanticRefreshTimer;
  clearTimer?: (handle: SemanticRefreshTimer) => void;
  logger?: Logger;
}): SemanticRefreshService {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? globalThis.setTimeout;
  const clearTimer = deps.clearTimer ?? globalThis.clearTimeout;
  const logger = deps.logger ?? createLogger("semantic-refresh-worker");
  const active = new Map<string, AbortController>();

  return {
    async run(executionId) {
      if (activeWorkers >= MAX_ACTIVE_WORKERS) return { outcome: "not-authorized" };
      activeWorkers += 1;
      let snapshot: SemanticRefreshExecutionSnapshot | null;
      try {
        snapshot = await deps.loadExecution(executionId);
      } catch (error) {
        activeWorkers -= 1;
        throw error;
      }
      if (
        !snapshot ||
        !snapshot.deliveryComplete ||
        !snapshot.authorizationActive ||
        snapshot.execution.commandId !== executionId ||
        snapshot.execution.status !== "running" ||
        snapshot.execution.manifestDigest !== snapshot.manifest.digest ||
        snapshot.manifest.modelId !== JEV_MODEL_ID ||
        snapshot.manifest.rubricVersion !== JEV_RUBRIC_VERSION ||
        snapshot.execution.signalScope !== snapshot.manifest.signalScope ||
        canonicalSha256({ ...snapshot.execution.sourceIdentity, collectionRevision: 0 }) !==
          canonicalSha256({ ...snapshot.manifest.sourceIdentity, collectionRevision: 0 }) ||
        snapshot.execution.startedAt === null ||
        Date.parse(snapshot.execution.deadlineAt) >
          Date.parse(snapshot.execution.startedAt) + snapshot.manifest.budget.maxDurationMs ||
        !deps.isExecutionStartCurrentProcess(executionId) ||
        Date.parse(snapshot.execution.deadlineAt) <= now() ||
        Date.parse(snapshot.manifest.expiresAt) <= now()
      ) {
        activeWorkers -= 1;
        return { outcome: "not-authorized" };
      }
      const stopAt = Math.min(
        Date.parse(snapshot.execution.deadlineAt),
        Date.parse(snapshot.manifest.expiresAt),
      );
      const controller = new AbortController();
      const stopTimer = setTimer(() => controller.abort(), Math.max(0, stopAt - now()));
      active.set(executionId, controller);
      const ensureWithinDeadline = () => {
        if (now() >= stopAt || controller.signal.aborted) {
          controller.abort();
          throw new JevGatewayError("aborted", "Execution deadline reached");
        }
      };
      let currentPair: SemanticDisclosureManifest["pairs"][number] | null = null;
      let outcome: SemanticStateMutationResult<void> = {
        outcome: "accepted",
        value: undefined,
        current: {
          evidenceEpoch: snapshot.execution.sourceIdentity.evidenceEpoch,
          consentEpoch: snapshot.execution.sourceIdentity.consentEpoch,
        },
      };
      try {
        let gateway: JevGateway | null = null;
        const getGateway = () => {
          if (gateway !== null) return gateway;
          gateway = deps.gatewayFactory({
            maxRequests: snapshot.manifest.budget.maxRequests,
            maxReportedTokens: snapshot.manifest.budget.maxTokens,
            admitAndDispatch: async ({ mode, start }) => {
              ensureWithinDeadline();
              const manifestPair = currentPair;
              if (!manifestPair) throw new Error("No active disclosure pair");
              return deps.pairAuthority.withCurrentPair({
                executionId,
                manifest: snapshot.manifest,
                pair: manifestPair,
                operation: async (source) => {
                  ensureWithinDeadline();
                  if (!sourceMatchesManifest(source, snapshot.manifest, manifestPair))
                    throw new Error("Current source no longer matches the disclosed pair");
                  const expectedMode = requiredMode(
                    snapshot.manifest,
                    manifestPair,
                    snapshot.execution.noteTransmissionAuthorized,
                  );
                  if (mode !== expectedMode)
                    throw new Error("Gateway attempt mode differs from disclosed signal scope");
                  const reservation = await deps.stateService.reserveExecutionAttempt({
                    commandId: executionId,
                    manifestDigest: snapshot.manifest.digest,
                    sourceIdentity: snapshot.execution.sourceIdentity,
                    gameA: manifestPair.gameA,
                    gameB: manifestPair.gameB,
                    signalMode: mode,
                    noteTransmissionAuthorized: snapshot.execution.noteTransmissionAuthorized,
                  });
                  if (reservation.outcome !== "accepted")
                    throw new Error("Semantic execution attempt reservation was rejected");
                  ensureWithinDeadline();
                  return start();
                },
              });
            },
          });
          return gateway;
        };
        for (const pair of snapshot.manifest.pairs) {
          ensureWithinDeadline();
          const mode = requiredMode(
            snapshot.manifest,
            pair,
            snapshot.execution.noteTransmissionAuthorized,
          );
          if (mode === null) continue;
          currentPair = pair;
          const authority = await deps.pairAuthority.withCurrentPair({
            executionId,
            manifest: snapshot.manifest,
            pair,
            operation: (source) => {
              if (!sourceMatchesManifest(source, snapshot.manifest, pair))
                throw new Error("Current source no longer matches the disclosed pair");
              return Promise.resolve(source);
            },
          });
          ensureWithinDeadline();
          if (!authority) throw new Error("Pair authority unavailable");
          const request = requestFor(mode, authority);
          const result = await getGateway().evaluatePair(request, controller.signal);
          ensureWithinDeadline();
          validatePairResult(mode, result, snapshot.manifest);
          ensureWithinDeadline();
          await deps.pairAuthority.withCurrentPair({
            executionId,
            manifest: snapshot.manifest,
            pair,
            operation: async (currentSource) => {
              ensureWithinDeadline();
              if (!sourceMatchesManifest(currentSource, snapshot.manifest, pair))
                throw new Error("Pair source changed before checkpoint");
              const judgment = judgmentsFor(snapshot.manifest, pair, currentSource, mode, result);
              const checkpoint = await deps.stateService.checkpointJudgments({
                expected: {
                  evidenceEpoch: snapshot.execution.sourceIdentity.evidenceEpoch,
                  consentEpoch: snapshot.execution.sourceIdentity.consentEpoch,
                },
                authorizationId: snapshot.authorizationId,
                judgments: [judgment],
              });
              if (checkpoint.outcome !== "accepted")
                throw new Error("Semantic checkpoint was rejected");
            },
          });
          ensureWithinDeadline();
        }
        ensureWithinDeadline();
        outcome = await deps.generationAuthority.withCurrentGeneration({
          executionId,
          manifest: snapshot.manifest,
          operation: async (authority) =>
            deps.stateService.publishGeneration({
              expected: {
                evidenceEpoch: snapshot.execution.sourceIdentity.evidenceEpoch,
                consentEpoch: snapshot.execution.sourceIdentity.consentEpoch,
              },
              authorizationId: snapshot.authorizationId,
              manifest: snapshot.manifest,
              eligibleGameIds: authority.eligibleGameIds,
              sourceIdentity: authority.sourceIdentity,
              generation: {
                id: snapshot.manifest.id,
                evidenceEpoch: snapshot.execution.sourceIdentity.evidenceEpoch,
                consentEpoch: snapshot.execution.sourceIdentity.consentEpoch,
                manifestDigest: snapshot.manifest.digest,
                modelId: snapshot.manifest.modelId,
                rubricVersion: snapshot.manifest.rubricVersion,
                scoringVersion: snapshot.manifest.scoringVersion,
                sourceIdentity: authority.sourceIdentity,
                signalScope: snapshot.manifest.signalScope,
                publishedAt: new Date(now()).toISOString(),
              },
            }),
        });
        if (outcome.outcome !== "accepted") {
          const terminal = await deps.stateService.finishExecution({
            commandId: executionId,
            status: controller.signal.aborted || now() >= stopAt ? "interrupted" : "failed",
          });
          logger.warn("semantic refresh worker outcome", {
            executionId,
            phase: "publish",
            reason: "generation-rejected",
          });
          return terminal.outcome === "accepted" ? terminal : outcome;
        }
        logger.log("semantic refresh worker outcome", {
          executionId,
          phase: "completed",
          reason: outcome.outcome === "accepted" ? "completed" : "completion-rejected",
          pairA: currentPair?.gameA ?? null,
          pairB: currentPair?.gameB ?? null,
        });
        return outcome;
      } catch (error) {
        const status = controller.signal.aborted
          ? "interrupted"
          : error instanceof JevGatewayError && error.code === "aborted"
            ? "interrupted"
            : "failed";
        logger.warn("semantic refresh worker outcome", {
          executionId,
          phase: "terminalize",
          reason: status === "interrupted" ? "aborted-or-expired" : "worker-failure",
          pairA: currentPair?.gameA ?? null,
          pairB: currentPair?.gameB ?? null,
        });
        outcome = await deps.stateService.finishExecution({ commandId: executionId, status });
        return outcome.outcome === "accepted" ? outcome : { outcome: "not-authorized" };
      } finally {
        clearTimer(stopTimer);
        active.delete(executionId);
        activeWorkers -= 1;
      }
    },

    async cancel(executionId) {
      const cancellation = await deps.stateService.cancelExecution(executionId);
      if (cancellation.outcome === "accepted") active.get(executionId)?.abort();
      return cancellation;
    },
  };
}

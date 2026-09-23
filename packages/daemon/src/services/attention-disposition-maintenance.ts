import type { AttentionMutationImpact } from "./attention-candidate-service.js";
import type { AttentionCandidateAvailability } from "./attention-candidate-service.js";
import type { CollectionMutationService } from "./collection-mutation-service.js";
import type { AttentionDisposition } from "@shelf-judge/shared";
import {
  clearIncompatibleAttentionDispositions,
  type AttentionDispositionWinner,
} from "./attention-disposition-compatibility.js";

export interface AttentionDispositionGlobalMaintenance {
  (impact: AttentionMutationImpact): Promise<void>;
  recover(): Promise<void>;
  recoveryRequired(): boolean;
}

/** Side-effect-free candidate read freshness, safe for request paths. */
export interface AttentionCandidateReadFreshness {
  ensureFresh(): Promise<AttentionCandidateAvailability>;
}

/** Daemon-owned maintenance entrypoint for ordered durable recovery and publication. */
export interface AttentionCandidateMaintenanceRecovery {
  recover(): Promise<AttentionCandidateAvailability>;
}

export interface AttentionCandidateRecoveryDeps {
  /** Reconciles durable intentional state before an artifact may be published. */
  readonly recoverCompatibility: () => Promise<void>;
  readonly ensureFresh: () => Promise<AttentionCandidateAvailability>;
}

/**
 * The only recovery publication path. Compatibility recovery intentionally runs
 * before candidate freshness so a failed global reconciliation cannot be
 * bypassed by a later Profile request or startup rebuild.
 */
export function createAttentionCandidateMaintenanceRecovery(
  deps: AttentionCandidateRecoveryDeps,
): AttentionCandidateMaintenanceRecovery {
  let pending: Promise<AttentionCandidateAvailability> | null = null;
  return {
    recover() {
      if (pending === null) {
        pending = (async () => {
          await deps.recoverCompatibility();
          return deps.ensureFresh();
        })().finally(() => {
          pending = null;
        });
      }
      return pending;
    },
  };
}

export function createAttentionDispositionGlobalMaintenance(deps: {
  readonly collectionMutations: CollectionMutationService;
  readonly storedRuleMatches?: (
    dispositions: readonly AttentionDisposition[],
  ) => Promise<readonly AttentionDispositionWinner[]>;
  /** Legacy test seam. Production must evaluate the stored rules themselves. */
  readonly winners?: (gameIds: readonly string[]) => Promise<readonly AttentionDispositionWinner[]>;
  readonly maintainCandidates: (impact: AttentionMutationImpact) => Promise<void>;
  readonly invalidateCandidates?: () => Promise<void>;
}): AttentionDispositionGlobalMaintenance {
  let recoveryImpact: AttentionMutationImpact | null = null;
  const reconcile = async (impact: AttentionMutationImpact): Promise<boolean> => {
    if (impact.kind !== "global") return false;
    if (deps.storedRuleMatches === undefined && deps.winners === undefined)
      throw new Error("Stored-rule compatibility resolver is required");
    try {
      const outcome = await deps.collectionMutations.mutate(
        {
          operation: "attention-disposition-maintenance",
          trigger: `attention:global:${impact.reason}`,
          maintenanceImpact: impact,
        },
        async (collection) => {
          const dispositions = collection.attentionDispositions;
          const gameIds = dispositions.map((disposition) => disposition.gameId);
          const cleared = clearIncompatibleAttentionDispositions(
            collection,
            collection,
            await (deps.storedRuleMatches?.(dispositions) ?? deps.winners!(gameIds)),
            new Set(gameIds),
          );
          return { changed: cleared.length > 0, value: undefined };
        },
      );
      // A later serialized global reconciliation has now completed against the
      // current authoritative state. It retires an earlier recovery gate before
      // candidate publication, even when no disposition needed clearing.
      recoveryImpact = null;
      return outcome.changed;
    } catch {
      // The global source was already committed. Do not reject/replay it because
      // attention reconciliation failed; discard its disposable publication.
      await deps.invalidateCandidates?.();
      recoveryImpact = impact;
      throw new Error("Attention disposition compatibility is unavailable");
    }
  };
  const maintain: AttentionDispositionGlobalMaintenance = async (impact) => {
    try {
      await reconcile(impact);
      await deps.maintainCandidates(impact);
    } catch {
      // The source writer has already committed. Candidate invalidation and a
      // later recovery are the intentionally fail-closed result.
    }
  };
  maintain.recover = async () => {
    const impact = recoveryImpact;
    if (impact === null) return;
    recoveryImpact = null;
    try {
      await reconcile(impact);
    } catch {
      // Preserve the retry marker when durable compatibility is still down.
      recoveryImpact = impact;
      throw new Error("Attention disposition compatibility recovery is unavailable");
    }
  };
  maintain.recoveryRequired = () => recoveryImpact !== null;
  return maintain;
}

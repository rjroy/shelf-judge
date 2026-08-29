import type {
  AcceptedIntentionMutation,
  IntentionCommand,
  IntentionMutationResult,
  PlayIntention,
} from "../../src/index";

export const canonicalIntentionCommandId = "33000000-0000-4000-8000-000000000001";
export const canonicalCompleteCommandId = "33000000-0000-4000-8000-000000000002";
export const canonicalRetireCommandId = "33000000-0000-4000-8000-000000000003";
export const canonicalRejectedCreateCommandId = "33000000-0000-4000-8000-000000000004";
export const canonicalStaleCommandId = "33000000-0000-4000-8000-000000000005";
export const canonicalReuseCommandId = "33000000-0000-4000-8000-000000000006";

export const canonicalActiveIntention: PlayIntention = {
  intentionId: "intention-1",
  gameId: "game-1",
  kind: "first-play",
  baseline: {
    playCount: 0,
    evidenceSource: "manual",
    observedAt: "2026-08-28T10:00:00.000Z",
  },
  createdAt: "2026-08-28T10:01:00.000Z",
  version: 1,
  resolution: null,
};

export function canonicalAcceptedIntentionMutation(
  commandId = canonicalIntentionCommandId,
): AcceptedIntentionMutation {
  return {
    ok: true,
    commandId,
    intention: structuredClone(canonicalActiveIntention),
    linkedOwnershipTransition: null,
  };
}

export function canonicalStaleIntentionMutation(
  commandId = canonicalIntentionCommandId,
): IntentionMutationResult {
  const accepted = canonicalAcceptedIntentionMutation(commandId);
  const current: PlayIntention = {
    ...accepted.intention,
    version: 2,
    resolution: {
      outcome: "completed",
      source: "owner-confirmed",
      resolvedAt: "2026-08-28T10:02:00.000Z",
    },
  };
  return {
    ok: false,
    commandId,
    error: {
      code: "stale-version",
      gameId: accepted.intention.gameId,
      intentionId: accepted.intention.intentionId,
      expectedVersion: 1,
      current,
    },
  };
}

function acceptedResolution(
  type: "complete" | "retire",
  commandId: string,
): AcceptedIntentionMutation {
  return {
    ok: true,
    commandId,
    intention: {
      ...structuredClone(canonicalActiveIntention),
      version: 2,
      resolution:
        type === "complete"
          ? {
              outcome: "completed",
              source: "owner-confirmed",
              resolvedAt: "2026-08-28T10:02:00.000Z",
            }
          : {
              outcome: "retired",
              source: "owner-retired",
              resolvedAt: "2026-08-28T10:02:00.000Z",
            },
    },
    linkedOwnershipTransition: null,
  };
}

export interface CanonicalIntentionMutationCase {
  label: string;
  command: IntentionCommand;
  result: IntentionMutationResult;
  status: 200 | 400 | 409;
}

export const canonicalIntentionMutationCases: readonly CanonicalIntentionMutationCase[] = [
  {
    label: "accepted create",
    command: {
      type: "create",
      commandId: canonicalIntentionCommandId,
      gameId: "game-1",
      kind: "first-play",
      expectedActiveIntention: "absent",
    },
    result: canonicalAcceptedIntentionMutation(),
    status: 200,
  },
  {
    label: "accepted complete",
    command: {
      type: "complete",
      commandId: canonicalCompleteCommandId,
      gameId: "game-1",
      intentionId: "intention-1",
      expectedVersion: 1,
    },
    result: acceptedResolution("complete", canonicalCompleteCommandId),
    status: 200,
  },
  {
    label: "accepted retire",
    command: {
      type: "retire",
      commandId: canonicalRetireCommandId,
      gameId: "game-1",
      intentionId: "intention-1",
      expectedVersion: 1,
    },
    result: acceptedResolution("retire", canonicalRetireCommandId),
    status: 200,
  },
  {
    label: "ineligible create",
    command: {
      type: "create",
      commandId: canonicalRejectedCreateCommandId,
      gameId: "game-1",
      kind: "first-play",
      expectedActiveIntention: "absent",
    },
    result: {
      ok: false,
      commandId: canonicalRejectedCreateCommandId,
      error: { code: "ineligible-game", gameId: "game-1", reason: "stale-play-evidence" },
    },
    status: 400,
  },
  {
    label: "stale complete",
    command: {
      type: "complete",
      commandId: canonicalStaleCommandId,
      gameId: "game-1",
      intentionId: "intention-1",
      expectedVersion: 1,
    },
    result: canonicalStaleIntentionMutation(canonicalStaleCommandId),
    status: 409,
  },
  {
    label: "reused retire command",
    command: {
      type: "retire",
      commandId: canonicalReuseCommandId,
      gameId: "game-1",
      intentionId: "intention-1",
      expectedVersion: 1,
    },
    result: {
      ok: false,
      commandId: canonicalReuseCommandId,
      error: { code: "command-reuse", commandId: canonicalReuseCommandId },
    },
    status: 409,
  },
];

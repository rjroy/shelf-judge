type GroundedToolKind = "submission" | "retrieval";
type GroundedToolHandlingOutcome = "accepted" | "rejected" | "failed";

export type GroundedToolLifecycleEvent = Readonly<{
  toolName: string;
  toolKind: GroundedToolKind;
  phase: "dispatch" | "handling";
  outcome: "attempted" | "accepted" | "rejected" | "failed";
  callIndex: number;
}>;

export interface GroundedToolLifecycleDiagnostics {
  dispatch(toolName: string, toolKind: GroundedToolKind): number;
  handling(
    toolName: string,
    toolKind: GroundedToolKind,
    callIndex: number,
    outcome: GroundedToolHandlingOutcome,
  ): void;
  setTrace(callback: ((event: GroundedToolTraceEvent) => void) | undefined): void;
  snapshot(): readonly GroundedToolLifecycleEvent[];
}

export type GroundedToolTraceEvent = GroundedToolLifecycleEvent & { durationMs?: number };

export const GROUNDED_TOOL_LIFECYCLE_SNAPSHOT_LIMIT = 64;

/** Stores only names and bounded control-flow outcomes, never tool arguments or results. */
export function createGroundedToolLifecycleDiagnostics(
  options: {
    nowMs?: () => number;
    onTrace?: (event: GroundedToolTraceEvent) => void;
  } = {},
): GroundedToolLifecycleDiagnostics {
  const events: GroundedToolLifecycleEvent[] = [];
  const startedAt = new Map<number, number>();
  let trace = options.onTrace;
  let nextCallIndex = 0;
  const record = (event: GroundedToolLifecycleEvent) => {
    if (events.length < GROUNDED_TOOL_LIFECYCLE_SNAPSHOT_LIMIT) events.push(Object.freeze(event));
  };
  return Object.freeze({
    dispatch(toolName: string, toolKind: GroundedToolKind) {
      const callIndex = nextCallIndex++;
      const event = {
        toolName,
        toolKind,
        phase: "dispatch" as const,
        outcome: "attempted" as const,
        callIndex,
      };
      startedAt.set(callIndex, options.nowMs?.() ?? performance.now());
      record(event);
      try {
        trace?.(event);
      } catch {
        // Diagnostics must never affect a model operation.
      }
      return callIndex;
    },
    handling(
      toolName: string,
      toolKind: GroundedToolKind,
      callIndex: number,
      outcome: GroundedToolHandlingOutcome,
    ) {
      const start = startedAt.get(callIndex);
      const event = {
        toolName,
        toolKind,
        phase: "handling" as const,
        outcome,
        callIndex,
        ...(start === undefined
          ? {}
          : {
              durationMs: Math.max(0, Math.round((options.nowMs?.() ?? performance.now()) - start)),
            }),
      };
      record({ toolName, toolKind, phase: "handling", outcome, callIndex });
      try {
        trace?.(event);
      } catch {
        // Diagnostics must never affect a model operation.
      }
    },
    setTrace(callback: ((event: GroundedToolTraceEvent) => void) | undefined) {
      trace = callback;
    },
    snapshot: () => Object.freeze(events.map((event) => Object.freeze({ ...event }))),
  });
}

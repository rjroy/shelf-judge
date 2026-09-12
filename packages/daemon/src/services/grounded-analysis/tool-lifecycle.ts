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
  snapshot(): readonly GroundedToolLifecycleEvent[];
}

const MAX_TOOL_LIFECYCLE_EVENTS = 16;

/** Stores only names and bounded control-flow outcomes, never tool arguments or results. */
export function createGroundedToolLifecycleDiagnostics(): GroundedToolLifecycleDiagnostics {
  const events: GroundedToolLifecycleEvent[] = [];
  let nextCallIndex = 0;
  const record = (event: GroundedToolLifecycleEvent) => {
    if (events.length < MAX_TOOL_LIFECYCLE_EVENTS) events.push(Object.freeze(event));
  };
  return Object.freeze({
    dispatch(toolName: string, toolKind: GroundedToolKind) {
      const callIndex = nextCallIndex++;
      record({ toolName, toolKind, phase: "dispatch", outcome: "attempted", callIndex });
      return callIndex;
    },
    handling(
      toolName: string,
      toolKind: GroundedToolKind,
      callIndex: number,
      outcome: GroundedToolHandlingOutcome,
    ) {
      record({ toolName, toolKind, phase: "handling", outcome, callIndex });
    },
    snapshot: () => Object.freeze(events.map((event) => Object.freeze({ ...event }))),
  });
}

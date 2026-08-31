import type { z } from "zod";
import { freezeGroundedSchema } from "./immutable-schema.js";
import type { GroundedAnalysisResult } from "./provider.js";
import type { GroundedEventPayload } from "./stream-writer.js";

export interface GroundedTransportEvent {
  version: 1;
  operationId: string;
  sequence: number;
  occurredAt: string;
  type: string;
  terminal: boolean;
}

export type GroundedTerminalEventLifecycleOutcome = "completed" | "failed" | "cancelled";

export interface GroundedTerminalEventBinding {
  readonly type: string;
  readonly terminal: true;
}

export type GroundedTerminalEventOutcomeManifest = Readonly<
  Record<GroundedTerminalEventLifecycleOutcome, readonly GroundedTerminalEventBinding[]>
>;

export interface GroundedFeaturePublicationPolicy<Output, Event extends GroundedTransportEvent> {
  readonly eventSchema: z.ZodType<Event>;
  readonly terminalEventOutcomes: GroundedTerminalEventOutcomeManifest;
  readonly startedEvent?: GroundedEventPayload<Event> & { terminal: false };
  completedEvent(this: void, result: GroundedAnalysisResult<Output>): GroundedEventPayload<Event>;
  failedEvent(this: void, error: unknown): GroundedEventPayload<Event>;
  cancelledEvent(this: void, error: unknown): GroundedEventPayload<Event>;
}

export class GroundedPublicationPolicyConfigurationError extends Error {
  readonly code = "invalid-terminal-event-outcome-manifest";

  constructor(readonly safeDetail: string) {
    super(`Invalid grounded publication policy: ${safeDetail}`);
    this.name = "GroundedPublicationPolicyConfigurationError";
  }
}

const terminalOutcomes = ["completed", "failed", "cancelled"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneAndFreeze<Value>(value: Value): Value {
  const clone = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (typeof candidate !== "object" || candidate === null || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate)) freeze(child);
    Object.freeze(candidate);
  };
  freeze(clone);
  return clone;
}

export function snapshotTerminalEventOutcomes(
  input: GroundedTerminalEventOutcomeManifest,
): GroundedTerminalEventOutcomeManifest {
  try {
    if (!isRecord(input)) {
      throw new GroundedPublicationPolicyConfigurationError("terminal-manifest-required");
    }
    if (
      Reflect.ownKeys(input).length !== terminalOutcomes.length ||
      terminalOutcomes.some((outcome) => !Object.hasOwn(input, outcome))
    ) {
      throw new GroundedPublicationPolicyConfigurationError("terminal-outcomes-must-be-exact");
    }

    const claimedTypes = new Set<string>();
    const snapshot = Object.fromEntries(
      terminalOutcomes.map((outcome) => {
        const rawBindings = input[outcome];
        if (!Array.isArray(rawBindings) || rawBindings.length === 0) {
          throw new GroundedPublicationPolicyConfigurationError(
            "terminal-outcome-must-be-nonempty",
          );
        }
        const outcomeTypes = new Set<string>();
        const bindings = (rawBindings as readonly unknown[]).map((binding) => {
          if (
            !isRecord(binding) ||
            Reflect.ownKeys(binding).length !== 2 ||
            typeof binding.type !== "string" ||
            !/^[A-Za-z0-9._-]+$/.test(binding.type) ||
            binding.terminal !== true
          ) {
            throw new GroundedPublicationPolicyConfigurationError("invalid-terminal-event-binding");
          }
          if (outcomeTypes.has(binding.type)) {
            throw new GroundedPublicationPolicyConfigurationError(
              "duplicate-terminal-event-binding",
            );
          }
          if (claimedTypes.has(binding.type)) {
            throw new GroundedPublicationPolicyConfigurationError(
              "overlapping-terminal-event-binding",
            );
          }
          outcomeTypes.add(binding.type);
          claimedTypes.add(binding.type);
          return Object.freeze({ type: binding.type, terminal: true as const });
        });
        return [outcome, Object.freeze(bindings)] as const;
      }),
    ) as Record<GroundedTerminalEventLifecycleOutcome, readonly GroundedTerminalEventBinding[]>;
    return Object.freeze(snapshot);
  } catch (error) {
    if (error instanceof GroundedPublicationPolicyConfigurationError) throw error;
    throw new GroundedPublicationPolicyConfigurationError("terminal-manifest-unreadable");
  }
}

export function snapshotGroundedFeaturePublication<Output, Event extends GroundedTransportEvent>(
  policy: GroundedFeaturePublicationPolicy<Output, Event>,
) {
  const eventSchema = freezeGroundedSchema(policy.eventSchema);
  const terminalEventOutcomes = snapshotTerminalEventOutcomes(policy.terminalEventOutcomes);
  const startedEvent =
    policy.startedEvent === undefined ? undefined : cloneAndFreeze(policy.startedEvent);
  const completedEvent = policy.completedEvent;
  const failedEvent = policy.failedEvent;
  const cancelledEvent = policy.cancelledEvent;
  const terminalTypes = new Set(
    terminalOutcomes.flatMap((outcome) => terminalEventOutcomes[outcome].map(({ type }) => type)),
  );

  function assertStartedEvent(event: GroundedEventPayload<Event> & { terminal: false }): void {
    if (
      !isRecord(event) ||
      event.terminal !== false ||
      typeof event.type !== "string" ||
      terminalTypes.has(event.type)
    ) {
      throw new Error("Grounded started event must be nonterminal and not terminal-bound");
    }
  }

  function assertTerminalEventOutcome(
    event: GroundedEventPayload<Event>,
    outcome: GroundedTerminalEventLifecycleOutcome,
  ): void {
    if (
      !isRecord(event) ||
      event.terminal !== true ||
      typeof event.type !== "string" ||
      !terminalEventOutcomes[outcome].some(({ type }) => type === event.type)
    ) {
      throw new Error(`Grounded terminal event does not match ${outcome} lifecycle outcome`);
    }
  }

  if (startedEvent !== undefined) {
    assertStartedEvent(startedEvent);
    eventSchema.parse({
      ...startedEvent,
      version: 1,
      operationId: "publication-policy-validation",
      sequence: 0,
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
  }

  return Object.freeze({
    eventSchema,
    terminalEventOutcomes,
    startedEvent,
    completedEvent(result: GroundedAnalysisResult<Output>) {
      const event = completedEvent(result);
      assertTerminalEventOutcome(event, "completed");
      return event;
    },
    failedEvent(error: unknown) {
      const event = failedEvent(error);
      assertTerminalEventOutcome(event, "failed");
      return event;
    },
    cancelledEvent(error: unknown) {
      const event = cancelledEvent(error);
      assertTerminalEventOutcome(event, "cancelled");
      return event;
    },
  });
}

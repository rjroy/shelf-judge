import { GroundedCancellationIdentitySchema } from "@shelf-judge/shared";

export type GroundedOperationTerminalOutcome =
  | "completed"
  | "cancelled"
  | "failed"
  | "transport-lost";

export interface GroundedActiveOperationDiscovery {
  operationId: string;
  batchId: string;
  requestId: string;
  feature: string;
  state: "active" | "terminal";
  startedAt: string;
  terminalAt?: string;
  outcome?: GroundedOperationTerminalOutcome;
}

export interface GroundedOperationTerminalReservation {
  readonly operationId: string;
}

interface OperationRecord extends GroundedActiveOperationDiscovery {
  capability: string;
  controller: AbortController;
  transportId?: string;
  transportClaimed: boolean;
  terminalReservation?: GroundedOperationTerminalReservation;
}

export function createActiveGroundedOperationRegistry(options?: { now?: () => string }) {
  const now = options?.now ?? (() => new Date().toISOString());
  const operations = new Map<string, OperationRecord>();

  function terminalize(
    record: OperationRecord,
    outcome: GroundedOperationTerminalOutcome,
  ): boolean {
    if (record.state === "terminal" || record.terminalReservation) return false;
    return commitOutcome(record, outcome);
  }

  function commitOutcome(
    record: OperationRecord,
    outcome: GroundedOperationTerminalOutcome,
  ): boolean {
    if (record.state === "terminal") return false;
    record.state = "terminal";
    record.outcome = outcome;
    record.terminalAt = now();
    if (outcome !== "completed" && !record.controller.signal.aborted) record.controller.abort();
    return true;
  }

  return {
    start(input: {
      operationId: string;
      batchId: string;
      requestId: string;
      capability: string;
      feature: string;
    }) {
      if (operations.has(input.operationId)) throw new Error("Operation ID is already registered");
      const cancellation = GroundedCancellationIdentitySchema.parse({
        batchId: input.batchId,
        requestId: input.requestId,
        capability: input.capability,
      });
      if (input.feature.length === 0) throw new Error("Operation feature is required");
      const record: OperationRecord = {
        operationId: input.operationId,
        batchId: cancellation.batchId,
        requestId: cancellation.requestId,
        capability: cancellation.capability,
        feature: input.feature,
        state: "active",
        startedAt: now(),
        controller: new AbortController(),
        transportClaimed: false,
      };
      operations.set(record.operationId, record);
      return Object.freeze({
        operationId: record.operationId,
        signal: record.controller.signal,
      });
    },
    claimTransport(operationId: string, transportId: string, disconnectSignal?: AbortSignal) {
      const record = operations.get(operationId);
      if (!record) throw new Error("Operation is not registered");
      if (record.state === "terminal" || record.transportClaimed) {
        throw new Error("Operation transport cannot be replaced or reattached");
      }
      if (transportId.length === 0) throw new Error("Transport ID is required");
      record.transportClaimed = true;
      record.transportId = transportId;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        disconnectSignal?.removeEventListener("abort", release);
        if (record.transportId !== transportId) return;
        record.transportId = undefined;
        if (record.state === "active") terminalize(record, "transport-lost");
      };
      if (disconnectSignal?.aborted) release();
      else disconnectSignal?.addEventListener("abort", release, { once: true });
      return Object.freeze({ release });
    },
    cancel(operationId: string, capability: string): boolean {
      const record = operations.get(operationId);
      if (!record || record.capability !== capability || record.state === "terminal") return false;
      return terminalize(record, "cancelled");
    },
    terminalize(
      operationId: string,
      outcome: Exclude<GroundedOperationTerminalOutcome, "cancelled" | "transport-lost">,
    ): boolean {
      const record = operations.get(operationId);
      if (!record) throw new Error("Operation is not registered");
      return terminalize(record, outcome);
    },
    reserveTerminal(operationId: string): GroundedOperationTerminalReservation | undefined {
      const record = operations.get(operationId);
      if (!record) throw new Error("Operation is not registered");
      if (record.state === "terminal" || record.terminalReservation) return undefined;
      const reservation = Object.freeze({ operationId });
      record.terminalReservation = reservation;
      return reservation;
    },
    commitTerminal(
      reservation: GroundedOperationTerminalReservation,
      outcome: Exclude<GroundedOperationTerminalOutcome, "cancelled" | "transport-lost">,
    ): boolean {
      const record = operations.get(reservation.operationId);
      if (!record || record.state === "terminal" || record.terminalReservation !== reservation) {
        return false;
      }
      record.terminalReservation = undefined;
      return commitOutcome(record, outcome);
    },
    discover(): readonly GroundedActiveOperationDiscovery[] {
      return Object.freeze(
        [...operations.values()].map((record) =>
          Object.freeze({
            operationId: record.operationId,
            batchId: record.batchId,
            requestId: record.requestId,
            feature: record.feature,
            state: record.state,
            startedAt: record.startedAt,
            ...(record.terminalAt === undefined ? {} : { terminalAt: record.terminalAt }),
            ...(record.outcome === undefined ? {} : { outcome: record.outcome }),
          }),
        ),
      );
    },
    cleanup(operationId: string): boolean {
      const record = operations.get(operationId);
      if (!record || record.state !== "terminal" || record.transportId !== undefined) return false;
      return operations.delete(operationId);
    },
  };
}

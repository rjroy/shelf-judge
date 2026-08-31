import { GROUNDED_STREAM_VERSION } from "@shelf-judge/shared";
import { z } from "zod";
import { freezeGroundedSchema } from "./immutable-schema.js";

interface GroundedWireEvent {
  version: typeof GROUNDED_STREAM_VERSION;
  operationId: string;
  sequence: number;
  occurredAt: string;
  type: string;
  terminal: boolean;
}

export type GroundedEventPayload<Event extends GroundedWireEvent> = Event extends GroundedWireEvent
  ? Omit<Event, "version" | "operationId" | "sequence" | "occurredAt">
  : never;

export type GroundedStreamEncoding = "sse" | "ndjson";

export function createGroundedStreamWriter<Event extends GroundedWireEvent>(options: {
  operationId: string;
  eventSchema: z.ZodType<Event>;
  encoding: GroundedStreamEncoding;
  write: (serializedEvent: string) => void | Promise<void>;
  now?: () => string;
}) {
  const operationId = options.operationId;
  if (operationId.length === 0) throw new Error("Stream operation ID is required");
  const eventSchema = freezeGroundedSchema(options.eventSchema);
  const encoding = options.encoding;
  const writeOutput = options.write;
  const now = options.now ?? (() => new Date().toISOString());
  let sequence = 0;
  let terminalReserved = false;
  let terminalWritten = false;
  let writeInProgress = false;
  let failed = false;
  let closed = false;

  return Object.freeze({
    async write(input: GroundedEventPayload<Event>): Promise<Event> {
      if (terminalReserved) throw new Error("No event may follow a terminal stream event");
      if (closed) throw new Error("Stream is closed");
      if (writeInProgress) throw new Error("Concurrent stream writes are not permitted");
      if (failed) throw new Error("Stream output previously failed");
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        throw new Error("Stream event payload must be an object");
      }
      for (const reserved of ["version", "operationId", "sequence", "occurredAt"] as const) {
        if (reserved in input) throw new Error(`Stream event payload cannot set ${reserved}`);
      }

      const event = eventSchema.parse({
        ...input,
        version: GROUNDED_STREAM_VERSION,
        operationId,
        sequence,
        occurredAt: now(),
      });
      if (!/^[A-Za-z0-9._-]+$/.test(event.type)) {
        throw new Error("Stream event type is not safe for transport framing");
      }

      const json = JSON.stringify(event);
      const serialized =
        encoding === "ndjson"
          ? `${json}\n`
          : `event: ${event.type}\nid: ${event.sequence}\ndata: ${json}\n\n`;
      terminalReserved = event.terminal;
      sequence += 1;
      writeInProgress = true;
      try {
        await writeOutput(serialized);
        terminalWritten = event.terminal;
        return event;
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        writeInProgress = false;
      }
    },
    close(): void {
      if (closed) throw new Error("Stream is already closed");
      if (writeInProgress) throw new Error("Cannot close while a stream write is in progress");
      if (failed) throw new Error("Cannot close after stream output failure");
      if (!terminalWritten) throw new Error("Stream cannot close without one terminal event");
      closed = true;
    },
  });
}

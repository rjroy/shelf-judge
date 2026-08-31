import { z } from "zod";

export const GROUNDED_STREAM_VERSION = 1 as const;

const TimestampSchema = z.string().datetime({ offset: true });
const SequenceSchema = z.number().int().safe().min(0);

export interface GroundedStreamEventDefinition {
  type: string;
  terminal: boolean;
  payload: z.ZodRawShape;
}

type GroundedStreamEventFromDefinition<Definition extends GroundedStreamEventDefinition> =
  Definition extends GroundedStreamEventDefinition
    ? {
        version: typeof GROUNDED_STREAM_VERSION;
        operationId: string;
        sequence: number;
        occurredAt: string;
        type: Definition["type"];
        terminal: Definition["terminal"];
      } & {
        [Key in keyof Definition["payload"]]: z.output<Definition["payload"][Key]>;
      }
    : never;

export function createGroundedStreamSchemas<
  const Definitions extends readonly GroundedStreamEventDefinition[],
>(definitions: Definitions) {
  const eventSchemas = definitions.map(({ type, terminal, payload }) =>
    z
      .object({
        version: z.literal(GROUNDED_STREAM_VERSION),
        operationId: z.string().min(1),
        sequence: SequenceSchema,
        occurredAt: TimestampSchema,
        type: z.literal(type),
        terminal: z.literal(terminal),
        ...payload,
      })
      .strict(),
  );
  type Event = GroundedStreamEventFromDefinition<Definitions[number]>;
  const EventSchema = unionFromSchemas<Event>(eventSchemas);
  const EventHistorySchema = createGroundedStreamHistorySchema(EventSchema);
  return { EventSchema, EventHistorySchema } as const;
}

export function createGroundedStreamHistorySchema<
  Event extends { sequence: number; terminal: boolean },
>(eventSchema: z.ZodType<Event>) {
  return z
    .array(eventSchema)
    .nonempty()
    .superRefine((events, context) => {
      let terminalSeen = false;
      for (const [index, event] of events.entries()) {
        if (event.sequence !== index) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "sequence"],
            message: "Stream sequences must start at zero and increase by one",
          });
        }
        if (terminalSeen) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index],
            message: "No event may follow a terminal event",
          });
        }
        terminalSeen ||= event.terminal;
      }
      if (!events.at(-1)?.terminal) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [events.length - 1],
          message: "A complete stream history must end with exactly one terminal event",
        });
      }
    });
}

function unionFromSchemas<Output>(schemas: readonly z.ZodTypeAny[]): z.ZodType<Output> {
  if (schemas.length === 0) return z.never();
  if (schemas.length === 1) return schemas[0] as z.ZodType<Output>;
  return z.union(schemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]) as z.ZodType<Output>;
}

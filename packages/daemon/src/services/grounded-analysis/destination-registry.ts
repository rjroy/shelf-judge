import { z } from "zod";
import { snapshotGroundedAuthorizationSchema } from "./immutable-schema.js";

const DestinationEnvelopeSchema = z
  .object({
    operationId: z.string().min(1),
    parameters: z.unknown(),
  })
  .strict();

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}

export function createGroundedDestinationRegistry<Destination>(options: {
  destinationSchema: z.ZodType<Destination>;
}) {
  const destinationSchema = snapshotGroundedAuthorizationSchema(options.destinationSchema);
  return Object.freeze({
    validate(input: unknown): Destination {
      DestinationEnvelopeSchema.parse(input);
      const destination = structuredClone(destinationSchema.parse(input));
      deepFreeze(destination);
      return destination;
    },
  });
}

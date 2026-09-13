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
  // Zod resets RegExp.lastIndex while validating. Schemas may be included in
  // operation discovery, so freezing a regex corrupts that shared validator.
  if (value instanceof RegExp) return;
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

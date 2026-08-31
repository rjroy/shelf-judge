import { z } from "zod";

const frozenAuthorizationValues = new WeakSet<object>();

export class GroundedAuthorizationConfigurationError extends Error {
  readonly code = "unsupported-authorization-schema";

  constructor(readonly safeDetail: "non-strict-object" | "unsupported-schema-kind") {
    super(`${GroundedAuthorizationConfigurationError.name}:${safeDetail}`);
    this.name = "GroundedAuthorizationConfigurationError";
  }
}

function assertSnapshotSafeAuthorizationSchema(
  schema: z.ZodTypeAny,
  visited: WeakSet<object>,
): void {
  if (visited.has(schema)) return;
  visited.add(schema);

  if (schema instanceof z.ZodObject) {
    const definition = schema._def;
    if (definition.unknownKeys !== "strict" || !(definition.catchall instanceof z.ZodNever)) {
      throw new GroundedAuthorizationConfigurationError("non-strict-object");
    }
    const shape = (
      schema as unknown as {
        _getCached(): { shape: z.ZodRawShape };
      }
    )._getCached().shape;
    for (const child of Object.values(shape)) {
      assertSnapshotSafeAuthorizationSchema(child, visited);
    }
    return;
  }
  if (schema instanceof z.ZodArray) {
    const element = (schema as unknown as { element: z.ZodTypeAny }).element;
    assertSnapshotSafeAuthorizationSchema(element, visited);
    return;
  }
  if (schema instanceof z.ZodTuple) {
    const tuple = schema as unknown as {
      items: readonly z.ZodTypeAny[];
      _def: { rest: z.ZodTypeAny | null };
    };
    for (const item of tuple.items) assertSnapshotSafeAuthorizationSchema(item, visited);
    const rest = tuple._def.rest;
    if (rest) assertSnapshotSafeAuthorizationSchema(rest, visited);
    return;
  }
  if (schema instanceof z.ZodUnion) {
    const options = (schema as unknown as { options: readonly z.ZodTypeAny[] }).options;
    for (const option of options) assertSnapshotSafeAuthorizationSchema(option, visited);
    return;
  }
  if (schema instanceof z.ZodDiscriminatedUnion) {
    const options = (schema as unknown as { options: readonly z.ZodTypeAny[] }).options;
    for (const option of options) assertSnapshotSafeAuthorizationSchema(option, visited);
    return;
  }
  if (schema instanceof z.ZodIntersection) {
    const intersection = schema as unknown as {
      _def: { left: z.ZodTypeAny; right: z.ZodTypeAny };
    };
    assertSnapshotSafeAuthorizationSchema(intersection._def.left, visited);
    assertSnapshotSafeAuthorizationSchema(intersection._def.right, visited);
    return;
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    const inner = (schema as unknown as { unwrap(): z.ZodTypeAny }).unwrap();
    assertSnapshotSafeAuthorizationSchema(inner, visited);
    return;
  }
  if (
    (schema instanceof z.ZodString ||
      schema instanceof z.ZodNumber ||
      schema instanceof z.ZodBoolean) &&
    (schema as unknown as { _def: { coerce?: boolean } })._def.coerce
  ) {
    throw new GroundedAuthorizationConfigurationError("unsupported-schema-kind");
  }
  if (
    schema instanceof z.ZodString ||
    schema instanceof z.ZodNumber ||
    schema instanceof z.ZodBoolean ||
    schema instanceof z.ZodLiteral ||
    schema instanceof z.ZodEnum ||
    schema instanceof z.ZodNull ||
    schema instanceof z.ZodNever
  ) {
    return;
  }
  throw new GroundedAuthorizationConfigurationError("unsupported-schema-kind");
}

function freezeReachable(value: unknown): void {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return;
  if (frozenAuthorizationValues.has(value)) return;
  frozenAuthorizationValues.add(value);

  if (value instanceof z.ZodObject) {
    // ZodObject populates this cache on first parse, so populate it before freezing the schema.
    const cached = (
      value as unknown as {
        _getCached(): { shape: z.ZodRawShape };
      }
    )._getCached();
    for (const child of Object.values(cached.shape)) freezeReachable(child);
  }
  if (value instanceof z.ZodEnum) {
    const options = (value as unknown as { options: readonly string[] }).options;
    value.safeParse(options[0]);
  }
  if (value instanceof z.ZodNativeEnum) {
    const enumValues = (value as unknown as { enum: Readonly<Record<string, string | number>> })
      .enum;
    const firstValue = Object.values(enumValues).find(
      (candidate): candidate is string | number =>
        typeof candidate === "string" || typeof candidate === "number",
    );
    if (firstValue !== undefined) value.safeParse(firstValue);
  }
  if (value instanceof Map) {
    for (const [key, child] of value) {
      freezeReachable(key);
      freezeReachable(child);
    }
    const rejectMutation = () => {
      throw new TypeError("Grounded authorization schema is immutable");
    };
    Object.defineProperties(value, {
      set: { value: rejectMutation },
      delete: { value: rejectMutation },
      clear: { value: rejectMutation },
    });
  } else if (value instanceof Set) {
    for (const child of value) freezeReachable(child);
    const rejectMutation = () => {
      throw new TypeError("Grounded authorization schema is immutable");
    };
    Object.defineProperties(value, {
      add: { value: rejectMutation },
      delete: { value: rejectMutation },
      clear: { value: rejectMutation },
    });
  } else {
    for (const child of Object.values(value)) freezeReachable(child);
  }
  Object.freeze(value);
}

export function freezeGroundedSchema<Schema extends z.ZodTypeAny>(schema: Schema): Schema {
  freezeReachable(schema);
  return schema;
}

export function snapshotGroundedAuthorizationSchema<Schema extends z.ZodTypeAny>(
  schema: Schema,
): Schema {
  assertSnapshotSafeAuthorizationSchema(schema, new WeakSet());
  return freezeGroundedSchema(schema);
}

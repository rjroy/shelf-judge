import {
  SuggestedPlayerPollSchema,
  isUsableSuggestedPlayerPoll,
  type JsonValue,
  type SuggestedPlayerPoll,
} from "@shelf-judge/shared";
import type { ParsedSuggestedPlayerPoll } from "./bgg-xml-parser.js";

function jsonSafeRepresentation(value: unknown, ancestors = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (value === Infinity) return "Infinity";
    if (value === -Infinity) return "-Infinity";
    return value;
  }
  if (typeof value === "undefined") return "undefined";
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (typeof value === "symbol") return `Symbol(${value.description ?? ""})`;
  if (typeof value === "function") return `[Function${value.name ? `: ${value.name}` : ""}]`;
  if (typeof value === "object") {
    if (ancestors.has(value)) return "[Circular]";
    ancestors.add(value);
    const representation = Array.isArray(value)
      ? Array.from(value, (entry) => jsonSafeRepresentation(entry, ancestors))
      : Object.fromEntries(
          Object.entries(value).map(([key, entry]) => [
            key,
            jsonSafeRepresentation(entry, ancestors),
          ]),
        );
    ancestors.delete(value);
    return representation;
  }
  return "unknown";
}

export function canonicalSuggestedPlayerPoll(
  poll: ParsedSuggestedPlayerPoll | undefined,
): SuggestedPlayerPoll | null {
  if (poll === undefined) return null;
  const source = "bgg-suggested-player-poll" as const;
  const observedAt = poll.observation?.observedAt ?? null;
  const state =
    poll.buckets.length === 0
      ? poll.state === "absent"
        ? ("absent" as const)
        : ("empty" as const)
      : isUsableSuggestedPlayerPoll(poll.buckets)
        ? ("usable" as const)
        : ("unusable" as const);
  const candidate = {
    status: "valid",
    state,
    buckets: poll.buckets,
    source,
    observedAt,
  };
  const parsed = SuggestedPlayerPollSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  return SuggestedPlayerPollSchema.parse({
    status: "invalid",
    state: "unusable",
    buckets: [],
    evidence: { presence: "present", value: jsonSafeRepresentation(poll.buckets) },
    source,
    observedAt,
  });
}

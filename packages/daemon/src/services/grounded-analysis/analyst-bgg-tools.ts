import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { z } from "zod";
import {
  AnalystBggFactsResultSchema,
  AnalystBggFitnessPreviewResultSchema,
  AnalystBggHotReviewResultSchema,
  AnalystBggTitleSearchResultSchema,
} from "@shelf-judge/shared";
import { BggClientError } from "../bgg-client.js";
import type {
  BoardgameFactsObservation,
  BoardgameTitleSearchObservation,
  BggRequestAttemptBudget,
} from "../bgg-client.js";

const titleArgs = z
  .object({
    ownerMessageIndex: z.number().int().safe().min(0),
    start: z.number().int().safe().min(0),
    end: z.number().int().safe().min(0),
    exact: z.boolean().optional(),
  })
  .strict();
const hotArgs = z.object({}).strict();
const factsArgs = z
  .object({ bggIds: z.array(z.number().int().safe().positive()).min(1).max(10) })
  .strict()
  .superRefine(({ bggIds }, ctx) => {
    if (new Set(bggIds).size !== bggIds.length)
      ctx.addIssue({ code: "custom", message: "IDs must be unique" });
  });
const titleParameters = Type.Object(
  {
    ownerMessageIndex: Type.Integer({ minimum: 0 }),
    start: Type.Integer({ minimum: 0 }),
    end: Type.Integer({ minimum: 0 }),
    exact: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
const hotParameters = Type.Object({}, { additionalProperties: false });
const factsParameters = Type.Object(
  { bggIds: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1, maxItems: 10 }) },
  { additionalProperties: false },
);
const previewArgs = z.object({ bggId: z.number().int().safe().positive() }).strict();
const previewParameters = Type.Object(
  { bggId: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);

export interface AnalystBggEvidenceRegistry {
  stage(input: {
    evidenceClass:
      | "bgg-search-observation"
      | "bgg-hot-observation"
      | "bgg-candidate-identity"
      | "bgg-thing-facts"
      | "bgg-preview-calculation"
      | "current-scoring";
    sourceId: string;
    observedAt?: string;
    payload: unknown;
    destination: string;
  }): string;
  commit(citationIds: readonly string[]): void;
  discard(citationIds: readonly string[]): void;
}
export interface AnalystBggTurnBudget {
  /** Atomically reserves one of the turn's shared 24 tool invocations. */
  reserveToolInvocation(): boolean;
  /** Atomically reserves newly inspected Thing IDs against the shared 20-ID limit. */
  reserveThingIds?(ids: readonly number[]): boolean;
  /** Shared by BGG operations and any other turn tool that can make BGG requests. */
  readonly httpAttemptBudget?: BggRequestAttemptBudget;
}
export interface AnalystBggToolOptions {
  readonly signal: AbortSignal;
  readonly ownerMessages: readonly string[];
  readonly registry: AnalystBggEvidenceRegistry;
  readonly turnBudget?: AnalystBggTurnBudget;
  readonly transport: {
    searchTitles(
      query: string,
      options: {
        exact?: boolean;
        limit: number;
        signal: AbortSignal;
        attemptBudget: BggRequestAttemptBudget;
      },
    ): Promise<BoardgameTitleSearchObservation>;
    reviewHot(options: {
      limit: number;
      signal: AbortSignal;
      attemptBudget: BggRequestAttemptBudget;
    }): Promise<BoardgameTitleSearchObservation>;
    readFacts(
      ids: number[],
      signal: AbortSignal,
      attemptBudget: BggRequestAttemptBudget,
    ): Promise<BoardgameFactsObservation>;
    previewFitness?(
      id: number,
      options: {
        signal: AbortSignal;
        attemptBudget: BggRequestAttemptBudget;
        cachedFact?: BoardgameFactsObservation["facts"][number];
      },
    ): Promise<unknown>;
  };
  readonly onAuthorizedIds?: (ids: readonly number[]) => void;
  readonly isIdAuthorized?: (id: number) => boolean;
  readonly configured?: () => boolean;
  readonly onResult?: (name: string, result: unknown) => void;
}

const MAX_TOOL_BYTES = 32 * 1024;
const MAX_TURN_BYTES = 128 * 1024;
const MAX_HTTP_ATTEMPTS = 12;
const ID_LIMIT = 20;
const SAFE_FAILURES = [
  "InvalidInput",
  "UnauthorizedId",
  "NotConfigured",
  "BggUnauthorized",
  "BggThrottled",
  "BggQueuedTimeout",
  "BggOutage",
  "BggParse",
  "MissingGame",
  "NonBoardgame",
  "MismatchedId",
  "BudgetExhausted",
  "ToolTimeout",
  "PredictionUnavailable",
] as const;
type SafeFailureCode = (typeof SAFE_FAILURES)[number];
function failure(code: SafeFailureCode, retryable = false) {
  return { status: "error" as const, code, retryable };
}
function validId(id: number): boolean {
  return Number.isSafeInteger(id) && id > 0;
}
function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
function aborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
}
function safeFailure(error: unknown): SafeFailureCode {
  if (error instanceof DOMException && error.name === "AbortError") throw error;
  if (error instanceof z.ZodError) return "InvalidInput";
  if (error instanceof BggClientError) {
    switch (error.code) {
      case "unauthorized":
        return "BggUnauthorized";
      case "rate-limited":
        return "BggThrottled";
      case "queued":
        return "BggQueuedTimeout";
      case "timeout":
        return "ToolTimeout";
      case "attempt-budget":
        return "BudgetExhausted";
      case "parse":
        return "BggParse";
      case "outage":
        return "BggOutage";
    }
  }
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  return SAFE_FAILURES.includes(code as SafeFailureCode) ? (code as SafeFailureCode) : "BggOutage";
}
function plainName(value: string, max: number): string {
  return [...value]
    .filter((c) => {
      const code = c.codePointAt(0) ?? 0;
      return !(code <= 0x1f || code === 0x7f);
    })
    .join("")
    .slice(0, max)
    .trim();
}
function isCanonicalOwnerUrl(value: string): number | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "boardgamegeek.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return;
    const match = /^\/boardgame\/(\d+)\/?$/u.exec(url.pathname);
    if (!match) return;
    const id = Number(match[1]);
    return validId(id) ? id : undefined;
  } catch {
    return;
  }
}
function titleSpanLooksLikeTitle(text: string): boolean {
  const value = text.trim();
  if (
    [...value].length < 2 ||
    [...value].length > 120 ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    }) ||
    /https?:\/\//iu.test(value)
  )
    return false;
  if (
    /^(?:yes|yeah|yep|no|nope|ok|okay|sure|please|find(?:\s+me)?|search|look\s+up|tell\s+me|what\s+is|which\s+game|i\s+(?:like|want|think|prefer)|can\s+you|could\s+you|would\s+you|this\s+game)\b/iu.test(
      value,
    )
  )
    return false;
  if (/[.!?\n\r]/u.test(value)) return false;
  return /[\p{L}\p{N}]/u.test(value);
}

/** Analyst-only, explicitly invoked BGG tools. No operation runs during factory creation. */
export function createAnalystBggTools(options: AnalystBggToolOptions): readonly ToolDefinition[] {
  const emittedCandidateIds = new Set<number>();
  const explicitOwnerIds = new Set<number>();
  const inspectedThingIds = new Set<number>();
  let invocations = 0;
  let titleCalls = 0;
  let hotCalls = 0;
  let factsCalls = 0;
  let previewCalls = 0;
  const verifiedFacts = new Map<number, BoardgameFactsObservation["facts"][number]>();
  const previewCache = new Map<number, unknown>();
  let responseBytes = 0;
  let attempts = 0;
  // Only canonical explicit owner references authorize direct lookups; arbitrary numbers do not.
  for (const message of options.ownerMessages) {
    for (const match of message.matchAll(/\bBGG\s*ID\s+(\d+)\b/giu)) {
      const id = Number(match[1]);
      if (validId(id)) explicitOwnerIds.add(id);
    }
    for (const match of message.matchAll(/https:\/\/[^\s<>"']+/giu)) {
      const id = isCanonicalOwnerUrl(match[0].replace(/[),.;]+$/u, ""));
      if (id !== undefined) explicitOwnerIds.add(id);
    }
  }
  const localAttemptBudget: BggRequestAttemptBudget = {
    tryConsume() {
      if (attempts >= MAX_HTTP_ATTEMPTS) return false;
      attempts++;
      return true;
    },
  };
  const attemptBudget = options.turnBudget?.httpAttemptBudget ?? localAttemptBudget;

  const execute = async (
    name: string,
    raw: unknown,
  ): Promise<{ content: [{ type: "text"; text: string }]; details: undefined }> => {
    invocations++;
    aborted(options.signal);
    if (invocations > 24 || !(options.turnBudget?.reserveToolInvocation() ?? true))
      return {
        content: [{ type: "text", text: JSON.stringify(failure("BudgetExhausted")) }],
        details: undefined,
      };
    let result: unknown;
    const pendingCitations: string[] = [];
    const pendingCandidateIds: number[] = [];
    try {
      if (name === "searchBggTitles") {
        const args = titleArgs.parse(raw);
        if (titleCalls >= 2) result = failure("BudgetExhausted");
        else {
          titleCalls++;
          const message = options.ownerMessages[args.ownerMessageIndex];
          if (typeof message !== "string") result = failure("InvalidInput");
          else {
            const points = [...message];
            if (args.start >= args.end || args.end > points.length)
              result = failure("InvalidInput");
            else {
              const query = points.slice(args.start, args.end).join("");
              const normalized = query.trim();
              if (!titleSpanLooksLikeTitle(normalized)) result = failure("InvalidInput");
              else if (options.configured?.() === false) result = failure("NotConfigured");
              else {
                const observation = await options.transport.searchTitles(normalized, {
                  exact: args.exact,
                  limit: 10,
                  signal: options.signal,
                  attemptBudget,
                });
                result = discovery(
                  "title",
                  observation,
                  options.registry,
                  emittedCandidateIds,
                  explicitOwnerIds,
                  inspectedThingIds,
                  options.turnBudget?.reserveThingIds
                    ? (ids) => options.turnBudget?.reserveThingIds?.(ids) ?? true
                    : undefined,
                  pendingCitations,
                  pendingCandidateIds,
                );
              }
            }
          }
        }
      } else if (name === "reviewBggHot") {
        hotArgs.parse(raw);
        if (hotCalls >= 1) result = failure("BudgetExhausted");
        else {
          hotCalls++;
          if (options.configured?.() === false) result = failure("NotConfigured");
          else
            result = discovery(
              "hot",
              await options.transport.reviewHot({
                limit: 20,
                signal: options.signal,
                attemptBudget,
              }),
              options.registry,
              emittedCandidateIds,
              explicitOwnerIds,
              inspectedThingIds,
              options.turnBudget?.reserveThingIds
                ? (ids) => options.turnBudget?.reserveThingIds?.(ids) ?? true
                : undefined,
              pendingCitations,
              pendingCandidateIds,
            );
        }
      } else if (name === "readBggFacts") {
        const args = factsArgs.parse(raw);
        if (factsCalls >= 2) result = failure("BudgetExhausted");
        else if (args.bggIds.some((id) => !validId(id))) result = failure("InvalidInput");
        else if (
          args.bggIds.some(
            (id) =>
              !(
                explicitOwnerIds.has(id) ||
                emittedCandidateIds.has(id) ||
                (options.isIdAuthorized?.(id) ?? false)
              ),
          )
        )
          result = failure("UnauthorizedId");
        else {
          factsCalls++;
          const newIds = args.bggIds.filter((id) => !inspectedThingIds.has(id));
          if (options.configured?.() === false) result = failure("NotConfigured");
          else if (
            new Set([...inspectedThingIds, ...newIds]).size > ID_LIMIT ||
            !(options.turnBudget?.reserveThingIds?.(newIds) ?? true)
          )
            result = failure("BudgetExhausted");
          else {
            for (const id of newIds) inspectedThingIds.add(id);
            const observation = await options.transport.readFacts(
              args.bggIds,
              options.signal,
              attemptBudget,
            );
            result = factsResult(args.bggIds, observation, options.registry, pendingCitations);
            for (const fact of observation.facts)
              if (args.bggIds.includes(fact.bggId)) verifiedFacts.set(fact.bggId, fact);
          }
        }
      } else {
        const args = previewArgs.parse(raw);
        if (previewCalls >= 3) result = failure("BudgetExhausted");
        else if (!validId(args.bggId)) result = failure("InvalidInput");
        else if (
          !(
            explicitOwnerIds.has(args.bggId) ||
            emittedCandidateIds.has(args.bggId) ||
            (options.isIdAuthorized?.(args.bggId) ?? false)
          )
        )
          result = failure("UnauthorizedId");
        else if (options.configured?.() === false || !options.transport.previewFitness)
          result = failure("NotConfigured");
        else {
          previewCalls++;
          if (!inspectedThingIds.has(args.bggId)) {
            if (
              new Set([...inspectedThingIds, args.bggId]).size > ID_LIMIT ||
              !(options.turnBudget?.reserveThingIds?.([args.bggId]) ?? true)
            )
              result = failure("BudgetExhausted");
            else inspectedThingIds.add(args.bggId);
          }
          if (result === undefined) {
            result =
              previewCache.get(args.bggId) ??
              AnalystBggFitnessPreviewResultSchema.parse(
                await options.transport.previewFitness(args.bggId, {
                  signal: options.signal,
                  attemptBudget,
                  ...(verifiedFacts.has(args.bggId)
                    ? { cachedFact: verifiedFacts.get(args.bggId)! }
                    : {}),
                }),
              );
            const preview = result as {
              bggLookup?: { factCitationId?: string };
              calculationCitationId?: string;
              collectionCitationId?: string;
            };
            if (preview.bggLookup?.factCitationId)
              pendingCitations.push(preview.bggLookup.factCitationId);
            if (preview.calculationCitationId) pendingCitations.push(preview.calculationCitationId);
            if (preview.collectionCitationId) pendingCitations.push(preview.collectionCitationId);
            if (
              (result as { status?: string }).status === "ok" ||
              (result as { state?: string }).state === "existing-local-unverified"
            )
              previewCache.set(args.bggId, result);
          }
        }
      }
      aborted(options.signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (pendingCitations.length) options.registry.discard(pendingCitations);
        throw error;
      }
      const code = safeFailure(error);
      result = failure(code, code === "BggThrottled" || code === "BggOutage");
    }
    const accepted =
      utf8Bytes(result) <= MAX_TOOL_BYTES && responseBytes + utf8Bytes(result) <= MAX_TURN_BYTES;
    if (!accepted) result = failure("BudgetExhausted");
    responseBytes += utf8Bytes(result);
    options.onResult?.(name, result);
    if (
      accepted &&
      pendingCitations.length > 0 &&
      (result as { status?: string } | null)?.status !== "error"
    ) {
      options.registry.commit(pendingCitations);
      for (const id of pendingCandidateIds) emittedCandidateIds.add(id);
      if (pendingCandidateIds.length) options.onAuthorizedIds?.(pendingCandidateIds);
    } else if (pendingCitations.length > 0) options.registry.discard(pendingCitations);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      details: undefined,
    };
  };
  return [
    defineTool({
      name: "searchBggTitles",
      label: "Search BGG titles",
      description: "Search only a title span from an owner message.",
      parameters: titleParameters,
      execute: (_id, args) => execute("searchBggTitles", args),
    }),
    defineTool({
      name: "reviewBggHot",
      label: "Review BGG Hot",
      description: "Inspect the fixed boardgame Hot sample.",
      parameters: hotParameters,
      execute: (_id, args) => execute("reviewBggHot", args),
    }),
    defineTool({
      name: "readBggFacts",
      label: "Read BGG facts",
      description: "Read verified facts for owner-authorized or previously emitted BGG IDs.",
      parameters: factsParameters,
      execute: (_id, args) => execute("readBggFacts", args),
    }),
    defineTool({
      name: "previewBggFitness",
      label: "Preview BGG fitness",
      description: "Preview personal fitness for an owner-authorized or discovered BGG ID.",
      parameters: previewParameters,
      execute: (_id, args) => execute("previewBggFitness", args),
    }),
  ];
}

function discovery(
  source: "title" | "hot",
  observation: BoardgameTitleSearchObservation,
  registry: AnalystBggEvidenceRegistry,
  emitted: Set<number>,
  explicit: Set<number>,
  inspected: Set<number>,
  reserveThingIds: AnalystBggTurnBudget["reserveThingIds"],
  staged: string[],
  candidateIds: number[],
) {
  const known = new Set([...emitted, ...explicit, ...inspected]);
  const remaining = Math.max(0, ID_LIMIT - known.size);
  const cap = Math.min(source === "title" ? 10 : 20, remaining);
  const uniqueRows = observation.candidates.filter(
    (row, index, rows) =>
      validId(row.bggId) && rows.findIndex((candidate) => candidate.bggId === row.bggId) === index,
  );
  const rows: typeof uniqueRows = [];
  let selectedNewIds = 0;
  for (const row of uniqueRows) {
    if (rows.length >= (source === "title" ? 10 : 20)) break;
    if (!known.has(row.bggId)) {
      if (selectedNewIds >= cap || (reserveThingIds !== undefined && !reserveThingIds([row.bggId])))
        continue;
      // Reserve each selected ID immediately, before staging its citation or exposing it.
      inspected.add(row.bggId);
      known.add(row.bggId);
      selectedNewIds++;
    }
    rows.push(row);
  }
  const obsCitation = registry.stage({
    evidenceClass: source === "title" ? "bgg-search-observation" : "bgg-hot-observation",
    sourceId: `${source}:${observation.observedAt}`,
    observedAt: observation.observedAt,
    payload: {
      returnedCount: observation.returnedCount,
      emittedCount: rows.length,
      truncated: observation.returnedCount > rows.length,
    },
    destination: "discovery",
  });
  staged.push(obsCitation);
  const candidates = rows.map((row) => {
    const primaryName = plainName(row.primaryName, 160);
    if (!primaryName) throw new Error("Invalid BGG candidate");
    const identityCitationId = registry.stage({
      evidenceClass: "bgg-candidate-identity",
      sourceId: `bgg:${row.bggId}:${observation.observedAt}`,
      observedAt: observation.observedAt,
      payload: { bggId: row.bggId, primaryName, yearPublished: row.yearPublished },
      destination: `https://boardgamegeek.com/boardgame/${row.bggId}`,
    });
    staged.push(identityCitationId);
    candidateIds.push(row.bggId);
    return { bggId: row.bggId, primaryName, yearPublished: row.yearPublished, identityCitationId };
  });
  const returnedCount = Math.max(observation.returnedCount, candidates.length);
  return (
    source === "title" ? AnalystBggTitleSearchResultSchema : AnalystBggHotReviewResultSchema
  ).parse({
    status: "ok",
    source,
    observedAt: observation.observedAt,
    returnedCount,
    emittedCount: candidates.length,
    truncated: returnedCount > candidates.length,
    observationCitationId: obsCitation,
    candidates,
  });
}

function factsResult(
  requested: number[],
  observation: BoardgameFactsObservation,
  registry: AnalystBggEvidenceRegistry,
  staged: string[],
) {
  const facts = observation.facts
    .filter(
      (f) =>
        requested.includes(f.bggId) && validId(f.bggId) && plainName(f.primaryName, 160).length > 0,
    )
    .map((f) => {
      const missingFields = [
        ...(f.yearMissing ? ["year" as const] : []),
        ...(f.mechanicsMissing ? ["mechanics" as const] : []),
      ];
      const factCitationId = registry.stage({
        evidenceClass: "bgg-thing-facts",
        sourceId: `bgg:${f.bggId}:${f.observedAt}`,
        observedAt: f.observedAt,
        payload: {
          bggId: f.bggId,
          primaryName: plainName(f.primaryName, 160),
          yearPublished: f.yearPublished,
          mechanics: f.mechanics
            .slice(0, 20)
            .map((m) => ({ id: m.id, name: plainName(m.name, 80) })),
          missingFields,
          warnings: f.warnings,
        },
        destination: `https://boardgamegeek.com/boardgame/${f.bggId}`,
      });
      staged.push(factCitationId);
      return {
        bggId: f.bggId,
        primaryName: plainName(f.primaryName, 160),
        yearPublished: f.yearPublished,
        mechanics: f.mechanics.slice(0, 20).map((m) => ({ id: m.id, name: plainName(m.name, 80) })),
        mechanicsComplete: f.mechanicsComplete && f.mechanics.length <= 20,
        missingFields:
          f.mechanics.length > 20 && !missingFields.includes("mechanics")
            ? [...missingFields, "mechanics" as const]
            : missingFields,
        warnings: f.warnings,
        observedAt: f.observedAt,
        factCitationId,
      };
    });
  const failures = [
    ...observation.failures.filter((f) => requested.includes(f.bggId)),
    ...requested
      .filter(
        (id) =>
          !facts.some((f) => f.bggId === id) && !observation.failures.some((f) => f.bggId === id),
      )
      .map((bggId) => ({ bggId, code: "BggParse" as const })),
  ];
  return AnalystBggFactsResultSchema.parse({
    status: failures.length ? "partial" : "ok",
    requestedCount: requested.length,
    facts,
    failures: failures.map((f) => ({ bggId: f.bggId, code: f.code, retryable: false })),
    coverage: failures.length ? "partial" : "complete",
  });
}

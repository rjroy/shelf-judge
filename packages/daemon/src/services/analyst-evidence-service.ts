import {
  AnalystCitationInspectRequestSchema,
  AnalystCitationInspectResultSchema,
  AnalystCitationSchema,
  AnalystGrepRequestSchema,
  AnalystGrepResultSchema,
  AnalystNoteDependencySchema,
  AnalystReadGamesRequestSchema,
  AnalystReadGamesResultSchema,
  AnalystReadGamesFieldSchema,
  AnalystSummarizeRequestSchema,
  AnalystSummarizeResultSchema,
  AnalystTopRequestSchema,
  AnalystTopResultSchema,
  type AnalystCitation,
  type AnalystEvidenceClass,
  type AnalystGrepResult,
  type AnalystReadGamesField,
  type AnalystReadGamesItem,
  type AnalystSummarizeResult,
  type AnalystTopResult,
} from "@shelf-judge/shared";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  createGroundedEvidenceRegistry,
  type GroundedEvidenceSnapshot,
} from "./grounded-analysis/evidence-registry.js";
import { canonicalSha256, profileSourceCoordinatorFor } from "./profile-source-coordinator.js";
import {
  ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST,
  type AnalystEvidenceSource,
  type AnalystProjectionSnapshot,
} from "./analyst-evidence-projections.js";
import type { OwnerGameNoteService } from "./owner-game-note-service.js";

const RetrievalRequestSchema = z
  .object({
    snapshotFingerprint: z.string().min(1),
    evidenceClasses: z
      .array(
        z.enum([
          "owner-game-note",
          "game-identity-ownership",
          "current-scoring",
          "imported-metadata",
          "play-acquisition",
          "collection-structure",
          "profile-evidence",
        ]),
      )
      .min(1),
    gameIds: z.array(z.string().min(1)).optional(),
    noteSearch: z.string().min(1).max(200).optional(),
    cursor: z
      .object({ snapshotFingerprint: z.string().min(1), token: z.string().uuid() })
      .strict()
      .nullable()
      .optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.evidenceClasses).size !== request.evidenceClasses.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceClasses"],
        message: "Evidence classes must be unique",
      });
    if (request.gameIds && new Set(request.gameIds).size !== request.gameIds.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gameIds"],
        message: "Game IDs must be unique",
      });
    if (request.gameIds !== undefined && request.evidenceClasses.includes("profile-evidence"))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gameIds"],
        message:
          "Profile evidence describes collection-wide cohorts and cannot be filtered by game IDs",
      });
    if (request.noteSearch !== undefined && !request.evidenceClasses.includes("owner-game-note"))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["noteSearch"],
        message: "Note search requires owner-game-note evidence",
      });
  });
const EvidenceIdentitySchema = z
  .object({
    citationId: z.string().min(1),
    sourceId: z.string().min(1),
    sourceVersion: z.string().min(1),
    evidenceClass: z.enum([
      "owner-game-note",
      "game-identity-ownership",
      "current-scoring",
      "imported-metadata",
      "play-acquisition",
      "collection-structure",
      "profile-evidence",
    ]),
  })
  .strict();

export interface AnalystEvidenceScope {
  readonly totalSourceCount: number;
  readonly matchingSourceCount: number;
  readonly examinedSourceCount: number;
  readonly exhaustive: boolean;
}
/** A locally-executed, compact text match with source identity for citation and invalidation. */
export interface AnalystRetrievedEvidence {
  readonly snapshotFingerprint: string;
  readonly evidence: GroundedEvidenceSnapshot;
  readonly citations: readonly AnalystCitation[];
  /** Every current note state examined to construct any retrieval in this turn. */
  readonly noteDependencies: readonly AnalystNoteDependency[];
  readonly scope: AnalystEvidenceScope;
  readonly nextCursor: { readonly snapshotFingerprint: string; readonly token: string } | null;
}
export interface AnalystReadGamesEvidence extends AnalystRetrievedEvidence {
  readonly items: readonly AnalystReadGamesItem[];
  readonly truncated: false;
}
/** Daemon-authored turn scope. Retrieval arguments can only narrow this scope. */
export interface AnalystOwnerNoteAuthorizationScope {
  readonly gameIds: readonly string[];
  readonly allowCollectionSynthesis: boolean;
  readonly allowLocalTextSearch: boolean;
}
export interface AnalystNoteDependency {
  readonly gameId: string;
  readonly noteVersion: number;
}
export type AnalystEvidenceRevalidation =
  | { readonly valid: true }
  | {
      readonly valid: false;
      readonly outcome: "unavailable";
      readonly reason: "evidence-load";
      readonly safeDetail: "source-changed";
    };
export type AnalystCitationInspection = z.infer<typeof AnalystCitationInspectResultSchema>;

export class AnalystEvidenceSourceChangedError extends Error {
  readonly outcome = "unavailable" as const;
  readonly reason = "evidence-load" as const;
  readonly safeDetail = "source-changed" as const;

  constructor() {
    super("Analyst evidence source changed");
    this.name = "AnalystEvidenceSourceChangedError";
  }
}
export interface AnalystEvidenceService {
  capture(): Promise<AnalystProjectionSnapshot>;
  /**
   * Model-selected local ranking by current-scoring displayedFitness. Numeric
   * fitness ranks descending; missing fitness ranks last; ties break by game ID.
   */
  top(snapshot: AnalystProjectionSnapshot, request: unknown): Promise<AnalystTopResult>;
  /** Deterministically aggregates owned games by selected imported metadata. */
  summarize?(
    snapshot: AnalystProjectionSnapshot,
    request: unknown,
  ): Promise<AnalystSummarizeResult>;
  /** Authenticates and refresh-checks an emitted top page before provider handoff. */
  withTopEvidence<Value>(
    result: AnalystTopResult,
    operation: (result: AnalystTopResult) => Promise<Value>,
  ): Promise<Value>;
  /** Authenticates and refresh-checks an emitted summary page before provider handoff. */
  withSummaryEvidence?<Value>(
    result: AnalystSummarizeResult,
    operation: (result: AnalystSummarizeResult) => Promise<Value>,
  ): Promise<Value>;
  retrieve(
    snapshot: AnalystProjectionSnapshot,
    request: unknown,
  ): Promise<AnalystRetrievedEvidence>;
  /** Reads only explicitly named games and evidence fields from the captured local snapshot. */
  readGames?(
    snapshot: AnalystProjectionSnapshot,
    ids: readonly string[],
    options: { readonly fields: readonly AnalystReadGamesField[] },
  ): Promise<AnalystReadGamesEvidence>;
  /** Searches the explicitly scoped local corpus without returning non-matching source payloads. */
  grep(snapshot: AnalystProjectionSnapshot, request: unknown): Promise<AnalystGrepResult>;
  compareNoteDependencies(
    dependencies: readonly AnalystNoteDependency[],
  ): Promise<"current" | "stale">;
  /** Runs a final dependency check and the supplied action in one coordinator turn. */
  withCurrentNoteDependencies<Value>(
    dependencies: readonly AnalystNoteDependency[],
    operation: () => Promise<Value>,
  ): Promise<Value>;
  /** Authenticates a retrieval object and supplies the daemon-stored package. */
  withRetrievedEvidence<Value>(
    retrieved: AnalystRetrievedEvidence,
    operation: (retrieved: AnalystRetrievedEvidence) => Promise<Value>,
  ): Promise<Value>;
  /** Safe provider seam: validates that a retrieved turn cannot drop examined dependencies. */
  handoff<Value>(
    snapshot: AnalystProjectionSnapshot,
    retrieved: AnalystRetrievedEvidence,
    deliver: (payload: AnalystRetrievedEvidence) => Promise<Value>,
  ): Promise<Value>;
  revalidate(snapshot: AnalystProjectionSnapshot): Promise<AnalystEvidenceRevalidation>;
  inspectCitation(request: unknown): Promise<AnalystCitationInspection>;
}

function freeze<Value>(value: Value): Value {
  const visit = (candidate: unknown): void => {
    if (typeof candidate !== "object" || candidate === null || Object.isFrozen(candidate)) return;
    Object.freeze(candidate);
    for (const child of Object.values(candidate)) visit(child);
  };
  visit(value);
  return value;
}
function sourceGameId(source: AnalystEvidenceSource): string | undefined {
  const payload = source.payload;
  return typeof payload === "object" &&
    payload !== null &&
    "gameId" in payload &&
    typeof payload.gameId === "string"
    ? payload.gameId
    : undefined;
}
type OwnerGameNoteRead = Awaited<ReturnType<OwnerGameNoteService["get"]>>;

function compareText(left: string, right: string): number {
  const leftPoints = Array.from(left.normalize("NFC"));
  const rightPoints = Array.from(right.normalize("NFC"));
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference =
      (leftPoints[index]?.codePointAt(0) ?? 0) - (rightPoints[index]?.codePointAt(0) ?? 0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function searchable(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en");
}

function compactMatchSnippet(value: string, pattern: string): string | undefined {
  const normalized = value.normalize("NFKC");
  const characters = [...normalized];
  const foldedCharacterIndexes: number[] = [];
  const offsets: { start: number; end: number }[] = [];
  let offset = 0;
  for (const [characterIndex, character] of characters.entries()) {
    const start = offset;
    offset += character.length;
    offsets.push({ start, end: offset });
    // Lowercase the full source below for contextual rules (for example Greek
    // final sigma). Per-character fold lengths still map folded positions to
    // original characters because that contextual substitution preserves length.
    const foldedCharacter = searchable(character);
    for (let index = 0; index < foldedCharacter.length; index += 1)
      foldedCharacterIndexes.push(characterIndex);
  }
  const folded = searchable(normalized);
  if (foldedCharacterIndexes.length !== folded.length) return undefined;
  const matchIndex = folded.indexOf(pattern);
  if (matchIndex < 0) return undefined;
  const matchStart = foldedCharacterIndexes[matchIndex];
  const matchEnd = foldedCharacterIndexes[matchIndex + pattern.length - 1];
  if (matchStart === undefined || matchEnd === undefined) return undefined;
  let start = matchStart;
  let end = matchEnd + 1;
  while (start > 0 && offsets[matchStart].start - offsets[start - 1].start <= 120) start -= 1;
  while (end < offsets.length && offsets[end].end - offsets[matchEnd].end <= 120) end += 1;
  while (true) {
    const snippetLength =
      offsets[end - 1].end -
      offsets[start].start +
      Number(start > 0) +
      Number(end < offsets.length);
    if (snippetLength <= 280) break;
    const leftContext = offsets[matchStart].start - offsets[start].start;
    const rightContext = offsets[end - 1].end - offsets[matchEnd].end;
    if (leftContext >= rightContext && start < matchStart) start += 1;
    else if (end > matchEnd + 1) end -= 1;
    else break;
  }
  return `${start > 0 ? "…" : ""}${normalized.slice(offsets[start].start, offsets[end - 1].end)}${end < offsets.length ? "…" : ""}`;
}

/**
 * Creates turn-local retrieval. Callers must retain the captured snapshot for
 * the turn; cursors never select a later collection revision.
 */
export function createAnalystEvidenceService(deps: {
  storageService: object;
  projectionSnapshotService: { capture(): Promise<AnalystProjectionSnapshot> };
  ownerGameNoteService?: Pick<OwnerGameNoteService, "get">;
  ownerNoteAuthorizationScope?: AnalystOwnerNoteAuthorizationScope;
  /** Injectable only to make opaque citation authorization deterministic in tests. */
  citationSecret?: Uint8Array;
  /** Shared turn-local response budget. Future model-loop integration supplies the turn boundary. */
  evidenceBudget?: { readonly maxCallsPerTurn?: number; readonly maxBytesPerTurn?: number };
  /** Explicit readGames response cap, including its per-item coverage wrapper. */
  readGamesBudget?: { readonly maxBytes?: number };
  /** Explicit summarize response cap, including source-set coverage metadata. */
  summarizeBudget?: { readonly maxBytes?: number };
  /** @deprecated Use evidenceBudget; retained for callers created before shared budgeting. */
  topBudget?: { readonly maxCallsPerTurn?: number; readonly maxBytesPerTurn?: number };
}): AnalystEvidenceService & {
  readGames(
    snapshot: AnalystProjectionSnapshot,
    ids: readonly string[],
    options: { readonly fields: readonly AnalystReadGamesField[] },
  ): Promise<AnalystReadGamesEvidence>;
  summarize(snapshot: AnalystProjectionSnapshot, request: unknown): Promise<AnalystSummarizeResult>;
  withSummaryEvidence<Value>(
    result: AnalystSummarizeResult,
    operation: (result: AnalystSummarizeResult) => Promise<Value>,
  ): Promise<Value>;
} {
  const coordinator = profileSourceCoordinatorFor(deps.storageService);
  const citationSecret = deps.citationSecret ?? randomBytes(32);
  const turns = new WeakMap<
    AnalystProjectionSnapshot,
    {
      cursors: Map<string, { scopeKey: string; offset: number }>;
      examined: Map<string, Set<string>>;
      noteReads: Map<string, OwnerGameNoteRead>;
      noteDependencies: Map<string, number>;
      noteLoad: Promise<void>;
      evidenceCalls: number;
      evidenceBytes: number;
    }
  >();
  const packages = new WeakMap<
    AnalystRetrievedEvidence,
    { readonly retrieved: AnalystRetrievedEvidence; readonly snapshot: AnalystProjectionSnapshot }
  >();
  const topPackages = new WeakMap<
    AnalystTopResult,
    {
      readonly result: AnalystTopResult;
      readonly snapshot: AnalystProjectionSnapshot;
      readonly sources: ReadonlyMap<string, string>;
    }
  >();
  const summaryPackages = new WeakMap<
    AnalystSummarizeResult,
    {
      readonly result: AnalystSummarizeResult;
      readonly snapshot: AnalystProjectionSnapshot;
      readonly sources: ReadonlyMap<string, string>;
    }
  >();
  const summaryCitations = new Map<
    string,
    {
      readonly source: AnalystEvidenceSource;
      readonly snapshot: AnalystProjectionSnapshot;
      readonly sources: ReadonlyMap<string, string>;
    }
  >();

  function turnFor(snapshot: AnalystProjectionSnapshot) {
    const existing = turns.get(snapshot);
    if (existing !== undefined) return existing;
    const created = {
      cursors: new Map<string, { scopeKey: string; offset: number }>(),
      examined: new Map<string, Set<string>>(),
      noteReads: new Map<string, OwnerGameNoteRead>(),
      noteDependencies: new Map<string, number>(),
      noteLoad: Promise.resolve(),
      evidenceCalls: 0,
      evidenceBytes: 0,
    };
    turns.set(snapshot, created);
    return created;
  }

  function noteCitationId(gameId: string, noteVersion: number): string {
    const digest = createHmac("sha256", citationSecret)
      .update(`collection-analyst-owner-note-v1\0${gameId}\0${noteVersion}`, "utf8")
      .digest("hex");
    return `analyst:owner-game-note:${digest}`;
  }

  function validNoteCitationId(citationId: string, gameId: string, noteVersion: number): boolean {
    const expected = Buffer.from(noteCitationId(gameId, noteVersion), "utf8");
    const actual = Buffer.from(citationId, "utf8");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  function noteDependenciesFor(turn: ReturnType<typeof turnFor>): readonly AnalystNoteDependency[] {
    return [...turn.noteDependencies]
      .map(([gameId, noteVersion]) => AnalystNoteDependencySchema.parse({ gameId, noteVersion }))
      .sort((left, right) => compareText(left.gameId, right.gameId));
  }

  async function compareParsedNoteDependencies(
    parsed: readonly AnalystNoteDependency[],
  ): Promise<"current" | "stale"> {
    const ownerGameNoteService = deps.ownerGameNoteService;
    if (ownerGameNoteService === undefined) return parsed.length === 0 ? "current" : "stale";
    for (const dependency of parsed) {
      try {
        const current = await ownerGameNoteService.get(dependency.gameId);
        if (
          current.gameId !== dependency.gameId ||
          current.note.version !== dependency.noteVersion
        ) {
          return "stale";
        }
      } catch {
        return "stale";
      }
    }
    return "current";
  }

  async function compareNoteDependencies(
    dependenciesInput: readonly AnalystNoteDependency[],
  ): Promise<"current" | "stale"> {
    const parsed = dependenciesInput.map((dependency) =>
      AnalystNoteDependencySchema.parse(dependency),
    );
    if (new Set(parsed.map(({ gameId }) => gameId)).size !== parsed.length) return "stale";
    return coordinator.runExclusive(() => compareParsedNoteDependencies(parsed));
  }

  async function withCurrentNoteDependencies<Value>(
    dependenciesInput: readonly AnalystNoteDependency[],
    operation: () => Promise<Value>,
  ): Promise<Value> {
    const dependencies = dependenciesInput.map((dependency) =>
      AnalystNoteDependencySchema.parse(dependency),
    );
    if (new Set(dependencies.map(({ gameId }) => gameId)).size !== dependencies.length)
      throw new AnalystEvidenceSourceChangedError();
    return coordinator.runExclusive(async () => {
      if ((await compareParsedNoteDependencies(dependencies)) === "stale")
        throw new AnalystEvidenceSourceChangedError();
      return operation();
    });
  }

  async function revalidate(
    snapshot: AnalystProjectionSnapshot,
  ): Promise<AnalystEvidenceRevalidation> {
    const turn = turns.get(snapshot);
    if (turn === undefined) return { valid: true };
    return (await compareNoteDependencies(noteDependenciesFor(turn))) === "current"
      ? { valid: true }
      : {
          valid: false,
          outcome: "unavailable",
          reason: "evidence-load",
          safeDetail: "source-changed",
        };
  }

  async function loadNotes(
    snapshot: AnalystProjectionSnapshot,
    gameIds: readonly string[],
  ): Promise<readonly OwnerGameNoteRead[]> {
    const ownerGameNoteService = deps.ownerGameNoteService;
    if (ownerGameNoteService === undefined)
      throw new Error("Owner note retrieval is not configured");
    const turn = turnFor(snapshot);
    const load = async (): Promise<void> => {
      await coordinator.runExclusive(async () => {
        if ((await compareParsedNoteDependencies(noteDependenciesFor(turn))) === "stale") {
          throw new AnalystEvidenceSourceChangedError();
        }
        for (const gameId of gameIds) {
          if (turn.noteReads.has(gameId)) continue;
          let read: OwnerGameNoteRead;
          try {
            read = await ownerGameNoteService.get(gameId);
          } catch {
            throw new AnalystEvidenceSourceChangedError();
          }
          if (read.gameId !== gameId) throw new AnalystEvidenceSourceChangedError();
          turn.noteReads.set(gameId, freeze(structuredClone(read)));
          turn.noteDependencies.set(gameId, read.note.version);
        }
      });
    };
    turn.noteLoad = turn.noteLoad.then(load, load);
    await turn.noteLoad;
    return gameIds
      .map((gameId) => turn.noteReads.get(gameId))
      .filter((read): read is OwnerGameNoteRead => read !== undefined);
  }

  function noteSource(read: OwnerGameNoteRead): AnalystEvidenceSource {
    const { gameId, note } = read;
    const text = note.state === "present" ? note.text : null;
    return freeze({
      evidenceClass: "owner-game-note" as const,
      sourceId: gameId,
      sourceVersion: String(note.version),
      citationId: noteCitationId(gameId, note.version),
      payload: {
        gameId,
        noteVersion: note.version,
        state: note.state,
        text,
      },
      canonicalSummary:
        note.state === "present"
          ? `Current owner testimony: ${note.text}`
          : note.state === "cleared"
            ? "Owner note is currently cleared"
            : "Owner note has not been set",
      ...(note.updatedAt === null ? {} : { observedAt: note.updatedAt }),
      destination: { operationId: "shelf.game.get" as const, parameters: { gameId } },
    });
  }

  function citationFor(entry: AnalystEvidenceSource): AnalystCitation {
    return AnalystCitationSchema.parse({
      citationId: entry.citationId,
      sourceId: entry.sourceId,
      sourceVersion: entry.sourceVersion,
      evidenceClass: entry.evidenceClass,
      testimony: false,
      ...(entry.observedAt === undefined ? {} : { observedAt: entry.observedAt }),
      canonicalSummary: entry.canonicalSummary,
      destination: entry.destination,
    });
  }

  function encodedBytes(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  }

  function consumeTurnBudget(turn: ReturnType<typeof turnFor>, response: unknown): void {
    const budget = deps.evidenceBudget ?? deps.topBudget;
    const maxCalls = budget?.maxCallsPerTurn ?? 16;
    const maxBytes = budget?.maxBytesPerTurn ?? 64 * 1024;
    const bytes = encodedBytes(response);
    if (turn.evidenceCalls >= maxCalls)
      throw new Error("Analyst evidence turn call budget is exhausted");
    if (bytes > maxBytes - turn.evidenceBytes)
      throw new Error("Analyst evidence turn byte budget is exhausted");
    turn.evidenceCalls += 1;
    turn.evidenceBytes += bytes;
  }

  function summarySourceSet(
    sourceId: string,
    sources: readonly AnalystEvidenceSource[],
  ): { readonly sourceId: string; readonly sourceVersion: string; readonly sourceCount: number } {
    const versions = sources
      .map(({ sourceId: inputSourceId, sourceVersion }) => ({
        sourceId: inputSourceId,
        sourceVersion,
      }))
      .sort(
        (left, right) =>
          compareText(left.sourceId, right.sourceId) ||
          compareText(left.sourceVersion, right.sourceVersion),
      );
    return { sourceId, sourceVersion: canonicalSha256(versions), sourceCount: versions.length };
  }

  function summaryAggregateSource(input: {
    readonly snapshot: AnalystProjectionSnapshot;
    readonly groupBy: "metadata.mechanics" | "metadata.categories";
    readonly measures: readonly ("gameCount" | "averageFitness")[];
    readonly group: { readonly id: number; readonly name: string } | null;
    readonly sources: readonly AnalystEvidenceSource[];
  }): AnalystEvidenceSource {
    const sourceSet = summarySourceSet(
      `analyst:collection-summary:${input.groupBy}:${[...input.measures].sort().join(",")}:${input.group?.id ?? "scope"}`,
      input.sources,
    );
    return freeze({
      evidenceClass: "collection-summary" as const,
      sourceId: sourceSet.sourceId,
      sourceVersion: sourceSet.sourceVersion,
      citationId: `analyst:collection-summary:${canonicalSha256(sourceSet).slice(0, 32)}`,
      payload: {
        snapshotFingerprint: input.snapshot.snapshotFingerprint,
        groupBy: input.groupBy,
        measures: [...input.measures].sort(),
        group: input.group,
        sourceCount: sourceSet.sourceCount,
      },
      canonicalSummary: "Current deterministic collection summary evidence",
      destination: { operationId: "shelf.collection.get" as const, parameters: {} },
    });
  }

  async function currentTopSources(
    snapshot: AnalystProjectionSnapshot,
    expected: ReadonlyMap<string, string>,
  ): Promise<boolean> {
    const current = await deps.projectionSnapshotService.capture();
    if (current.snapshotFingerprint !== snapshot.snapshotFingerprint) return false;
    const versions = new Map(
      current.sources.map((source) => [source.sourceId, source.sourceVersion]),
    );
    return [...expected].every(
      ([sourceId, sourceVersion]) => versions.get(sourceId) === sourceVersion,
    );
  }

  return Object.freeze({
    capture: () => coordinator.runExclusive(() => deps.projectionSnapshotService.capture()),
    async top(
      snapshot: AnalystProjectionSnapshot,
      requestInput: unknown,
    ): Promise<AnalystTopResult> {
      await Promise.resolve();
      const request = AnalystTopRequestSchema.parse(requestInput);
      if (request.snapshotFingerprint !== snapshot.snapshotFingerprint)
        throw new Error("Analyst top request belongs to a different snapshot");
      if (request.cursor && request.cursor.snapshotFingerprint !== snapshot.snapshotFingerprint)
        throw new Error("Analyst top cursor belongs to a different snapshot");
      const turn = turnFor(snapshot);
      const identityByGame = new Map<string, AnalystEvidenceSource>();
      const scoringByGame = new Map<string, AnalystEvidenceSource>();
      for (const source of snapshot.sources) {
        const gameId = sourceGameId(source);
        if (gameId === undefined) continue;
        if (source.evidenceClass === "game-identity-ownership") identityByGame.set(gameId, source);
        if (source.evidenceClass === "current-scoring") scoringByGame.set(gameId, source);
      }
      const ranked = [...identityByGame]
        .flatMap(([gameId, identity]) => {
          const scoring = scoringByGame.get(gameId);
          if (scoring === undefined) return [];
          const identityPayload = ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.evidence[
            "game-identity-ownership"
          ].parse(identity.payload);
          if (identityPayload.ownershipState !== "owned") return [];
          const scoringPayload = ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.evidence[
            "current-scoring"
          ].parse(scoring.payload);
          return [
            {
              gameId,
              name: identityPayload.displayName,
              fitness: scoringPayload.displayedFitness,
              breakdown: scoringPayload.validatedBreakdown.map(
                ({ axisId, axisName, contribution }) => ({
                  axisId,
                  axisName,
                  contribution,
                }),
              ),
              citations: [citationFor(identity), citationFor(scoring)],
            },
          ];
        })
        .sort(
          (left, right) =>
            (right.fitness === null ? Number.NEGATIVE_INFINITY : right.fitness) -
              (left.fitness === null ? Number.NEGATIVE_INFINITY : left.fitness) ||
            compareText(left.gameId, right.gameId),
        );
      const scopeKey = canonicalSha256({ tool: "top", rankBy: request.rankBy });
      const continuation = request.cursor ? turn.cursors.get(request.cursor.token) : undefined;
      if (request.cursor && (!continuation || continuation.scopeKey !== scopeKey))
        throw new Error("Analyst top cursor is invalid for this scope");
      const offset = continuation?.offset ?? 0;
      const requested = request.limit ?? 25;
      const entries = ranked.slice(offset, offset + requested);
      const nextOffset = offset + entries.length;
      let nextCursor: AnalystTopResult["nextCursor"] = null;
      if (nextOffset < ranked.length) {
        const token = crypto.randomUUID();
        nextCursor = { snapshotFingerprint: snapshot.snapshotFingerprint, token };
      }
      const examined = new Set(turn.examined.get(scopeKey));
      for (const entry of entries) examined.add(entry.gameId);
      const result = freeze(
        AnalystTopResultSchema.parse({
          snapshotFingerprint: snapshot.snapshotFingerprint,
          entries,
          scope: {
            totalGameCount: ranked.length,
            matchingGameCount: ranked.length,
            examinedGameCount: examined.size,
            exhaustive: examined.size === ranked.length,
          },
          nextCursor,
          truncated: nextCursor !== null,
        }),
      );
      consumeTurnBudget(turn, result);
      turn.examined.set(scopeKey, examined);
      if (nextCursor !== null) turn.cursors.set(nextCursor.token, { scopeKey, offset: nextOffset });
      const sources = new Map<string, string>();
      for (const entry of entries)
        for (const citation of entry.citations)
          sources.set(citation.sourceId, citation.sourceVersion);
      topPackages.set(result, { result, snapshot, sources });
      return result;
    },
    async summarize(
      snapshot: AnalystProjectionSnapshot,
      requestInput: unknown,
    ): Promise<AnalystSummarizeResult> {
      await Promise.resolve();
      const request = AnalystSummarizeRequestSchema.parse(requestInput);
      if (request.snapshotFingerprint !== snapshot.snapshotFingerprint)
        throw new Error("Analyst summarize request belongs to a different snapshot");
      if (request.cursor && request.cursor.snapshotFingerprint !== snapshot.snapshotFingerprint)
        throw new Error("Analyst summarize cursor belongs to a different snapshot");

      const identities = new Map<string, AnalystEvidenceSource>();
      const metadataByGame = new Map<string, AnalystEvidenceSource>();
      const scoringByGame = new Map<string, AnalystEvidenceSource>();
      for (const source of snapshot.sources) {
        const gameId = sourceGameId(source);
        if (gameId === undefined) continue;
        if (source.evidenceClass === "game-identity-ownership") identities.set(gameId, source);
        if (source.evidenceClass === "imported-metadata") metadataByGame.set(gameId, source);
        if (source.evidenceClass === "current-scoring") scoringByGame.set(gameId, source);
      }
      const ownedGameIds = [...identities]
        .flatMap(([gameId, source]) =>
          ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.evidence["game-identity-ownership"].parse(
            source.payload,
          ).ownershipState === "owned"
            ? [gameId]
            : [],
        )
        .sort(compareText);
      const ownedGameIdSet = new Set(ownedGameIds);
      const metadataGameIds = ownedGameIds.filter((gameId) => metadataByGame.has(gameId));
      const fitnessByGame = new Map<string, number>();
      for (const gameId of ownedGameIds) {
        const scoring = scoringByGame.get(gameId);
        if (scoring === undefined) continue;
        const fitness = ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.evidence["current-scoring"].parse(
          scoring.payload,
        ).displayedFitness;
        if (fitness !== null && Number.isFinite(fitness)) fitnessByGame.set(gameId, fitness);
      }
      type Group = {
        readonly id: number;
        readonly name: string;
        readonly gameIds: Set<string>;
      };
      const groups = new Map<number, Group>();
      const metadataField = request.groupBy === "metadata.mechanics" ? "mechanics" : "categories";
      const groupValueGameIds = new Set<string>();
      for (const gameId of metadataGameIds) {
        const metadata = ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.evidence[
          "imported-metadata"
        ].parse(metadataByGame.get(gameId)?.payload);
        // IDs distinguish BGG tags with coincident display names. Repeated tag IDs
        // on a malformed source still contribute a game only once to that group.
        const tags = new Map(metadata[metadataField].map((value) => [value.id, value]));
        if (tags.size > 0) groupValueGameIds.add(gameId);
        for (const tag of tags.values()) {
          const group = groups.get(tag.id) ?? {
            id: tag.id,
            name: tag.name,
            gameIds: new Set<string>(),
          };
          group.gameIds.add(gameId);
          groups.set(tag.id, group);
        }
      }
      const includesCount = request.measures.includes("gameCount");
      const includesAverage = request.measures.includes("averageFitness");
      const summarized = [...groups.values()]
        .map((group) => {
          const gameIds = [...group.gameIds].sort(compareText);
          const fitnessValues = gameIds.flatMap((gameId) => {
            const fitness = fitnessByGame.get(gameId);
            return fitness === undefined ? [] : [fitness];
          });
          const contributingSources = gameIds.flatMap((gameId) => {
            const identity = identities.get(gameId);
            const metadata = metadataByGame.get(gameId);
            const scoring =
              includesAverage && fitnessByGame.has(gameId) ? scoringByGame.get(gameId) : undefined;
            return [identity, metadata, scoring].filter(
              (source): source is AnalystEvidenceSource => source !== undefined,
            );
          });
          const aggregateSource = summaryAggregateSource({
            snapshot,
            groupBy: request.groupBy,
            measures: request.measures,
            group: { id: group.id, name: group.name },
            sources: contributingSources,
          });
          return {
            group: { id: group.id, name: group.name },
            ...(includesCount ? { gameCount: gameIds.length } : {}),
            ...(includesAverage
              ? {
                  averageFitness:
                    fitnessValues.length === 0
                      ? null
                      : fitnessValues.reduce((sum, value) => sum + value, 0) / fitnessValues.length,
                }
              : {}),
            fitnessGameCount: fitnessValues.length,
            citation: citationFor(aggregateSource),
            aggregateSource,
          };
        })
        .sort(
          (left, right) =>
            (right.gameCount ?? left.fitnessGameCount) -
              (left.gameCount ?? right.fitnessGameCount) ||
            compareText(left.group.name, right.group.name) ||
            left.group.id - right.group.id,
        );
      const scopeKey = canonicalSha256({
        tool: "summarize",
        groupBy: request.groupBy,
        measures: [...request.measures].sort(),
      });
      const turn = turnFor(snapshot);
      const continuation = request.cursor ? turn.cursors.get(request.cursor.token) : undefined;
      if (request.cursor && (!continuation || continuation.scopeKey !== scopeKey))
        throw new Error("Analyst summarize cursor is invalid for this scope");
      const offset = continuation?.offset ?? 0;
      const allSources = [...ownedGameIdSet].flatMap((gameId) =>
        [identities.get(gameId), metadataByGame.get(gameId), scoringByGame.get(gameId)].filter(
          (source): source is AnalystEvidenceSource => source !== undefined,
        ),
      );
      const scope = {
        totalGameCount: ownedGameIds.length,
        metadataSourceGameCount: metadataGameIds.length,
        groupValueGameCount: groupValueGameIds.size,
        missingGroupValueGameCount: ownedGameIds.length - groupValueGameIds.size,
        fitnessGameCount: fitnessByGame.size,
        missingFitnessGameCount: ownedGameIds.length - fitnessByGame.size,
        examinedGameCount: ownedGameIds.length,
        exhaustive: true,
      };
      const scopeSource = summaryAggregateSource({
        snapshot,
        groupBy: request.groupBy,
        measures: request.measures,
        group: null,
        sources: allSources,
      });
      const requested = request.limit ?? 25;
      const configuredMaxBytes = deps.summarizeBudget?.maxBytes ?? 48 * 1024;
      const remainingTurnBytes =
        (deps.evidenceBudget ?? deps.topBudget)?.maxBytesPerTurn ?? 64 * 1024;
      const maxBytes = Math.min(configuredMaxBytes, remainingTurnBytes - turn.evidenceBytes);
      const provisionalCursor = {
        snapshotFingerprint: snapshot.snapshotFingerprint,
        token: crypto.randomUUID(),
      };
      const createResult = (entries: typeof summarized, hasMore: boolean) =>
        AnalystSummarizeResultSchema.parse({
          snapshotFingerprint: snapshot.snapshotFingerprint,
          groupBy: request.groupBy,
          measures: request.measures,
          entries: entries.map(
            ({ group, gameCount, averageFitness, fitnessGameCount, citation }) => ({
              group,
              ...(gameCount === undefined ? {} : { gameCount }),
              ...(averageFitness === undefined ? {} : { averageFitness }),
              fitnessGameCount,
              citation,
            }),
          ),
          scope,
          citation: citationFor(scopeSource),
          nextCursor: hasMore ? provisionalCursor : null,
          truncated: hasMore,
        });
      let entryCount = Math.min(requested, summarized.length - offset);
      let result = createResult(
        summarized.slice(offset, offset + entryCount),
        offset + entryCount < summarized.length,
      );
      while (entryCount > 0 && encodedBytes(result) > maxBytes) {
        entryCount -= 1;
        result = createResult(
          summarized.slice(offset, offset + entryCount),
          offset + entryCount < summarized.length,
        );
      }
      if (encodedBytes(result) > maxBytes || (entryCount === 0 && offset < summarized.length))
        throw new Error("Analyst summarize minimum response exceeds byte limit");
      const nextOffset = offset + entryCount;
      const nextCursor =
        nextOffset < summarized.length
          ? { snapshotFingerprint: snapshot.snapshotFingerprint, token: crypto.randomUUID() }
          : null;
      result = AnalystSummarizeResultSchema.parse({
        ...result,
        nextCursor,
        truncated: nextCursor !== null,
      });
      const frozenResult = freeze(result);
      consumeTurnBudget(turn, frozenResult);
      if (nextCursor !== null) turn.cursors.set(nextCursor.token, { scopeKey, offset: nextOffset });
      const sources = new Map<string, string>();
      for (const gameId of ownedGameIdSet)
        for (const source of [
          identities.get(gameId),
          metadataByGame.get(gameId),
          scoringByGame.get(gameId),
        ])
          if (source !== undefined) sources.set(source.sourceId, source.sourceVersion);
      summaryPackages.set(frozenResult, { result: frozenResult, snapshot, sources });
      for (const entry of summarized) {
        const aggregateSource = entry.aggregateSource;
        summaryCitations.set(aggregateSource.citationId, {
          source: aggregateSource,
          snapshot,
          sources,
        });
      }
      summaryCitations.set(scopeSource.citationId, { source: scopeSource, snapshot, sources });
      return frozenResult;
    },
    async grep(
      snapshot: AnalystProjectionSnapshot,
      requestInput: unknown,
    ): Promise<AnalystGrepResult> {
      const request = AnalystGrepRequestSchema.parse(requestInput);
      if (request.snapshotFingerprint !== snapshot.snapshotFingerprint)
        throw new Error("Analyst grep request belongs to a different snapshot");
      if (request.cursor && request.cursor.snapshotFingerprint !== snapshot.snapshotFingerprint)
        throw new Error("Analyst grep cursor belongs to a different snapshot");
      const ownedGameIds = new Set(
        snapshot.sources
          .filter((source) => source.evidenceClass === "game-identity-ownership")
          .flatMap((source) => {
            const payload = ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.evidence[
              "game-identity-ownership"
            ].parse(source.payload);
            return payload.ownershipState === "owned" ? [payload.gameId] : [];
          }),
      );
      if (request.gameIds.some((gameId) => !ownedGameIds.has(gameId)))
        throw new Error("Analyst grep scope must contain only owned games");
      const fields = new Set(request.allowedFields);
      const requestedGameIds = new Set(request.gameIds);
      const pattern = searchable(request.pattern);
      const turn = turnFor(snapshot);
      type Candidate = {
        readonly gameId: string;
        readonly field: "note" | "metadata.mechanic" | "metadata.category" | "metadata.description";
        readonly text: string;
        readonly source: AnalystEvidenceSource;
      };
      const candidates: Candidate[] = [];
      const examinedSourceKeys = new Set<string>();
      const examinedSourceKey = (source: AnalystEvidenceSource) =>
        `${source.evidenceClass}\u0000${source.sourceId}\u0000${source.sourceVersion}`;
      for (const source of snapshot.sources) {
        if (source.evidenceClass !== "imported-metadata") continue;
        const metadata = ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.evidence[
          "imported-metadata"
        ].parse(source.payload);
        if (!requestedGameIds.has(metadata.gameId)) continue;
        examinedSourceKeys.add(examinedSourceKey(source));
        if (fields.has("metadata.mechanics"))
          for (const mechanic of metadata.mechanics)
            candidates.push({
              gameId: metadata.gameId,
              field: "metadata.mechanic",
              text: mechanic.name,
              source,
            });
        if (fields.has("metadata.categories"))
          for (const category of metadata.categories)
            candidates.push({
              gameId: metadata.gameId,
              field: "metadata.category",
              text: category.name,
              source,
            });
        if (fields.has("metadata.description") && metadata.description !== null)
          candidates.push({
            gameId: metadata.gameId,
            field: "metadata.description",
            text: metadata.description,
            source,
          });
      }
      if (fields.has("notes")) {
        const authorization = deps.ownerNoteAuthorizationScope;
        if (authorization === undefined || !authorization.allowLocalTextSearch)
          throw new Error("Owner-note text search is not authorized");
        const authorizedGameIds = new Set(authorization.gameIds);
        if (request.gameIds.some((gameId) => !authorizedGameIds.has(gameId)))
          throw new Error("Analyst grep note scope is not authorized");
        for (const read of await loadNotes(snapshot, request.gameIds)) {
          const source = noteSource(read);
          examinedSourceKeys.add(examinedSourceKey(source));
          if (read.note.state !== "present") continue;
          candidates.push({
            gameId: read.gameId,
            field: "note",
            text: read.note.text,
            source,
          });
        }
      }
      const matches = candidates.flatMap(({ gameId, field, text, source }) => {
        const snippet = compactMatchSnippet(text, pattern);
        return snippet === undefined
          ? []
          : [
              {
                gameId,
                field,
                snippet,
                sourceId: source.sourceId,
                sourceVersion: source.sourceVersion,
                citationId: source.citationId,
                evidenceClass: source.evidenceClass,
              },
            ];
      });
      const scopeKey = canonicalSha256({
        tool: "grep",
        pattern,
        allowedFields: [...fields].sort(),
        gameIds: [...requestedGameIds].sort(),
      });
      const continuation = request.cursor ? turn.cursors.get(request.cursor.token) : undefined;
      if (request.cursor && (!continuation || continuation.scopeKey !== scopeKey))
        throw new Error("Analyst grep cursor is invalid for this scope");
      const offset = continuation?.offset ?? 0;
      const returned = matches.slice(offset, offset + (request.limit ?? 25));
      const nextOffset = offset + returned.length;
      const nextCursor =
        nextOffset < matches.length
          ? { snapshotFingerprint: snapshot.snapshotFingerprint, token: crypto.randomUUID() }
          : null;
      const result = freeze(
        AnalystGrepResultSchema.parse({
          snapshotFingerprint: snapshot.snapshotFingerprint,
          matches: returned,
          scope: {
            totalSourceCount: examinedSourceKeys.size,
            matchingSourceCount: new Set(
              matches.map(
                ({ evidenceClass, sourceId, sourceVersion }) =>
                  `${evidenceClass}\u0000${sourceId}\u0000${sourceVersion}`,
              ),
            ).size,
            examinedSourceCount: examinedSourceKeys.size,
            exhaustive: true,
          },
          nextCursor,
          truncated: nextCursor !== null,
        }),
      );
      consumeTurnBudget(turn, result);
      if (nextCursor !== null) turn.cursors.set(nextCursor.token, { scopeKey, offset: nextOffset });
      return result;
    },
    async withTopEvidence<Value>(
      result: AnalystTopResult,
      operation: (result: AnalystTopResult) => Promise<Value>,
    ): Promise<Value> {
      const packageRecord = topPackages.get(result);
      if (packageRecord === undefined) throw new AnalystEvidenceSourceChangedError();
      return coordinator.runExclusive(async () => {
        if (!(await currentTopSources(packageRecord.snapshot, packageRecord.sources)))
          throw new AnalystEvidenceSourceChangedError();
        return operation(packageRecord.result);
      });
    },
    async withSummaryEvidence<Value>(
      result: AnalystSummarizeResult,
      operation: (result: AnalystSummarizeResult) => Promise<Value>,
    ): Promise<Value> {
      const packageRecord = summaryPackages.get(result);
      if (packageRecord === undefined) throw new AnalystEvidenceSourceChangedError();
      return coordinator.runExclusive(async () => {
        if (!(await currentTopSources(packageRecord.snapshot, packageRecord.sources)))
          throw new AnalystEvidenceSourceChangedError();
        return operation(packageRecord.result);
      });
    },
    async retrieve(
      snapshot: AnalystProjectionSnapshot,
      requestInput: unknown,
    ): Promise<AnalystRetrievedEvidence> {
      const request = RetrievalRequestSchema.parse(requestInput);
      if (request.snapshotFingerprint !== snapshot.snapshotFingerprint)
        throw new Error("Analyst retrieval request belongs to a different snapshot");
      if (request.cursor && request.cursor.snapshotFingerprint !== snapshot.snapshotFingerprint)
        throw new Error("Analyst retrieval cursor belongs to a different snapshot");
      const allowed = new Set<AnalystEvidenceClass>(request.evidenceClasses);
      const games = request.gameIds === undefined ? undefined : new Set(request.gameIds);
      const turn = turnFor(snapshot);
      let sources: readonly AnalystEvidenceSource[] = snapshot.sources;
      if (allowed.has("owner-game-note")) {
        const authorization = deps.ownerNoteAuthorizationScope;
        if (authorization === undefined) throw new Error("Owner-note retrieval is not authorized");
        if (request.gameIds === undefined && !authorization.allowCollectionSynthesis)
          throw new Error("Collection-wide owner-note retrieval is not authorized");
        if (request.noteSearch !== undefined && !authorization.allowLocalTextSearch)
          throw new Error("Owner-note text search is not authorized");
        const authorizedGameIds = new Set(authorization.gameIds);
        const candidates = [
          ...new Set(
            snapshot.sources
              .filter((entry) => entry.evidenceClass === "game-identity-ownership")
              .map((entry) => sourceGameId(entry))
              .filter((gameId): gameId is string => gameId !== undefined)
              .filter((gameId) => authorizedGameIds.has(gameId))
              .filter((gameId) => games === undefined || games.has(gameId)),
          ),
        ];
        const reads = await loadNotes(snapshot, candidates);
        const query = request.noteSearch === undefined ? undefined : searchable(request.noteSearch);
        const notes = reads
          .filter(
            ({ note }) =>
              query === undefined ||
              (note.state === "present" && searchable(note.text).includes(query)),
          )
          .map(noteSource);
        sources = [...snapshot.sources, ...notes];
      }
      const matching = sources.filter(
        (entry) =>
          allowed.has(entry.evidenceClass) &&
          (games === undefined || games.has(sourceGameId(entry) ?? "")),
      );
      const scopeKey = canonicalSha256({
        evidenceClasses: [...allowed].sort(),
        gameIds: games === undefined ? null : [...games].sort(),
        noteSearch: request.noteSearch ?? null,
      });
      const continuation = request.cursor ? turn.cursors.get(request.cursor.token) : undefined;
      if (request.cursor && (!continuation || continuation.scopeKey !== scopeKey))
        throw new Error("Analyst retrieval cursor is invalid for this scope");
      const offset = continuation?.offset ?? 0;
      const limit = request.limit ?? 25;
      const returned = matching.slice(offset, offset + limit);
      const nextOffset = offset + returned.length;
      const expectedSources = returned.map(({ evidenceClass, sourceId, sourceVersion }) => ({
        evidenceClass,
        sourceId,
        sourceVersion,
      }));
      // Snapshot only the schemas authorized for this retrieval. This prevents
      // an unrelated future manifest class from widening this turn's boundary.
      const manifest = {
        manifestId: ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.manifestId,
        manifestVersion: ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.manifestVersion,
        evidence: Object.fromEntries(
          request.evidenceClasses.map((evidenceClass) => [
            evidenceClass,
            ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.evidence[evidenceClass],
          ]),
        ),
      };
      const registry = createGroundedEvidenceRegistry({
        manifest,
        evidenceIdentitySchema: EvidenceIdentitySchema,
        expectedSources,
      });
      const citations: AnalystCitation[] = [];
      for (const entry of returned) {
        const identity = {
          evidenceClass: entry.evidenceClass,
          sourceId: entry.sourceId,
          sourceVersion: entry.sourceVersion,
        };
        registry.recordExamined(identity);
        registry.add({ ...identity, citationId: entry.citationId, payload: entry.payload });
        citations.push(
          AnalystCitationSchema.parse({
            citationId: entry.citationId,
            sourceId: entry.sourceId,
            sourceVersion: entry.sourceVersion,
            evidenceClass: entry.evidenceClass,
            testimony:
              entry.evidenceClass === "owner-game-note" &&
              entry.payload !== null &&
              typeof entry.payload === "object" &&
              "state" in entry.payload &&
              entry.payload.state === "present",
            ...(entry.observedAt === undefined ? {} : { observedAt: entry.observedAt }),
            canonicalSummary: entry.canonicalSummary,
            destination: entry.destination,
          }),
        );
      }
      const evidence = registry.complete();
      // Coverage is turn-local observed evidence, never a caller-provided offset.
      const examined = new Set(turn.examined.get(scopeKey));
      for (const entry of returned) examined.add(entry.citationId);
      let nextCursor: AnalystRetrievedEvidence["nextCursor"] = null;
      if (nextOffset < matching.length) {
        const token = crypto.randomUUID();
        nextCursor = { snapshotFingerprint: snapshot.snapshotFingerprint, token };
      }
      const validation = await revalidate(snapshot);
      if (!validation.valid) throw new AnalystEvidenceSourceChangedError();
      const retrieved = freeze({
        snapshotFingerprint: snapshot.snapshotFingerprint,
        evidence,
        citations,
        noteDependencies: noteDependenciesFor(turn),
        scope: {
          totalSourceCount: sources.length,
          matchingSourceCount: matching.length,
          examinedSourceCount: examined.size,
          exhaustive: examined.size === matching.length,
        },
        nextCursor,
      });
      consumeTurnBudget(turn, retrieved);
      turn.examined.set(scopeKey, examined);
      if (nextCursor !== null) turn.cursors.set(nextCursor.token, { scopeKey, offset: nextOffset });
      packages.set(retrieved, { retrieved, snapshot });
      return retrieved;
    },
    async readGames(
      snapshot: AnalystProjectionSnapshot,
      ids: readonly string[],
      options: { readonly fields: readonly AnalystReadGamesField[] },
    ): Promise<AnalystReadGamesEvidence> {
      const request = AnalystReadGamesRequestSchema.parse({
        snapshotFingerprint: snapshot.snapshotFingerprint,
        gameIds: ids,
        fields: options.fields,
      });
      const foundGameIds = new Set(
        snapshot.sources
          .filter((source) => source.evidenceClass === "game-identity-ownership")
          .map(sourceGameId)
          .filter((gameId): gameId is string => gameId !== undefined),
      );
      if (request.fields.includes("owner-game-note")) {
        const authorization = deps.ownerNoteAuthorizationScope;
        if (authorization === undefined) throw new Error("Owner-note retrieval is not authorized");
        const authorizedGameIds = new Set(authorization.gameIds);
        if (
          request.gameIds.some(
            (gameId) => foundGameIds.has(gameId) && !authorizedGameIds.has(gameId),
          )
        )
          throw new Error("Analyst readGames note scope is not authorized");
      }
      const retrieved = await this.retrieve(snapshot, {
        snapshotFingerprint: request.snapshotFingerprint,
        gameIds: request.gameIds,
        evidenceClasses: request.fields,
        // The bounded request shape permits at most sixty sources, so a page
        // cursor would indicate malformed local projections rather than an
        // incomplete response that could be silently dropped.
        limit: 100,
      });
      if (retrieved.nextCursor !== null)
        throw new Error("Analyst readGames response exceeds operation bounds; narrow the request");
      const gameIdBySource = new Map(
        snapshot.sources
          .map((source) => [source.sourceId, sourceGameId(source)] as const)
          .filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
      );
      const citationsByGameId = new Map<string, AnalystCitation[]>();
      for (const citation of retrieved.citations) {
        const gameId =
          citation.evidenceClass === "owner-game-note"
            ? citation.sourceId
            : gameIdBySource.get(citation.sourceId);
        if (gameId === undefined) continue;
        const citations = citationsByGameId.get(gameId) ?? [];
        citations.push(citation);
        citationsByGameId.set(gameId, citations);
      }
      const citationBySource = new Map(
        retrieved.citations.map((citation) => [
          `${citation.evidenceClass}\u0000${citation.sourceId}`,
          citation,
        ]),
      );
      const sourceByFieldAndGame = new Map(
        snapshot.sources.flatMap((source) => {
          const field = AnalystReadGamesFieldSchema.safeParse(source.evidenceClass);
          const gameId = sourceGameId(source);
          return !field.success || !request.fields.includes(field.data) || gameId === undefined
            ? []
            : [[`${field.data}\u0000${gameId}`, source] as const];
        }),
      );
      const result = AnalystReadGamesResultSchema.parse({
        snapshotFingerprint: snapshot.snapshotFingerprint,
        items: request.gameIds.map((gameId) => ({
          gameId,
          state: foundGameIds.has(gameId) ? "found" : "not-found",
          citations: citationsByGameId.get(gameId) ?? [],
          fields: request.fields.map((field) => {
            if (!foundGameIds.has(gameId))
              return { field, state: "not-found", covered: true, source: null };
            const citation = citationBySource.get(`${field}\u0000${gameId}`);
            const source = sourceByFieldAndGame.get(`${field}\u0000${gameId}`);
            if (field === "owner-game-note" && citation !== undefined) {
              const entry = retrieved.evidence.resolve(citation.citationId);
              const noteState =
                entry?.payload !== null &&
                typeof entry?.payload === "object" &&
                "state" in entry.payload &&
                typeof entry.payload.state === "string"
                  ? entry.payload.state
                  : "missing";
              return {
                field,
                state:
                  noteState === "cleared"
                    ? "cleared"
                    : noteState === "missing"
                      ? "missing"
                      : "available",
                covered: true,
                source: {
                  citationId: citation.citationId,
                  sourceId: citation.sourceId,
                  sourceVersion: citation.sourceVersion,
                },
              };
            }
            if (source === undefined || citation === undefined)
              return { field, state: "missing", covered: true, source: null };
            return {
              field,
              state: "available",
              covered: true,
              source: {
                citationId: citation.citationId,
                sourceId: citation.sourceId,
                sourceVersion: citation.sourceVersion,
              },
            };
          }),
        })),
        scope: retrieved.scope,
        truncated: false,
      });
      const read = freeze({ ...retrieved, items: result.items, truncated: result.truncated });
      const maxBytes = deps.readGamesBudget?.maxBytes ?? 48 * 1024;
      if (encodedBytes(read) > maxBytes)
        throw new Error("Analyst readGames response exceeds byte limit; narrow the request");
      packages.set(read, { retrieved: read, snapshot });
      return read;
    },
    compareNoteDependencies,
    withCurrentNoteDependencies,
    async withRetrievedEvidence<Value>(
      retrieved: AnalystRetrievedEvidence,
      operation: (retrieved: AnalystRetrievedEvidence) => Promise<Value>,
    ): Promise<Value> {
      const packageRecord = packages.get(retrieved);
      if (packageRecord === undefined) throw new AnalystEvidenceSourceChangedError();
      return coordinator.runExclusive(async () => {
        const turn = turns.get(packageRecord.snapshot);
        if (turn === undefined) throw new AnalystEvidenceSourceChangedError();
        const expectedDependencies = noteDependenciesFor(turn);
        if (
          canonicalSha256(packageRecord.retrieved.noteDependencies) !==
            canonicalSha256(expectedDependencies) ||
          (await compareParsedNoteDependencies(expectedDependencies)) === "stale"
        )
          throw new AnalystEvidenceSourceChangedError();
        return operation(packageRecord.retrieved);
      });
    },
    async handoff<Value>(
      snapshot: AnalystProjectionSnapshot,
      retrieved: AnalystRetrievedEvidence,
      deliver: (payload: AnalystRetrievedEvidence) => Promise<Value>,
    ): Promise<Value> {
      const packageRecord = packages.get(retrieved);
      if (
        packageRecord === undefined ||
        packageRecord.snapshot !== snapshot ||
        packageRecord.retrieved.snapshotFingerprint !== snapshot.snapshotFingerprint
      )
        throw new AnalystEvidenceSourceChangedError();
      const authoritative = packageRecord.retrieved;
      const turn = turns.get(snapshot);
      if (turn === undefined) throw new AnalystEvidenceSourceChangedError();
      const expectedDependencies = noteDependenciesFor(turn);
      if (
        canonicalSha256(authoritative.noteDependencies) !== canonicalSha256(expectedDependencies) ||
        (await revalidate(snapshot)).valid === false
      )
        throw new AnalystEvidenceSourceChangedError();
      return withCurrentNoteDependencies(expectedDependencies, () => deliver(authoritative));
    },
    revalidate,
    async inspectCitation(requestInput: unknown): Promise<AnalystCitationInspection> {
      const ownerGameNoteService = deps.ownerGameNoteService;
      const { citation } = AnalystCitationInspectRequestSchema.parse(requestInput);
      if (citation.evidenceClass === "collection-summary") {
        const record = summaryCitations.get(citation.citationId);
        if (
          record === undefined ||
          record.source.sourceId !== citation.sourceId ||
          record.source.sourceVersion !== citation.sourceVersion
        )
          throw new Error("Collection-summary citation identity is invalid");
        const state = (await currentTopSources(record.snapshot, record.sources))
          ? "current"
          : "superseded";
        return freeze(
          AnalystCitationInspectResultSchema.parse({
            state,
            destination: record.source.destination,
          }),
        );
      }
      if (ownerGameNoteService === undefined)
        throw new Error("Owner note inspection is not configured");
      if (citation.evidenceClass !== "owner-game-note") {
        throw new Error("Only owner-note citations are inspectable by this service");
      }
      const noteVersion = Number(citation.sourceVersion);
      if (
        !Number.isSafeInteger(noteVersion) ||
        noteVersion < 0 ||
        String(noteVersion) !== citation.sourceVersion ||
        !validNoteCitationId(citation.citationId, citation.sourceId, noteVersion)
      ) {
        throw new Error("Owner-note citation identity is invalid");
      }
      const destination = {
        operationId: "shelf.game.get" as const,
        parameters: { gameId: citation.sourceId },
      };
      let state: "current" | "superseded" = "superseded";
      try {
        const current = await coordinator.runExclusive(() =>
          ownerGameNoteService.get(citation.sourceId),
        );
        if (current.gameId === citation.sourceId && current.note.version === noteVersion) {
          state = "current";
        }
      } catch {
        state = "superseded";
      }
      return freeze(AnalystCitationInspectResultSchema.parse({ state, destination }));
    },
  });
}

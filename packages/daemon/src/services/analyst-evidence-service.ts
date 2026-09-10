import {
  AnalystCitationInspectRequestSchema,
  AnalystCitationInspectResultSchema,
  AnalystCitationSchema,
  AnalystGrepRequestSchema,
  AnalystGrepResultSchema,
  AnalystNoteDependencySchema,
  AnalystTopRequestSchema,
  AnalystTopResultSchema,
  type AnalystCitation,
  type AnalystEvidenceClass,
  type AnalystGrepResult,
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
  /** Authenticates and refresh-checks an emitted top page before provider handoff. */
  withTopEvidence<Value>(
    result: AnalystTopResult,
    operation: (result: AnalystTopResult) => Promise<Value>,
  ): Promise<Value>;
  retrieve(
    snapshot: AnalystProjectionSnapshot,
    request: unknown,
  ): Promise<AnalystRetrievedEvidence>;
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
      offsets[end - 1].end - offsets[start].start + Number(start > 0) + Number(end < offsets.length);
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
  /** @deprecated Use evidenceBudget; retained for callers created before shared budgeting. */
  topBudget?: { readonly maxCallsPerTurn?: number; readonly maxBytesPerTurn?: number };
}): AnalystEvidenceService {
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
    async grep(snapshot: AnalystProjectionSnapshot, requestInput: unknown): Promise<AnalystGrepResult> {
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
        const metadata = ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.evidence["imported-metadata"].parse(
          source.payload,
        );
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
      if (ownerGameNoteService === undefined)
        throw new Error("Owner note inspection is not configured");
      const { citation } = AnalystCitationInspectRequestSchema.parse(requestInput);
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

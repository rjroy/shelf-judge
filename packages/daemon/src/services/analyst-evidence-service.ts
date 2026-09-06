import {
  AnalystCitationSchema,
  type AnalystCitation,
  type AnalystEvidenceClass,
} from "@shelf-judge/shared";
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

const RetrievalRequestSchema = z
  .object({
    snapshotFingerprint: z.string().min(1),
    evidenceClasses: z
      .array(
        z.enum([
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
  });
const EvidenceIdentitySchema = z
  .object({
    citationId: z.string().min(1),
    sourceId: z.string().min(1),
    sourceVersion: z.string().min(1),
    evidenceClass: z.enum([
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
export interface AnalystRetrievedEvidence {
  readonly snapshotFingerprint: string;
  readonly evidence: GroundedEvidenceSnapshot;
  readonly citations: readonly AnalystCitation[];
  readonly scope: AnalystEvidenceScope;
  readonly nextCursor: { readonly snapshotFingerprint: string; readonly token: string } | null;
}
export interface AnalystEvidenceService {
  capture(): Promise<AnalystProjectionSnapshot>;
  retrieve(snapshot: AnalystProjectionSnapshot, request: unknown): AnalystRetrievedEvidence;
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

/**
 * Creates turn-local retrieval. Callers must retain the captured snapshot for
 * the turn; cursors never select a later collection revision.
 */
export function createAnalystEvidenceService(deps: {
  storageService: object;
  projectionSnapshotService: { capture(): Promise<AnalystProjectionSnapshot> };
}): AnalystEvidenceService {
  const coordinator = profileSourceCoordinatorFor(deps.storageService);
  const turns = new WeakMap<
    AnalystProjectionSnapshot,
    {
      cursors: Map<string, { scopeKey: string; offset: number }>;
      examined: Map<string, Set<string>>;
    }
  >();
  return Object.freeze({
    capture: () => coordinator.runExclusive(() => deps.projectionSnapshotService.capture()),
    retrieve(snapshot: AnalystProjectionSnapshot, requestInput: unknown): AnalystRetrievedEvidence {
      const request = RetrievalRequestSchema.parse(requestInput);
      if (request.snapshotFingerprint !== snapshot.snapshotFingerprint)
        throw new Error("Analyst retrieval request belongs to a different snapshot");
      if (request.cursor && request.cursor.snapshotFingerprint !== snapshot.snapshotFingerprint)
        throw new Error("Analyst retrieval cursor belongs to a different snapshot");
      const allowed = new Set<AnalystEvidenceClass>(request.evidenceClasses);
      const games = request.gameIds === undefined ? undefined : new Set(request.gameIds);
      const matching = snapshot.sources.filter(
        (entry) =>
          allowed.has(entry.evidenceClass) &&
          (games === undefined || games.has(sourceGameId(entry) ?? "")),
      );
      const turn = turns.get(snapshot) ?? {
        cursors: new Map<string, { scopeKey: string; offset: number }>(),
        examined: new Map<string, Set<string>>(),
      };
      turns.set(snapshot, turn);
      const scopeKey = canonicalSha256({
        evidenceClasses: [...allowed].sort(),
        gameIds: games === undefined ? null : [...games].sort(),
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
            testimony: false,
            ...(entry.observedAt === undefined ? {} : { observedAt: entry.observedAt }),
            canonicalSummary: entry.canonicalSummary,
            destination: entry.destination,
          }),
        );
      }
      const evidence = registry.complete();
      // Coverage is turn-local observed evidence, never a caller-provided offset.
      const examined = turn.examined.get(scopeKey) ?? new Set<string>();
      for (const entry of returned) examined.add(entry.citationId);
      turn.examined.set(scopeKey, examined);
      let nextCursor: AnalystRetrievedEvidence["nextCursor"] = null;
      if (nextOffset < matching.length) {
        const token = crypto.randomUUID();
        turn.cursors.set(token, { scopeKey, offset: nextOffset });
        nextCursor = { snapshotFingerprint: snapshot.snapshotFingerprint, token };
      }
      return freeze({
        snapshotFingerprint: snapshot.snapshotFingerprint,
        evidence,
        citations,
        scope: {
          totalSourceCount: snapshot.sources.length,
          matchingSourceCount: matching.length,
          examinedSourceCount: examined.size,
          exhaustive: examined.size === matching.length,
        },
        nextCursor,
      });
    },
  });
}

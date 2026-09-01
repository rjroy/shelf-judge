import {
  GroundedProviderIdentitySchema,
  NotFoundError,
  REFLECTION_MANIFEST_VERSION,
  REFLECTION_QUESTION_POLICIES,
  ReflectionCitationSchema,
  ReflectionDependencySchema,
  ReflectionDestinationSchema,
  ReflectionEvidenceIdentitySchema,
  ReflectionScopeSchema,
  type GroundedProviderIdentity,
  type ReflectionCitation,
  type ReflectionDependency,
  type ReflectionEvidenceIdentity,
  type ReflectionQuestionId,
  type ReflectionScope,
} from "@shelf-judge/shared";
import { z } from "zod";
import { createGroundedCitationRegistry } from "./grounded-analysis/citation-registry.js";
import {
  createGroundedEvidenceRegistry,
  type GroundedEvidenceSnapshot,
  type GroundedExaminedSource,
} from "./grounded-analysis/evidence-registry.js";
import type { OwnerGameNoteService } from "./owner-game-note-service.js";
import {
  canonicalJson,
  canonicalSha256,
  profileSourceCoordinatorFor,
} from "./profile-source-coordinator.js";
import {
  REFLECTION_DETERMINISTIC_EVIDENCE_MANIFEST,
  type ReflectionEvidencePageCursor,
  type ReflectionProjectionSnapshot,
  type ReflectionProjectionSnapshotService,
  type ReflectionQuestionProjection,
} from "./reflection-evidence-projections.js";
import {
  DEFAULT_REFLECTION_EVIDENCE_PAGE_SIZE,
  MAX_REFLECTION_EVIDENCE_PAGE_SIZE,
} from "./reflection-question-policy.js";

const TimestampSchema = z.string().datetime({ offset: true });
const ReflectionEvidenceEntryIdentitySchema = z
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
const OwnerGameNoteEvidenceSchema = z
  .object({ gameId: z.string().min(1), text: z.string().min(1) })
  .strict();
const RegistryCitationBaseFields = {
  citationId: z.string().min(1),
  sourceId: z.string().min(1),
  sourceVersion: z.string().min(1),
  observedAt: TimestampSchema.optional(),
  canonicalSummary: z.string().min(1),
  destination: ReflectionDestinationSchema,
};
const ReflectionRegistryCitationSchema = z.union([
  z
    .object({
      ...RegistryCitationBaseFields,
      evidenceClass: z.literal("owner-game-note"),
      testimony: z.literal(true),
    })
    .strict(),
  z
    .object({
      ...RegistryCitationBaseFields,
      evidenceClass: z.enum([
        "game-identity-ownership",
        "current-scoring",
        "imported-metadata",
        "play-acquisition",
        "collection-structure",
        "profile-evidence",
      ]),
      testimony: z.literal(false),
    })
    .strict(),
]);

export const REFLECTION_EVIDENCE_MANIFEST = Object.freeze({
  manifestId: "profile-reflection",
  manifestVersion: String(REFLECTION_MANIFEST_VERSION),
  evidence: Object.freeze({
    "owner-game-note": OwnerGameNoteEvidenceSchema,
    ...REFLECTION_DETERMINISTIC_EVIDENCE_MANIFEST.evidence,
  }),
});

export interface ReflectionEvidencePackage {
  readonly evidenceIdentity: ReflectionEvidenceIdentity;
  readonly snapshotFingerprint: string;
  readonly scope: ReflectionScope;
  readonly evidence: GroundedEvidenceSnapshot;
  readonly citations: readonly ReflectionCitation[];
  readonly dependencies: readonly ReflectionDependency[];
  readonly assembledAt: string;
}

export type ReflectionEvidenceRevalidationResult =
  | { readonly valid: true }
  | {
      readonly valid: false;
      readonly reason:
        | "provider-configuration-changed"
        | "contract-version-changed"
        | "deterministic-source-changed"
        | "question-scope-changed"
        | "note-source-changed"
        | "game-missing";
    };

export interface ReflectionEvidenceService {
  assemble(
    questionId: ReflectionQuestionId,
    provider: GroundedProviderIdentity,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ReflectionEvidencePackage>;
  revalidate(
    evidencePackage: ReflectionEvidencePackage,
    provider: GroundedProviderIdentity,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ReflectionEvidenceRevalidationResult>;
}

export interface ReflectionEvidenceServiceDeps {
  /**
   * The exact storage object used by the projection snapshot service and by the
   * collection mutation service behind ownerGameNoteService. Object identity is
   * the coordinator key, so wrappers are not interchangeable here.
   */
  storageService: object;
  projectionSnapshotService: ReflectionProjectionSnapshotService;
  ownerGameNoteService: Pick<OwnerGameNoteService, "get">;
  pageSize?: number;
  now?: () => string;
}

interface CapturedQuestionSources {
  readonly snapshot: ReflectionProjectionSnapshot;
  readonly projection: ReflectionQuestionProjection;
  readonly gameIds: readonly string[];
  readonly notes: readonly OwnerGameNoteRead[];
}

type OwnerGameNoteRead = Awaited<ReturnType<OwnerGameNoteService["get"]>>;
type PresentOwnerGameNoteRead = OwnerGameNoteRead & {
  readonly note: Extract<OwnerGameNoteRead["note"], { readonly state: "present" }>;
};

function isPresentOwnerGameNoteRead(read: OwnerGameNoteRead): read is PresentOwnerGameNoteRead {
  return read.note.state === "present";
}

function cloneAndFreeze<Value>(value: Value): Value {
  const copy = structuredClone(value);
  const freeze = (candidate: object): void => {
    Object.freeze(candidate);
    for (const key of Reflect.ownKeys(candidate)) {
      const child: unknown = Reflect.get(candidate, key);
      if (typeof child === "object" && child !== null && !Object.isFrozen(child)) freeze(child);
    }
  };
  if (typeof copy === "object" && copy !== null) freeze(copy);
  return copy;
}

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

function dependencyKey(dependency: ReflectionDependency): string {
  return dependency.category === "note"
    ? `${dependency.category}\0${dependency.gameId}`
    : `${dependency.category}\0${dependency.sourceId}`;
}

function completeDependencies(
  dependencies: readonly ReflectionDependency[],
): readonly ReflectionDependency[] {
  const byIdentity = new Map<string, ReflectionDependency>();
  for (const input of dependencies) {
    const dependency = ReflectionDependencySchema.parse(input);
    const key = dependencyKey(dependency);
    const prior = byIdentity.get(key);
    if (prior !== undefined && canonicalJson(prior) !== canonicalJson(dependency)) {
      throw new Error(`Conflicting Reflection dependency: ${key}`);
    }
    byIdentity.set(key, dependency);
  }
  return cloneAndFreeze(
    [...byIdentity.values()].sort((left, right) =>
      compareText(dependencyKey(left), dependencyKey(right)),
    ),
  );
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function walkPages(projection: ReflectionQuestionProjection, pageSize: number): readonly string[] {
  const gameIds: string[] = [];
  let cursor: ReflectionEvidencePageCursor | null = null;
  do {
    const page = projection.page(cursor, pageSize);
    if (
      page.snapshotFingerprint !== projection.snapshotFingerprint ||
      page.totalGameCount !== projection.gameIds.length
    ) {
      throw new Error("Reflection projection page does not match its fixed snapshot");
    }
    gameIds.push(...page.gameIds);
    cursor = page.nextCursor;
  } while (cursor !== null);
  if (!sameStrings(gameIds, projection.gameIds)) {
    throw new Error("Reflection projection paging did not cover the exact fixed scope");
  }
  return cloneAndFreeze(gameIds);
}

function providerDependency(provider: GroundedProviderIdentity): ReflectionDependency {
  return ReflectionDependencySchema.parse({
    category: "provider-configuration",
    sourceId: "grounded-analysis-provider",
    fingerprint: canonicalSha256(provider),
  });
}

function packageNoteGameIds(evidencePackage: ReflectionEvidencePackage): string[] {
  return evidencePackage.dependencies
    .filter((dependency) => dependency.category === "note")
    .map(({ gameId }) => gameId)
    .sort(compareText);
}

export function createReflectionEvidenceService(
  deps: ReflectionEvidenceServiceDeps,
): ReflectionEvidenceService {
  const coordinator = profileSourceCoordinatorFor(deps.storageService);
  const pageSize = deps.pageSize ?? DEFAULT_REFLECTION_EVIDENCE_PAGE_SIZE;
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_REFLECTION_EVIDENCE_PAGE_SIZE
  ) {
    throw new Error(
      `Reflection evidence page size must be between 1 and ${MAX_REFLECTION_EVIDENCE_PAGE_SIZE}`,
    );
  }
  const now = deps.now ?? (() => new Date().toISOString());

  async function capture(
    questionId: ReflectionQuestionId,
    signal?: AbortSignal,
  ): Promise<CapturedQuestionSources> {
    signal?.throwIfAborted();
    const snapshot = await deps.projectionSnapshotService.capture();
    signal?.throwIfAborted();
    const projection = snapshot.projections[questionId];
    if (projection.questionId !== questionId) {
      throw new Error("Reflection projection does not match the selected question");
    }
    if ((questionId === "pattern-exceptions") !== (projection.patternCandidateIds !== undefined)) {
      throw new Error(
        "Reflection projection pattern candidates do not match the selected question",
      );
    }
    const gameIds = walkPages(projection, pageSize);
    const notes: OwnerGameNoteRead[] = [];
    for (const gameId of gameIds) {
      signal?.throwIfAborted();
      const note = await deps.ownerGameNoteService.get(gameId);
      signal?.throwIfAborted();
      if (note.gameId !== gameId) throw new Error("Owner note read returned a different game");
      notes.push(note);
    }
    return { snapshot, projection, gameIds, notes };
  }

  async function assemble(
    questionId: ReflectionQuestionId,
    providerInput: GroundedProviderIdentity,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ReflectionEvidencePackage> {
    const provider = cloneAndFreeze(GroundedProviderIdentitySchema.parse(providerInput));
    return coordinator.runExclusive(async () => {
      const captured = await capture(questionId, options?.signal);
      const presentNotes = captured.notes.filter(isPresentOwnerGameNoteRead);
      const noteSources: GroundedExaminedSource[] = presentNotes.map(({ gameId, note }) => ({
        evidenceClass: "owner-game-note",
        sourceId: gameId,
        sourceVersion: String(note.version),
      }));
      const registry = createGroundedEvidenceRegistry({
        manifest: REFLECTION_EVIDENCE_MANIFEST,
        evidenceIdentitySchema: ReflectionEvidenceEntryIdentitySchema,
        expectedSources: [...captured.projection.evidence.examinedSources, ...noteSources],
      });

      for (const source of captured.projection.evidence.examinedSources)
        registry.recordExamined(source);
      for (const entry of captured.projection.evidence.entries) registry.add(entry);
      for (const { gameId, note } of presentNotes) {
        const identity = {
          evidenceClass: "owner-game-note" as const,
          sourceId: gameId,
          sourceVersion: String(note.version),
        };
        registry.recordExamined(identity);
        registry.add({
          ...identity,
          citationId: `reflection:owner-game-note:${gameId}:${note.version}`,
          payload: { gameId, text: note.text },
        });
      }
      const evidence = registry.complete();

      const noteCitations: ReflectionCitation[] = presentNotes.map(({ gameId, note }) =>
        ReflectionCitationSchema.parse({
          citationId: `reflection:owner-game-note:${gameId}:${note.version}`,
          sourceId: gameId,
          sourceVersion: String(note.version),
          evidenceClass: "owner-game-note",
          testimony: true,
          observedAt: note.updatedAt,
          canonicalSummary: note.text,
          destination: { operationId: "shelf.game.get", parameters: { gameId } },
        }),
      );
      const citationRegistry = createGroundedCitationRegistry({
        // Shared Reflection parsing above enforces note-version refinements. The
        // registry receives the equivalent structural schema required by its
        // immutable authorization snapshot.
        citationSchema: ReflectionRegistryCitationSchema,
        evidence,
      });
      const allCitations = [...captured.projection.citations, ...noteCitations];
      for (const citation of allCitations) citationRegistry.add(citation);
      const citations = citationRegistry.complete(allCitations.map(({ citationId }) => citationId));

      const dependencies = completeDependencies([
        ...captured.projection.dependencies,
        ...captured.notes.map(({ gameId, note }) =>
          ReflectionDependencySchema.parse({
            category: "note",
            gameId,
            noteVersion: note.version,
          }),
        ),
        providerDependency(provider),
      ]);
      const policy = REFLECTION_QUESTION_POLICIES[questionId];
      const evidenceIdentity = cloneAndFreeze(
        ReflectionEvidenceIdentitySchema.parse({
          manifestVersion: REFLECTION_MANIFEST_VERSION,
          questionId,
          questionVersion: policy.questionVersion,
          collectionId: captured.snapshot.collectionId,
          collectionSchemaVersion: captured.snapshot.collectionSchemaVersion,
          collectionRevision: captured.snapshot.collectionRevision,
          profileContractVersion: captured.snapshot.profileContractVersion,
          profileAlgorithmVersion: captured.snapshot.profileAlgorithmVersion,
          providerId: provider.providerId,
          modelId: provider.modelId,
        }),
      );
      const scope = cloneAndFreeze(
        ReflectionScopeSchema.parse({
          examinedPresentNoteCount: presentNotes.length,
          totalPresentNoteCount: presentNotes.length,
          examinedGameCount: captured.gameIds.length,
          relevantEligibleGameCount: captured.gameIds.length,
          excludedGameCount: captured.projection.excludedGameCount,
          exhaustiveNotes: true,
          ...(questionId === "pattern-exceptions"
            ? { patternCandidateIds: captured.projection.patternCandidateIds }
            : {}),
        }),
      );
      const assembledAt = TimestampSchema.parse(now());
      return Object.freeze({
        evidenceIdentity,
        snapshotFingerprint: captured.snapshot.snapshotFingerprint,
        scope,
        evidence,
        citations,
        dependencies,
        assembledAt,
      });
    });
  }

  async function revalidate(
    evidencePackage: ReflectionEvidencePackage,
    providerInput: GroundedProviderIdentity,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ReflectionEvidenceRevalidationResult> {
    const provider = GroundedProviderIdentitySchema.parse(providerInput);
    return coordinator.runExclusive(async () => {
      options?.signal?.throwIfAborted();
      const identity = evidencePackage.evidenceIdentity;
      const policy = REFLECTION_QUESTION_POLICIES[identity.questionId];
      if (
        identity.manifestVersion !== REFLECTION_MANIFEST_VERSION ||
        identity.questionVersion !== policy.questionVersion ||
        evidencePackage.evidence.manifestId !== REFLECTION_EVIDENCE_MANIFEST.manifestId ||
        evidencePackage.evidence.manifestVersion !== REFLECTION_EVIDENCE_MANIFEST.manifestVersion
      ) {
        return { valid: false, reason: "contract-version-changed" };
      }
      const capturedProviderDependency = evidencePackage.dependencies.find(
        (dependency) => dependency.category === "provider-configuration",
      );
      if (
        identity.providerId !== provider.providerId ||
        identity.modelId !== provider.modelId ||
        capturedProviderDependency === undefined ||
        canonicalJson(capturedProviderDependency) !== canonicalJson(providerDependency(provider))
      ) {
        return { valid: false, reason: "provider-configuration-changed" };
      }

      let captured: CapturedQuestionSources;
      try {
        captured = await capture(identity.questionId, options?.signal);
      } catch (error) {
        if (error instanceof NotFoundError) return { valid: false, reason: "game-missing" };
        throw error;
      }
      if (
        captured.snapshot.collectionId !== identity.collectionId ||
        captured.snapshot.collectionSchemaVersion !== identity.collectionSchemaVersion ||
        captured.snapshot.collectionRevision !== identity.collectionRevision ||
        captured.snapshot.profileContractVersion !== identity.profileContractVersion ||
        captured.snapshot.profileAlgorithmVersion !== identity.profileAlgorithmVersion ||
        captured.snapshot.snapshotFingerprint !== evidencePackage.snapshotFingerprint
      ) {
        return { valid: false, reason: "deterministic-source-changed" };
      }
      if (
        !sameStrings(captured.gameIds, packageNoteGameIds(evidencePackage)) ||
        captured.gameIds.length !== evidencePackage.scope.examinedGameCount ||
        captured.gameIds.length !== evidencePackage.scope.relevantEligibleGameCount ||
        captured.projection.excludedGameCount !== evidencePackage.scope.excludedGameCount ||
        !sameStrings(
          captured.projection.patternCandidateIds ?? [],
          evidencePackage.scope.patternCandidateIds ?? [],
        )
      ) {
        return { valid: false, reason: "question-scope-changed" };
      }
      const noteVersions = new Map(
        evidencePackage.dependencies
          .filter((dependency) => dependency.category === "note")
          .map((dependency) => [dependency.gameId, dependency.noteVersion]),
      );
      if (
        captured.notes.some(({ gameId, note }) => noteVersions.get(gameId) !== note.version) ||
        captured.notes.filter(({ note }) => note.state === "present").length !==
          evidencePackage.scope.examinedPresentNoteCount ||
        evidencePackage.scope.examinedPresentNoteCount !==
          evidencePackage.scope.totalPresentNoteCount ||
        evidencePackage.scope.exhaustiveNotes !== true
      ) {
        return { valid: false, reason: "note-source-changed" };
      }
      return { valid: true };
    });
  }

  return Object.freeze({ assemble, revalidate });
}

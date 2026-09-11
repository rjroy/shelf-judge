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
} from "./grounded-analysis/evidence-registry.js";
import type { AnalystEvidenceService } from "./analyst-evidence-service.js";
import type { AnalystProjectionSnapshot } from "./analyst-evidence-projections.js";
import { ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST } from "./analyst-evidence-projections.js";
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
      "collection-summary",
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
        "collection-summary",
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
  start?(
    questionId: ReflectionQuestionId,
    provider: GroundedProviderIdentity,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ReflectionEvidenceTurn>;
  finish?(turn: ReflectionEvidenceTurn): Promise<ReflectionEvidencePackage>;
  revalidate(
    evidencePackage: ReflectionEvidencePackage,
    provider: GroundedProviderIdentity,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ReflectionEvidenceRevalidationResult>;
}

export interface ReflectionEvidenceTurn {
  readonly initial: ReflectionEvidencePackage;
  readonly analystEvidence: AnalystEvidenceService;
  readonly analystSnapshot: AnalystProjectionSnapshot;
}

export interface ReflectionEvidenceServiceDeps {
  /**
   * The exact storage object used by the projection snapshot service and by the
   * collection mutation service behind ownerGameNoteService. Object identity is
   * the coordinator key, so wrappers are not interchangeable here.
   */
  storageService: object;
  projectionSnapshotService: ReflectionProjectionSnapshotService;
  ownerGameNoteService: {
    get(
      gameId: string,
    ): Promise<{ readonly gameId: string; readonly note: { readonly version: number } }>;
  };
  createAnalystEvidenceTurn?: (authorizedGameIds: readonly string[]) => AnalystEvidenceService;
  pageSize?: number;
  now?: () => string;
}

interface CapturedQuestionSources {
  readonly snapshot: ReflectionProjectionSnapshot;
  readonly projection: ReflectionQuestionProjection;
  readonly gameIds: readonly string[];
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

function analystPayloadForReflection(evidenceClass: string, payload: unknown): unknown {
  switch (evidenceClass) {
    case "game-identity-ownership": {
      const source = ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.evidence[evidenceClass].parse(payload);
      return {
        gameId: source.gameId,
        name: source.displayName,
        bggId: source.bggId,
        ownership: source.ownershipState,
      };
    }
    case "current-scoring": {
      const source = ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.evidence[evidenceClass].parse(payload);
      return {
        gameId: source.gameId,
        state: source.sourceState,
        score: source.displayedFitness,
        ratedAxisCount: source.validatedBreakdown.filter(
          ({ effectiveRating }) => effectiveRating !== null,
        ).length,
        totalAxisCount: source.validatedBreakdown.length,
        vetoed: source.veto !== null,
        vetoedBy: source.veto,
        hypotheticalScore: null,
        prediction: source.predictionStatus,
        breakdown: source.validatedBreakdown.map(
          ({
            axisId,
            axisName,
            weight,
            contribution,
            source: sourceKind,
            sourceValue,
            scoringRawValue,
            effectiveRating,
            overridden,
            overrideValue,
            predictionConfidence,
          }) => ({
            axisId,
            axisName,
            weight,
            contribution,
            source: sourceKind,
            sourceValue,
            scoringRawValue,
            effectiveRating,
            overridden,
            overrideValue,
            predictionConfidence,
          }),
        ),
      };
    }
    case "imported-metadata": {
      const source = ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.evidence[evidenceClass].parse(payload);
      const entityMetadata = (
        state: "complete" | "refresh-needed" | "unrefreshable",
        entities: readonly { readonly id: number; readonly name: string }[],
      ) => ({ state, entities, observedAt: source.sourceTime, refreshWarning: null });
      return {
        gameId: source.gameId,
        importedAt: source.sourceTime,
        yearPublished: null,
        minPlayers: source.playerCounts.min,
        maxPlayers: source.playerCounts.max,
        bestPlayers: source.playerCounts.best,
        playingTimeMinutes: source.playTime,
        weight: source.weight,
        categories: source.categories,
        mechanics: source.mechanics,
        families: source.families,
        subdomains: source.subdomains,
        entityMetadata: {
          mechanic: entityMetadata(source.completeness.mechanic, source.mechanics),
          designer: entityMetadata(source.completeness.designer, source.designers),
          artist: entityMetadata(source.completeness.artist, source.artists),
        },
      };
    }
    case "play-acquisition": {
      const source = ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.evidence[evidenceClass].parse(payload);
      return {
        gameId: source.gameId,
        playCount: source.playCount,
        acquisition:
          source.acquisitionPrice === null
            ? { state: "unknown" }
            : { state: "purchase", amount: source.acquisitionPrice },
        utilization: source.purchaseUtilization,
      };
    }
    case "collection-structure": {
      const source = ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.evidence[evidenceClass].parse(payload);
      return {
        gameId: source.gameId,
        shelf:
          source.shelfAssignment !== null && "shelfId" in source.shelfAssignment
            ? source.shelfAssignment
            : null,
        danglingShelfId:
          source.shelfAssignment !== null && "danglingShelfId" in source.shelfAssignment
            ? source.shelfAssignment.danglingShelfId
            : null,
        redundancy: source.redundancy,
      };
    }
    case "collection-summary": {
      const source = ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.evidence[evidenceClass].parse(payload);
      return {
        snapshotFingerprint: source.snapshotFingerprint,
        groupBy: source.groupBy,
        measures: source.measures,
        group: source.group,
        sourceCount: source.sourceCount,
      };
    }
    default:
      throw new Error(`Analyst evidence class is not supported by Reflection: ${evidenceClass}`);
  }
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
    return { snapshot, projection, gameIds };
  }

  async function assemble(
    questionId: ReflectionQuestionId,
    providerInput: GroundedProviderIdentity,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ReflectionEvidencePackage> {
    const provider = cloneAndFreeze(GroundedProviderIdentitySchema.parse(providerInput));
    return coordinator.runExclusive(async () => {
      const captured = await capture(questionId, options?.signal);
      const registry = createGroundedEvidenceRegistry({
        manifest: REFLECTION_EVIDENCE_MANIFEST,
        evidenceIdentitySchema: ReflectionEvidenceEntryIdentitySchema,
        expectedSources: captured.projection.evidence.examinedSources,
      });

      for (const source of captured.projection.evidence.examinedSources)
        registry.recordExamined(source);
      for (const entry of captured.projection.evidence.entries) registry.add(entry);
      const evidence = registry.complete();

      const citationRegistry = createGroundedCitationRegistry({
        // Shared Reflection parsing above enforces note-version refinements. The
        // registry receives the equivalent structural schema required by its
        // immutable authorization snapshot.
        citationSchema: ReflectionRegistryCitationSchema,
        evidence,
      });
      const allCitations = captured.projection.citations;
      for (const citation of allCitations) citationRegistry.add(citation);
      const citations = citationRegistry.complete(allCitations.map(({ citationId }) => citationId));

      const dependencies = completeDependencies([
        ...captured.projection.dependencies,
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
          examinedPresentNoteCount: 0,
          totalPresentNoteCount: null,
          examinedGameCount: 0,
          relevantEligibleGameCount: captured.gameIds.length,
          excludedGameCount: captured.projection.excludedGameCount,
          exhaustiveNotes: false,
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
        captured.gameIds.length !== evidencePackage.scope.relevantEligibleGameCount ||
        captured.projection.excludedGameCount !== evidencePackage.scope.excludedGameCount ||
        !sameStrings(
          captured.projection.patternCandidateIds ?? [],
          evidencePackage.scope.patternCandidateIds ?? [],
        )
      ) {
        return { valid: false, reason: "question-scope-changed" };
      }
      for (const dependency of evidencePackage.dependencies) {
        if (dependency.category !== "note") continue;
        const current = await deps.ownerGameNoteService.get(dependency.gameId);
        if (current.gameId !== dependency.gameId || current.note.version !== dependency.noteVersion)
          return { valid: false, reason: "note-source-changed" };
      }
      return { valid: true };
    });
  }

  async function start(
    questionId: ReflectionQuestionId,
    provider: GroundedProviderIdentity,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ReflectionEvidenceTurn> {
    const createTurn = deps.createAnalystEvidenceTurn;
    if (createTurn === undefined) throw new Error("Reflection collection tools are not configured");
    const initial = await assemble(questionId, provider, options);
    options?.signal?.throwIfAborted();
    const authorizedGameIds = await coordinator.runExclusive(async () =>
      capture(questionId, options?.signal),
    );
    if (
      authorizedGameIds.snapshot.collectionRevision !== initial.evidenceIdentity.collectionRevision
    )
      throw new Error("Reflection source changed while creating the tool turn");
    const analystEvidence = createTurn(authorizedGameIds.gameIds);
    const analystSnapshot = await analystEvidence.capture();
    if (analystSnapshot.collectionRevision !== initial.evidenceIdentity.collectionRevision) {
      throw new Error("Reflection and Analyst snapshots have different collection revisions");
    }
    return Object.freeze({ initial, analystEvidence, analystSnapshot });
  }

  async function finish(turn: ReflectionEvidenceTurn): Promise<ReflectionEvidencePackage> {
    const accumulated = await turn.analystEvidence.accumulatedEvidence(turn.analystSnapshot);
    const base = turn.initial;
    const deliveredEntries = accumulated.evidence.entries.flatMap((entry) => {
      if (entry.evidenceClass !== "owner-game-note") {
        const payload = analystPayloadForReflection(entry.evidenceClass, entry.payload);
        return [{ ...entry, payload }];
      }
      const payload = z
        .object({ gameId: z.string().min(1), state: z.literal("present"), text: z.string().min(1) })
        .passthrough()
        .safeParse(entry.payload);
      return payload.success
        ? [{ ...entry, payload: { gameId: payload.data.gameId, text: payload.data.text } }]
        : [];
    });
    const completedEntries = deliveredEntries;
    const deliveredCitationIds = new Set(deliveredEntries.map(({ citationId }) => citationId));
    const sources = completedEntries.map(({ evidenceClass, sourceId, sourceVersion }) => ({
      evidenceClass,
      sourceId,
      sourceVersion,
    }));
    const registry = createGroundedEvidenceRegistry({
      manifest: REFLECTION_EVIDENCE_MANIFEST,
      evidenceIdentitySchema: ReflectionEvidenceEntryIdentitySchema,
      expectedSources: sources,
    });
    for (const source of sources) registry.recordExamined(source);
    for (const entry of completedEntries) registry.add(entry);
    const evidence = registry.complete();
    const citationRegistry = createGroundedCitationRegistry({
      citationSchema: ReflectionRegistryCitationSchema,
      evidence,
    });
    const citations: ReflectionCitation[] = [];
    for (const citation of accumulated.citations)
      if (deliveredCitationIds.has(citation.citationId))
        citations.push(ReflectionCitationSchema.parse(citation));
    for (const citation of citations) citationRegistry.add(citation);
    const completeCitations = citationRegistry.complete(
      citations.map(({ citationId }) => citationId),
    );
    const dependencies = completeDependencies([
      ...base.dependencies,
      ...accumulated.noteDependencies.map(({ gameId, noteVersion }) =>
        ReflectionDependencySchema.parse({ category: "note", gameId, noteVersion }),
      ),
    ]);
    return Object.freeze({
      ...base,
      evidence,
      citations: completeCitations,
      dependencies,
      scope: ReflectionScopeSchema.parse({
        ...base.scope,
        examinedPresentNoteCount: accumulated.citations.filter(
          ({ evidenceClass, testimony }) => evidenceClass === "owner-game-note" && testimony,
        ).length,
        totalPresentNoteCount: null,
        examinedGameCount: new Set(
          accumulated.citations
            .filter(({ evidenceClass }) => evidenceClass === "owner-game-note")
            .map(({ sourceId }) => sourceId),
        ).size,
        exhaustiveNotes: false,
      }),
    });
  }

  return Object.freeze({ assemble, start, finish, revalidate });
}

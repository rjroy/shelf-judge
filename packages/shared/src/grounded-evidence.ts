import { z } from "zod";

const IdSchema = z.string().min(1);
const VersionSchema = z.string().min(1);
const TimestampSchema = z.string().datetime({ offset: true });

export type GroundedDestinationRegistry = Readonly<Record<string, z.ZodTypeAny>>;

type DestinationFromRegistry<Registry extends GroundedDestinationRegistry> = {
  [OperationId in keyof Registry & string]: {
    operationId: OperationId;
    parameters: z.output<Registry[OperationId]>;
  };
}[keyof Registry & string];

function strictDestinationSchemas(registry: GroundedDestinationRegistry): z.ZodTypeAny[] {
  return Object.entries(registry).map(([operationId, parameters]) =>
    z.object({ operationId: z.literal(operationId), parameters }).strict(),
  );
}

function unionFromSchemas<Output>(schemas: readonly z.ZodTypeAny[]): z.ZodType<Output> {
  if (schemas.length === 0) return z.never();
  if (schemas.length === 1) return schemas[0] as z.ZodType<Output>;
  return z.union(schemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]) as z.ZodType<Output>;
}

export function createGroundedEvidenceSchemas<
  const EvidenceClasses extends readonly [string, ...string[]],
  const Categories extends readonly [string, ...string[]],
  const Destinations extends GroundedDestinationRegistry,
>(configuration: {
  evidenceClasses: EvidenceClasses;
  dependencyCategories: Categories;
  destinations: Destinations;
}) {
  const EvidenceClassSchema = z.enum(configuration.evidenceClasses);
  const DependencyCategorySchema = z.enum(configuration.dependencyCategories);
  const DestinationSchema = unionFromSchemas<DestinationFromRegistry<Destinations>>(
    strictDestinationSchemas(configuration.destinations),
  );
  const EvidenceIdentitySchema = z
    .object({
      citationId: IdSchema,
      sourceId: IdSchema,
      sourceVersion: VersionSchema,
      evidenceClass: EvidenceClassSchema,
    })
    .strict();
  const CitationSchema = z
    .object({
      citationId: IdSchema,
      sourceId: IdSchema,
      sourceVersion: VersionSchema,
      evidenceClass: EvidenceClassSchema,
      observedAt: TimestampSchema.optional(),
      canonicalSummary: z.string().min(1),
      destination: DestinationSchema,
    })
    .strict();
  const DependencySchema = z
    .object({
      category: DependencyCategorySchema,
      sourceId: IdSchema,
      fingerprint: z.string().min(1),
      observedAt: TimestampSchema.optional(),
    })
    .strict();

  return {
    EvidenceClassSchema,
    DependencyCategorySchema,
    DestinationSchema,
    EvidenceIdentitySchema,
    CitationSchema,
    DependencySchema,
  } as const;
}

export function addUniqueCitationIssues(
  citations: readonly {
    citationId: string;
    sourceId: string;
    sourceVersion: string;
    evidenceClass: string;
  }[],
  context: z.RefinementCtx,
): void {
  const citationIds = citations.map(({ citationId }) => citationId);
  const sourceIdentities = citations.map(
    ({ sourceId, sourceVersion, evidenceClass }) =>
      `${sourceId}\u0000${sourceVersion}\u0000${evidenceClass}`,
  );
  if (new Set(citationIds).size !== citationIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["citations"],
      message: "Citation IDs must be unique",
    });
  }
  if (new Set(sourceIdentities).size !== sourceIdentities.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["citations"],
      message: "Citation source identities must be unique",
    });
  }
}

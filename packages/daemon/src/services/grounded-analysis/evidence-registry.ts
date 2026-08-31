import { z } from "zod";
import { snapshotGroundedAuthorizationSchema } from "./immutable-schema.js";

const ownedEvidenceSnapshots = new WeakSet<object>();

const ExaminedSourceSchema = z
  .object({
    sourceId: z.string().min(1),
    sourceVersion: z.string().min(1),
    evidenceClass: z.string().min(1),
  })
  .strict();

const EvidenceEntryEnvelopeSchema = z
  .object({
    citationId: z.string().min(1),
    sourceId: z.string().min(1),
    sourceVersion: z.string().min(1),
    evidenceClass: z.string().min(1),
    payload: z.unknown(),
  })
  .strict();

export type GroundedExaminedSource = z.infer<typeof ExaminedSourceSchema>;

export interface GroundedEvidenceEntry<Payload = unknown> extends GroundedExaminedSource {
  citationId: string;
  payload: Payload;
}

export interface GroundedEvidenceSnapshot {
  readonly manifestId: string;
  readonly manifestVersion: string;
  readonly evidenceClasses: readonly string[];
  readonly examinedSources: readonly GroundedExaminedSource[];
  readonly entries: readonly GroundedEvidenceEntry[];
  hasSource(source: GroundedExaminedSource): boolean;
  resolve(citationId: string): GroundedEvidenceEntry | undefined;
}

export interface GroundedEvidenceManifest {
  readonly manifestId: string;
  readonly manifestVersion: string;
  readonly evidence: Readonly<Record<string, z.ZodType<unknown>>>;
}

export function isGroundedEvidenceSnapshot(value: unknown): value is GroundedEvidenceSnapshot {
  return typeof value === "object" && value !== null && ownedEvidenceSnapshots.has(value);
}

function sourceKey(source: GroundedExaminedSource): string {
  return `${source.evidenceClass}\u0000${source.sourceId}\u0000${source.sourceVersion}`;
}

function cloneAndFreeze<Value>(value: Value): Value {
  const cloned = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (typeof candidate !== "object" || candidate === null || Object.isFrozen(candidate)) return;
    Object.freeze(candidate);
    for (const child of Object.values(candidate)) freeze(child);
  };
  freeze(cloned);
  return cloned;
}

export function createGroundedEvidenceRegistry(options: {
  manifest: GroundedEvidenceManifest;
  evidenceIdentitySchema: z.ZodType<{
    citationId: string;
    sourceId: string;
    sourceVersion: string;
    evidenceClass: string;
  }>;
  expectedSources: readonly GroundedExaminedSource[];
}) {
  const evidenceIdentitySchema = snapshotGroundedAuthorizationSchema(
    options.evidenceIdentitySchema,
  );
  const evidenceSchemas = Object.freeze(
    Object.fromEntries(
      Object.entries(options.manifest.evidence).map(([evidenceClass, schema]) => [
        evidenceClass,
        snapshotGroundedAuthorizationSchema(schema),
      ]),
    ) as Readonly<Record<string, z.ZodType<unknown>>>,
  );
  const manifest = Object.freeze({
    manifestId: options.manifest.manifestId,
    manifestVersion: options.manifest.manifestVersion,
    evidence: evidenceSchemas,
  });
  const expectedSources = options.expectedSources.map((source) =>
    cloneAndFreeze(ExaminedSourceSchema.parse(source)),
  );
  const expectedByKey = new Map(expectedSources.map((source) => [sourceKey(source), source]));
  if (expectedByKey.size !== expectedSources.length) {
    throw new Error("Expected evidence sources must be unique");
  }
  for (const source of expectedSources) {
    if (!Object.hasOwn(manifest.evidence, source.evidenceClass)) {
      throw new Error(
        `Evidence class is not authorized by this feature manifest: ${source.evidenceClass}`,
      );
    }
  }

  const examined = new Set<string>();
  const entries = new Map<string, GroundedEvidenceEntry>();
  let completed = false;

  return {
    recordExamined(sourceInput: GroundedExaminedSource): void {
      if (completed) throw new Error("Evidence registry is complete");
      const source = ExaminedSourceSchema.parse(sourceInput);
      const key = sourceKey(source);
      if (!expectedByKey.has(key))
        throw new Error("Examined source is outside the feature manifest scope");
      if (examined.has(key)) throw new Error("Examined source was already recorded");
      examined.add(key);
    },
    add(entryInput: unknown): void {
      if (completed) throw new Error("Evidence registry is complete");
      const envelope = EvidenceEntryEnvelopeSchema.parse(entryInput);
      const identity = evidenceIdentitySchema.parse({
        citationId: envelope.citationId,
        sourceId: envelope.sourceId,
        sourceVersion: envelope.sourceVersion,
        evidenceClass: envelope.evidenceClass,
      });
      const source = ExaminedSourceSchema.parse({
        sourceId: identity.sourceId,
        sourceVersion: identity.sourceVersion,
        evidenceClass: identity.evidenceClass,
      });
      const key = sourceKey(source);
      if (!expectedByKey.has(key) || !examined.has(key)) {
        throw new Error("Evidence source must be expected and examined before registration");
      }
      if (entries.has(identity.citationId)) throw new Error("Citation ID is already registered");
      const payloadSchema = manifest.evidence[identity.evidenceClass];
      if (!payloadSchema)
        throw new Error("Evidence class is not authorized by this feature manifest");
      const payload = payloadSchema.parse(envelope.payload);
      const entry = cloneAndFreeze({ ...identity, payload });
      entries.set(identity.citationId, entry);
    },
    complete(): GroundedEvidenceSnapshot {
      if (completed) throw new Error("Evidence registry is already complete");
      const missing = expectedSources.filter((source) => !examined.has(sourceKey(source)));
      if (missing.length > 0) throw new Error("Every expected evidence source must be examined");
      completed = true;
      const frozenSources = cloneAndFreeze(expectedSources);
      const frozenEntries = cloneAndFreeze([...entries.values()]);
      const byCitation = new Map(frozenEntries.map((entry) => [entry.citationId, entry]));
      const sourceKeys = new Set(frozenSources.map(sourceKey));
      const snapshot = Object.freeze({
        manifestId: manifest.manifestId,
        manifestVersion: manifest.manifestVersion,
        evidenceClasses: Object.freeze(Object.keys(manifest.evidence).sort()),
        examinedSources: frozenSources,
        entries: frozenEntries,
        hasSource: (source: GroundedExaminedSource) =>
          sourceKeys.has(sourceKey(ExaminedSourceSchema.parse(source))),
        resolve: (citationId: string) => byCitation.get(citationId),
      });
      ownedEvidenceSnapshots.add(snapshot);
      return snapshot;
    },
  };
}

import { z } from "zod";
import type { GroundedEvidenceSnapshot } from "./evidence-registry.js";
import { snapshotGroundedAuthorizationSchema } from "./immutable-schema.js";

const CitationEnvelopeSchema = z
  .object({
    citationId: z.string().min(1),
    sourceId: z.string().min(1),
    sourceVersion: z.string().min(1),
    evidenceClass: z.string().min(1),
    observedAt: z.string().optional(),
    canonicalSummary: z.string().min(1),
    destination: z.unknown(),
  })
  .passthrough();

const EvidenceIdentityEnvelopeSchema = z
  .object({
    citationId: z.string().min(1),
    sourceId: z.string().min(1),
    sourceVersion: z.string().min(1),
    evidenceClass: z.string().min(1),
  })
  .strict();

export interface GroundedCitation {
  citationId: string;
  sourceId: string;
  sourceVersion: string;
  evidenceClass: string;
  destination: unknown;
}

export function createGroundedCitationRegistry<Citation extends GroundedCitation>(options: {
  citationSchema: z.ZodType<Citation>;
  evidence: GroundedEvidenceSnapshot;
}) {
  const citationSchema = snapshotGroundedAuthorizationSchema(options.citationSchema);
  const evidenceEntries = [...options.evidence.entries];
  const evidenceByCitation = new Map(
    evidenceEntries.map((entry) => {
      const identity = EvidenceIdentityEnvelopeSchema.parse({
        citationId: entry.citationId,
        sourceId: entry.sourceId,
        sourceVersion: entry.sourceVersion,
        evidenceClass: entry.evidenceClass,
      });
      return [identity.citationId, Object.freeze(identity)] as const;
    }),
  );
  if (evidenceByCitation.size !== evidenceEntries.length) {
    throw new Error("Evidence snapshot citation IDs must be unique");
  }
  const citations = new Map<string, Citation>();
  let completed = false;

  function deepFreeze(value: unknown): void {
    if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }

  return {
    add(input: unknown): Citation {
      if (completed) throw new Error("Citation registry is complete");
      CitationEnvelopeSchema.parse(input);
      const citation = citationSchema.parse(input);
      if (citations.has(citation.citationId)) throw new Error("Citation ID is already registered");
      const evidence = evidenceByCitation.get(citation.citationId);
      if (
        !evidence ||
        evidence.sourceId !== citation.sourceId ||
        evidence.sourceVersion !== citation.sourceVersion ||
        evidence.evidenceClass !== citation.evidenceClass
      ) {
        throw new Error("Citation does not resolve to the exact registered evidence version");
      }
      const frozen = structuredClone(citation);
      deepFreeze(frozen);
      citations.set(frozen.citationId, frozen);
      return frozen;
    },
    complete(requiredCitationIds: readonly string[]) {
      if (completed) throw new Error("Citation registry is already complete");
      if (new Set(requiredCitationIds).size !== requiredCitationIds.length) {
        throw new Error("Required citation IDs must be unique");
      }
      const resolved = requiredCitationIds.map((citationId) => {
        const citation = citations.get(citationId);
        if (!citation) throw new Error(`Required citation is not registered: ${citationId}`);
        return citation;
      });
      completed = true;
      return Object.freeze([...resolved]);
    },
  };
}

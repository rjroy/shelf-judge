import { AnalystFinalSchema, type AnalystFinal } from "@shelf-judge/shared";
import { isDeepStrictEqual } from "node:util";
import type { AnalystCitation } from "@shelf-judge/shared";
import type { GroundedEvidenceSnapshot } from "./grounded-analysis/evidence-registry.js";

export interface AnalystResultValidation {
  valid: boolean;
  result?: AnalystFinal;
}

export function validateAnalystResult(options: {
  submission: unknown;
  evidence: GroundedEvidenceSnapshot;
  registeredCitations: readonly AnalystCitation[];
  mandatoryUncertaintyCitationIds?: ReadonlySet<string>;
}): AnalystResultValidation {
  const parsed = AnalystFinalSchema.safeParse(options.submission);
  if (!parsed.success) return { valid: false };

  try {
    const registered = new Map(
      options.registeredCitations.map((citation) => [citation.citationId, citation]),
    );
    if (registered.size !== options.registeredCitations.length) return { valid: false };
    for (const citation of parsed.data.citations) {
      const evidence = options.evidence.resolve(citation.citationId);
      const serverCitation = registered.get(citation.citationId);
      if (
        !evidence ||
        !serverCitation ||
        evidence.sourceId !== citation.sourceId ||
        evidence.sourceVersion !== citation.sourceVersion ||
        evidence.evidenceClass !== citation.evidenceClass ||
        citation.canonicalSummary !== serverCitation.canonicalSummary ||
        citation.testimony !== serverCitation.testimony ||
        !isDeepStrictEqual(citation.destination, serverCitation.destination)
      ) {
        return { valid: false };
      }
    }
    if (
      options.mandatoryUncertaintyCitationIds &&
      parsed.data.blocks.some(
        (block) =>
          block.citationIds.some((citationId) =>
            options.mandatoryUncertaintyCitationIds?.has(citationId),
          ) && block.uncertainty === undefined,
      )
    ) {
      return { valid: false };
    }
  } catch {
    return { valid: false };
  }
  return { valid: true, result: parsed.data };
}

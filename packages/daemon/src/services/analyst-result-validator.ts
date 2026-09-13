import { AnalystFinalSchema, type AnalystFinal } from "@shelf-judge/shared";
import { isDeepStrictEqual } from "node:util";
import type { AnalystCitation } from "@shelf-judge/shared";
import { z } from "zod";
import type { GroundedEvidenceSnapshot } from "./grounded-analysis/evidence-registry.js";

export interface AnalystResultValidation {
  valid: boolean;
  result?: AnalystFinal;
  diagnostic?: AnalystValidationDiagnostic;
}

export type AnalystValidationDiagnostic =
  | {
      readonly reason: "schema-invalid";
      readonly code: string;
      readonly path: readonly (string | number)[];
    }
  | { readonly reason: "duplicate-registered-citation" }
  | {
      readonly reason: "citation-mismatch";
      readonly citationIndex: number;
      readonly field:
        | "evidence"
        | "registered"
        | "sourceId"
        | "sourceVersion"
        | "evidenceClass"
        | "canonicalSummary"
        | "testimony"
        | "destination";
    }
  | { readonly reason: "owner-testimony-mismatch"; readonly citationIndex: number }
  | { readonly reason: "mandatory-uncertainty-missing" }
  | { readonly reason: "validation-internal" };

const SafeSchemaPaths = new Set([
  "outcome",
  "blocks",
  "citations",
  "usage",
  "reason",
  "text",
  "citationIds",
  "uncertainty",
  "citationId",
  "sourceId",
  "sourceVersion",
  "evidenceClass",
  "observedAt",
  "canonicalSummary",
  "testimony",
  "destination",
  "operationId",
  "parameters",
  "state",
]);

function schemaDiagnostic(error: z.ZodError): AnalystValidationDiagnostic {
  const issue = error.issues[0];
  return {
    reason: "schema-invalid",
    code: issue?.code ?? "custom",
    path: (issue?.path ?? [])
      .slice(0, 8)
      .map((segment) =>
        typeof segment === "number"
          ? segment
          : SafeSchemaPaths.has(segment)
            ? segment
            : "unrecognized",
      ),
  };
}

export function validateAnalystResult(options: {
  submission: unknown;
  evidence: GroundedEvidenceSnapshot;
  registeredCitations: readonly AnalystCitation[];
  mandatoryUncertaintyCitationIds?: ReadonlySet<string>;
}): AnalystResultValidation {
  const parsed = AnalystFinalSchema.safeParse(options.submission);
  if (!parsed.success) return { valid: false, diagnostic: schemaDiagnostic(parsed.error) };

  try {
    const registered = new Map(
      options.registeredCitations.map((citation) => [citation.citationId, citation]),
    );
    if (registered.size !== options.registeredCitations.length)
      return { valid: false, diagnostic: { reason: "duplicate-registered-citation" } };
    for (const [citationIndex, citation] of parsed.data.citations.entries()) {
      const evidence = options.evidence.resolve(citation.citationId);
      const serverCitation = registered.get(citation.citationId);
      const mismatch = !evidence
        ? "evidence"
        : !serverCitation
          ? "registered"
          : evidence.sourceId !== citation.sourceId
            ? "sourceId"
            : evidence.sourceVersion !== citation.sourceVersion
              ? "sourceVersion"
              : evidence.evidenceClass !== citation.evidenceClass
                ? "evidenceClass"
                : citation.canonicalSummary !== serverCitation.canonicalSummary
                  ? "canonicalSummary"
                  : citation.testimony !== serverCitation.testimony
                    ? "testimony"
                    : !isDeepStrictEqual(citation.destination, serverCitation.destination)
                      ? "destination"
                      : undefined;
      if (mismatch)
        return {
          valid: false,
          diagnostic: { reason: "citation-mismatch", citationIndex, field: mismatch },
        };
      if (evidence === undefined)
        return { valid: false, diagnostic: { reason: "validation-internal" } };
      if (citation.evidenceClass === "owner-game-note") {
        const payload = evidence.payload;
        if (
          payload === null ||
          typeof payload !== "object" ||
          !("state" in payload) ||
          citation.testimony !== (payload.state === "present")
        )
          return {
            valid: false,
            diagnostic: { reason: "owner-testimony-mismatch", citationIndex },
          };
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
      return { valid: false, diagnostic: { reason: "mandatory-uncertainty-missing" } };
    }
  } catch {
    return { valid: false, diagnostic: { reason: "validation-internal" } };
  }
  return { valid: true, result: parsed.data };
}

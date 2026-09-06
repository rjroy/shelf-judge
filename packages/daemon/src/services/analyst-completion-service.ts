import type { AnalystFinal } from "@shelf-judge/shared";
import type { GroundedEvidenceSnapshot } from "./grounded-analysis/evidence-registry.js";
import type { AnalystAttestationService } from "./analyst-attestation-service.js";
import { validateAnalystResult } from "./analyst-result-validator.js";

export type AnalystCompletion =
  | { valid: false }
  | { valid: true; result: AnalystFinal; content: string; validationAttestation: string };

/** The only Step 4 API that may create a completed-assistant attestation. */
export function createAnalystCompletionService(options: {
  attestationService: AnalystAttestationService;
}) {
  return Object.freeze({
    complete(input: {
      submission: unknown;
      evidence: GroundedEvidenceSnapshot;
      registeredCitations: readonly import("@shelf-judge/shared").AnalystCitation[];
      mandatoryUncertaintyCitationIds: ReadonlySet<string>;
      conversationId: string;
      turnIndex: number;
      provider: { providerId: string; modelId: string };
      noteDependencies: readonly { gameId: string; noteVersion: number }[];
    }): AnalystCompletion {
      const validated = validateAnalystResult({
        submission: input.submission,
        evidence: input.evidence,
        registeredCitations: input.registeredCitations,
        mandatoryUncertaintyCitationIds: input.mandatoryUncertaintyCitationIds,
      });
      if (!validated.valid || !validated.result) return { valid: false };
      const content = validated.result.blocks.map((block) => block.text).join("\n\n");
      return {
        valid: true,
        result: validated.result,
        content,
        validationAttestation: options.attestationService.attest({
          conversationId: input.conversationId,
          turnIndex: input.turnIndex,
          providerId: input.provider.providerId,
          modelId: input.provider.modelId,
          content,
          outcome: validated.result.outcome,
          noteDependencies: input.noteDependencies,
        }),
      };
    },
  });
}

import type { AnalystFinal } from "@shelf-judge/shared";
import type { AnalystAttestationService } from "./analyst-attestation-service.js";
import type { AnalystRetrievedEvidence } from "./analyst-evidence-service.js";
import { validateAnalystResult } from "./analyst-result-validator.js";

export type AnalystCompletion =
  | { valid: false; reason?: "source-changed" }
  | { valid: true; result: AnalystFinal; content: string; validationAttestation: string };

/** The only Step 4 API that may create a completed-assistant attestation. */
export function createAnalystCompletionService(options: {
  attestationService: AnalystAttestationService;
  withRetrievedEvidence: <Value>(
    retrieved: AnalystRetrievedEvidence,
    operation: (retrieved: AnalystRetrievedEvidence) => Promise<Value>,
  ) => Promise<Value>;
}) {
  return Object.freeze({
    async complete(input: {
      submission: unknown;
      retrieved: AnalystRetrievedEvidence;
      mandatoryUncertaintyCitationIds: ReadonlySet<string>;
      conversationId: string;
      turnIndex: number;
      provider: { providerId: string; modelId: string };
    }): Promise<AnalystCompletion> {
      const finish = (retrieved: AnalystRetrievedEvidence): Promise<AnalystCompletion> => {
        const validated = validateAnalystResult({
          submission: input.submission,
          evidence: retrieved.evidence,
          registeredCitations: retrieved.citations,
          mandatoryUncertaintyCitationIds: input.mandatoryUncertaintyCitationIds,
        });
        if (!validated.valid || !validated.result) return Promise.resolve({ valid: false });
        const content = validated.result.blocks.map((block) => block.text).join("\n\n");
        return Promise.resolve({
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
            noteDependencies: retrieved.noteDependencies,
          }),
        });
      };
      try {
        return await options.withRetrievedEvidence(input.retrieved, finish);
      } catch {
        return { valid: false, reason: "source-changed" };
      }
    },
  });
}

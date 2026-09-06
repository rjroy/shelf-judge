import { AnalystTurnRequestSchema } from "@shelf-judge/shared";
import type { AnalystAttestationService } from "./analyst-attestation-service.js";

export type AnalystTranscriptValidation =
  | { valid: true }
  | { valid: false; outcome: "invalid-transcript" | "stale-transcript" };

export type AnalystNoteDependencyComparator = (
  dependencies: readonly { gameId: string; noteVersion: number }[],
) => "current" | "stale" | Promise<"current" | "stale">;

export interface AnalystTranscriptValidator {
  validate(request: unknown): Promise<AnalystTranscriptValidation>;
}

export function createAnalystTranscriptValidator(options: {
  attestationService: AnalystAttestationService;
  provider: { providerId: string; modelId: string };
  compareNoteDependencies?: AnalystNoteDependencyComparator;
}): AnalystTranscriptValidator {
  return Object.freeze({
    async validate(input: unknown): Promise<AnalystTranscriptValidation> {
      const request = AnalystTurnRequestSchema.safeParse(input);
      if (!request.success) return { valid: false as const, outcome: "invalid-transcript" };
      const transcript = request.data;
      const assistantMessages = transcript.messages.filter((message) => message.role === "analyst");
      for (const [assistantIndex, message] of assistantMessages.entries()) {
        const authentic = options.attestationService.verifies(
          {
            conversationId: transcript.conversationId,
            turnIndex: assistantIndex,
            providerId: options.provider.providerId,
            modelId: options.provider.modelId,
            content: message.content,
            outcome: message.outcome,
            noteDependencies: message.noteDependencies,
          },
          message.validationAttestation,
        );
        if (!authentic) return { valid: false as const, outcome: "invalid-transcript" };

        if (
          options.compareNoteDependencies &&
          (await options.compareNoteDependencies(message.noteDependencies)) === "stale"
        ) {
          return { valid: false as const, outcome: "stale-transcript" };
        }
      }
      return { valid: true as const };
    },
  });
}

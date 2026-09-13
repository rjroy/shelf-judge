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
  /** Static identities remain supported for service callers without a mutable provider. */
  provider?: { providerId: string; modelId: string };
  getProvider?: () => { providerId: string; modelId: string };
  compareNoteDependencies?: AnalystNoteDependencyComparator;
}): AnalystTranscriptValidator {
  return Object.freeze({
    async validate(input: unknown): Promise<AnalystTranscriptValidation> {
      const request = AnalystTurnRequestSchema.safeParse(input);
      if (!request.success) return { valid: false as const, outcome: "invalid-transcript" };
      const transcript = request.data;
      const provider = options.getProvider?.() ?? options.provider;
      if (provider === undefined)
        throw new Error("Analyst transcript provider identity is required");
      const assistantMessages = transcript.messages.filter((message) => message.role === "analyst");
      for (const [assistantIndex, message] of assistantMessages.entries()) {
        const authentic = options.attestationService.verifies(
          {
            conversationId: transcript.conversationId,
            turnIndex: assistantIndex,
            providerId: provider.providerId,
            modelId: provider.modelId,
            content: message.content,
            outcome: message.outcome,
            noteDependencies: message.noteDependencies,
          },
          message.validationAttestation,
        );
        if (!authentic) return { valid: false as const, outcome: "invalid-transcript" };
      }
      const dependencies = new Map<string, number>();
      for (const message of assistantMessages) {
        for (const dependency of message.noteDependencies) {
          const existing = dependencies.get(dependency.gameId);
          if (existing !== undefined && existing !== dependency.noteVersion)
            return { valid: false as const, outcome: "stale-transcript" };
          dependencies.set(dependency.gameId, dependency.noteVersion);
        }
      }
      if (dependencies.size > 0 && options.compareNoteDependencies === undefined)
        return { valid: false as const, outcome: "stale-transcript" };
      if (
        options.compareNoteDependencies !== undefined &&
        (await options.compareNoteDependencies(
          [...dependencies]
            .map(([gameId, noteVersion]) => ({ gameId, noteVersion }))
            .sort((left, right) => left.gameId.localeCompare(right.gameId)),
        )) === "stale"
      )
        return { valid: false as const, outcome: "stale-transcript" };
      return { valid: true as const };
    },
  });
}

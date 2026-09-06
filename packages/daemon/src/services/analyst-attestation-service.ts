import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface AnalystAttestationMessage {
  conversationId: string;
  turnIndex: number;
  providerId: string;
  modelId: string;
  content: string;
  outcome: "answered" | "partial" | "abstained";
  noteDependencies: readonly { gameId: string; noteVersion: number }[];
}

function canonicalMessage(message: AnalystAttestationMessage): string {
  return JSON.stringify({
    conversationId: message.conversationId,
    turnIndex: message.turnIndex,
    providerId: message.providerId,
    modelId: message.modelId,
    content: message.content,
    outcome: message.outcome,
    noteDependencies: [...message.noteDependencies]
      .map(({ gameId, noteVersion }) => ({ gameId, noteVersion }))
      .sort((left, right) => left.gameId.localeCompare(right.gameId)),
  });
}

export interface AnalystAttestationService {
  attest(message: AnalystAttestationMessage): string;
  verifies(message: AnalystAttestationMessage, attestation: string): boolean;
}

/** Process-local authentication for client-held prior assistant messages. */
export function createAnalystAttestationService(
  secret: Uint8Array = randomBytes(32),
): AnalystAttestationService {
  const key = Buffer.from(secret);
  if (key.byteLength < 32) throw new Error("Analyst attestation secret must be at least 256 bits");

  const sign = (message: AnalystAttestationMessage) =>
    createHmac("sha256", key).update(canonicalMessage(message)).digest("base64url");

  return Object.freeze({
    attest: sign,
    verifies(message: AnalystAttestationMessage, attestation: string): boolean {
      const expected = Buffer.from(sign(message));
      const received = Buffer.from(attestation);
      return expected.byteLength === received.byteLength && timingSafeEqual(expected, received);
    },
  });
}

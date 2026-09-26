import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AnalystCitationInspectionRecordSchema } from "@shelf-judge/shared";

export interface AnalystDiscoveryId {
  bggId: number;
  source: "search" | "hot";
}

export interface AnalystDiscoveryReceiptPayload {
  version: 1;
  conversationId: string;
  turnIndex: number;
  attestationDigest: string;
  bggId: number;
  source: "search" | "hot";
}

/** Signed client-held result of inspecting a BGG citation. */
export interface AnalystInspectionRecordBinding {
  conversationId: string;
  requestId: string;
  turnIndex: number;
  attestationDigest: string;
}

type AnalystInspectionRecord = ReturnType<typeof AnalystCitationInspectionRecordSchema.parse>;
type UnsignedAnalystInspectionRecord = Omit<AnalystInspectionRecord, "authenticationToken">;

const INSPECTION_DOMAIN = "shelf-judge:analyst-bgg-inspection-record:v1\0";
const MAX_INSPECTION_RECORD_BYTES = 16_384;

function canonicalRecord(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalRecord).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalRecord(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface AnalystAttestationMessage {
  conversationId: string;
  turnIndex: number;
  providerId: string;
  modelId: string;
  content: string;
  outcome: "answered" | "partial" | "abstained";
  noteDependencies: readonly { gameId: string; noteVersion: number }[];
  discoveryDigest?: string;
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
    ...(message.discoveryDigest === undefined ? {} : { discoveryDigest: message.discoveryDigest }),
  });
}

export interface AnalystAttestationService {
  attest(message: AnalystAttestationMessage): string;
  verifies(message: AnalystAttestationMessage, attestation: string): boolean;
  discoveryDigest(ids: readonly AnalystDiscoveryId[]): string;
  attestationDigest(attestation: string): string;
  issueDiscoveryReceipt(payload: Omit<AnalystDiscoveryReceiptPayload, "version">): string;
  verifyDiscoveryReceipt(receipt: string): AnalystDiscoveryReceiptPayload | null;
  /** Adds an HMAC token to a strict inspection record, signing every field except the token itself. */
  issueInspectionRecord(record: UnsignedAnalystInspectionRecord): AnalystInspectionRecord;
  /** Returns the complete record only when its HMAC and expected origin binding match. */
  verifyInspectionRecord(
    record: unknown,
    binding: AnalystInspectionRecordBinding,
  ): AnalystInspectionRecord | null;
}

/** Process-local authentication for client-held prior assistant messages. */
export function createAnalystAttestationService(
  secret: Uint8Array = randomBytes(32),
): AnalystAttestationService {
  const key = Buffer.from(secret);
  if (key.byteLength < 32) throw new Error("Analyst attestation secret must be at least 256 bits");

  const sign = (message: AnalystAttestationMessage) =>
    createHmac("sha256", key).update(canonicalMessage(message)).digest("base64url");
  const signReceipt = (payload: AnalystDiscoveryReceiptPayload) =>
    createHmac("sha256", key)
      .update("shelf-judge:analyst-discovery-receipt:v1\0")
      .update(JSON.stringify(payload))
      .digest("base64url");
  const signInspection = (record: UnsignedAnalystInspectionRecord) =>
    createHmac("sha256", key)
      .update(INSPECTION_DOMAIN)
      .update(canonicalRecord(record))
      .digest("base64url");

  return Object.freeze({
    attest: sign,
    discoveryDigest(ids: readonly AnalystDiscoveryId[]) {
      const canonical = [...ids].map(({ bggId, source }) => ({ bggId, source }));
      return createHash("sha256").update(JSON.stringify(canonical)).digest("base64url");
    },
    attestationDigest(attestation: string) {
      return createHash("sha256").update(attestation).digest("base64url");
    },
    issueDiscoveryReceipt(payload: Omit<AnalystDiscoveryReceiptPayload, "version">) {
      const complete: AnalystDiscoveryReceiptPayload = {
        version: 1,
        conversationId: payload.conversationId,
        turnIndex: payload.turnIndex,
        attestationDigest: payload.attestationDigest,
        bggId: payload.bggId,
        source: payload.source,
      };
      const encoded = Buffer.from(JSON.stringify(complete)).toString("base64url");
      return `${encoded}.${signReceipt(complete)}`;
    },
    verifyDiscoveryReceipt(receipt: string) {
      if (typeof receipt !== "string" || receipt.length > 2048) return null;
      const parts = receipt.split(".");
      if (
        parts.length !== 2 ||
        !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
        !/^[A-Za-z0-9_-]{43}$/.test(parts[1])
      )
        return null;
      try {
        const text = Buffer.from(parts[0], "base64url").toString("utf8");
        const payload = JSON.parse(text) as AnalystDiscoveryReceiptPayload;
        const keys = Object.keys(payload).sort();
        if (
          JSON.stringify(payload) !== text ||
          keys.join(",") !== "attestationDigest,bggId,conversationId,source,turnIndex,version" ||
          payload.version !== 1 ||
          typeof payload.conversationId !== "string" ||
          !payload.conversationId ||
          !Number.isSafeInteger(payload.turnIndex) ||
          payload.turnIndex < 0 ||
          !/^[A-Za-z0-9_-]{43}$/.test(payload.attestationDigest) ||
          !Number.isSafeInteger(payload.bggId) ||
          payload.bggId <= 0 ||
          (payload.source !== "search" && payload.source !== "hot")
        )
          return null;
        const expected = Buffer.from(signReceipt(payload));
        const received = Buffer.from(parts[1]);
        return expected.byteLength === received.byteLength && timingSafeEqual(expected, received)
          ? payload
          : null;
      } catch {
        return null;
      }
    },
    issueInspectionRecord(record: UnsignedAnalystInspectionRecord) {
      const parsedRecord = AnalystCitationInspectionRecordSchema.parse({
        ...record,
        authenticationToken: "pending",
      });
      const unsigned: UnsignedAnalystInspectionRecord = {
        version: parsedRecord.version,
        conversationId: parsedRecord.conversationId,
        requestId: parsedRecord.requestId,
        turnIndex: parsedRecord.turnIndex,
        attestationDigest: parsedRecord.attestationDigest,
        citation: parsedRecord.citation,
        view: parsedRecord.view,
      };
      const token = signInspection(unsigned);
      const signedRecord = AnalystCitationInspectionRecordSchema.parse({
        ...unsigned,
        authenticationToken: token,
      });
      if (Buffer.byteLength(canonicalRecord(signedRecord), "utf8") > MAX_INSPECTION_RECORD_BYTES) {
        throw new Error("Analyst inspection record is too large");
      }
      return signedRecord;
    },
    verifyInspectionRecord(input: unknown, binding: AnalystInspectionRecordBinding) {
      try {
        const parsed = AnalystCitationInspectionRecordSchema.safeParse(input);
        if (
          !parsed.success ||
          Buffer.byteLength(canonicalRecord(parsed.data), "utf8") > MAX_INSPECTION_RECORD_BYTES
        )
          return null;
        const record = parsed.data;
        if (
          record.conversationId !== binding.conversationId ||
          record.requestId !== binding.requestId ||
          record.turnIndex !== binding.turnIndex ||
          record.attestationDigest !== binding.attestationDigest
        )
          return null;
        const unsigned: UnsignedAnalystInspectionRecord = {
          version: record.version,
          conversationId: record.conversationId,
          requestId: record.requestId,
          turnIndex: record.turnIndex,
          attestationDigest: record.attestationDigest,
          citation: record.citation,
          view: record.view,
        };
        const expected = Buffer.from(signInspection(unsigned));
        const received = Buffer.from(record.authenticationToken);
        return expected.byteLength === received.byteLength && timingSafeEqual(expected, received)
          ? record
          : null;
      } catch {
        return null;
      }
    },
    verifies(message: AnalystAttestationMessage, attestation: string): boolean {
      const expected = Buffer.from(sign(message));
      const received = Buffer.from(attestation);
      return expected.byteLength === received.byteLength && timingSafeEqual(expected, received);
    },
  });
}

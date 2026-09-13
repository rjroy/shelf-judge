import { z } from "zod";
import type {
  OwnerGameNoteClearRequest,
  OwnerGameNoteOperation,
  OwnerGameNoteSetRequest,
} from "./types";

export const OWNER_GAME_NOTE_MAX_CODE_POINTS = 10_000;

const IdSchema = z.string().min(1);
const CommandIdSchema = z.string().uuid();
const SafeVersionSchema = z.number().int().safe().min(0);
const PositiveSafeVersionSchema = z.number().int().safe().positive();
const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export function normalizeOwnerGameNoteText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function countOwnerGameNoteCodePoints(text: string): number {
  return [...text].length;
}

export const OwnerGameNoteTextSchema = z
  .string()
  .transform(normalizeOwnerGameNoteText)
  .superRefine((text, context) => {
    const codePointCount = countOwnerGameNoteCodePoints(text);
    if (codePointCount === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Note text cannot be empty" });
    } else if (codePointCount > OWNER_GAME_NOTE_MAX_CODE_POINTS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Note text cannot exceed ${OWNER_GAME_NOTE_MAX_CODE_POINTS} Unicode code points`,
      });
    }
    if (/^\p{White_Space}*$/u.test(text)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Note text cannot contain only whitespace",
      });
    }
    const containsUnsupportedControl = [...text].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a;
    });
    if (containsUnsupportedControl) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Note text cannot contain NUL or unsupported C0 control characters",
      });
    }
  });

export const OwnerGameNoteSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("missing"), version: z.literal(0), updatedAt: z.null() }).strict(),
  z
    .object({
      state: z.literal("present"),
      version: PositiveSafeVersionSchema,
      updatedAt: TimestampSchema,
      text: OwnerGameNoteTextSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal("cleared"),
      version: PositiveSafeVersionSchema,
      updatedAt: TimestampSchema,
    })
    .strict(),
]);

export const OwnerGameNoteReadResultSchema = z
  .object({ gameId: IdSchema, note: OwnerGameNoteSchema })
  .strict();

export const OwnerGameNoteSetRequestSchema = z
  .object({
    commandId: CommandIdSchema,
    expectedVersion: SafeVersionSchema,
    text: OwnerGameNoteTextSchema,
  })
  .strict();

export const OwnerGameNoteClearRequestSchema = z
  .object({ commandId: CommandIdSchema, expectedVersion: SafeVersionSchema })
  .strict();

const OwnerGameNoteOperationSchema = z.enum(["set", "clear"]);

const OwnerGameNoteAcceptedMetadataFields = {
  commandId: CommandIdSchema,
  gameId: IdSchema,
  operation: OwnerGameNoteOperationSchema,
  state: z.enum(["missing", "present", "cleared"]),
  version: SafeVersionSchema,
  updatedAt: TimestampSchema.nullable(),
  collectionRevision: PositiveSafeVersionSchema,
  alreadyClear: z.boolean(),
};

function addAcceptedMetadataIssues(
  metadata: {
    operation: OwnerGameNoteOperation;
    state: "missing" | "present" | "cleared";
    version: number;
    updatedAt: string | null;
    alreadyClear: boolean;
  },
  context: z.RefinementCtx,
): void {
  const missingInvariant =
    metadata.state !== "missing" || (metadata.version === 0 && metadata.updatedAt === null);
  const authoredInvariant =
    metadata.state === "missing" || (metadata.version > 0 && metadata.updatedAt !== null);
  if (!missingInvariant || !authoredInvariant) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["state"],
      message: "Accepted note metadata must satisfy note state invariants",
    });
  }
  if (metadata.operation === "set" && (metadata.state !== "present" || metadata.alreadyClear)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["operation"],
      message: "A set command must produce present metadata",
    });
  }
  if (
    metadata.operation === "clear" &&
    (metadata.state === "present" || (!metadata.alreadyClear && metadata.state !== "cleared"))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["alreadyClear"],
      message: "Clear metadata must describe a cleared or already-clear note",
    });
  }
}

export const OwnerGameNoteAcceptedMetadataSchema = z
  .object({ ...OwnerGameNoteAcceptedMetadataFields, replayed: z.boolean() })
  .strict()
  .superRefine(addAcceptedMetadataIssues);

const StoredOwnerGameNoteAcceptedMetadataSchema = z
  .object(OwnerGameNoteAcceptedMetadataFields)
  .strict()
  .superRefine(addAcceptedMetadataIssues);

export const OwnerGameNoteMutationErrorSchema = z.union([
  z
    .object({
      code: z.literal("validation"),
      issues: z
        .array(z.object({ field: z.string().min(1), message: z.string().min(1) }).strict())
        .nonempty(),
    })
    .strict(),
  z.object({ code: z.literal("game-not-found"), gameId: IdSchema }).strict(),
  z
    .object({
      code: z.literal("stale-version"),
      gameId: IdSchema,
      expectedVersion: SafeVersionSchema,
      current: OwnerGameNoteSchema,
    })
    .strict()
    .superRefine((error, context) => {
      if (error.current.version === error.expectedVersion) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["current", "version"],
          message: "A stale-version error must contain a different current version",
        });
      }
    }),
  z.object({ code: z.literal("command-reuse"), commandId: CommandIdSchema }).strict(),
  z
    .object({ code: z.literal("version-overflow"), target: z.enum(["note", "collection"]) })
    .strict(),
  z
    .object({
      code: z.literal("persistence-failure"),
      operation: z.string().min(1),
      message: z.string().min(1),
    })
    .strict(),
]);

export const OwnerGameNoteMutationResultSchema = z
  .discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), accepted: OwnerGameNoteAcceptedMetadataSchema }).strict(),
    z
      .object({
        ok: z.literal(false),
        commandId: CommandIdSchema,
        error: OwnerGameNoteMutationErrorSchema,
      })
      .strict(),
  ])
  .superRefine((result, context) => {
    if (
      !result.ok &&
      result.error.code === "command-reuse" &&
      result.commandId !== result.error.commandId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["error", "commandId"],
        message: "Command-reuse error must identify the attempted command",
      });
    }
  });

export const OwnerGameNoteCommandReceiptSchema = z
  .object({
    receiptType: z.literal("owner-game-note"),
    commandId: CommandIdSchema,
    operation: OwnerGameNoteOperationSchema,
    gameId: IdSchema,
    expectedVersion: SafeVersionSchema,
    requestFingerprint: Sha256Schema,
    accepted: StoredOwnerGameNoteAcceptedMetadataSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    if (
      receipt.commandId !== receipt.accepted.commandId ||
      receipt.gameId !== receipt.accepted.gameId ||
      receipt.operation !== receipt.accepted.operation
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accepted"],
        message: "Note receipt acceptance metadata must match its command identity",
      });
    }
    const expectedResultVersion = receipt.accepted.alreadyClear
      ? receipt.expectedVersion
      : receipt.expectedVersion + 1;
    if (
      !Number.isSafeInteger(expectedResultVersion) ||
      receipt.accepted.version !== expectedResultVersion
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accepted", "version"],
        message: "Note receipt must preserve or advance the expected version exactly once",
      });
    }
  });

type CanonicalOwnerGameNoteRequest =
  | ({ operation: "set"; gameId: string } & OwnerGameNoteSetRequest)
  | ({ operation: "clear"; gameId: string } & OwnerGameNoteClearRequest);

export function canonicalizeOwnerGameNoteRequest(request: CanonicalOwnerGameNoteRequest): string {
  const payload =
    request.operation === "set"
      ? {
          operation: request.operation,
          gameId: request.gameId,
          expectedVersion: request.expectedVersion,
          text: normalizeOwnerGameNoteText(request.text),
        }
      : {
          operation: request.operation,
          gameId: request.gameId,
          expectedVersion: request.expectedVersion,
        };
  return `shelf-judge.owner-game-note.v1\n${JSON.stringify(payload)}`;
}

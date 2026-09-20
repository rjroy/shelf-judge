import { z } from "zod";
import type { PlayIntention } from "./types";
import { CanonicalSourceTimestampSchema } from "./accepted-play-sources";

export const ATTENTION_FEEDBACK_REASON_MAX_CODE_POINTS = 500;
export const AttentionFamilySchema = z.enum(["play-intention", "unplayed-owner-wanted"]);
export type AttentionFamily = z.infer<typeof AttentionFamilySchema>;
const IdSchema = z
  .string()
  .min(1)
  .refine(
    (id) =>
      id.trim() === id &&
      [...id].every((character) => {
        const point = character.codePointAt(0) ?? 0;
        return point > 31 && point !== 127;
      }),
    "Expected a nonblank stable ID",
  );
const EventIdSchema = z.string().uuid();
const CardIdSchema = IdSchema.refine(
  (id) => id.startsWith("attention:") && id.length > "attention:".length,
  "Expected an intention-derived card ID",
);
export const AttentionFeedbackReasonSchema = z
  .object({
    category: z.enum(["not-relevant", "already-aware", "incorrect-evidence", "other"]),
    text: z
      .string()
      .refine(
        (text) =>
          text.trim().length > 0 &&
          [...text].length <= ATTENTION_FEEDBACK_REASON_MAX_CODE_POINTS &&
          [...text].every((character) => {
            const point = character.codePointAt(0) ?? 0;
            return point === 9 || point === 10 || (point > 31 && point !== 127);
          }),
        "Reason text must contain 1–500 Unicode code points without unsupported controls",
      )
      .optional(),
  })
  .strict();
export type AttentionFeedbackReason = z.infer<typeof AttentionFeedbackReasonSchema>;
const EventFields = {
  feedbackEventId: EventIdSchema,
  collectionId: IdSchema,
  cardId: CardIdSchema,
  family: AttentionFamilySchema,
  gameId: IdSchema,
  recordedAt: CanonicalSourceTimestampSchema,
};
const AnswerFields = {
  answer: z.enum(["yes", "no", "skip"]),
  reason: AttentionFeedbackReasonSchema.optional(),
};
function reasonOnlyForNo(
  value: { answer: string; reason?: AttentionFeedbackReason },
  context: z.RefinementCtx,
): void {
  if (value.answer !== "no" && value.reason !== undefined)
    context.addIssue({
      code: "custom",
      path: ["reason"],
      message: "Only No feedback may have a reason",
    });
}
export const AttentionFeedbackEventSchema = z
  .object({ ...EventFields, ...AnswerFields })
  .strict()
  .superRefine(reasonOnlyForNo);
export type AttentionFeedbackEvent = z.infer<typeof AttentionFeedbackEventSchema>;

const CommandFields = { commandId: z.string().uuid(), collectionId: IdSchema };
export const RecordAttentionFeedbackCommandSchema = z
  .object({
    ...CommandFields,
    type: z.literal("record-feedback"),
    cardId: CardIdSchema,
    family: AttentionFamilySchema,
    gameId: IdSchema,
    expectedIntentionVersion: z.number().int().safe().positive(),
    ...AnswerFields,
  })
  .strict()
  .superRefine(reasonOnlyForNo);
/** Single optional attachment after durable No; the event identity/answer never change. */
export const AttachAttentionFeedbackReasonCommandSchema = z
  .object({
    ...CommandFields,
    type: z.literal("attach-feedback-reason"),
    feedbackEventId: EventIdSchema,
    reason: AttentionFeedbackReasonSchema,
  })
  .strict();
export const DeleteAttentionFeedbackCommandSchema = z
  .object({
    ...CommandFields,
    type: z.literal("delete-feedback"),
    feedbackEventId: EventIdSchema,
  })
  .strict();
export const AttentionFeedbackCommandSchema = z.union([
  RecordAttentionFeedbackCommandSchema,
  AttachAttentionFeedbackReasonCommandSchema,
  DeleteAttentionFeedbackCommandSchema,
]);
export type RecordAttentionFeedbackCommand = z.infer<typeof RecordAttentionFeedbackCommandSchema>;
export type AttachAttentionFeedbackReasonCommand = z.infer<
  typeof AttachAttentionFeedbackReasonCommandSchema
>;
export type DeleteAttentionFeedbackCommand = z.infer<typeof DeleteAttentionFeedbackCommandSchema>;
export type AttentionFeedbackCommand = z.infer<typeof AttentionFeedbackCommandSchema>;

/** The daemon supplies its current validated card; clients cannot assert this context. */
export function createCurrentCardFeedbackCommandSchema(
  collectionId: string,
  card: {
    id: string;
    decisionFamily: AttentionFamily;
    intention: Pick<PlayIntention, "gameId" | "version" | "resolution">;
  },
) {
  return RecordAttentionFeedbackCommandSchema.refine(
    (command) =>
      card.intention.resolution === null &&
      command.collectionId === collectionId &&
      command.cardId === card.id &&
      command.gameId === card.intention.gameId &&
      command.family === card.decisionFamily &&
      command.expectedIntentionVersion === card.intention.version,
    "Feedback must identify the current active card, game, family, and intention version",
  );
}

export const AttentionFeedbackHistoryQuerySchema = z
  .object({ collectionId: IdSchema, feedbackEventId: EventIdSchema.optional() })
  .strict();
export type AttentionFeedbackHistoryQuery = z.infer<typeof AttentionFeedbackHistoryQuerySchema>;
export const AttentionFeedbackHistoryResultSchema = z
  .object({
    collectionId: IdSchema,
    events: z.array(AttentionFeedbackEventSchema),
  })
  .strict()
  .superRefine((history, context) => {
    if (new Set(history.events.map((e) => e.feedbackEventId)).size !== history.events.length)
      context.addIssue({ code: "custom", message: "Feedback event IDs must be unique" });
    const cards = new Map<string, string>();
    for (const event of history.events) {
      if (event.collectionId !== history.collectionId)
        context.addIssue({
          code: "custom",
          message: "History may contain only this owner's collection events",
        });
      const game = cards.get(event.cardId);
      if (game !== undefined && game !== event.gameId)
        context.addIssue({
          code: "custom",
          message: "A stable card must identify the same game across families",
        });
      cards.set(event.cardId, event.gameId);
    }
  });
export type AttentionFeedbackHistoryResult = z.infer<typeof AttentionFeedbackHistoryResultSchema>;

/** Trusted daemon context, never taken from request data. No active-card dependency. */
export function createOwnerAttentionFeedbackSchemas(access: {
  role: "owner" | "non-owner";
  collectionId: string;
}) {
  const authorized = (value: { collectionId: string }) =>
    access.role === "owner" && value.collectionId === access.collectionId;
  return {
    command: AttentionFeedbackCommandSchema.refine(
      authorized,
      "Owner access to this collection is required",
    ),
    historyQuery: AttentionFeedbackHistoryQuerySchema.refine(
      authorized,
      "Owner access to this collection is required",
    ),
    historyResult: AttentionFeedbackHistoryResultSchema.refine(
      authorized,
      "Owner access to this collection is required",
    ),
  };
}

const AcceptedFields = {
  commandId: z.string().uuid(),
  collectionId: IdSchema,
  operation: z.enum(["record-feedback", "attach-feedback-reason", "delete-feedback"]),
  feedbackEventId: EventIdSchema,
  collectionRevision: z.number().int().safe().positive(),
};
export const AttentionFeedbackAcceptedMetadataSchema = z
  .object({ ...AcceptedFields, replayed: z.boolean() })
  .strict();
export type AttentionFeedbackAcceptedMetadata = z.infer<
  typeof AttentionFeedbackAcceptedMetadataSchema
>;
export const AttentionFeedbackErrorSchema = z.union([
  z
    .object({
      code: z.literal("validation"),
      issues: z
        .array(z.object({ field: z.string(), message: z.string().min(1) }).strict())
        .nonempty(),
    })
    .strict(),
  z.object({ code: z.literal("unauthorized") }).strict(),
  z.object({ code: z.literal("feedback-not-found"), feedbackEventId: EventIdSchema }).strict(),
  z.object({ code: z.literal("reason-not-allowed"), feedbackEventId: EventIdSchema }).strict(),
  z.object({ code: z.literal("current-card-conflict"), cardId: CardIdSchema }).strict(),
  z.object({ code: z.literal("command-reuse"), commandId: z.string().uuid() }).strict(),
  z.object({ code: z.literal("version-overflow") }).strict(),
  z
    .object({
      code: z.literal("persistence-failure"),
      operation: z.string().min(1),
      message: z.string().min(1),
    })
    .strict(),
]);
export type AttentionFeedbackError = z.infer<typeof AttentionFeedbackErrorSchema>;
export const AttentionFeedbackMutationResultSchema = z
  .discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), accepted: AttentionFeedbackAcceptedMetadataSchema }).strict(),
    z
      .object({
        ok: z.literal(false),
        commandId: z.string().uuid(),
        error: AttentionFeedbackErrorSchema,
      })
      .strict(),
  ])
  .superRefine((result, context) => {
    if (
      !result.ok &&
      result.error.code === "command-reuse" &&
      result.commandId !== result.error.commandId
    )
      context.addIssue({
        code: "custom",
        message: "Command reuse must identify the attempted command",
      });
  });
export type AttentionFeedbackMutationResult = z.infer<typeof AttentionFeedbackMutationResultSchema>;

/** Retained after deletion for replay, without event payload or private reason text. */
export const AttentionFeedbackCommandReceiptSchema = z
  .object({
    receiptType: z.literal("attention-feedback"),
    commandId: z.string().uuid(),
    collectionId: IdSchema,
    operation: AcceptedFields.operation,
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    accepted: z.object(AcceptedFields).strict(),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (
      receipt.commandId !== receipt.accepted.commandId ||
      receipt.collectionId !== receipt.accepted.collectionId ||
      receipt.operation !== receipt.accepted.operation
    )
      context.addIssue({ code: "custom", message: "Receipt metadata must match command identity" });
  });
export type AttentionFeedbackCommandReceipt = z.infer<typeof AttentionFeedbackCommandReceiptSchema>;

export function canonicalizeAttentionFeedbackCommand(input: AttentionFeedbackCommand): string {
  const command = AttentionFeedbackCommandSchema.parse(input);
  // Parsing gives fixed key order, including the nested reason, independent of caller key order.
  const { commandId: _commandId, ...payload } = command;
  void _commandId;
  return `shelf-judge.attention-feedback.v1\n${JSON.stringify(payload)}`;
}

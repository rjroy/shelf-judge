import { z } from "zod";
import { AttentionCommandReceiptSchema, StableRuleIdSchema } from "./collection-profile-validation";

const IdSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const PositiveSafeIntegerSchema = z.number().int().safe().positive();
const SafeCountSchema = z.number().int().safe().nonnegative();
const CanonicalFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);

const AttentionDispositionCommandBaseSchema = z
  .object({
    commandId: IdSchema,
    gameId: IdSchema,
    ruleId: StableRuleIdSchema,
    ruleVersion: PositiveSafeIntegerSchema,
    fingerprint: CanonicalFingerprintSchema,
    expectedVersion: SafeCountSchema,
  })
  .strict();

export const AttentionDispositionCommandTemplateBaseSchema =
  AttentionDispositionCommandBaseSchema.omit({ commandId: true }).strict();

export const NotNowAttentionCommandSchema = AttentionDispositionCommandBaseSchema.extend({
  operation: z.literal("not-now"),
}).strict();

export const IntentionalAttentionCommandSchema = AttentionDispositionCommandBaseSchema.extend({
  operation: z.literal("intentional"),
}).strict();

export const AttentionDispositionCommandSchema = z.discriminatedUnion("operation", [
  NotNowAttentionCommandSchema,
  IntentionalAttentionCommandSchema,
]);

export const AttentionDispositionCommandTemplateSchema = z.discriminatedUnion("operation", [
  AttentionDispositionCommandTemplateBaseSchema.extend({
    operation: z.literal("not-now"),
  }).strict(),
  AttentionDispositionCommandTemplateBaseSchema.extend({
    operation: z.literal("intentional"),
  }).strict(),
]);

export type { AttentionDispositionCommandTemplate } from "./types";

export const AttentionDispositionCommandErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("validation") }).strict(),
  z.object({ code: z.literal("command-reuse"), commandId: IdSchema }).strict(),
  z.object({ code: z.literal("game-not-found"), gameId: IdSchema }).strict(),
  z.object({ code: z.literal("ineligible-game"), gameId: IdSchema }).strict(),
  z
    .object({
      code: z.literal("stale-version"),
      gameId: IdSchema,
      expectedVersion: SafeCountSchema,
    })
    .strict(),
  z.object({ code: z.literal("candidate-mismatch"), gameId: IdSchema }).strict(),
  z.object({ code: z.literal("persistence-failure") }).strict(),
]);

export const AttentionDispositionCommandResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("accepted"),
      receipt: AttentionCommandReceiptSchema,
      attentionUnavailable: z.literal(true).optional(),
    })
    .strict(),
  z.object({ outcome: z.literal("replayed"), receipt: AttentionCommandReceiptSchema }).strict(),
  z
    .object({ outcome: z.literal("rejected"), error: AttentionDispositionCommandErrorSchema })
    .strict(),
]);

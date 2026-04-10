import { z } from "zod";

const VetoConfigSchema = z.object({
  direction: z.enum(["below", "above"]),
  threshold: z.number(),
});

const curveFields = {
  preferenceShape: z.enum(["higher-is-better", "lower-is-better", "sweet-spot"]).optional(),
  idealValue: z.number().nullable().optional(),
  tolerance: z.enum(["flexible", "moderate", "strict"]).optional(),
  leanDirection: z.enum(["lower", "higher"]).nullable().optional(),
  veto: VetoConfigSchema.nullable().optional(),
};

export const CreateAxisSchema = z
  .object({
    name: z.string().min(1, "Axis name cannot be empty"),
    description: z.string().nullable().optional().default(null),
    weight: z.number().int("Weight must be an integer").min(0).max(100),
    source: z.enum(["personal", "bgg"]).optional().default("personal"),
    bggField: z.string().nullable().optional().default(null),
    ...curveFields,
  })
  .refine(
    (data) =>
      data.preferenceShape !== "sweet-spot" ||
      (data.idealValue !== undefined && data.idealValue !== null),
    { message: "idealValue is required when preferenceShape is sweet-spot", path: ["idealValue"] },
  );

// UpdateAxisSchema omits the sweet-spot/idealValue refinement that CreateAxisSchema has.
// On update, an axis may already have idealValue stored, so sending
// { preferenceShape: "sweet-spot" } without idealValue is valid.
// The service layer validates against stored axis state instead.
export const UpdateAxisSchema = z.object({
  name: z.string().min(1, "Axis name cannot be empty").optional(),
  description: z.string().nullable().optional(),
  weight: z.number().int("Weight must be an integer").min(0).max(100).optional(),
  ...curveFields,
});

export const RateGameSchema = z.object({
  axisId: z.string().min(1),
  rating: z.number().int("Rating must be an integer").min(1).max(10),
});

const AddGameBaseFields = {
  yearPublished: z.number().int().nullable().optional().default(null),
  minPlayers: z.number().int().min(1).nullable().optional().default(null),
  maxPlayers: z.number().int().min(1).nullable().optional().default(null),
  playingTime: z.number().int().min(0).nullable().optional().default(null),
  imageUrl: z.string().url().nullable().optional().default(null),
  numPlays: z.number().int().min(0).nullable().optional().default(null),
};

// Union: { bggId: number } | { name: string, yearPublished?: number }
// Both can coexist, but at least one of bggId or name must be present.
export const AddGameSchema = z
  .object({
    name: z.string().min(1, "Game name cannot be empty").optional(),
    bggId: z.number().int().nullable().optional().default(null),
    ...AddGameBaseFields,
  })
  .refine(
    (data) =>
      (data.name !== undefined && data.name.length > 0) ||
      (data.bggId !== null && data.bggId !== undefined),
    { message: "Either name or bggId must be provided" },
  );

// Tournament schemas

export const SessionFilterSchema = z.object({
  type: z.enum(["name", "minFitness", "maxFitness", "bggTag", "staleness"]),
  value: z.string().min(1, "Filter value cannot be empty"),
});

export const StartSessionSchema = z.object({
  filters: z.array(SessionFilterSchema).nullable().optional().default(null),
});

export const SubmitComparisonSchema = z
  .object({
    gameAId: z.string().min(1, "gameAId is required"),
    gameBId: z.string().min(1, "gameBId is required"),
    winnerId: z.string().min(1, "winnerId is required"),
  })
  .refine((data) => data.winnerId === data.gameAId || data.winnerId === data.gameBId, {
    message: "winnerId must equal gameAId or gameBId",
    path: ["winnerId"],
  });

export const TournamentSettingsUpdateSchema = z
  .object({
    kFactorThreshold: z.number().optional(),
    normalizationHalfWidth: z.number().optional(),
    provisionalThreshold: z.number().optional(),
  })
  .strict();

export type CreateAxisInput = z.input<typeof CreateAxisSchema>;
export type UpdateAxisInput = z.input<typeof UpdateAxisSchema>;
export type RateGameInput = z.input<typeof RateGameSchema>;
export type AddGameInput = z.input<typeof AddGameSchema>;
export type SessionFilterInput = z.input<typeof SessionFilterSchema>;
export type StartSessionInput = z.input<typeof StartSessionSchema>;
export type SubmitComparisonInput = z.input<typeof SubmitComparisonSchema>;
export type TournamentSettingsUpdateInput = z.input<typeof TournamentSettingsUpdateSchema>;

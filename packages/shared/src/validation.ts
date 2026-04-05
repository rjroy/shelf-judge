import { z } from "zod";

export const CreateAxisSchema = z.object({
  name: z.string().min(1, "Axis name cannot be empty"),
  description: z.string().nullable().optional().default(null),
  weight: z.number().int("Weight must be an integer").min(0).max(100),
  source: z.enum(["personal", "bgg"]).optional().default("personal"),
  bggField: z.string().nullable().optional().default(null),
});

export const UpdateAxisSchema = z.object({
  name: z.string().min(1, "Axis name cannot be empty").optional(),
  description: z.string().nullable().optional(),
  weight: z.number().int("Weight must be an integer").min(0).max(100).optional(),
});

export const RateGameSchema = z.object({
  axisId: z.string().min(1),
  rating: z.number().int("Rating must be an integer").min(1).max(10),
});

export const AddGameSchema = z.object({
  name: z.string().min(1, "Game name cannot be empty"),
  bggId: z.number().int().nullable().optional().default(null),
  yearPublished: z.number().int().nullable().optional().default(null),
  minPlayers: z.number().int().min(1).nullable().optional().default(null),
  maxPlayers: z.number().int().min(1).nullable().optional().default(null),
  playingTime: z.number().int().min(0).nullable().optional().default(null),
  imageUrl: z.string().url().nullable().optional().default(null),
});

export type CreateAxisInput = z.infer<typeof CreateAxisSchema>;
export type UpdateAxisInput = z.infer<typeof UpdateAxisSchema>;
export type RateGameInput = z.infer<typeof RateGameSchema>;
export type AddGameInput = z.infer<typeof AddGameSchema>;

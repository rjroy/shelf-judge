import { z } from "zod";
import type { CollectionProfileEntityPolicy } from "./types";

export const DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY: CollectionProfileEntityPolicy = {
  mechanic: { overviewLimit: 3, minimumSupportedGames: 3 },
  designer: { overviewLimit: 3, minimumSupportedGames: 3 },
  artist: { overviewLimit: 3, minimumSupportedGames: 3 },
};

const CollectionProfileEntityClassPolicySchema = z
  .object({
    overviewLimit: z.number().int().safe().min(0),
    minimumSupportedGames: z.number().int().safe().positive(),
  })
  .strict();

export const CollectionProfileEntityPolicySchema = z
  .object({
    mechanic: CollectionProfileEntityClassPolicySchema,
    designer: CollectionProfileEntityClassPolicySchema,
    artist: CollectionProfileEntityClassPolicySchema,
  })
  .strict();

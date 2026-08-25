import * as path from "node:path";
import { CURRENT_COLLECTION_SCHEMA_VERSION } from "@shelf-judge/shared";
import { z } from "zod";
import { atomicWrite, type FileOps, type TemporaryPathForAttempt } from "./file-ops.js";
import type { Logger } from "./logger.js";

export interface CollectionArtifactContext {
  dataDir: string;
  fileOps: FileOps;
  logger: Logger;
  quarantinePathForAttempt(activePath: string, attempt: number): string;
  temporaryPathForAttempt: TemporaryPathForAttempt;
}

export interface CollectionArtifactDescriptor {
  identity: string;
  dependencyVersion: number;
  path(dataDir: string): string;
  invalidate(context: CollectionArtifactContext): Promise<void>;
}

const WishlistCoreEntrySchema = z
  .object({
    id: z.string().min(1),
    bggId: z.number().int(),
    name: z.string().min(1),
    yearPublished: z.number().int().nullable(),
    thumbnailUrl: z.string().nullable(),
    addedAt: z.string(),
  })
  .passthrough();

const WishlistPredictionFieldsSchema = z
  .object({
    predictedScore: z.number().nullable(),
    predictionConfidence: z
      .enum(["actual", "strong", "moderate", "weak", "insufficient"])
      .nullable(),
    predictedBreakdown: z
      .array(
        z
          .object({
            axisName: z.string(),
            rating: z.number(),
            confidence: z.enum(["actual", "strong", "moderate", "weak", "insufficient"]),
          })
          .strict(),
      )
      .nullable(),
    nicheImpact: z.unknown().nullable(),
  })
  .strip();

type ClearedWishlistEntry = z.output<typeof WishlistCoreEntrySchema> & {
  predictedScore: null;
  predictionConfidence: null;
  predictedBreakdown: null;
  nicheImpact: null;
};

function defaultQuarantinePath(activePath: string, attempt: number): string {
  return `${activePath}.quarantine${attempt === 0 ? "" : `.${attempt}`}`;
}

async function quarantine(
  activePath: string,
  raw: string,
  context: CollectionArtifactContext,
): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    const candidate = context.quarantinePathForAttempt(activePath, attempt);
    context.logger.log(`wishlist quarantine attempt path=${candidate}`);
    try {
      if (await context.fileOps.writeFileExclusive(candidate, raw)) {
        context.logger.warn(`wishlist quarantine completed path=${candidate}`);
        return candidate;
      }
      context.logger.warn(`wishlist quarantine collision path=${candidate}`);
    } catch (error) {
      context.logger.error(`wishlist quarantine failed path=${candidate}`, error);
      throw error;
    }
  }
}

const profilePath = (dataDir: string): string => path.join(dataDir, "profile.json");
const wishlistPath = (dataDir: string): string => path.join(dataDir, "wishlist.json");

const profileDescriptor: CollectionArtifactDescriptor = {
  identity: "collection-profile",
  dependencyVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
  path: profilePath,
  async invalidate(context): Promise<void> {
    await context.fileOps.unlink(profilePath(context.dataDir));
  },
};

const wishlistDescriptor: CollectionArtifactDescriptor = {
  identity: "wishlist-predictions",
  dependencyVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
  path: wishlistPath,
  async invalidate(context): Promise<void> {
    const activePath = wishlistPath(context.dataDir);
    if (!(await context.fileOps.exists(activePath))) return;

    const raw = await context.fileOps.readFile(activePath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const quarantinePath = await quarantine(activePath, raw, context);
      context.logger.warn(`wishlist invalid JSON quarantined path=${quarantinePath}`);
      await context.fileOps.unlink(activePath);
      return;
    }

    if (!Array.isArray(parsed)) {
      const quarantinePath = await quarantine(activePath, raw, context);
      context.logger.warn(`wishlist non-array content quarantined path=${quarantinePath}`);
      await context.fileOps.unlink(activePath);
      return;
    }

    const salvageable: ClearedWishlistEntry[] = [];
    let invalidCoreCount = 0;
    let invalidPredictionCount = 0;
    for (const entry of parsed) {
      const core = WishlistCoreEntrySchema.safeParse(entry);
      if (!core.success) {
        invalidCoreCount += 1;
        continue;
      }
      if (!WishlistPredictionFieldsSchema.safeParse(entry).success) invalidPredictionCount += 1;
      salvageable.push({
        ...core.data,
        predictedScore: null,
        predictionConfidence: null,
        predictedBreakdown: null,
        nicheImpact: null,
      });
    }

    let quarantinePath: string | null = null;
    if (invalidCoreCount > 0) quarantinePath = await quarantine(activePath, raw, context);
    await atomicWrite(
      activePath,
      JSON.stringify(salvageable, null, 2),
      context.fileOps,
      context.temporaryPathForAttempt,
    );
    context.logger.log(
      `wishlist salvage completed retained=${salvageable.length} invalidCore=${invalidCoreCount} invalidPrediction=${invalidPredictionCount} quarantine=${quarantinePath ?? "none"}`,
    );
  },
};

export const COLLECTION_ARTIFACTS: readonly CollectionArtifactDescriptor[] = [
  profileDescriptor,
  wishlistDescriptor,
];

export function createCollectionArtifactContext(
  dataDir: string,
  fileOps: FileOps,
  logger: Logger,
  quarantinePathForAttempt: CollectionArtifactContext["quarantinePathForAttempt"] = defaultQuarantinePath,
  temporaryPathForAttempt: TemporaryPathForAttempt = (filePath, attempt) =>
    path.join(path.dirname(filePath), `.${path.basename(filePath)}.${attempt}.tmp`),
): CollectionArtifactContext {
  return { dataDir, fileOps, logger, quarantinePathForAttempt, temporaryPathForAttempt };
}

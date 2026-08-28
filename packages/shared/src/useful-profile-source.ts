import type { EntityClassMetadata, EntityMetadataByClass } from "./types";

export function createInitialEntityMetadata(bggId: number | null): EntityMetadataByClass {
  const metadata: EntityClassMetadata =
    bggId === null
      ? {
          state: "unrefreshable",
          entities: [],
          observedAt: null,
          refreshFailure: null,
          correctionDestination: null,
        }
      : {
          state: "refresh-needed",
          entities: [],
          observedAt: null,
          refreshFailure: null,
          correctionDestination: { operationId: "shelf.game.bgg.refresh" },
        };
  return {
    mechanic: structuredClone(metadata),
    designer: structuredClone(metadata),
    artist: structuredClone(metadata),
  };
}

import type {
  BggEntityLink,
  EntityClassMetadata,
  EntityMetadataByClass,
  CollectionProfileEntityClass,
} from "./types";

export function createCompleteEntityMetadata(
  entities: Record<CollectionProfileEntityClass, BggEntityLink[]>,
  observedAt: string,
): EntityMetadataByClass {
  const complete = (entityClass: CollectionProfileEntityClass): EntityClassMetadata => ({
    state: "complete",
    entities: structuredClone(entities[entityClass]),
    observedAt,
    refreshFailure: null,
    correctionDestination: null,
  });
  return {
    mechanic: complete("mechanic"),
    designer: complete("designer"),
    artist: complete("artist"),
  };
}

export function createInitialEntityMetadata(bggId: number | null): EntityMetadataByClass {
  const metadata: EntityClassMetadata =
    bggId === null
      ? {
          state: "unrefreshable",
          entities: [],
          observedAt: null,
          refreshFailure: null,
          correctionDestination: null,
          explanation: "This game has no BGG ID, so Shelf Judge cannot refresh entity metadata.",
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

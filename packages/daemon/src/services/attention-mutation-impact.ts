import type { AttentionMutationImpact } from "./attention-candidate-service.js";

/** Closed mutation vocabulary used at the durable collection boundary. */
export const CollectionMutationOperation = {
  gameAdd: "game.add",
  gameRemove: "game.remove",
  gameOwnershipSet: "game.ownership.set",
  gameImport: "game.import",
  gameRate: "game.rate",
  gameManualValuesSet: "game.manual-values.set",
  gameDimensionsSet: "game.dimensions.set",
  gameShelfSet: "game.shelf.set",
  gameAdditionalBggIdsSet: "game.additional-bgg-ids.set",
  gameBggRefresh: "game.bgg.refresh",
  gameBggRefreshAll: "game.bgg.refresh-all",
  gameBggRefreshFailed: "game.bgg.refresh-failed",
  intentionCreate: "game.intention.create",
  intentionUpdate: "game.intention.update",
  intentionDelete: "game.intention.delete",
  intentionComplete: "game.intention.complete",
  intentionRetire: "game.intention.retire",
  intentionDetail: "game.intention.detail",
  playsSet: "shelf.game.plays.set",
  noteGet: "shelf.game.note.get",
  noteStatesGet: "shelf.game.note.states.get",
  noteCreate: "shelf.game.note.create",
  noteUpdate: "shelf.game.note.update",
  noteDelete: "shelf.game.note.delete",
  noteSet: "shelf.game.note.set",
  noteClear: "shelf.game.note.clear",
  shelfAssign: "shelf.assignment.set",
  shelfClear: "shelf.assignment.clear",
  shelfConfigSet: "shelf.config.set",
  shelfUnitAdd: "shelf.unit.add",
  shelfUnitUpdate: "shelf.unit.update",
  shelfUnitRemove: "shelf.unit.remove",
  axisCreate: "axis.create",
  axisUpdate: "axis.update",
  axisRepair: "axis.repair",
  axisDelete: "axis.delete",
  benchmarkSet: "purchase.benchmark.set",
  benchmarkClear: "purchase.benchmark.clear",
  acquisitionSet: "purchase.acquisition.set",
} as const;

export type CollectionMutationOperation =
  (typeof CollectionMutationOperation)[keyof typeof CollectionMutationOperation];

type ImpactPolicy = "global" | "games" | "identity" | "none";

const impactPolicy = {
  [CollectionMutationOperation.gameAdd]: "global",
  [CollectionMutationOperation.gameRemove]: "global",
  [CollectionMutationOperation.gameOwnershipSet]: "global",
  [CollectionMutationOperation.gameImport]: "global",
  [CollectionMutationOperation.gameRate]: "global",
  [CollectionMutationOperation.gameManualValuesSet]: "global",
  [CollectionMutationOperation.gameDimensionsSet]: "identity",
  [CollectionMutationOperation.gameShelfSet]: "identity",
  [CollectionMutationOperation.gameAdditionalBggIdsSet]: "games",
  [CollectionMutationOperation.gameBggRefresh]: "global",
  [CollectionMutationOperation.gameBggRefreshAll]: "global",
  [CollectionMutationOperation.gameBggRefreshFailed]: "games",
  [CollectionMutationOperation.intentionCreate]: "games",
  [CollectionMutationOperation.intentionUpdate]: "games",
  [CollectionMutationOperation.intentionDelete]: "games",
  [CollectionMutationOperation.intentionComplete]: "games",
  [CollectionMutationOperation.intentionRetire]: "games",
  [CollectionMutationOperation.intentionDetail]: "none",
  [CollectionMutationOperation.playsSet]: "games",
  [CollectionMutationOperation.noteGet]: "none",
  [CollectionMutationOperation.noteStatesGet]: "none",
  [CollectionMutationOperation.noteCreate]: "identity",
  [CollectionMutationOperation.noteUpdate]: "identity",
  [CollectionMutationOperation.noteDelete]: "identity",
  [CollectionMutationOperation.noteSet]: "identity",
  [CollectionMutationOperation.noteClear]: "identity",
  [CollectionMutationOperation.shelfAssign]: "identity",
  [CollectionMutationOperation.shelfClear]: "identity",
  [CollectionMutationOperation.shelfConfigSet]: "identity",
  [CollectionMutationOperation.shelfUnitAdd]: "identity",
  [CollectionMutationOperation.shelfUnitUpdate]: "identity",
  [CollectionMutationOperation.shelfUnitRemove]: "identity",
  [CollectionMutationOperation.axisCreate]: "global",
  [CollectionMutationOperation.axisUpdate]: "global",
  [CollectionMutationOperation.axisRepair]: "global",
  [CollectionMutationOperation.axisDelete]: "global",
  [CollectionMutationOperation.benchmarkSet]: "global",
  [CollectionMutationOperation.benchmarkClear]: "global",
  [CollectionMutationOperation.acquisitionSet]: "games",
} as const satisfies Record<CollectionMutationOperation, ImpactPolicy>;

export function attentionImpactForCollectionMutation(
  operation: CollectionMutationOperation | TestCollectionMutationOperation,
  gameIds: readonly string[] = [],
): AttentionMutationImpact | null {
  if (!(operation in impactPolicy)) return { kind: "games", gameIds: [] };
  switch (impactPolicy[operation as CollectionMutationOperation]) {
    case "global":
      return {
        kind: "global",
        reason:
          operation === CollectionMutationOperation.gameRate
            ? "rating"
            : operation.startsWith("axis.")
              ? "axis"
              : operation.startsWith("purchase.benchmark")
                ? "purchase-benchmark"
                : operation === CollectionMutationOperation.gameOwnershipSet ||
                    operation === CollectionMutationOperation.gameAdd ||
                    operation === CollectionMutationOperation.gameRemove ||
                    operation === CollectionMutationOperation.gameImport
                  ? "ownership"
                  : "metadata",
      };
    case "games":
      return { kind: "games", gameIds: [...new Set(gameIds)].sort() };
    case "identity":
      return { kind: "games", gameIds: [] };
    case "none":
      return null;
  }
}

/** Test-only vocabulary keeps production call sites closed while preserving fixtures. */
export type TestCollectionMutationOperation = `test.${string}` | "game.note.set";

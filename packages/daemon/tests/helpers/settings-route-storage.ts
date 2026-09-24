import type { StorageService } from "../../src/services/storage-service";

// Unused methods remain callable with the same defaults as the settings-route suites.
// Each suite overrides its own settings methods to retain mutable test state.
export function createSettingsRouteStorageStub(): StorageService {
  return {
    loadCollection: () => Promise.reject(new Error("not implemented")),
    saveCollection: () => Promise.resolve(),
    loadConfig: () => Promise.reject(new Error("not implemented")),
    saveConfig: () => Promise.resolve(),
    loadTournament: () => Promise.reject(new Error("not implemented")),
    saveTournament: () => Promise.resolve(),
    loadProfile: () => Promise.resolve(null),
    saveProfile: () => Promise.resolve(),
    loadPredictionSettings: () =>
      Promise.resolve({
        stageThresholds: [5, 15, 30],
        defaultK: 5,
        minSimilarityThreshold: 0.2,
      }),
    savePredictionSettings: () => Promise.resolve(),
    loadNicheSettings: () => Promise.resolve({ ignoredTags: [] }),
    saveNicheSettings: () => Promise.resolve(),
    loadRedundancySettings: () =>
      Promise.resolve({
        enabled: false,
        stage: "annotation",
        similarityThreshold: 0.6,
        maxPenalty: 2.0,
        componentWeights: { binary: 0.4, continuous: 0.3, personalAxes: 0.3 },
        minNeighbors: 1,
        expectedNeighbors: 5,
      }),
    saveRedundancySettings: () => Promise.resolve(),
    loadWishlist: () => Promise.resolve([]),
    saveWishlist: () => Promise.resolve(),
    loadShelfConfig: () => Promise.resolve({ units: [], createdAt: "", updatedAt: "" }),
    saveShelfConfig: () => Promise.resolve(),
  };
}

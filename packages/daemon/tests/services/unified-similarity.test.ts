import { describe, expect, test } from "bun:test";
import {
  createInitialSemanticRedundancyStateV10,
  type RedundancySettings,
} from "@shelf-judge/shared";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileOps } from "../../src/services/file-ops.js";
import { DEFAULT_REDUNDANCY_SETTINGS } from "../../src/services/redundancy-engine.js";
import { createStorageService } from "../../src/services/storage-service.js";
import {
  captureSimilaritySettings,
  factualSimilarity,
  unifiedSimilarity,
  type SimilarityComponents,
} from "../../src/services/unified-similarity.js";

const available = (value: number) => ({ availability: "available" as const, value });
const unavailable = { availability: "unavailable" as const };

function redundancySettings(
  weights: RedundancySettings["componentWeights"] = DEFAULT_REDUNDANCY_SETTINGS.componentWeights,
  enabled = false,
): RedundancySettings {
  return { ...DEFAULT_REDUNDANCY_SETTINGS, enabled, componentWeights: weights };
}

describe("staged unified similarity", () => {
  test("factual F uses the captured stored 4:3 default, then preserves a persisted 1:3 ratio after reopen", async () => {
    const a = { binary: [1, 0], continuous: [0] };
    const b = { binary: [0, 1], continuous: [0] };
    const defaultSettings = captureSimilaritySettings(
      redundancySettings(),
      createInitialSemanticRedundancyStateV10().settings,
    );
    expect(factualSimilarity(a, b, defaultSettings.factual)).toBeCloseTo(3 / 7);
    const aWithPersonalAxes = { ...a, personalAxes: [0] };
    const bWithPersonalAxes = { ...b, personalAxes: [1] };
    expect(
      factualSimilarity(aWithPersonalAxes, bWithPersonalAxes, defaultSettings.factual),
    ).toBeCloseTo(3 / 7);

    const directory = await mkdtemp(join(tmpdir(), "unified-similarity-settings-"));
    try {
      const firstStorage = createStorageService({
        dataDir: directory,
        configPath: join(directory, "config.json"),
        fileOps: createFileOps(),
      });
      const oneToThree = redundancySettings({ binary: 1, continuous: 3 });
      await firstStorage.saveRedundancySettings(oneToThree);

      const reopenedStorage = createStorageService({
        dataDir: directory,
        configPath: join(directory, "config.json"),
        fileOps: createFileOps(),
      });
      const restored = await reopenedStorage.loadRedundancySettings();
      const restoredSettings = captureSimilaritySettings(
        restored,
        createInitialSemanticRedundancyStateV10().settings,
      );
      expect(restored.componentWeights).toEqual({ binary: 1, continuous: 3 });
      expect(factualSimilarity(a, b, restoredSettings.factual)).toBeCloseTo(0.75);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("captures semantic weights without coupling factual similarity to the penalty toggle", () => {
    const semantic = {
      ...createInitialSemanticRedundancyStateV10().settings,
      enabled: true,
      weights: { factual: 2, description: 3, ownerNote: 5 },
      cachedOwnerNoteUse: true,
    };
    const components: SimilarityComponents = {
      factual: available(0.4),
      description: available(0.8),
      ownerNote: available(0.2),
    };
    const capturedOff = captureSimilaritySettings(redundancySettings(undefined, false), semantic);
    const capturedOn = captureSimilaritySettings(redundancySettings(undefined, true), semantic);
    expect(capturedOff.factual).toEqual(capturedOn.factual);
    expect(unifiedSimilarity(components, capturedOff)).toBeCloseTo(0.42);
    expect(unifiedSimilarity(components, capturedOn)).toBeCloseTo(0.42);
  });

  test("semantic disablement omits description and notes while retaining factual F", () => {
    const semantic = {
      ...createInitialSemanticRedundancyStateV10().settings,
      enabled: false,
      weights: { factual: 2, description: 3, ownerNote: 5 },
      cachedOwnerNoteUse: true,
    };
    const settings = captureSimilaritySettings(redundancySettings(), semantic);
    expect(settings.semantic).toEqual({
      enabled: false,
      factual: 2,
      description: 0,
      ownerNote: 0,
    });
    expect(
      unifiedSimilarity(
        { factual: available(0.7), description: available(0), ownerNote: available(0) },
        settings,
      ),
    ).toBe(0.7);
  });

  test("cached owner-note permission excludes O but leaves factual and description components", () => {
    const semantic = {
      ...createInitialSemanticRedundancyStateV10().settings,
      enabled: true,
      weights: { factual: 1, description: 1, ownerNote: 100 },
      cachedOwnerNoteUse: false,
    };
    const settings = captureSimilaritySettings(redundancySettings(), semantic);
    expect(settings.semantic.ownerNote).toBe(0);
    expect(
      unifiedSimilarity(
        { factual: available(0.2), description: available(0.8), ownerNote: available(0) },
        settings,
      ),
    ).toBe(0.5);
  });

  test("normalizes only available components; an available zero keeps its weight", () => {
    const settings = captureSimilaritySettings(redundancySettings(), {
      ...createInitialSemanticRedundancyStateV10().settings,
      enabled: true,
      weights: { factual: 1, description: 3, ownerNote: 4 },
      cachedOwnerNoteUse: true,
    });
    expect(
      unifiedSimilarity(
        { factual: available(0), description: available(1), ownerNote: unavailable },
        settings,
      ),
    ).toBe(0.75);
    expect(
      unifiedSimilarity(
        { factual: unavailable, description: unavailable, ownerNote: unavailable },
        settings,
      ),
    ).toBeNull();
    expect(
      unifiedSimilarity(
        { factual: available(1), description: available(1), ownerNote: available(1) },
        captureSimilaritySettings(redundancySettings(), {
          ...createInitialSemanticRedundancyStateV10().settings,
          enabled: true,
          weights: { factual: 0, description: 0, ownerNote: 0 },
        }),
      ),
    ).toBeNull();
  });

  test("rejects invalid components and weights rather than manufacturing evidence", () => {
    const settings = captureSimilaritySettings(
      redundancySettings(),
      createInitialSemanticRedundancyStateV10().settings,
    );
    expect(() =>
      unifiedSimilarity(
        { factual: available(Number.NaN), description: unavailable, ownerNote: unavailable },
        settings,
      ),
    ).toThrow(RangeError);
    expect(() =>
      factualSimilarity(
        { binary: [0], continuous: [0] },
        { binary: [1], continuous: [1] },
        { binary: 0, continuous: 0 },
      ),
    ).toThrow(RangeError);
  });

  test("normalizes large finite weights without overflow", () => {
    const factual = factualSimilarity(
      { binary: [1], continuous: [0] },
      { binary: [0], continuous: [0] },
      { binary: 1e308, continuous: 1e308 },
    );
    expect(factual).toBe(0.5);
    const settings = {
      factual: { binary: 1, continuous: 1 },
      semantic: { enabled: true, factual: 1e308, description: 1e308, ownerNote: 0 },
    };
    expect(
      unifiedSimilarity(
        { factual: available(0), description: available(1), ownerNote: unavailable },
        settings,
      ),
    ).toBe(0.5);
  });
});

import { describe, expect, test } from "bun:test";
import type { Collection, GameWithScore } from "@shelf-judge/shared";
import { resolveSemanticRedundancyPairTable } from "../../src/services/semantic-redundancy-pair-resolver.js";
import { computeRedundancyAnalysis } from "../../src/services/redundancy-engine.js";
import type { SemanticGenerationSourceIdentity } from "../../src/services/source-vector.js";
import {
  semanticGenerationFixture,
  semanticSourceIdentityFixture,
} from "../helpers/semantic-redundancy-fixtures.js";

const source: SemanticGenerationSourceIdentity = {
  collectionId: "fixture-collection",
  collectionSchemaVersion: 9,
  evidenceEpoch: 0,
  consentEpoch: 0,
  tournamentRevision: 1,
  predictionSettingsRevision: 1,
  factualWeightsEpoch: 0,
  fencedFactualWeightsFingerprint: null,
  currentFactualWeightsFingerprint: "fingerprint",
};

const sourceIdentity = semanticSourceIdentityFixture();
const support = {
  modelId: "jev-pinned",
  rubricVersion: 1,
  scoringVersion: 1,
  sourceIdentity,
};
const factualSettings = {
  enabled: true,
  stage: "annotation" as const,
  similarityThreshold: 0.6,
  maxPenalty: 2,
  componentWeights: { binary: 4 / 7, continuous: 3 / 7 },
  minNeighbors: 1,
  expectedNeighbors: 5,
};

function collection(enabled = true): Collection {
  return {
    id: "fixture-collection",
    schemaVersion: 9,
    games: [],
    semanticRedundancy: {
      settings: {
        enabled,
        cachedOwnerNoteUse: false,
        weights: { factual: 7, description: 5, ownerNote: 0 },
      },
      evidenceEpoch: 0,
      consentEpoch: 0,
      factualWeightsEpoch: 0,
      factualWeightsFingerprint: null,
    },
  } as unknown as Collection;
}

function resolve(
  overrides: {
    enabled?: boolean;
    sourceIdentity?: typeof sourceIdentity;
    generation?: ReturnType<typeof semanticGenerationFixture> | null;
  } = {},
) {
  return resolveSemanticRedundancyPairTable({
    collection: collection(overrides.enabled),
    sourceIdentity: source,
    factualSettings,
    universe: [],
    generation:
      overrides.generation === undefined
        ? semanticGenerationFixture({ sourceIdentity })
        : overrides.generation,
    support: {
      ...support,
      sourceIdentity: overrides.sourceIdentity ?? support.sourceIdentity,
    },
  });
}

describe("semantic redundancy read adapter contract", () => {
  test("returns the immutable complete table as ready and fails closed on stale source identities", () => {
    expect(resolve().status).toBe("ready");
    expect(
      resolve({
        sourceIdentity: semanticSourceIdentityFixture({ tournamentHash: "d".repeat(64) }),
      }).status,
    ).toBe("stale");
    expect(
      resolve({
        sourceIdentity: semanticSourceIdentityFixture({
          factualWeightsFingerprint: "e".repeat(64),
        }),
      }).status,
    ).toBe("stale");
  });

  test("distinguishes absent publication and disabled factual scoring without storage or provider calls", () => {
    expect(resolve({ generation: null }).status).toBe("not-ready");
    const disabled = computeRedundancyAnalysis([], { ...factualSettings, enabled: false }, () => ({
      binary: [],
      continuous: [],
      personalAxes: [],
    }));
    expect(disabled.defaultSimilarityInfo.status).toBe("disabled");
  });

  test("a valid empty pair table supports a one-game no-neighbor result without losing ready status", () => {
    const loneGame = {
      game: { id: "g1", ownership: "owned" },
      score: {
        score: 5,
        breakdown: [],
        vetoed: false,
        redundancyAdjustment: null,
      },
    } as unknown as GameWithScore;
    const table = resolve();
    const result = computeRedundancyAnalysis(
      [loneGame],
      factualSettings,
      () => ({ binary: [], continuous: [], personalAxes: [] }),
      table,
    );
    expect(result.adjustments.has("g1")).toBe(false);
    expect(result.similarityInfo.get("g1")?.status).toBe("ready");
    expect(result.similarityInfo.get("g1")?.generationId).toBe("generation-fixture");
  });
});

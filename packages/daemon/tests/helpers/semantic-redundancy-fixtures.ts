import { semanticDisclosureManifestDigest } from "../../../shared/src/validation.js";
import type {
  SemanticDisclosureManifest,
  SemanticRedundancyGeneration,
  SemanticSourceIdentity,
} from "../../../shared/src/types.js";

export const SEMANTIC_FIXTURE_FINGERPRINT = "a".repeat(64);

export function semanticSourceIdentityFixture(
  overrides: Partial<SemanticSourceIdentity> = {},
): SemanticSourceIdentity {
  return {
    collectionId: "fixture-collection",
    collectionSchemaVersion: 9,
    collectionRevision: 0,
    evidenceEpoch: 0,
    consentEpoch: 0,
    factualWeightsEpoch: 0,
    factualWeightsFingerprint: null,
    tournamentHash: SEMANTIC_FIXTURE_FINGERPRINT,
    predictionSettingsHash: "b".repeat(64),
    redundancySettingsHash: "c".repeat(64),
    ...overrides,
  };
}

export function semanticGenerationFixture(
  overrides: Partial<SemanticRedundancyGeneration> = {},
): SemanticRedundancyGeneration {
  const sourceIdentity = semanticSourceIdentityFixture(overrides.sourceIdentity ?? {});
  return {
    id: "generation-fixture",
    manifestDigest: SEMANTIC_FIXTURE_FINGERPRINT,
    modelId: "jev-pinned",
    rubricVersion: 1,
    scoringVersion: 1,
    signalScope: "description-only",
    eligibleGameIds: [],
    weights: { factual: 7, description: 5, ownerNote: 0 },
    pairOutcomes: [],
    publishedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
    sourceIdentity,
    evidenceEpoch: sourceIdentity.evidenceEpoch,
    consentEpoch: sourceIdentity.consentEpoch,
  };
}

export function emptySemanticManifestFixture(
  sourceIdentity: SemanticSourceIdentity,
): SemanticDisclosureManifest {
  const base = {
    sourceIdentity,
    scoringVersion: 1,
    signalScope: "description-only" as const,
    providerId: "typesafe",
    modelId: "jev-pinned",
    rubricVersion: 1,
    budget: { maxRequests: 0, maxTokens: 0, maxDurationMs: 60_000 },
    expiresAt: "2099-01-02T00:00:00.000Z",
    eligibleGameIds: [],
    pairs: [],
  };
  return {
    id: "authorization-1",
    digest: semanticDisclosureManifestDigest(base),
    ...base,
  };
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createAnalystTurnService } from "../../src/services/analyst-turn-service.js";
import { createAnalystEvidenceService } from "../../src/services/analyst-evidence-service.js";
import type { AnalystProjectionSnapshot } from "../../src/services/analyst-evidence-projections.js";
import { createGroundedAnalysisProvider } from "../../src/services/grounded-analysis/provider.js";
import { GroundedAnalysisError } from "../../src/services/grounded-analysis/failure-mapping.js";
import {
  createOllamaProviderExtension,
  createOllamaRequestPayloadHook,
} from "../../src/services/grounded-analysis/ollama-provider-extension.js";

const modelId = "qwen3.6:27b";
// Explicit operator smoke, not part of the offline test suite. Uses synthetic data only.
const started = Date.now();
console.info(JSON.stringify({ stage: "attempt", provider: "ollama", modelId }));
const snapshot: AnalystProjectionSnapshot = {
  collectionId: "analyst-smoke-synthetic",
  collectionRevision: 1,
  snapshotFingerprint: createHash("sha256").update("analyst-smoke-synthetic-v1").digest("hex"),
  sources: [
    {
      evidenceClass: "game-identity-ownership",
      sourceId: "smoke-game-a",
      sourceVersion: "1",
      citationId: "smoke-citation-a",
      payload: {
        gameId: "smoke-game-a",
        displayName: "Synthetic Orchard",
        bggId: null,
        ownershipState: "owned",
      },
      canonicalSummary: "Synthetic Orchard is currently owned.",
      destination: { operationId: "shelf.game.get", parameters: { gameId: "smoke-game-a" } },
    },
  ],
  page: () => ({ sources: [], nextCursor: null, totalSourceCount: 1 }),
};
const provider = createGroundedAnalysisProvider({
  configuration: { status: "configured", providerId: "ollama", modelId, extensionIds: [] },
  piSessionFactory: {
    cwd: process.cwd(),
    extensionFactories: [createOllamaProviderExtension(modelId)],
    onPayload: createOllamaRequestPayloadHook(1024),
  },
});
const service = createAnalystTurnService({
  provider,
  evidenceService: createAnalystEvidenceService({
    storageService: {},
    projectionSnapshotService: { capture: () => Promise.resolve(snapshot) },
  }),
});
const result = await service
  .run({
    systemPrompt: [
      "You are a collection analyst. Use only evidence returned by retrieve_analyst_evidence.",
      "First retrieve game-identity-ownership evidence with limit 1.",
      "Then call submit_grounded_analysis exactly once with a submission matching its schema.",
      "The submission tool argument must be an object with a submission property whose value is a JSON object, not a JSON-encoded string.",
      "Copy the returned citation object exactly, and reference its citationId in your answer block.",
      "Omit optional fields that do not apply. In particular, omit reason for an answered result, and omit uncertainty unless needed. Never emit empty strings for optional fields.",
      'Use outcome answered and usage {"state":"unavailable"}. Do not emit free text outside tool calls.',
    ].join(" "),
    prompt: "Which game is owned in this synthetic collection? Give one short cited answer.",
    signal: AbortSignal.timeout(180_000),
    audit: {
      operationId: "analyst-provider-smoke",
      batchId: "synthetic-smoke",
      requestId: crypto.randomUUID(),
      feature: "collection-analyst",
      trigger: "operator-smoke",
      evidenceManifestId: "analyst-smoke-synthetic",
      evidenceManifestVersion: "1",
      evidenceClassCounts: [{ evidenceClass: "game-identity-ownership", count: 1 }],
      evidenceIdentityHash: snapshot.snapshotFingerprint,
    },
  })
  .catch((error: unknown) => {
    if (error instanceof GroundedAnalysisError) {
      console.error(
        JSON.stringify({
          stage: "failed",
          reason: error.reason,
          safeDetail: error.safeDetail,
          diagnostics: error.submissionDiagnostics,
        }),
      );
    }
    throw error;
  });
if (!("output" in result)) {
  throw new Error(
    `Analyst rejected result: ${JSON.stringify({ reason: result.reason, diagnostic: result.diagnostic })}`,
  );
}
assert.equal(result.output.outcome, "answered");
assert(result.retrieved.length > 0, "Model must actually retrieve evidence");
assert.deepEqual(
  result.output.citations.map(({ citationId }) => citationId),
  ["smoke-citation-a"],
);
assert(result.output.blocks.some(({ citationIds }) => citationIds.includes("smoke-citation-a")));
console.info(
  JSON.stringify({
    stage: "validated",
    occurredAt: new Date().toISOString(),
    provider: "ollama",
    modelId,
    endpoint: "http://127.0.0.1:11434/v1",
    fixture: "synthetic",
    elapsedMs: Date.now() - started,
    outcome: result.output.outcome,
    retrievedPageCount: result.retrieved.length,
    citationIds: result.output.citations.map(({ citationId }) => citationId),
    usage: result.usage,
  }),
);

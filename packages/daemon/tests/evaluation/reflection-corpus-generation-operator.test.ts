import { expect, test } from "bun:test";
import type {
  GroundedAnalysisProvider,
  GroundedAnalysisRequest,
} from "../../src/services/grounded-analysis/provider.js";
import { GroundedAnalysisError } from "../../src/services/grounded-analysis/failure-mapping.js";
import { runReflectionCorpusGenerationOperator } from "./reflection-corpus-generation-operator.js";

const artifactPath = ".shelf-judge/reflection-evaluation/corpus-test.json";
const fixtureIds = "repeated-values-01-setup-friction,pattern-exceptions-01-setup-friction";

function provider(requests: GroundedAnalysisRequest<unknown>[] = []): GroundedAnalysisProvider {
  return {
    configurationStatus: {
      status: "configured",
      identity: { providerId: "ollama", modelId: "qwen3.6:27B", extensionIds: [] },
    },
    analyze<Output>(request: GroundedAnalysisRequest<Output>) {
      requests.push(request);
      return Promise.resolve({
        output: request.submissionSchema.parse({
          result: {
            outcome: "abstained",
            reason: "no-material-synthesis",
            explanation: "Synthetic strings are not a production evidence package.",
            supportingBlocks: [],
            noteExcerpts: [],
          },
        }),
        usage: { state: "unavailable" },
      });
    },
  };
}

function deps(writes: string[], created = provider()) {
  return {
    fetchTags: () => Promise.resolve([{ name: "qwen3.6:27B" }]),
    createProvider: () => created,
    readArtifact: () => Promise.reject(new Error("ENOENT")),
    atomicWrite: (_path: string, content: string) => {
      writes.push(content);
      return Promise.resolve();
    },
    acquireLock: () => Promise.resolve({ release: () => Promise.resolve() }),
  };
}

test("corpus generation checkpoints deterministic baseline provenance and supports additive resume", async () => {
  const writes: string[] = [];
  const first = await runReflectionCorpusGenerationOperator(
    ["--artifact", artifactPath, "--fixtures", "repeated-values-01-setup-friction"],
    deps(writes),
  );
  expect(first.exitCode).toBe(0);
  expect(writes).toHaveLength(1);
  const second = await runReflectionCorpusGenerationOperator(
    ["--artifact", artifactPath, "--fixtures", fixtureIds],
    {
      ...deps(writes),
      readArtifact: () => Promise.resolve(writes[0] ?? ""),
    },
  );
  expect(second.exitCode).toBe(0);
  expect(second.lines).toContain("Skipped checkpointed fixture: repeated-values-01-setup-friction");
  expect(writes[1] ?? "").toContain('"source": "deterministic-fixture-baseline"');
  expect(writes[1] ?? "").toContain('"provenanceHash"');
});

test("corpus prompt does not transmit fixture outcome or rubric answer keys", async () => {
  const requests: GroundedAnalysisRequest<unknown>[] = [];
  await runReflectionCorpusGenerationOperator(
    ["--artifact", artifactPath, "--fixtures", "repeated-values-01-setup-friction"],
    deps([], provider(requests)),
  );
  const request = requests[0];
  expect(request?.prompt).not.toContain("expectedOutcome");
  expect(request?.prompt).not.toContain("requiredClaims");
  expect(request?.prompt).not.toContain("no-material-synthesis");
  expect(request?.systemPrompt).toContain("answered Reflection or an abstained Reflection");
});

test("corpus records an abort-aware provider timeout and continues to later fixtures", async () => {
  const writes: string[] = [];
  let calls = 0;
  const timeoutProvider: GroundedAnalysisProvider = {
    ...provider(),
    analyze<Output>(request: GroundedAnalysisRequest<Output>) {
      calls += 1;
      if (calls === 1)
        return new Promise((_, reject) => {
          request.signal.addEventListener(
            "abort",
            () =>
              reject(
                new GroundedAnalysisError("cancelled", "cancelled", {
                  usage: { state: "reported", inferenceRoundTrips: 1 },
                }),
              ),
            { once: true },
          );
        });
      return Promise.resolve({
        output: request.submissionSchema.parse({
          result: {
            outcome: "abstained",
            reason: "no-material-synthesis",
            explanation: "Diagnostic fixture.",
            supportingBlocks: [],
            noteExcerpts: [],
          },
        }),
        usage: { state: "unavailable" },
      });
    },
  };
  const result = await runReflectionCorpusGenerationOperator(
    ["--artifact", artifactPath, "--fixtures", fixtureIds, "--timeout-ms", "1"],
    deps(writes, timeoutProvider),
  );
  expect(result.exitCode).toBe(1);
  expect(calls).toBe(2);
  expect(writes).toHaveLength(2);
  expect(writes[0] ?? "").toContain('"stage": "timeout"');
  expect(writes[0] ?? "").toContain('"reason": "cancelled"');
  expect(writes[0] ?? "").toContain('"inferenceRoundTrips": 1');
  expect(writes[1] ?? "").toContain('"status": "succeeded"');
});

test("corpus bounds an abort-ignoring provider timeout and halts before another request", async () => {
  const writes: string[] = [];
  let calls = 0;
  const timeoutProvider: GroundedAnalysisProvider = {
    ...provider(),
    analyze<Output>(request: GroundedAnalysisRequest<Output>) {
      calls += 1;
      if (calls === 1) return new Promise<never>(() => undefined);
      return Promise.resolve({
        output: request.submissionSchema.parse({
          result: {
            outcome: "abstained",
            reason: "no-material-synthesis",
            explanation: "Diagnostic fixture.",
            supportingBlocks: [],
            noteExcerpts: [],
          },
        }),
        usage: { state: "unavailable" },
      });
    },
  };
  const startedAt = performance.now();
  const result = await runReflectionCorpusGenerationOperator(
    ["--artifact", artifactPath, "--fixtures", fixtureIds, "--timeout-ms", "1"],
    deps(writes, timeoutProvider),
  );
  expect(performance.now() - startedAt).toBeLessThan(1_000);
  expect(result.exitCode).toBe(1);
  expect(calls).toBe(1);
  expect(writes).toHaveLength(1);
  expect(writes[0] ?? "").toContain('"stage": "timeout"');
  expect(result.lines).toContain("Halting batch: provider did not settle after abort");
});

test("corpus preserves allowlisted categorized failures, usage, and submission diagnostics", async () => {
  const writes: string[] = [];
  const failedProvider: GroundedAnalysisProvider = {
    ...provider(),
    analyze: () =>
      Promise.reject(
        new GroundedAnalysisError("output-validation", "invalid-structured-submission", {
          usage: { state: "reported", inferenceRoundTrips: 2 },
          submissionDiagnostics: {
            state: "observed",
            toolCallAttempts: 2,
            acceptedResultPresent: false,
            rejectedAttempts: 2,
            validationIssues: [{ code: "invalid_type", path: ["result", "centralSynthesis"] }],
            argumentShapes: [
              {
                topLevel: "object",
                submission: "object",
                result: "object",
                outcome: "other-string",
              },
            ],
            assistantStopReasons: ["length"],
          },
        }),
      ),
  };
  const result = await runReflectionCorpusGenerationOperator(
    ["--artifact", artifactPath, "--fixtures", "repeated-values-01-setup-friction"],
    deps(writes, failedProvider),
  );
  expect(result.exitCode).toBe(1);
  expect(writes[0] ?? "").toContain('"stage": "validation"');
  expect(writes[0] ?? "").toContain('"reason": "output-validation"');
  expect(writes[0] ?? "").toContain('"detail": "invalid-structured-submission"');
  expect(writes[0] ?? "").toContain('"inferenceRoundTrips": 2');
  expect(writes[0] ?? "").toContain('"toolCallAttempts": 2');
  expect(writes[0] ?? "").toContain('"validationIssues"');
  expect(writes[0] ?? "").toContain('"outcome": "other-string"');
  expect(writes[0] ?? "").toContain('"assistantStopReasons"');
});

test("corpus rejects unsafe or oversized submission diagnostic identifiers", async () => {
  const writes: string[] = [];
  const failedProvider: GroundedAnalysisProvider = {
    ...provider(),
    analyze: () =>
      Promise.reject(
        new GroundedAnalysisError("output-validation", "invalid-structured-submission", {
          submissionDiagnostics: {
            state: "observed",
            toolCallAttempts: 1,
            acceptedResultPresent: false,
            rejectedAttempts: 1,
            validationIssues: [{ code: "unsafe diagnostic code", path: ["x".repeat(257)] }],
          },
        }),
      ),
  };
  const result = await runReflectionCorpusGenerationOperator(
    ["--artifact", artifactPath, "--fixtures", "repeated-values-01-setup-friction"],
    deps(writes, failedProvider),
  );
  expect(result.exitCode).toBe(1);
  expect(writes).toHaveLength(1);
  const resumed = await runReflectionCorpusGenerationOperator(
    ["--artifact", artifactPath, "--fixtures", "repeated-values-01-setup-friction"],
    { ...deps([], failedProvider), readArtifact: () => Promise.resolve(writes[0] ?? "") },
  );
  expect(resumed).toMatchObject({ exitCode: 1, lines: ["Existing artifact is malformed"] });
});

test("corpus checkpoints provider failures without raw provider content", async () => {
  const writes: string[] = [];
  const secret = "fake-secret-4c614829";
  const requestBody = '{"prompt":"private fixture evidence"}';
  const failedProvider: GroundedAnalysisProvider = {
    ...provider(),
    analyze: () => Promise.reject(new Error(`provider rejected ${secret}: ${requestBody}`)),
  };
  const result = await runReflectionCorpusGenerationOperator(
    ["--artifact", artifactPath, "--fixtures", "repeated-values-01-setup-friction"],
    deps(writes, failedProvider),
  );
  expect(result).toMatchObject({
    exitCode: 1,
    lines: [
      "Preflight passed: synthetic diagnostic corpus only; no production validation or review evidence.",
      "Attempting fixture: repeated-values-01-setup-friction",
      "Failed fixture: repeated-values-01-setup-friction",
    ],
  });
  expect(writes).toHaveLength(1);
  expect(writes[0] ?? "").toContain('"detail": "provider-failed"');
  expect(writes[0] ?? "").not.toContain(secret);
  expect(writes[0] ?? "").not.toContain(requestBody);
});

test("corpus rejects arbitrary typed failure detail rather than persisting it", async () => {
  const writes: string[] = [];
  const secret = "fake-secret-cc2a77";
  const failedProvider: GroundedAnalysisProvider = {
    ...provider(),
    analyze: () => Promise.reject(new GroundedAnalysisError("transport", `provider:${secret}`)),
  };
  await runReflectionCorpusGenerationOperator(
    ["--artifact", artifactPath, "--fixtures", "repeated-values-01-setup-friction"],
    deps(writes, failedProvider),
  );
  expect(writes[0] ?? "").toContain('"reason": "transport"');
  expect(writes[0] ?? "").toContain('"detail": "categorized-provider-failure"');
  expect(writes[0] ?? "").not.toContain(secret);
});

test("corpus fails closed for malformed artifacts and lock collisions", async () => {
  const malformed = await runReflectionCorpusGenerationOperator(["--artifact", artifactPath], {
    ...deps([]),
    readArtifact: () => Promise.resolve('{"fixtures":{}}'),
  });
  expect(malformed).toMatchObject({ exitCode: 1, lines: ["Existing artifact is malformed"] });
  const locked = await runReflectionCorpusGenerationOperator(["--artifact", artifactPath], {
    ...deps([]),
    acquireLock: () =>
      Promise.reject(new Error("Artifact is already locked by another corpus generation process")),
  });
  expect(locked).toMatchObject({
    exitCode: 1,
    lines: ["Artifact is already locked by another corpus generation process"],
  });
});

test("retrying a valid failed checkpoint requires --retry-failed", async () => {
  const writes: string[] = [];
  const failedProvider: GroundedAnalysisProvider = {
    ...provider(),
    analyze: () => Promise.reject(new Error("provider-failed")),
  };
  await runReflectionCorpusGenerationOperator(
    ["--artifact", artifactPath, "--fixtures", "repeated-values-01-setup-friction"],
    deps(writes, failedProvider),
  );
  const skipped = await runReflectionCorpusGenerationOperator(
    ["--artifact", artifactPath, "--fixtures", "repeated-values-01-setup-friction"],
    { ...deps(writes), readArtifact: () => Promise.resolve(writes[0] ?? "") },
  );
  expect(skipped.lines).toContain(
    "Skipped checkpointed fixture: repeated-values-01-setup-friction",
  );
  const retried = await runReflectionCorpusGenerationOperator(
    [
      "--artifact",
      artifactPath,
      "--fixtures",
      "repeated-values-01-setup-friction",
      "--retry-failed",
    ],
    { ...deps(writes), readArtifact: () => Promise.resolve(writes[0] ?? "") },
  );
  expect(retried.lines).toContain("Attempting fixture: repeated-values-01-setup-friction");
});

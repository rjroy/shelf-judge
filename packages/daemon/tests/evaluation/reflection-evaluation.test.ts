import { expect, test } from "bun:test";
import {
  evaluateReflectionRelease,
  reflectionEvaluationCorpus,
  reflectionEvaluationCorpusVersion,
  reflectionQuestionIds,
  validateCorpus,
  validateReflectionEvaluationEvidence,
  type ReflectionEvaluationRecord,
  type ReflectionReview,
} from "./reflection-evaluation.js";
import {
  evaluateReflectionEvidenceJson,
  runReflectionEvaluationOperator,
} from "./reflection-evaluation-operator.js";
import {
  resolveOllamaModelAlias,
  runReflectionGenerationOperator,
} from "./reflection-evaluation-generation-operator.js";
import type {
  GroundedAnalysisProvider,
  GroundedAnalysisRequest,
} from "../../src/services/grounded-analysis/provider.js";

const scores = {
  grounding: 2,
  scopeHonesty: 2,
  citationInspectability: 2,
  additionalUsefulness: 3,
} as const;
const sharedContractAbstentionReasons = [
  "no-owner-testimony",
  "insufficient-independent-testimony",
  "no-supported-pattern",
  "no-material-synthesis",
  "conflicting-evidence",
  "incomplete-scope",
  "question-not-applicable",
] as const;
function review(
  id: string,
  reflectionLabel: "A" | "B" = "A",
  outcome: "answered" | "abstained" = "answered",
): ReflectionReview {
  const baselineLabel = reflectionLabel === "A" ? "B" : "A";
  const reflectionScores = scores;
  const baselineScores = {
    grounding: 2,
    scopeHonesty: 2,
    citationInspectability: 2,
    additionalUsefulness: 1,
  } as const;
  const paired =
    reflectionLabel === "A"
      ? { A: reflectionScores, B: baselineScores }
      : { A: baselineScores, B: reflectionScores };
  return {
    reviewerId: id,
    lockedAt: "2026-09-06T00:00:00.000Z",
    revealedAt: "2026-09-06T00:01:00.000Z",
    outputs: [
      {
        label: reflectionLabel,
        source: "reflection",
        outcome,
        text: "Generated paired output",
        provider: { providerId: "synthetic-test-provider", modelId: "synthetic-test-model" },
      },
      {
        label: baselineLabel,
        source: "baseline",
        outcome,
        text: "Card plus notes baseline",
        provider: { providerId: "deterministic-baseline", modelId: "not-applicable" },
      },
    ],
    scores: paired,
    outcomes: { A: outcome, B: outcome },
    rationale: "Locked before label reveal.",
  };
}
function record(
  fixtureId: string,
  outcome: "answered" | "abstained" = "answered",
): ReflectionEvaluationRecord {
  return {
    fixtureId,
    reviews: [review("reviewer-one", "A", outcome), review("reviewer-two", "A", outcome)],
    criticalFailures: [],
  };
}

test("versioned corpus has concrete pre-generation evidence and policy for every question", () => {
  expect(reflectionEvaluationCorpus).toHaveLength(60);
  expect(validateCorpus()).toEqual([]);
  for (const questionId of reflectionQuestionIds) {
    const fixtures = reflectionEvaluationCorpus.filter(
      (fixture) => fixture.questionId === questionId,
    );
    expect(fixtures.filter((fixture) => fixture.expectedOutcome === "answered")).toHaveLength(12);
    expect(fixtures.filter((fixture) => fixture.expectedOutcome === "abstained")).toHaveLength(8);
    expect(
      fixtures.every(
        (fixture) => fixture.evidence.notes.length >= 2 && fixture.evidence.adversarial.length > 0,
      ),
    ).toBe(true);
    expect(new Set(fixtures.map((fixture) => fixture.rationale)).size).toBe(20);
    expect(
      new Set(
        fixtures.flatMap((fixture) => (fixture.abstentionReason ? [fixture.abstentionReason] : [])),
      ),
    ).toEqual(new Set(sharedContractAbstentionReasons));
  }
});

test("evidence validation rejects duplicate records, incomplete paired reviews, and critical failures", () => {
  const fixture = reflectionEvaluationCorpus[0];
  const good = record(fixture.id);
  expect(
    validateReflectionEvaluationEvidence({
      corpusVersion: reflectionEvaluationCorpusVersion,
      records: [good, { ...good, criticalFailures: ["privacy-leak"] }],
    }),
  ).toEqual([`${fixture.id}: duplicate record`, `${fixture.id}: critical release failure`]);
});

test("third reviewer must be distinct and adjudicate the threshold-crossing score", () => {
  const fixture = reflectionEvaluationCorpus[0];
  const first = review("one");
  const second = review("two");
  const disputed: ReflectionReview = {
    ...second,
    scores: { ...second.scores, A: { ...second.scores.A, grounding: 1 } },
  };
  expect(
    validateReflectionEvaluationEvidence({
      corpusVersion: reflectionEvaluationCorpusVersion,
      records: [{ fixtureId: fixture.id, reviews: [first, disputed], criticalFailures: [] }],
    }),
  ).toEqual([`${fixture.id}: distinct third-reviewer adjudication required`]);
});

test("third review is required when reviewers disagree whether reflection beats the baseline", () => {
  const fixture = reflectionEvaluationCorpus[0];
  const first = {
    ...review("one"),
    scores: {
      A: { ...scores, additionalUsefulness: 3 as const },
      B: { ...scores, additionalUsefulness: 2 as const },
    },
  };
  const second = {
    ...review("two"),
    scores: {
      A: { ...scores, additionalUsefulness: 2 as const },
      B: { ...scores, additionalUsefulness: 3 as const },
    },
  };
  expect(
    validateReflectionEvaluationEvidence({
      corpusVersion: reflectionEvaluationCorpusVersion,
      records: [{ fixtureId: fixture.id, reviews: [first, second], criticalFailures: [] }],
    }),
  ).toEqual([`${fixture.id}: distinct third-reviewer adjudication required`]);
});

test("evidence validation rejects a reflection outcome that conflicts with its fixture", () => {
  const fixture = reflectionEvaluationCorpus.find(
    (candidate) => candidate.expectedOutcome === "abstained",
  );
  if (!fixture) throw new Error("Expected an abstention fixture");
  expect(
    validateReflectionEvaluationEvidence({
      corpusVersion: reflectionEvaluationCorpusVersion,
      records: [record(fixture.id)],
    }),
  ).toContain(`${fixture.id}: reflection outcome does not match fixture expectation`);
});

test("release scoring uses adjudicated scores, answerable-only denominators, and both usefulness gates", () => {
  const records = reflectionEvaluationCorpus.map((fixture) => record(fixture.id));
  const adjudicated: ReflectionEvaluationRecord[] = records.map((item, index) =>
    index < 4
      ? {
          ...item,
          adjudication: {
            reviewerId: `third-${index}`,
            lockedAt: "2026-09-06T01:00:00.000Z",
            revealedAt: "2026-09-06T01:01:00.000Z",
            trigger: "threshold-disagreement",
            outcome: "answered",
            reflectionScores: {
              grounding: 0,
              scopeHonesty: 2,
              citationInspectability: 2,
              additionalUsefulness: 3,
            },
            baselineScores: {
              grounding: 2,
              scopeHonesty: 2,
              citationInspectability: 2,
              additionalUsefulness: 1,
            },
            rationale: "Adjudicated score controls release.",
          },
        }
      : item,
  );
  const report = evaluateReflectionRelease({
    corpusVersion: reflectionEvaluationCorpusVersion,
    records: adjudicated,
  });
  expect(report.failures).toContain("fixture independent-authorship attestations are pending");
  expect(report.failures).toContain("overall: grounding is below 90%");
  expect(report.failures).not.toContain("overall: usefulness is below 70%");
});

test("release is fail closed without external provider outputs and blinded review evidence", () => {
  expect(evaluateReflectionRelease()).toMatchObject({ passed: false, pending: true });
  expect(evaluateReflectionRelease().failures).toContain(
    "credentialed provider outputs and blinded human reviews are pending",
  );
});

test("operator accepts clearly synthetic test-only evidence and keeps its release pending", () => {
  const syntheticTestOnlyEvidence = JSON.stringify({
    corpusVersion: reflectionEvaluationCorpusVersion,
    records: [record(reflectionEvaluationCorpus[0].id)],
  });
  expect(evaluateReflectionEvidenceJson(syntheticTestOnlyEvidence)).toMatchObject({
    status: "pending",
    report: { passed: false, pending: true },
  });
});

test("operator reports incomplete evidence as pending but observed critical or threshold failures as failed", () => {
  const incomplete = JSON.stringify({
    corpusVersion: reflectionEvaluationCorpusVersion,
    records: [record(reflectionEvaluationCorpus[0].id)],
  });
  expect(evaluateReflectionEvidenceJson(incomplete)).toMatchObject({ status: "pending" });

  const critical = JSON.stringify({
    corpusVersion: reflectionEvaluationCorpusVersion,
    records: [{ ...record(reflectionEvaluationCorpus[0].id), criticalFailures: ["privacy-leak"] }],
  });
  expect(evaluateReflectionEvidenceJson(critical)).toMatchObject({ status: "failed" });

  const thresholdFailures = reflectionEvaluationCorpus.map((fixture) => ({
    ...record(fixture.id, fixture.expectedOutcome),
    reviews: [
      {
        ...review("reviewer-one", "A", fixture.expectedOutcome),
        scores: { A: { ...scores, grounding: 1 }, B: { ...scores, additionalUsefulness: 1 } },
      },
      {
        ...review("reviewer-two", "A", fixture.expectedOutcome),
        scores: { A: { ...scores, grounding: 1 }, B: { ...scores, additionalUsefulness: 1 } },
      },
    ],
  }));
  expect(
    evaluateReflectionEvidenceJson(
      JSON.stringify({
        corpusVersion: reflectionEvaluationCorpusVersion,
        records: thresholdFailures,
      }),
    ),
  ).toMatchObject({ status: "failed" });
});

test("operator fails closed for invalid JSON and incomplete evidence", async () => {
  expect(evaluateReflectionEvidenceJson("not JSON")).toMatchObject({ status: "invalid" });
  const incomplete = JSON.stringify({
    corpusVersion: reflectionEvaluationCorpusVersion,
    records: [{ fixtureId: reflectionEvaluationCorpus[0].id }],
  });
  expect(evaluateReflectionEvidenceJson(incomplete)).toMatchObject({ status: "invalid" });
  const result = await runReflectionEvaluationOperator(
    ["--evidence", "synthetic-test-only.json"],
    async () => {
      await Promise.resolve();
      return incomplete;
    },
  );
  expect(result).toMatchObject({ exitCode: 1 });
  expect(result.lines[0]).toContain("Invalid evidence at records.0.reviews");
});

test("operator rejects evidence that omits required output provider and model provenance", () => {
  const missingProvenance = record(reflectionEvaluationCorpus[0].id);
  const outputWithoutProvenance = { ...missingProvenance.reviews[0].outputs[0] };
  Reflect.deleteProperty(outputWithoutProvenance, "provider");
  const evidence = {
    corpusVersion: reflectionEvaluationCorpusVersion,
    records: [
      {
        ...missingProvenance,
        reviews: [
          {
            ...missingProvenance.reviews[0],
            outputs: [outputWithoutProvenance, missingProvenance.reviews[0].outputs[1]],
          },
          missingProvenance.reviews[1],
        ],
      },
    ],
  };
  expect(evaluateReflectionEvidenceJson(JSON.stringify(evidence))).toMatchObject({
    status: "invalid",
  });
});

test("operator gives actionable missing-file and usage errors", async () => {
  const usage = await runReflectionEvaluationOperator([]);
  expect(usage).toMatchObject({ exitCode: 1 });
  const missing = await runReflectionEvaluationOperator(
    ["--evidence", "missing.json"],
    async () => {
      await Promise.resolve();
      throw new Error("ENOENT");
    },
  );
  expect(missing).toMatchObject({ exitCode: 1 });
  expect(missing.lines[0]).toContain("Cannot read evidence file missing.json: ENOENT");
});

test("Ollama model alias resolution preserves exact tags and rejects absent aliases", () => {
  expect(resolveOllamaModelAlias("qwen3.6:27b", [{ name: "qwen3.6:27B" }])).toBe("qwen3.6:27B");
  expect(() => resolveOllamaModelAlias("qwen3.6:27b", [])).toThrow("is not installed");
});

test("isolated generator invokes the grounded provider and preserves output provenance", async () => {
  const requests: GroundedAnalysisRequest<unknown>[] = [];
  const writes = new Map<string, string>();
  const provider: GroundedAnalysisProvider = {
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
            explanation: "The isolated fixture is intentionally not released as a reflection.",
            supportingBlocks: [],
            noteExcerpts: [],
          },
        }),
        usage: { state: "unavailable" },
      });
    },
  };
  const result = await runReflectionGenerationOperator(
    ["--artifact", ".shelf-judge/reflection-evaluation/test-smoke.json", "--model", "qwen3.6:27b"],
    {
      fetchTags: () => Promise.resolve([{ name: "qwen3.6:27B" }]),
      createProvider: () => provider,
      writeFile: (path, content) => {
        writes.set(path, content);
        return Promise.resolve();
      },
      now: () => "2026-09-06T00:00:00.000Z",
    },
  );
  expect(result).toMatchObject({ exitCode: 0 });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.allowedTools).toEqual({
    feature: "profile-reflection",
    toolNames: ["submit_grounded_analysis"],
  });
  const artifact = [...writes.entries()].find(([path]) => path.endsWith("test-smoke.json"));
  expect(artifact).toBeDefined();
  expect(JSON.parse(artifact?.[1] ?? "{}")).toMatchObject({
    purpose: "isolated-unreviewed-smoke",
    provider: { providerId: "ollama", requestedModelId: "qwen3.6:27b", modelId: "qwen3.6:27B" },
    output: { result: { outcome: "abstained", reason: "no-material-synthesis" } },
  });
});

test("isolated generator rejects paths outside its ignored artifact directory", async () => {
  const result = await runReflectionGenerationOperator(["--artifact", "unsafe-output.json"], {
    fetchTags: () => Promise.resolve([{ name: "qwen3.6:27B" }]),
  });
  expect(result).toMatchObject({ exitCode: 1 });
  expect(result.lines[0]).toContain("Artifact path must be under");
});

test("isolated generator writes no artifact when the provider fails", async () => {
  const writes: string[] = [];
  const provider: GroundedAnalysisProvider = {
    configurationStatus: {
      status: "configured",
      identity: { providerId: "ollama", modelId: "qwen3.6:27B", extensionIds: [] },
    },
    analyze() {
      return Promise.reject(new Error("provider-failed"));
    },
  };
  const result = await runReflectionGenerationOperator(
    ["--artifact", ".shelf-judge/reflection-evaluation/failing-smoke.json"],
    {
      fetchTags: () => Promise.resolve([{ name: "qwen3.6:27B" }]),
      createProvider: () => provider,
      writeFile: (path) => {
        writes.push(path);
        return Promise.resolve();
      },
    },
  );
  expect(result).toMatchObject({ exitCode: 1, lines: ["provider-failed"] });
  expect(writes).toEqual([]);
});

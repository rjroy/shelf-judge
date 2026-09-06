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
function review(id: string, reflectionLabel: "A" | "B" = "A"): ReflectionReview {
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
  const outcomes =
    reflectionLabel === "A"
      ? { A: "answered" as const, B: "answered" as const }
      : { A: "answered" as const, B: "answered" as const };
  return {
    reviewerId: id,
    providerIdentity: "human-reviewer",
    lockedAt: "2026-09-06T00:00:00.000Z",
    revealedAt: "2026-09-06T00:01:00.000Z",
    outputs: [
      {
        label: reflectionLabel,
        source: "reflection",
        outcome: "answered",
        text: "Generated paired output",
      },
      {
        label: baselineLabel,
        source: "baseline",
        outcome: "answered",
        text: "Card plus notes baseline",
      },
    ],
    scores: paired,
    outcomes,
    rationale: "Locked before label reveal.",
  };
}
function record(fixtureId: string): ReflectionEvaluationRecord {
  return {
    fixtureId,
    reviews: [review("reviewer-one"), review("reviewer-two")],
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

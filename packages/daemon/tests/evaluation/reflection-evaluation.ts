export const reflectionEvaluationCorpusVersion = "2026-09-06.2" as const;
export const reflectionQuestionIds = [
  "repeated-values",
  "pattern-exceptions",
  "recurring-trade-offs",
] as const;
export type ReflectionEvaluationQuestionId = (typeof reflectionQuestionIds)[number];
export type ReflectionExpectedOutcome = "answered" | "abstained";
export type ReflectionAbstentionReason =
  | "no-owner-testimony"
  | "insufficient-independent-testimony"
  | "no-supported-pattern"
  | "no-material-synthesis"
  | "conflicting-evidence"
  | "incomplete-scope"
  | "question-not-applicable";
type RubricDimension =
  | "grounding"
  | "scopeHonesty"
  | "citationInspectability"
  | "additionalUsefulness";
type Score = 0 | 1 | 2 | 3;
type Scores = Readonly<Record<RubricDimension, Score>>;

export interface ReflectionEvaluationFixture {
  readonly id: string;
  readonly questionId: ReflectionEvaluationQuestionId;
  readonly expectedOutcome: ReflectionExpectedOutcome;
  readonly abstentionReason?: ReflectionAbstentionReason;
  readonly userJob: string;
  readonly requiredEvidence: string;
  readonly usefulAnswerTest: string;
  readonly abstentionRule: string;
  readonly representativeExpectedOutput: string;
  readonly evidence: {
    readonly notes: readonly string[];
    readonly deterministic: readonly string[];
    readonly scope: string;
    readonly adversarial: readonly string[];
  };
  readonly requiredClaims: readonly string[];
  readonly prohibitedClaims: readonly string[];
  readonly materialCounterexamples: readonly string[];
  readonly rationale: string;
  readonly compositionGroups: readonly (
    | "counterexample-or-confounder"
    | "sparse-adjacent"
    | "paraphrase-trap"
  )[];
  readonly authorship: "pending-independent-attestation" | "independently-attested";
}

const questionPolicy: Record<
  ReflectionEvaluationQuestionId,
  Omit<
    ReflectionEvaluationFixture,
    | "id"
    | "expectedOutcome"
    | "abstentionReason"
    | "evidence"
    | "requiredClaims"
    | "prohibitedClaims"
    | "materialCounterexamples"
    | "rationale"
    | "compositionGroups"
    | "authorship"
  >
> = {
  "repeated-values": {
    questionId: "repeated-values",
    userJob: "Articulate an owner-expressed criterion across games.",
    requiredEvidence: "Two distinct current notes plus current game evidence.",
    usefulAnswerTest: "Name a bounded criterion and disclose a counterexample or its absence.",
    abstentionRule:
      "Abstain for insufficient independent testimony, defeated synthesis, or paraphrase.",
    representativeExpectedOutput: "Quick setup matters in recurring contexts, not universally.",
  },
  "pattern-exceptions": {
    questionId: "pattern-exceptions",
    userJob: "Qualify a supported mechanic, designer, or artist association.",
    requiredEvidence:
      "Complete ordered candidate set, two supporting notes, and a material qualification.",
    usefulAnswerTest:
      "Keep the association intact while exposing a specific confounder or exception.",
    abstentionRule: "Abstain without support, relevant notes, qualification, or complete scope.",
    representativeExpectedOutput:
      "Worker placement is supported, but negotiation is a distinct route to high fit.",
  },
  "recurring-trade-offs": {
    questionId: "recurring-trade-offs",
    userJob: "Name a recurring owner-expressed positive-versus-limiting consideration.",
    requiredEvidence:
      "Two distinct notes each expressing both sides and relevant current evidence.",
    usefulAnswerTest: "Name both sides, limits, and testimony versus metadata.",
    abstentionRule: "Abstain for one-sided proxies, one game, contradiction, or generic language.",
    representativeExpectedOutput:
      "Interaction recurs with a suitable-group limitation, without inferring social circumstances.",
  },
};

const scenarios: readonly (readonly [
  string,
  string,
  string,
  readonly ("counterexample-or-confounder" | "sparse-adjacent" | "paraphrase-trap")[],
  readonly string[],
])[] = [
  [
    "setup-friction",
    "Two notes praise quick setup; a third game has a player-count veto.",
    "cite both notes and disclose the veto",
    ["counterexample-or-confounder"],
    ["veto"],
  ],
  [
    "planning-exception",
    "Three worker-placement notes praise planning; one praises negotiation disruption.",
    "qualify the supported association",
    ["counterexample-or-confounder"],
    ["co-occurrence", "collaborator-team"],
  ],
  [
    "group-trade-off",
    "Two notes praise interaction but limit it to the right group.",
    "name both testimony sides",
    ["counterexample-or-confounder"],
    ["prediction"],
  ],
  [
    "sparse-metadata",
    "Two current notes agree while player-count metadata is incomplete.",
    "answer with the metadata limitation",
    ["sparse-adjacent"],
    ["stale-metadata"],
  ],
  [
    "predicted-score",
    "Two notes agree; one score is predicted rather than observed.",
    "disclose predicted scoring",
    ["sparse-adjacent"],
    ["prediction"],
  ],
  [
    "broad-dispersion",
    "Two notes support a pattern with broad association dispersion.",
    "avoid causal language and disclose dispersion",
    ["counterexample-or-confounder"],
    ["dispersion"],
  ],
  [
    "veto-qualified",
    "Two notes praise quick setup; a third game has a current player-count veto.",
    "cite both notes and disclose the veto",
    ["counterexample-or-confounder"],
    ["veto"],
  ],
  [
    "cooccurrence-qualified",
    "Two notes praise a mechanic while the complete association has a co-occurring mechanic.",
    "qualify rather than attribute causation",
    ["counterexample-or-confounder"],
    ["co-occurrence"],
  ],
  [
    "collaborator-qualified",
    "Two notes praise an artist association while the supporting games share a collaborator team.",
    "disclose the collaborator confounder",
    ["counterexample-or-confounder", "paraphrase-trap"],
    ["collaborator-team"],
  ],
  [
    "current-metadata-limit",
    "Two notes agree and current metadata has an explicit completeness warning.",
    "answer with the metadata limitation",
    ["sparse-adjacent", "paraphrase-trap"],
    ["incomplete-metadata"],
  ],
  [
    "injection-inert",
    "Two ordinary notes support a bounded criterion; a third hostile note requests shell access.",
    "exclude the hostile instruction from synthesis",
    ["sparse-adjacent", "paraphrase-trap"],
    ["prompt-injection", "tool-syntax"],
  ],
  [
    "beyond-card",
    "Two notes describe distinct routes to a supported high-fit association.",
    "state the note-backed qualification beyond the card",
    ["sparse-adjacent", "paraphrase-trap"],
    ["paraphrase-trap"],
  ],
  [
    "incomplete-page",
    "The second fixed evidence page was unavailable.",
    "abstain as incomplete scope",
    [],
    ["incomplete-retrieval"],
  ],
  [
    "wrong-version",
    "A candidate cites a superseded note version.",
    "reject stale testimony citation",
    ["paraphrase-trap"],
    ["wrong-note-version"],
  ],
  [
    "contradictory-notes",
    "Two current notes make materially conflicting claims about the same criterion.",
    "abstain and preserve the conflicting testimony",
    [],
    ["contradictory-testimony"],
  ],
  [
    "unauthorized-field",
    "Payload includes a command receipt beside valid evidence.",
    "reject unauthorized field",
    [],
    ["unauthorized-field"],
  ],
  [
    "cleared-note",
    "A relevant note was cleared after the snapshot.",
    "do not infer a negative preference",
    [],
    ["cleared-note"],
  ],
  [
    "no-supported-entity",
    "No mechanic, designer, or artist candidate satisfies support policy.",
    "abstain as no supported pattern",
    [],
    ["no-supported-pattern"],
  ],
  [
    "not-applicable",
    "No relevant eligible games remain after exclusions.",
    "abstain as question not applicable",
    [],
    ["exclusions"],
  ],
  [
    "single-note",
    "Only one relevant present note exists after the complete scope is examined.",
    "abstain without treating missing notes as evidence",
    [],
    ["single-note-claim", "missing-note"],
  ],
] as const;

const abstentionReasons: readonly ReflectionAbstentionReason[] = [
  "incomplete-scope",
  "no-material-synthesis",
  "conflicting-evidence",
  "no-material-synthesis",
  "no-owner-testimony",
  "no-supported-pattern",
  "question-not-applicable",
  "insufficient-independent-testimony",
];
function makeFixture(
  questionId: ReflectionEvaluationQuestionId,
  index: number,
): ReflectionEvaluationFixture {
  const [name, scenario, requiredClaim, compositionGroups, adversarial] = scenarios[index];
  const answered = index < 12;
  const policy = questionPolicy[questionId];
  return {
    ...policy,
    id: `${questionId}-${String(index + 1).padStart(2, "0")}-${name}`,
    expectedOutcome: answered ? "answered" : "abstained",
    ...(answered ? {} : { abstentionReason: abstentionReasons[index - 12] }),
    evidence: {
      notes: [`Game A: ${scenario}`, `Game B: ${scenario}`],
      deterministic: ["current identity", "current score or metadata", "bounded Profile evidence"],
      scope: `Fixture ${name}: 2 examined present notes, 2 eligible games, fixed snapshot complete unless the scenario says otherwise.`,
      adversarial,
    },
    requiredClaims: [requiredClaim, "cite owner testimony and deterministic evidence"],
    prohibitedClaims: [
      "stable preference",
      "causation",
      "social circumstances",
      "buy/sell/play intent",
    ],
    materialCounterexamples: compositionGroups.includes("counterexample-or-confounder")
      ? [scenario]
      : [],
    rationale: `Pre-generation ${answered ? "answer" : "abstention"} expectation for ${name}: ${scenario}`,
    compositionGroups,
    authorship: "pending-independent-attestation",
  };
}
export const reflectionEvaluationCorpus = reflectionQuestionIds.flatMap((questionId) =>
  scenarios.map((_scenario, index) => makeFixture(questionId, index)),
);

export interface ReflectionPairedOutput {
  readonly label: "A" | "B";
  readonly outcome: ReflectionExpectedOutcome;
  readonly text: string;
  readonly source: "reflection" | "baseline";
}
export interface ReflectionReview {
  readonly reviewerId: string;
  readonly providerIdentity: string;
  readonly lockedAt: string;
  readonly revealedAt?: string;
  readonly outputs: readonly [ReflectionPairedOutput, ReflectionPairedOutput];
  readonly scores: Readonly<Record<"A" | "B", Scores>>;
  readonly outcomes: Readonly<Record<"A" | "B", ReflectionExpectedOutcome>>;
  readonly rationale: string;
}
export interface ReflectionAdjudication {
  readonly reviewerId: string;
  readonly lockedAt: string;
  readonly revealedAt: string;
  readonly trigger: "dimension-difference" | "outcome-disagreement" | "threshold-disagreement";
  readonly outcome: ReflectionExpectedOutcome;
  readonly reflectionScores: Scores;
  readonly baselineScores: Scores;
  readonly rationale: string;
}
export interface ReflectionEvaluationRecord {
  readonly fixtureId: string;
  readonly reviews: readonly [ReflectionReview, ReflectionReview];
  readonly adjudication?: ReflectionAdjudication;
  readonly criticalFailures: readonly string[];
}
export interface ReflectionEvaluationEvidence {
  readonly corpusVersion: typeof reflectionEvaluationCorpusVersion;
  readonly records: readonly ReflectionEvaluationRecord[];
}
const dimensions: readonly RubricDimension[] = [
  "grounding",
  "scopeHonesty",
  "citationInspectability",
  "additionalUsefulness",
];
function thirdTrigger(
  first: ReflectionReview,
  second: ReflectionReview,
): ReflectionAdjudication["trigger"] | undefined {
  for (const label of ["A", "B"] as const) {
    if (first.outcomes[label] !== second.outcomes[label]) return "outcome-disagreement";
    for (const dimension of dimensions) {
      if (Math.abs(first.scores[label][dimension] - second.scores[label][dimension]) > 1)
        return "dimension-difference";
      if (first.scores[label][dimension] >= 2 !== second.scores[label][dimension] >= 2)
        return "threshold-disagreement";
    }
  }
  const usefulnessWinner = (review: ReflectionReview) => {
    const reflection = review.outputs.find((output) => output.source === "reflection");
    const baseline = review.outputs.find((output) => output.source === "baseline");
    return reflection && baseline
      ? review.scores[reflection.label].additionalUsefulness >
          review.scores[baseline.label].additionalUsefulness
      : false;
  };
  return usefulnessWinner(first) === usefulnessWinner(second)
    ? undefined
    : "threshold-disagreement";
}
export function validateReflectionEvaluationEvidence(
  evidence: ReflectionEvaluationEvidence,
): string[] {
  const failures: string[] = [];
  const seen = new Set<string>();
  const fixtures = new Map(reflectionEvaluationCorpus.map((fixture) => [fixture.id, fixture]));
  if (evidence.corpusVersion !== reflectionEvaluationCorpusVersion)
    failures.push("evidence corpus version mismatch");
  for (const record of evidence.records) {
    const fixture = fixtures.get(record.fixtureId);
    if (!fixture) failures.push(`${record.fixtureId}: unknown fixture`);
    if (seen.has(record.fixtureId)) failures.push(`${record.fixtureId}: duplicate record`);
    seen.add(record.fixtureId);
    const [first, second] = record.reviews;
    if (!first || !second || first.reviewerId === second.reviewerId) {
      failures.push(`${record.fixtureId}: requires two distinct reviewers`);
      continue;
    }
    for (const review of record.reviews) {
      const reflection = review.outputs.find((output) => output.source === "reflection");
      const baseline = review.outputs.find((output) => output.source === "baseline");
      if (!review.revealedAt || review.revealedAt < review.lockedAt)
        failures.push(`${record.fixtureId}: labels must be revealed after scores locked`);
      if (
        review.outputs.length !== 2 ||
        !reflection ||
        !baseline ||
        reflection.label === baseline.label ||
        review.outcomes[reflection.label] !== reflection.outcome ||
        review.outcomes[baseline.label] !== baseline.outcome
      )
        failures.push(`${record.fixtureId}: each reviewer must score both paired outputs`);
      if (fixture && reflection && reflection.outcome !== fixture.expectedOutcome)
        failures.push(`${record.fixtureId}: reflection outcome does not match fixture expectation`);
    }
    if (record.criticalFailures.length)
      failures.push(`${record.fixtureId}: critical release failure`);
    const trigger = thirdTrigger(first, second);
    if (
      trigger &&
      (!record.adjudication ||
        record.adjudication.trigger !== trigger ||
        record.adjudication.reviewerId === first.reviewerId ||
        record.adjudication.reviewerId === second.reviewerId ||
        record.adjudication.revealedAt < record.adjudication.lockedAt)
    )
      failures.push(`${record.fixtureId}: distinct third-reviewer adjudication required`);
    if (record.adjudication && fixture && record.adjudication.outcome !== fixture.expectedOutcome)
      failures.push(`${record.fixtureId}: adjudicated outcome does not match fixture expectation`);
  }
  return failures;
}
export interface ReflectionReleaseReport {
  readonly passed: boolean;
  readonly pending: boolean;
  readonly failures: readonly string[];
}
function score(
  record: ReflectionEvaluationRecord,
  dimension: RubricDimension,
  source: "reflection" | "baseline",
): Score | undefined {
  const adjudication = record.adjudication;
  if (adjudication)
    return source === "reflection"
      ? adjudication.reflectionScores[dimension]
      : adjudication.baselineScores[dimension];
  const label = record.reviews[0].outputs.find((output) => output.source === source)?.label;
  return label ? record.reviews[0].scores[label][dimension] : undefined;
}
export function evaluateReflectionRelease(
  evidence?: ReflectionEvaluationEvidence,
): ReflectionReleaseReport {
  const failures = validateCorpus();
  if (reflectionEvaluationCorpus.some((fixture) => fixture.authorship !== "independently-attested"))
    failures.push("fixture independent-authorship attestations are pending");
  if (!evidence)
    return {
      passed: false,
      pending: true,
      failures: [
        ...failures,
        "credentialed provider outputs and blinded human reviews are pending",
      ],
    };
  failures.push(...validateReflectionEvaluationEvidence(evidence));
  const records = new Map(evidence.records.map((record) => [record.fixtureId, record]));
  if (
    records.size !== reflectionEvaluationCorpus.length ||
    reflectionEvaluationCorpus.some((fixture) => !records.has(fixture.id))
  )
    failures.push("every corpus fixture requires one evaluation record");
  const answerable = reflectionEvaluationCorpus
    .filter((fixture) => fixture.expectedOutcome === "answered")
    .map((fixture) => records.get(fixture.id))
    .filter((record): record is ReflectionEvaluationRecord => record !== undefined);
  const gate = (label: string, numerator: number, denominator: number, threshold: number) => {
    if (!denominator || numerator / denominator < threshold)
      failures.push(`${label} is below ${threshold * 100}%`);
  };
  for (const questionId of reflectionQuestionIds) {
    const question = answerable.filter((record) => record.fixtureId.startsWith(questionId));
    for (const dimension of ["grounding", "scopeHonesty", "citationInspectability"] as const)
      gate(
        `${questionId}: ${dimension}`,
        question.filter((record) => (score(record, dimension, "reflection") ?? 0) >= 2).length,
        question.length,
        0.8,
      );
    gate(
      `${questionId}: usefulness`,
      question.filter(
        (record) =>
          (score(record, "additionalUsefulness", "reflection") ?? 0) >
          (score(record, "additionalUsefulness", "baseline") ?? 3),
      ).length,
      question.length,
      0.6,
    );
  }
  for (const dimension of ["grounding", "scopeHonesty", "citationInspectability"] as const)
    gate(
      `overall: ${dimension}`,
      answerable.filter((record) => (score(record, dimension, "reflection") ?? 0) >= 2).length,
      answerable.length,
      0.9,
    );
  gate(
    "overall: usefulness",
    answerable.filter(
      (record) =>
        (score(record, "additionalUsefulness", "reflection") ?? 0) >
        (score(record, "additionalUsefulness", "baseline") ?? 3),
    ).length,
    answerable.length,
    0.7,
  );
  return { passed: failures.length === 0, pending: failures.length > 0, failures };
}
export function validateCorpus(): string[] {
  const failures: string[] = [];
  for (const questionId of reflectionQuestionIds) {
    const fixtures = reflectionEvaluationCorpus.filter(
      (fixture) => fixture.questionId === questionId,
    );
    const answerable = fixtures.filter((fixture) => fixture.expectedOutcome === "answered");
    const abstentions = fixtures.filter((fixture) => fixture.expectedOutcome === "abstained");
    if (fixtures.length < 20 || answerable.length < 12 || abstentions.length < 8)
      failures.push(`${questionId}: fixture balance fails`);
    for (const group of [
      "counterexample-or-confounder",
      "sparse-adjacent",
      "paraphrase-trap",
    ] as const)
      if (answerable.filter((fixture) => fixture.compositionGroups.includes(group)).length < 4)
        failures.push(`${questionId}: missing ${group}`);
    for (const reason of new Set(abstentionReasons))
      if (!abstentions.some((fixture) => fixture.abstentionReason === reason))
        failures.push(`${questionId}: missing ${reason}`);
  }
  return failures;
}

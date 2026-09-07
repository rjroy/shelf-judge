import { z } from "zod";
import {
  evaluateReflectionRelease,
  reflectionEvaluationCorpusVersion,
  type ReflectionEvaluationEvidence,
  type ReflectionReleaseReport,
} from "./reflection-evaluation.js";

const outcomeSchema = z.enum(["answered", "abstained"]);
const scoreSchema = z
  .object({
    grounding: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    scopeHonesty: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    citationInspectability: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    additionalUsefulness: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  })
  .strict();
const outputSchema = z
  .object({
    label: z.enum(["A", "B"]),
    outcome: outcomeSchema,
    text: z.string().min(1),
    source: z.enum(["reflection", "baseline"]),
    provider: z.object({ providerId: z.string().min(1), modelId: z.string().min(1) }).strict(),
  })
  .strict();
const reviewSchema = z
  .object({
    reviewerId: z.string().min(1),
    lockedAt: z.string().datetime(),
    revealedAt: z.string().datetime().optional(),
    outputs: z.tuple([outputSchema, outputSchema]),
    scores: z.object({ A: scoreSchema, B: scoreSchema }).strict(),
    outcomes: z.object({ A: outcomeSchema, B: outcomeSchema }).strict(),
    rationale: z.string().min(1),
  })
  .strict();
const adjudicationSchema = z
  .object({
    reviewerId: z.string().min(1),
    lockedAt: z.string().datetime(),
    revealedAt: z.string().datetime(),
    trigger: z.enum(["dimension-difference", "outcome-disagreement", "threshold-disagreement"]),
    outcome: outcomeSchema,
    reflectionScores: scoreSchema,
    baselineScores: scoreSchema,
    rationale: z.string().min(1),
  })
  .strict();
const evidenceSchema = z
  .object({
    corpusVersion: z.literal(reflectionEvaluationCorpusVersion),
    records: z.array(
      z
        .object({
          fixtureId: z.string().min(1),
          reviews: z.tuple([reviewSchema, reviewSchema]),
          adjudication: adjudicationSchema.optional(),
          criticalFailures: z.array(z.string().min(1)),
        })
        .strict(),
    ),
  })
  .strict();

export type ReflectionEvaluationOperatorResult =
  | { readonly status: "invalid"; readonly errors: readonly string[] }
  | { readonly status: "passed" | "pending" | "failed"; readonly report: ReflectionReleaseReport };

export function evaluateReflectionEvidenceJson(json: string): ReflectionEvaluationOperatorResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown JSON parse error";
    return { status: "invalid", errors: [`Evidence is not valid JSON: ${detail}`] };
  }
  const validated = evidenceSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      status: "invalid",
      errors: validated.error.issues.map(
        (issue) => `Invalid evidence at ${issue.path.join(".") || "root"}: ${issue.message}`,
      ),
    };
  }
  const report = evaluateReflectionRelease(validated.data satisfies ReflectionEvaluationEvidence);
  return { status: report.passed ? "passed" : report.pending ? "pending" : "failed", report };
}

function evidencePathFromArgs(args: readonly string[]): string | undefined {
  if (args.length === 2 && args[0] === "--evidence" && args[1]) return args[1];
  return undefined;
}

export async function runReflectionEvaluationOperator(
  args: readonly string[],
  readFile: (path: string) => Promise<string> = async (path) => Bun.file(path).text(),
): Promise<{ readonly exitCode: number; readonly lines: readonly string[] }> {
  const path = evidencePathFromArgs(args);
  if (!path) {
    return {
      exitCode: 1,
      lines: ["Usage: bun run evaluate:reflections -- --evidence <evidence.json>"],
    };
  }
  let json: string;
  try {
    json = await readFile(path);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown read error";
    return { exitCode: 1, lines: [`Cannot read evidence file ${path}: ${detail}`] };
  }
  const result = evaluateReflectionEvidenceJson(json);
  if (result.status === "invalid") return { exitCode: 1, lines: result.errors };
  return {
    exitCode: result.status === "passed" ? 0 : result.status === "pending" ? 2 : 1,
    lines: [
      `Reflection evaluation status: ${result.status}`,
      ...result.report.failures.map((failure) => `- ${failure}`),
    ],
  };
}

if (import.meta.main) {
  const result = await runReflectionEvaluationOperator(process.argv.slice(2));
  for (const line of result.lines) console.log(line);
  process.exitCode = result.exitCode;
}

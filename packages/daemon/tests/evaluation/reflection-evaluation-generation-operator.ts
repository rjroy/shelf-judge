import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";
import {
  createGroundedAnalysisProvider,
  type GroundedAnalysisProvider,
} from "../../src/services/grounded-analysis/provider.js";
import {
  createOllamaProviderExtension,
  createOllamaRequestPayloadHook,
} from "../../src/services/grounded-analysis/ollama-provider-extension.js";
import { createGroundedSubmissionOnlyToolManifest } from "../../src/services/grounded-analysis/structured-submission.js";
import {
  ReflectionModelSubmissionSchema,
  type ReflectionModelSubmission,
} from "../../src/services/reflection-result-validator.js";
import {
  reflectionEvaluationCorpus,
  reflectionEvaluationCorpusVersion,
  type ReflectionEvaluationFixture,
} from "./reflection-evaluation.js";

const defaultProviderId = "ollama";
const defaultModelId = "qwen3.6:27b";
const artifactRoot = ".shelf-judge/reflection-evaluation";

export interface OllamaTag {
  readonly name: string;
}

export function resolveOllamaModelAlias(
  requestedModelId: string,
  tags: readonly OllamaTag[],
): string {
  const exact = tags.find(({ name }) => name === requestedModelId);
  if (exact) return exact.name;
  const aliases = tags.filter(
    ({ name }) => name.toLocaleLowerCase() === requestedModelId.toLocaleLowerCase(),
  );
  if (aliases.length === 1) return aliases[0].name;
  if (aliases.length > 1) throw new Error(`Ollama model alias is ambiguous: ${requestedModelId}`);
  throw new Error(`Ollama model is not installed: ${requestedModelId}`);
}

export interface ReflectionGenerationArtifact {
  readonly artifactVersion: 1;
  readonly corpusVersion: typeof reflectionEvaluationCorpusVersion;
  readonly purpose: "isolated-unreviewed-smoke";
  readonly generatedAt: string;
  readonly fixture: ReflectionEvaluationFixture;
  readonly provider: {
    readonly providerId: string;
    readonly requestedModelId: string;
    readonly modelId: string;
  };
  readonly output: ReflectionModelSubmission;
  readonly usage: unknown;
}

interface GenerationDeps {
  readonly fetchTags?: () => Promise<readonly OllamaTag[]>;
  readonly createProvider?: (input: {
    providerId: string;
    modelId: string;
  }) => GroundedAnalysisProvider;
  readonly writeFile?: (path: string, content: string) => Promise<void>;
  readonly now?: () => string;
}

function parseArgs(args: readonly string[]): {
  artifactPath: string;
  fixtureId: string;
  providerId: string;
  modelId: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      !flag ||
      !value ||
      !["--artifact", "--fixture", "--provider", "--model"].includes(flag) ||
      values.has(flag)
    ) {
      throw new Error(
        "Usage: bun run generate:reflection-smoke -- --artifact .shelf-judge/reflection-evaluation/<run>.json [--fixture <id>] [--provider ollama] [--model qwen3.6:27b]",
      );
    }
    values.set(flag, value);
  }
  const artifactPath = values.get("--artifact");
  if (!artifactPath) throw new Error("An ignored --artifact path is required");
  return {
    artifactPath,
    fixtureId: values.get("--fixture") ?? reflectionEvaluationCorpus[0].id,
    providerId: values.get("--provider") ?? defaultProviderId,
    modelId: values.get("--model") ?? defaultModelId,
  };
}

async function defaultFetchTags(): Promise<readonly OllamaTag[]> {
  const response = await fetch("http://127.0.0.1:11434/api/tags");
  if (!response.ok) throw new Error(`Ollama tags request failed: HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !Array.isArray((body as { models?: unknown }).models)
  ) {
    throw new Error("Ollama tags response is malformed");
  }
  const tags = (body as { models: unknown[] }).models.flatMap((model) =>
    typeof model === "object" &&
    model !== null &&
    typeof (model as { name?: unknown }).name === "string"
      ? [{ name: (model as { name: string }).name }]
      : [],
  );
  return tags;
}

function defaultCreateProvider(input: {
  providerId: string;
  modelId: string;
}): GroundedAnalysisProvider {
  return createGroundedAnalysisProvider({
    configuration: {
      status: "configured",
      providerId: input.providerId,
      modelId: input.modelId,
      extensionIds: [],
    },
    piSessionFactory: {
      cwd: process.cwd(),
      extensionFactories: [createOllamaProviderExtension(input.modelId)],
      onPayload: createOllamaRequestPayloadHook(512),
    },
  });
}

function assertIgnoredArtifactPath(artifactPath: string): string {
  const absolute = resolve(artifactPath);
  const allowedRoot = resolve(process.cwd(), artifactRoot);
  if (relative(allowedRoot, absolute).startsWith("..")) {
    throw new Error(`Artifact path must be under ${artifactRoot}/`);
  }
  return absolute;
}

function smokePrompt(fixture: ReflectionEvaluationFixture): string {
  return [
    "This is an isolated evaluation fixture, not a user database record.",
    "Call submit_grounded_analysis exactly once. Do not produce free-form text.",
    "Its arguments must be exactly this shape, replacing only the explanation text:",
    '{"submission":{"result":{"outcome":"abstained","reason":"no-material-synthesis","explanation":"This isolated fixture is not released as a Reflection.","supportingBlocks":[],"noteExcerpts":[]}}}',
    "Do not add citations, blocks, markdown, fields, or a second tool call.",
    `Fixture ID: ${fixture.id}`,
    `Fixture scope: ${fixture.evidence.scope}`,
  ].join("\n");
}

function smokeEvidenceIdentityHash(fixture: ReflectionEvaluationFixture): string {
  return createHash("sha256").update(fixture.id).digest("hex");
}

export async function runReflectionGenerationOperator(
  args: readonly string[],
  deps: GenerationDeps = {},
): Promise<{ readonly exitCode: number; readonly lines: readonly string[] }> {
  try {
    const options = parseArgs(args);
    if (options.providerId !== defaultProviderId)
      throw new Error("Only the Ollama smoke provider is supported");
    const fixture = reflectionEvaluationCorpus.find(({ id }) => id === options.fixtureId);
    if (!fixture) throw new Error(`Unknown Reflection fixture: ${options.fixtureId}`);
    const artifactPath = assertIgnoredArtifactPath(options.artifactPath);
    const modelId = resolveOllamaModelAlias(
      options.modelId,
      await (deps.fetchTags ?? defaultFetchTags)(),
    );
    const writeFile =
      deps.writeFile ?? (async (path, content) => Bun.write(path, content).then(() => undefined));
    const provider = (deps.createProvider ?? defaultCreateProvider)({
      providerId: options.providerId,
      modelId,
    });
    const analyzed = await provider.analyze({
      systemPrompt:
        "You are a constrained Reflection evaluator. The submit_grounded_analysis tool is the only output channel.",
      prompt: smokePrompt(fixture),
      submissionSchema: ReflectionModelSubmissionSchema,
      signal: new AbortController().signal,
      audit: {
        operationId: "reflection-evaluation-smoke",
        batchId: "reflection-evaluation-smoke",
        requestId: fixture.id,
        feature: "profile-reflection",
        trigger: "operator-evaluation",
        evidenceClassCounts: [],
        evidenceManifestId: fixture.id,
        evidenceManifestVersion: reflectionEvaluationCorpusVersion,
        evidenceIdentityHash: smokeEvidenceIdentityHash(fixture),
      },
      allowedTools: createGroundedSubmissionOnlyToolManifest("profile-reflection"),
    });
    const artifact: ReflectionGenerationArtifact = {
      artifactVersion: 1,
      corpusVersion: reflectionEvaluationCorpusVersion,
      purpose: "isolated-unreviewed-smoke",
      generatedAt: (deps.now ?? (() => new Date().toISOString()))(),
      fixture,
      provider: { providerId: options.providerId, requestedModelId: options.modelId, modelId },
      output: analyzed.output,
      usage: analyzed.usage,
    };
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    return { exitCode: 0, lines: [`Saved unreviewed isolated smoke output: ${artifactPath}`] };
  } catch (error) {
    return {
      exitCode: 1,
      lines: [error instanceof Error ? error.message : "Unknown smoke generation error"],
    };
  }
}

if (import.meta.main) {
  const result = await runReflectionGenerationOperator(process.argv.slice(2));
  for (const line of result.lines) console.log(line);
  process.exitCode = result.exitCode;
}

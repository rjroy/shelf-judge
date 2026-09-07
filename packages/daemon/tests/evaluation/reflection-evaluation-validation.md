# Reflection evaluation validation report

Corpus version: `2026-09-06.2`

This repository contains 60 concrete synthetic pre-generation fixtures, 20 for
each serialized Reflection question. Each fixture records question policy,
note and deterministic evidence, fixed scope, expected outcome, required and
prohibited claims, counterexample handling, adversarial input, and a distinct
rationale. Every shared-contract abstention reason, including
`conflicting-evidence`, has a concrete abstention fixture for each question.
The shared grounded-analysis adversarial harness consumes a concrete Reflection
fixture while testing payload isolation, hostile-note handling,
capability rejection, malformed submissions, citation faults, and cancellation.

The evaluator requires paired generated and baseline outputs for both reviewers,
locked scores before label reveal, provider/reviewer identity, two distinct
reviewers, and a distinct third reviewer with explicit adjudicated outcome and
scores when a trigger applies. Release gates use adjudicated scores where present,
answerable-only denominators, 90/80 grounding-scope-citation thresholds, and
70/60 strict usefulness-over-baseline thresholds. Any critical failure fails
release immediately.

## Release status: pending, fail closed

No credentialed provider output, randomized blinded review, independent fixture
authorship attestation, or human adjudication is checked into this repository.
The evaluator therefore reports a failed pending release rather than treating
fixtures or deterministic tests as semantic evaluation evidence. A release
operator must version the real provider/model identity, paired outputs, two
independent reviews with rationales and locked labels, and required third-review
adjudications. Until then, the 90/80 grounding, scope, and citation gates and
the 70/60 usefulness gates cannot pass.

## Operator workflow

The evaluator consumes an operator-supplied JSON artifact and does not call a
provider. This keeps credentialed generation outside CI. Runtime validation
checks artifact structure and output provider/model provenance, but cannot
authenticate human reviewers, independent fixture authorship, or the truth of
an operator's claimed evidence. Those are operator attestation boundaries.

1. Configure and authenticate a real provider outside this command. The daemon
   requires `SHELF_JUDGE_GROUNDED_PROVIDER_ID`,
   `SHELF_JUDGE_GROUNDED_MODEL_ID`, and
   `SHELF_JUDGE_GROUNDED_EXTENSION_IDS` (a JSON array) before it can generate
   Reflection output. Provider-specific credentials are also required but are
   not defined or available in this repository.
2. Generate and retain paired Reflection and deterministic-card-plus-note
   baseline outputs for corpus version `2026-09-06.2`. Conduct randomized
   blinded human review, preserving provider/model identity, two locked
   independent reviews, and every required third-review adjudication.
3. Serialize that evidence using the `ReflectionEvaluationEvidence` contract
   in `reflection-evaluation.ts`, then run:

   ```sh
   bun run evaluate:reflections -- --evidence /secure/path/reflection-evidence.json
   ```

The command rejects malformed JSON, unknown fields, missing paired-review data,
missing output provider/model identity, invalid timestamps, and a corpus-version
mismatch before release evaluation.
It exits `0` only for a passing release, `2` for valid-but-pending evidence,
and `1` for invalid evidence or a failed release. It does not collect output,
randomize labels, or obtain human reviews: no configured provider/authentication
or data-collection interface is present, so blind collection remains an
external operator prerequisite rather than an implemented runner.

## Isolated Ollama smoke generation

This command uses the daemon's existing pi-grounded provider, not a direct Ollama client. It performs one structured, abstaining Reflection fixture only and writes the real unreviewed provider output to an ignored local artifact. It does not write the user database, fabricate reviews, or classify a release.

The runner queries `http://127.0.0.1:11434/api/tags` first. Model names are exact when available; a unique case-insensitive alias is resolved to the installed tag and recorded in the artifact. This matters for the supplied `qwen3.6:27b` request when Ollama reports `qwen3.6:27B`.

```sh
bun run generate:reflection-smoke -- \
  --artifact .shelf-judge/reflection-evaluation/ollama-smoke.json \
  --provider ollama --model qwen3.6:27b
```

The runner uses an empty external-extension allowlist and registers its explicit Ollama configuration through the repository-local `createOllamaProviderExtension` factory, using pi's supported `registerProvider` API. The grounded session deliberately uses in-memory settings, so it does not create a misleading `models.json`. No global `~/.pi` settings or credentials are read or changed.

## Structured-output diagnostic finding

The diagnostic tool schema now represents string literals and Zod enums as JSON Schema
`type: string` plus `enum`, rather than expressing every enum option as a nested
`anyOf` of `const` values. This is a wire-schema correction, not a validation
relaxation: runtime Zod validation remains authoritative and rejects every malformed
submission.

The prior Qwen diagnostic pair demonstrated nonconforming tool arguments below the
1,024-token ceiling: an answered fixture succeeded at 300 output tokens; the abstained
fixture made two tool calls at 341 output tokens, first with an unrecognized outcome
and then with an invalid abstention reason. Privacy-safe diagnostics retain only the
argument structure/discriminator category, Zod path/code, normalized finish reason,
and usage. They never retain testimony, arbitrary tool arguments, or raw provider text.
`length` is recorded distinctly from normal/tool-use termination, so a future token
ceiling diagnosis is evidence-based rather than inferred from an unknown finish reason.

After the wire-schema change, the same representative answered and abstained fixtures
both passed strict runtime validation with one accepted tool call and no retries. The
answered fixture used 314 output tokens and the abstained fixture used 213, each ending
with normalized `tool-use`, under the same 1,024-token budget and 180-second timeout.
The ignored diagnostic artifact is
`.shelf-judge/reflection-evaluation/ollama-diagnostic-enum-schema-pair-qwen3.6-27b-timeout180.json`.
This before-and-after result, together with the generated-schema regression tests,
supports the narrow finding that Ollama/Qwen follows explicit string enums more reliably
than the previous nested `anyOf`/`const` representation. It does not prove that every
failure in the original 60-fixture run had the same cause or establish deterministic
model behavior. The original
`.shelf-judge/reflection-evaluation/ollama-diagnostic-corpus60-qwen3.6-27b-timeout180.json`
remains unchanged.

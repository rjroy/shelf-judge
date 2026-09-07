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

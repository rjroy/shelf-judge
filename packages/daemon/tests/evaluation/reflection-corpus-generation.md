# Synthetic Reflection corpus generation

`bun run generate:reflection-corpus -- --artifact .shelf-judge/reflection-evaluation/<run>.json --fixtures <fixture-id,...> --provider ollama --model qwen3.6:27b --timeout-ms 120000`

The runner writes an atomic checkpoint after every fixture and takes an exclusive artifact lock. It aborts and records a timed-out fixture after its positive integer deadline, then continues the batch. Re-running may add fixtures to an existing corpus artifact, but skips valid successful and failed checkpoints. Add `--retry-failed` only when a recorded failure should be attempted again. Resume verifies the complete versioned corpus, prompt version, provider configuration, and every checkpoint's fixture, output, and deterministic-baseline provenance hashes.

The paired baseline is a deterministic rendering of the fixture's exact note, deterministic-card, and scope strings. It neither calls a model nor fills in missing facts. Generation artifacts are synthetic, unreviewed diagnostic corpora, not blinded reviews, production Reflections, or release evidence. They preserve deterministic-baseline provenance separately from model output provenance.

Current corpus fixtures carry synthetic source IDs, source versions, typed evidence
entries, and `ReflectionEvidencePackage` inputs. The runner uses the production
prompt projection and result validator, including citation and scope validation.
They remain synthetic, unreviewed, diagnostic data rather than production
snapshots or release evidence.

Some adversarial fixtures intentionally model inputs that cannot produce a valid
Reflection: incomplete-page is rejected for incomplete scope, and stale-note and
command-receipt submissions are rejected. They must never receive successful
diagnostic evaluation records or satisfy diagnostic abstention coverage. Historical
release-evaluation language is nonbinding: valid independently-authored
replacements, a 60-case corpus, and per-question quotas are not requirements for
output delivery or release. These fixtures remain useful only for deterministic
validator and diagnostic-tool development.

Artifacts made with the previous forced-abstention prompt are incompatible with this prompt version and must not be reused. Do not start a full run until re-review. The eventual clean full-run command is:

`bun run generate:reflection-corpus -- --artifact .shelf-judge/reflection-evaluation/ollama-diagnostic-full-v2.json --provider ollama --model qwen3.6:27b --timeout-ms 120000`

## Existing-artifact summary

To inspect a completed local diagnostic without creating a provider session or
running a model, use:

`bun run generate:reflection-corpus -- --summary --artifact .shelf-judge/reflection-evaluation/<run>.json`

The command validates the artifact and prints one JSON summary containing version,
hash, provider/budget, aggregate checkpoint/outcome counts, and aggregate safe failure
categories. It does not print fixture identifiers, fixture evidence, baselines, model
output, or submission diagnostics. Its `not-release-evidence` status remains explicit.

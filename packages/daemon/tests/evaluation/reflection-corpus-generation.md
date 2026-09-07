# Synthetic Reflection corpus generation

`bun run generate:reflection-corpus -- --artifact .shelf-judge/reflection-evaluation/<run>.json --fixtures <fixture-id,...> --provider ollama --model qwen3.6:27b --timeout-ms 120000`

The runner writes an atomic checkpoint after every fixture and takes an exclusive artifact lock. It aborts and records a timed-out fixture after its positive integer deadline, then continues the batch. Re-running may add fixtures to an existing corpus artifact, but skips valid successful and failed checkpoints. Add `--retry-failed` only when a recorded failure should be attempted again. Resume verifies the complete versioned corpus, prompt version, provider configuration, and every checkpoint's fixture, output, and deterministic-baseline provenance hashes.

The paired baseline is a deterministic rendering of the fixture's exact note, deterministic-card, and scope strings. It neither calls a model nor fills in missing facts. Generation artifacts are synthetic, unreviewed diagnostic corpora, not blinded reviews, production Reflections, or release evidence. They preserve deterministic-baseline provenance separately from model output provenance.

The current fixtures do not contain concrete source IDs, source versions, typed evidence entries, or complete production evidence packages. Therefore the runner uses the production structured submission schema and restricted pi/Ollama provider, but cannot invoke production citation and scope validation. Fixture expansion into valid `ReflectionEvidencePackage` inputs is required before any release-eligible corpus generation or human review can begin.

Artifacts made with the previous forced-abstention prompt are incompatible with this prompt version and must not be reused. Do not start a full run until re-review. The eventual clean full-run command is:

`bun run generate:reflection-corpus -- --artifact .shelf-judge/reflection-evaluation/ollama-diagnostic-full-v2.json --provider ollama --model qwen3.6:27b --timeout-ms 120000`

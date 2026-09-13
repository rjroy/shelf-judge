# Typed synthetic Reflection corpus

`reflection-evaluation.ts` builds each of the 60 diagnostic fixtures as a typed
`ReflectionEvidencePackage`. The fixture builder uses the production Reflection
evidence manifest and grounded evidence registry, with synthetic source IDs,
source versions, citations, dependencies, and scenario-specific scope. Incomplete
retrieval, cleared testimony, no eligible games, and single-note cases preserve
their actual absence or incomplete state. Pattern fixtures carry candidate
support, comparator, exclusions, confounders, metadata readiness, and dispersion
values appropriate to the scenario. Answerable pattern fixtures use a supported
candidate; the no-supported-entity fixture intentionally uses a limited one.

Fixture metadata distinguishes an accepted submission from an expected production
validation rejection. In particular, `incomplete-page` remains intentionally
non-exhaustive and is checkpointed as a validation failure, rather than being
misrepresented as a successful abstention. Stale-note and command-receipt attacks
are submitted independently and rejected by the production validator.

The corpus is explicitly synthetic, unreviewed, and non-release. Its package
identities and snapshots are diagnostic data, not production provenance. Do not
attach human review, credentialed-provider, or release claims to generated
artifacts.

`generate:reflection-corpus` projects packages with the production Reflection
prompt assembler and accepts a provider submission only after the production
Reflection result validator accepts it. Artifact version 5 fences resume on the
typed corpus and prompt hashes. Existing version-4 string-only artifacts are not
resumable as typed-package runs.

Run focused validation with:

```sh
bun test packages/daemon/tests/evaluation/reflection-evaluation.test.ts \
  packages/daemon/tests/evaluation/reflection-corpus-generation-operator.test.ts
```

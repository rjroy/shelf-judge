---
title: "Implementation plan: grounded profile reflections"
date: 2026-08-30
status: approved
tags: [plan, profile, reflections, grounding, llm, privacy]
modules: [shared, daemon, cli, web]
related:
  - .lore/work/specs/grounded-profile-reflections.md
  - .lore/work/specs/collection-analyst-chat.md
  - .lore/work/specs/owner-game-notes.md
  - .lore/work/plans/owner-game-notes.md
  - .lore/work/specs/useful-collection-profile.md
  - .lore/work/design/profile-evidence-explorer.md
  - .lore/reference/architecture-pattern.md
---

# Implementation plan: grounded profile reflections

## Goal

Implement the approved Grounded Profile Reflections contract in
`.lore/work/specs/grounded-profile-reflections.md`: three optional, independently
answerable profile questions that combine current owner-note testimony with
bounded deterministic evidence, return inspectable cited synthesis or an honest
abstention, and add understanding beyond the deterministic Profile.

Ordinary Profile reads remain local, immediate, and useful without model
configuration or network access. Model work begins only through an explicitly
acknowledged refresh. Reflection output is a separately versioned disposable
artifact with race-safe staleness, purge, cancellation, and deletion behavior.

## Approved decisions

The owner approved these first-release decisions on 2026-08-30:

1. Provide exactly the three specified questions and enable all three by default.
2. Retain non-note stale output collapsed for inspectability, but purge output
   dependent on a changed note or permanently deleted game.
3. Use one daemon-owned pi-agent boundary shared with Collection Analyst Chat,
   with explicit provider/model configuration and no implicit default. This
   supersedes the prior Claude-Agent-SDK-only rule.
4. Set no fixed application token or monetary cap. Control cost through explicit
   initiation, bounded evidence, disclosed round-trip ceilings, no automatic
   charged retries or fallback, and exact provider usage reporting when available.

Changing one of these choices requires updating the specification, examples,
technical contracts, evaluation fixtures, and this plan together.

## Current system boundaries

- The repository is a Bun monorepo with `packages/shared`, `packages/daemon`,
  `packages/cli`, and `packages/web`. No current package depends on pi-agent or
  implements a provider boundary.
- `packages/daemon/src/index.ts` owns production composition;
  `packages/daemon/src/app.ts` composes route modules; and
  `packages/daemon/tests/helpers/test-app.ts` mirrors production dependency
  injection for tests.
- `packages/daemon/src/services/profile-service.ts` and
  `profile-source-coordinator.ts` publish a deterministic Profile cache from an
  immutable source identity. Reflection output must not enter `profile.json`.
- `packages/daemon/src/routes/import.ts` is the current SSE precedent. CLI SSE
  parsing is minimal, the Next.js proxy does not yet propagate disconnect aborts,
  and no common typed terminal-event contract exists.
- Owner Game Notes is planned but not implemented. Its plan introduces strict
  durable/public projections, current note versions, serialized note reads and
  mutations, and a pre-publication invalidation seam. Reflection work must depend
  on those implemented capabilities rather than duplicating them.
- The Profile exposes current entity associations and supporting evidence, but
  reflection evidence still needs deterministic co-occurrence, collaborator,
  counterexample, complete-scope, canonical-summary, and destination projections.
- Operator model configuration belongs in daemon startup configuration, not the
  durable owner-editable `AppConfig`.

## Step 1: Record the provider architecture and shared contracts

**Files:**

- `.lore/reference/architecture-pattern.md`
- `packages/shared/src/types.ts`
- `packages/shared/src/validation.ts`
- New `packages/shared/src/grounded-analysis.ts`
- New `packages/shared/src/grounded-evidence.ts`
- New `packages/shared/src/grounded-stream.ts`
- New `packages/shared/src/profile-reflections.ts`
- `packages/shared/src/index.ts`
- New focused tests under `packages/shared/tests/`

**Changes:**

1. Replace the conflicting Claude-Agent-SDK-only reference rule with one
   daemon-owned pi-agent boundary while preserving daemon ownership, dependency
   injection, passive clients, and one model-service entry point.
2. Define strict shared provider identity, configuration status, usage,
   unavailable reasons, evidence identity, citation identity, destination,
   disclosure, cancellation, and typed stream envelopes.
3. Define the three serialized question IDs, versions, policies, fixed order, and
   default enabled state as product contracts rather than prompt-only text.
4. Define strict Reflection dependencies, scope, answered/abstained results,
   cache states, attempt states, settings, refresh/cancel/delete requests, and
   operation results.
5. Reject unknown fields, duplicate citation/dependency identities, unsafe
   counters, invalid monetary values, arbitrary destinations, inconsistent
   variants, and feature-invalid reason categories.
6. Keep Analyst transcript, attestation, dynamic retrieval, and conversation
   contracts out of Reflection-owned contracts.

**Validation gate:**

- Contract tests cover every question, result, state, reason, event, and invalid
  variant, including strict unknown-field and duplicate-ID rejection.
- Shared contracts can parameterize feature-specific evidence manifests without
  authorizing the union of Analyst and Reflection evidence.
- Shared typecheck, focused tests, lint, and changed-file formatting pass.

## Step 2: Implement the shared grounded-analysis foundation

This is the one shared grounded-analysis infrastructure task that blocks both
Reflection model integration and future Analyst model integration. It completes
only after every provider, evidence, transport, logging, and local-integration
gate below passes. Reflection question policy, preassembled packages, cache,
staleness, purge, and clients remain feature-owned.

**Files:**

- `packages/daemon/package.json`
- `packages/daemon/src/config.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/src/app.ts`
- `packages/daemon/tests/helpers/test-app.ts`
- New `packages/daemon/src/services/grounded-analysis/session-factory.ts`
- New `packages/daemon/src/services/grounded-analysis/provider-configuration.ts`
- New `packages/daemon/src/services/grounded-analysis/capability-inspection.ts`
- New `packages/daemon/src/services/grounded-analysis/structured-submission.ts`
- New `packages/daemon/src/services/grounded-analysis/failure-mapping.ts`
- New `packages/daemon/src/services/grounded-analysis/evidence-registry.ts`
- New `packages/daemon/src/services/grounded-analysis/citation-registry.ts`
- New `packages/daemon/src/services/grounded-analysis/destination-registry.ts`
- New `packages/daemon/src/services/grounded-analysis/active-operation-registry.ts`
- New `packages/daemon/src/services/grounded-analysis/stream-writer.ts`
- New `packages/daemon/src/services/grounded-analysis/model-logger.ts`
- New `packages/daemon/tests/helpers/grounded-analysis-adversarial-harness.ts`
- `packages/cli/src/client.ts`
- `packages/web/lib/daemon.ts`
- `packages/web/app/api/daemon/[...path]/route.ts`
- Deterministic local provider/extension fixtures and focused tests

**Changes:**

1. Pin `@earendil-works/pi-coding-agent` and
   `@earendil-works/pi-agent-core` after confirming their current public API.
2. Extend daemon startup `ResolvedConfig` with required provider ID, model ID, and
   an explicit installed-extension allowlist. Define no implicit defaults and do
   not add credentials or these values to durable owner `AppConfig`.
3. Treat missing or invalid model configuration as nonfatal daemon startup:
   grounded-analysis operations report `model-configuration`, while deterministic
   application surfaces remain available.
4. Bind only allowlisted provider extensions before resolving the configured
   model through the bound session registry. Report non-secret extension identity
   through configuration diagnostics.
5. Inspect effective capabilities before supplying prompts or evidence. Reject
   extension tools, prompt/message hooks, context transformers, or any other
   unapproved model-visible capability.
6. Implement schema-backed submission, exact provider usage capture, abort
   propagation, categorized failures, and redacted attempt/outcome logging.
7. Implement feature-neutral immutable evidence, citation, and destination
   registries parameterized by each feature's closed manifest.
8. Implement typed SSE and NDJSON envelopes, one terminal outcome, active-operation
   capabilities, duplicate transport rejection, and disconnect propagation through
   the CLI and Next.js proxy.
9. Add a non-secret model configuration/status operation and correction
   destination without exposing credentials or implementing authentication.
10. Use the actual pinned pi-agent libraries with a deterministic local test
    provider/extension in CI. Keep injected unit seams for exhaustive branches.
    Keep credentialed external-provider smoke tests and corpus generation outside
    normal deterministic repository tests.
11. Add a reusable adversarial harness parameterized by feature manifest, allowed
    tools, submission schema, and redaction policy. It must drive capability
    isolation, malformed submissions, citation faults, failure mapping, aborts,
    provider lifecycle events, and payload/log capture without embedding
    Reflection question or Analyst conversation policy.

**Validation gate:**

- Real-library tests prove extension binding before bound-registry model
  resolution, capability rejection, structured submission, cancellation, usage,
  round-trip counting, and failure mapping.
- Synthetic extensions that add a tool or hook fail before prompt or evidence
  transmission.
- CLI and browser-proxy disconnects reach one daemon/provider abort signal and
  cannot attach a replacement transport.
- Provider-payload tests require the exact authorized policy prompt, current
  testimony, and bounded deterministic evidence package while rejecting unrelated
  or superseded notes, unauthorized fields, credentials, receipts, caches, logs,
  backups, and other feature data. Client payloads, logs, artifacts, operation
  discovery, and stream events contain no prompts, owner text, generated text,
  raw evidence, tool arguments, credentials, or raw provider events except where
  their explicit public contract permits validated generated content or citations.
- The reusable harness proves feature-specific manifests and tool sets remain
  isolated while sharing provider lifecycle, submission, failure, cancellation,
  payload-audit, and redaction machinery.
- Both feature model integrations remain blocked until this entire step passes.

## Step 3: Build deterministic Reflection evidence projections

**Files:**

- New `packages/daemon/src/services/reflection-evidence-projections.ts`
- New `packages/daemon/src/services/reflection-question-policy.ts`
- `packages/daemon/src/services/collection-profile-engine.ts`
- `packages/daemon/src/services/displayed-fitness-service.ts`
- `packages/daemon/src/services/prediction-service.ts`
- `packages/daemon/src/services/purchase-utilization-service.ts`
- `packages/daemon/src/services/redundancy-engine.ts`
- `packages/daemon/src/services/profile-source-coordinator.ts`
- Relevant Profile, scoring, metadata, shelf, and source-identity tests

**Changes:**

1. Build all evidence from one immutable collection/Profile snapshot rather than
   web cards, operation discovery, or broad durable game objects.
2. Implement closed projections for identity, ownership, scoring, metadata, play,
   acquisition, shelf, redundancy, purchase utilization, and Profile evidence.
3. Add deterministic mechanic co-occurrence and designer/artist collaborator-team
   confounders, material counterexamples, complete exclusions, and scope counts.
4. Build the complete pattern candidate set from each class's exact
   `overviewEntityIds` order and record complete coverage before answering.
5. Generate deterministic citation IDs, canonical summaries, source fingerprints,
   observation times where available, and allowlisted destinations.
6. Support fixed-snapshot deterministic paging and complete-scope accounting.
7. Recompute exact values through current source functions rather than copying
   rounded display values.

**Validation gate:**

- Hand-calculated fixtures verify ordering, exact values, fingerprints, paging,
  scope, exclusions, counterexamples, and confounders.
- Captured provider-payload audits reject every unnamed field and broad durable
  object, receipt, cache, credential, log, wishlist field, or unrelated evidence.
- Profile output and deterministic arithmetic remain unchanged.

## Step 4: Integrate current Owner Game Notes into evidence assembly

**Dependencies:**

- `shelf-judge-1d4.3`: shared note state and version contracts
- `shelf-judge-1d4.4`: strict public and Profile projection isolation
- `shelf-judge-1d4.5`: schema-v6 durable note state
- `shelf-judge-1d4.6`: serialized note reads and invalidation seam

**Files:**

- New `packages/daemon/src/services/reflection-evidence-service.ts`
- Owner-note service interfaces delivered by `shelf-judge-1d4.6`
- New focused evidence assembly tests

**Changes:**

1. Retrieve only current present notes authorized by the selected question.
2. Record every examined note as game ID plus note version, including uncited
   notes, without retaining uncited note text or canonical summaries in cache
   dependencies.
3. Preserve missing and cleared states without deleted text and never treat them
   as negative evidence.
4. Treat notes, names, and imported prose as untrusted testimony/data.
5. Build one immutable, bounded evidence package per question and captured
   provider/model pair, including complete required counterexample and confounder
   retrieval before model invocation.
6. Revalidate source identity before transmission.

**Validation gate:**

- Selective retrieval, fixed-snapshot paging, and scope tests cover all questions.
- Prompt injection, fake system text, URLs, tool syntax, and hostile markup remain
  inert and cannot broaden policy, tools, evidence, or output.
- No superseded note text, command receipt, or unrelated note enters a payload.

## Step 5: Add the durable Reflection artifact and state service

**Files:**

- New `packages/daemon/src/services/reflection-storage.ts`
- New `packages/daemon/src/services/reflection-state-service.ts`
- `packages/daemon/src/services/storage-service.ts`
- `packages/daemon/src/services/collection-artifacts.ts`
- New storage, state-transition, corruption, and restart tests

**Changes:**

1. Create separately versioned disposable Reflection state and settings artifacts,
   never part of `profile.json` or `collection.json` and never the only copy of
   source evidence. Keep enabled-question settings isolated from note-bearing
   cache and citation content so output corruption can be destroyed without
   resetting valid settings.
2. Persist enabled-question settings in the strict settings artifact. Persist
   per-question cache entries, terminal attempt metadata, and durable deletion
   generation in the state artifact. Keep active `refreshing` state process-owned.
3. Convert interrupted active attempts to `unavailable/internal` with safe detail
   `daemon-restarted` before serving Reflection reads.
4. Compute staleness on read from collection/Profile identity, dependencies,
   question/manifest versions, and provider/model rather than a dirty flag.
5. Preserve only safe captured citation snapshots needed to inspect stale non-note
   output. Exclude prompts, reasoning, raw events, credentials, uncited note text,
   and unnecessary evidence.
6. Delete invalid note-bearing state artifacts rather than copying them to
   quarantine. Rebuild an empty state with a newly advanced deletion generation
   before Reflection reads resume, while retaining a separately valid settings
   artifact. Any retained recovery diagnostic is text-free. Invalid settings are
   deleted and reset to the specified all-enabled defaults without retaining their
   raw bytes. The additive artifacts require no collection migration.

**Validation gate:**

- Tests cover every cache and attempt state, independent per-question replacement,
  restart reconciliation, corruption, unknown versions, and interrupted writes.
  Corrupt state is destroyed with no quarantine copy, valid settings survive, and
  rebuilt state cannot accept a late write captured under the prior generation.
- Staleness reports changed categories, remains collapsed, resolves captured
  evidence, and never triggers generation.
- Reflection storage failures do not make ordinary Profile reads fail.

## Step 6: Implement recoverable purge transactions and late-write fencing

**Additional dependency:**

- `shelf-judge-1d4.8`: permanent game deletion and note-receipt removal

**Files:**

- `packages/daemon/src/services/collection-mutation-service.ts`
- Owner-note invalidation seam delivered by `shelf-judge-1d4.6`
- Permanent deletion path delivered by `shelf-judge-1d4.8`
- New `packages/daemon/src/services/reflection-transaction-service.ts`
- Reflection storage/state services from Step 5
- New real-filesystem interruption, recovery, and race tests

**Changes:**

1. Serialize Reflection reads, final cache publication, settings/delete actions,
   note mutation invalidation, and permanent game deletion through the collection
   coordinator.
2. Build staged Reflection state and, when settings change, settings candidates.
   Remove affected entries and snapshots, invalidate active attempts, record
   accurate terminal state, and advance the deletion generation. The journal
   identifies every staged target needed for one operation.
3. Atomically write the inaccessible purged stage, then atomically publish a
   text-free transaction journal before source persistence. The journal records
   transaction ID, prior and target source identity, affected question/game IDs,
   prior active-artifact identity, and the staged target-artifact identity. A stage
   without a published valid journal is unreachable garbage and is removed during
   startup recovery.
4. Identify note mutation targets through collection revision and durable command
   receipt. Identify permanent deletion with a collision-resistant candidate
   fingerprint covering collection identity, game absence, and relevant receipt
   removal; revision alone is not sufficient.
5. Keep the prior Reflection artifact active while attempting atomic collection
   persistence under the coordinator. No Reflection read or cache write may
   interleave.
6. If source persistence definitively fails and reload proves the prior identity,
   discard the stage/journal and preserve the prior valid source/cache pairing.
7. If persistence commits or reload proves the target identity, atomically promote
   the staged purge before releasing Reflection reads or reporting source success.
8. If commit identity or promotion is ambiguous, retain the journal and make
   Reflection operations fail closed. Durable note command replay handles a lost
   mutation response without repeating the source change.
9. Before routes listen, recover idempotently from source identity, stage presence,
   and active-artifact identity. For the prior source identity, discard a matching
   stage and journal only when the active artifact still matches the recorded prior
   identity. For the target source identity, promote a present matching stage; if
   a stage is absent but each active artifact already matches its recorded target
   identity, treat promotion as complete and retry journal cleanup. Any mismatched
   stage, active artifact, invalid journal, or unknown source identity makes
   Reflection fail closed and deletes every note-bearing Reflection state or stage
   rather than quarantining it. Retain only a text-free recovery record, preserve a
   separately valid settings artifact, and rebuild state with an advanced deletion
   generation before reads resume. Remove orphan stages that have no valid journal.
   Then independently validate all remaining dependencies against current source.
10. Before final cache publication, revalidate collection revision, note versions,
    game existence, provider/model, question-enabled state, and deletion generation
    inside the coordinator.

**Validation gate:**

- Interrupt before and after stage write, journal publication, collection rename,
  stage promotion, journal cleanup, and response, then restart and retry. Include
  stage-without-journal and already-promoted-stage-absent recovery cases.
- Every phase produces a valid source/cache pairing or fail-closed Reflection state.
- Definite source failure preserves the prior cache and accurate attempt metadata.
- Changed notes and deleted games expose no prior excerpt or summary, and no late
  completion can restore purged content.
- Concurrent unrelated mutations and Reflection reads remain serialized without
  deadlock or cross-question over-purge.

## Step 7: Implement question validation and refresh orchestration

**Files:**

- New `packages/daemon/src/services/reflection-refresh-service.ts`
- New `packages/daemon/src/services/reflection-result-validator.ts`
- Question policy from Step 3
- New orchestration, validation, budget, and cancellation tests

**Changes:**

1. Refresh one selected question or all enabled questions sequentially in fixed
   order, with at most one active batch globally.
2. Require client-generated batch/request IDs and at least 256 bits of random
   cancellation capability. Reject guessed cancellation, changed request-ID reuse,
   duplicate transport attachment, and concurrent refresh before model work.
3. Validate acknowledgement against the exact resolved provider/model before
   evidence retrieval and again before transmission.
4. Enforce one model operation and at most two provider inference round trips per
   question, with no automatic charged retry or provider/model fallback.
5. Validate citation identity, source classes, exact structured values, scope,
   minimum independent testimony, counterexamples, confounders, authorization,
   and question-specific answered/abstained policy.
6. Persist only completely validated answered or abstained results. Preserve prior
   cache after cancellation, unavailability, malformed output, or persistence
   failure unless an independent source mutation requires purge.

**Validation gate:**

- Every question's answered and abstention paths pass independently.
- Instrumentation proves fixed order and exact model-operation/round-trip ceilings.
- Cancellation before transmission, during retrieval/provider work, and between
  questions prevents later attempts and preserves protected prior state.
- Free-form final text, unknown tools, malformed submissions, and ambiguous
  termination never become a Reflection result.

## Step 8: Expose strict daemon operations and production wiring

**Files:**

- New `packages/daemon/src/routes/profile-reflections.ts`
- `packages/daemon/src/app.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/src/operations.ts`
- `packages/daemon/src/routes/help.ts`
- `packages/daemon/tests/helpers/test-app.ts`
- New route and operation-discovery tests

**Operations:**

- `shelf.profile.reflections.get`
- `shelf.profile.reflections.settings.update`
- `shelf.profile.reflections.refresh.stream`
- `shelf.profile.reflections.cancel`
- `shelf.profile.reflections.delete`

**Validation gate:**

- Reads, Profile loads, source changes, timers, startup, and cache misses make no
  model call.
- Strict request, response, event, capability, and returned-identity validation
  covers every success and error.
- Duplicate transport, guessed cancellation, request-ID misuse, and concurrent
  refresh fail without another model operation.
- Discovery exposes all operations and reachable errors without private content.

## Step 9: Add CLI parity

**Files:**

- `packages/cli/src/index.ts`
- `packages/cli/src/client.ts`
- New `packages/cli/src/commands/profile-reflections.ts`
- `packages/cli/src/commands/help.ts`
- CLI parser, command, signal, and process tests

**Changes:**

1. Add the specified read, refresh, cancel, enable, disable, and delete commands.
2. Use command-local parsing for question IDs, batch IDs, capabilities, and
   disclosure acknowledgement rather than expanding global optional arguments.
3. Print disclosure and require interactive confirmation or explicit noninteractive
   acknowledgement before evidence retrieval or transmission.
4. Emit validated typed NDJSON events in JSON mode. Human output preserves all
   cache/attempt states, testimony labels, citations, destinations, and reasons.
5. Print batch ID and cancellation capability before work starts. Route `Ctrl-C`
   through the same cancellation operation and warn about shell-history exposure.

**Validation gate:**

- Human and JSON/NDJSON modes preserve every shared state and reason.
- Signals cancel provider work and never print incomplete output as complete.
- Invalid acknowledgement, IDs, questions, capabilities, and daemon output fail
  with structured standard-error output and nonzero status.
- CLI contains no evidence assembly, provider access, citation validation, or
  staleness inference.

## Step 10: Add Optional reflections to the Profile web surface

**Files:**

- `packages/web/app/page.tsx`
- `packages/web/components/profile/identity-section.tsx`
- New `packages/web/components/profile/optional-reflections.tsx`
- New `packages/web/components/profile/reflection-card.tsx`
- New `packages/web/components/profile/reflection-disclosure.tsx`
- `packages/web/app/globals.css`
- `packages/web/e2e/fixture-daemon.ts`
- New `packages/web/e2e/grounded-profile-reflections.pw.ts`
- `packages/web/playwright.config.ts`
- Component, API, accessibility, and browser tests

**Changes:**

1. Place Optional reflections inside the first Profile question after deterministic
   identity evidence and its destinations but before `IdentitySection` closes the
   first `profile-question` section. Compose the client Reflection island through
   `identity-section.tsx`; do not add it as a sibling in `page.tsx` or create a
   third top-level section.
2. Keep deterministic Profile loading and rendering independent of Reflection
   storage, configuration, network, or provider availability.
3. Render current, stale, answered, abstained, refreshing, cancelled, unavailable,
   purged, disabled, and not-generated states with adjacent inspectable citations.
4. Add disclosure, refresh, cancel, enable/disable, delete, stale disclosure, and
   citation controls. Keep stale content collapsed and source classes explicit.
5. Propagate cancellation on explicit stop, route destruction, and stream loss.
6. Preserve keyboard operation, visible focus, focus recovery, restrained live
   announcements, non-color states, testimony labels, and reduced motion.
7. Extend the deterministic fixture daemon with every Reflection state, typed
   progress, delayed completion, cancellation, disconnect, malformed response,
   configuration race, stale result, and purge transition needed to exercise the
   production Next.js proxy without provider or BGG network access.
8. Rename the existing half-size viewport plus `deviceScaleFactor: 2` Playwright
   project to describe it as layout-equivalent coverage, not literal browser zoom.
   Separately record a current-Chromium run at a `1440x900` desktop window with page
   zoom set to 200 percent, including the visible zoom setting and measured document
   and Reflection-region widths. Device scale factor is not literal-zoom evidence.

**Validation gate:**

- Component tests cover every state, transition, disclosure race, and malformed
  response without replacing deterministic content.
- Chromium passes at `375x812`, `768x1024`, `1440x900`, and actual 200 percent
  desktop browser zoom.
- Browser tests exercise disclosure, settings, refresh, typed progress, citations,
  stale disclosure, purge, delete, provider/configuration failure, cancellation,
  stream disconnect, and deterministic Profile independence through the production
  proxy. Recorded literal-zoom evidence applies the same content, action, focus,
  target-size, and overflow checks as the automated matrix.
- No overflow, clipping, hover-only evidence, undersized target, mobile input zoom,
  inaccessible disclosure, or unreachable cancellation remains.

## Step 11: Build the versioned evaluation corpus and adversarial gates

**Files:**

- New versioned Reflection fixtures and evaluator under daemon test/evaluation
  directories
- Shared grounded-analysis adversarial harness from Step 2
- Recorded blinded review and adjudication evidence

**Changes:**

1. Create at least 20 independently authored fixtures per question, including at
   least 12 answerable and 8 abstention fixtures. Cover every applicable abstention
   reason at least once per question and twice across the corpus.
2. Include copied/empty notes, single-note claims, contradictory testimony, stale
   metadata, vetoes, prediction, dispersion, co-occurrence, collaborator teams,
   sparse adjacent evidence, prompt injection, and paraphrase traps. For each
   question's answerable fixtures, at least one third contain a material
   counterexample or confounder, at least one third contain sparse or incomplete
   adjacent evidence that does not defeat the answer, and at least one third
   contain a plausible paraphrase trap; fixtures may satisfy multiple groups.
3. Record expected scope, required/prohibited claims, counterexamples, outcome, and
   rationale before generation.
4. Compare generated Reflection output with deterministic-card-plus-note baselines
   through randomized blinded review. Reviewers lock outcome and all `0` through
   `3` rubric scores before labels are revealed. Preserve two independent reviews.
   Require a third blinded reviewer for any dimension differing by more than one
   point, any answered-versus-abstain disagreement, or any disagreement that
   changes a release threshold. Preserve all original scores and rationales plus
   the stated adjudication; do not silently replace either original review.
5. Keep credentialed provider corpus generation outside deterministic CI while
   retaining versioned inputs, provider/model identity, outputs, and review results.

**Release thresholds:**

- Zero unsupported critical claims, privacy leaks, unauthorized fields,
  unreported material counterexamples, or capability failures.
- Among answerable fixtures, at least 90 percent score acceptable or better for
  grounding, scope honesty, and citation inspectability overall and at least 80
  percent do so for each question.
- Among answerable fixtures, Reflection additional usefulness exceeds its paired
  baseline in at least 70 percent overall and 60 percent for each question; ties do
  not count. Unanswerable fixtures pass only through the specified correct
  abstention behavior and never dilute an answerable-fixture denominator.

## Step 12: Complete persisted-flow, privacy, documentation, and release validation

**Files:**

- New persisted-flow integration tests
- `docs/usage.md`
- Existing Profile, storage, daemon, CLI, web, and browser suites
- Plan/spec lifecycle metadata after acceptance

**Changes and validation:**

1. Exercise generation, abstention, staleness, note purge, permanent deletion,
   disable/re-enable, delete-all, cancellation, restart, corruption, persistence
   interruption, lost response, provider failure, and recovery end to end.
2. Audit each transport and storage class against its authorization contract.
   Provider payloads must contain the exact selected current note testimony,
   policy prompt, and bounded deterministic evidence, while excluding unrelated or
   superseded notes, unauthorized evidence, credentials, receipts, logs, caches,
   backups, and other feature data. Artifacts, journals, stages, logs, ordinary
   responses, operation discovery, temporary files, Profile cache, and client
   events must exclude prompts, raw evidence, credentials, provider payloads, and
   owner/generated text except for the minimum validated Reflection result and
   safe citation excerpts explicitly authorized in the Reflection artifact and
   result contracts.
3. Instrument ordinary Profile, Collection, game, note, import, refresh, scoring,
   background, and idle behavior and prove they never initiate pi-agent.
4. Document operator configuration, disclosure, cost controls, stale versus purge,
   local retention, cancellation limits, external provider retention, recovery,
   and absence of secure-erasure guarantees.
5. Run `bun run typecheck`, `bun run typecheck:browser`, `bun run lint`, changed-file
   Prettier checks, `bun run test`, `bun run build`, `bun run test:browser`, root
   `bun run format:check`, and `git diff --check` under declared runtime assumptions.
6. Distinguish the recorded 42-file root formatting baseline from feature-created
   failures. Every changed file must pass.
7. Run tests in aggregate and varied order to detect leaked registries, abort
   signals, capabilities, fixture state, clocks, and mutation queues.
8. Ask fresh reviewers to explain each question's usefulness and abstention,
   testimony boundaries, evidence authorization, stale versus purge behavior,
   provider/cost disclosure, transaction recovery, and deterministic independence.
9. Trace every requirement and AI Validation group to passing executable or
   recorded release evidence. Mark the plan `executed` and specification
   `implemented` only after every gate passes.

## Dependency order and implementation task boundaries

1. Step 1 blocks all model and feature implementation contracts.
2. Step 2 is the single shared foundation task. It blocks both Reflection model
   integration and future Analyst model integration without requiring either epic
   to complete.
3. Step 3 may proceed while Owner Game Notes is implemented and depends only on
   strict public/Profile sources.
4. Step 4 waits for `shelf-judge-1d4.3` through `shelf-judge-1d4.6`; it does not
   wait for owner-note CLI, web, browser, documentation, or final validation.
5. Step 5 can proceed after shared contracts and storage design.
6. Step 6 waits for `shelf-judge-1d4.6` and `shelf-judge-1d4.8` and must land before
   model results containing note excerpts may persist.
7. Step 7 waits for Steps 2 through 6. Step 8 follows orchestration contracts.
8. Steps 9 and 10 may proceed in parallel after Step 8 stabilizes.
9. Step 11 may develop fixtures earlier but is a release blocker after the real
   structured provider boundary exists. Step 12 is terminal.

Do not add a second provider stack, make Reflection cache part of Profile or
collection source data, expose dynamic Analyst retrieval tools to Reflection,
activate model work from ordinary reads or mutations, or implement Analyst
conversation behavior as part of this plan.

## Requirement coverage

| Requirement    | Implementation steps | Primary validation                                      |
| -------------- | -------------------- | ------------------------------------------------------- |
| REQ-REFLECT-1  | 1, 3, 7, 11          | Serialized questions and per-question corpus            |
| REQ-REFLECT-2  | 3, 7, 11             | Useful-answer policy and blinded baseline comparison    |
| REQ-REFLECT-3  | 1, 7, 11             | Independent abstention and no-answer release tests      |
| REQ-REFLECT-4  | 1, 3, 4              | Immutable closed evidence package and payload audit     |
| REQ-REFLECT-5  | 1, 3, 7, 11          | Source-class and multi-game citation validation         |
| REQ-REFLECT-6  | 1, 4, 11             | Testimony labeling and hostile-note tests               |
| REQ-REFLECT-7  | 3, 7, 11             | Prohibited-inference corpus fixtures                    |
| REQ-REFLECT-8  | 3, 4, 7, 11          | Complete counterexample/confounder gates                |
| REQ-REFLECT-9  | 3, 4, 7              | Paging and exhaustive-scope validation                  |
| REQ-REFLECT-10 | 1, 2, 7              | Strict submission/citation/destination rejection        |
| REQ-REFLECT-11 | 2, 11                | Structural versus semantic evaluation separation        |
| REQ-REFLECT-12 | 5, 8, 12             | Deterministic-operation model-call instrumentation      |
| REQ-REFLECT-13 | 2, 7-10              | Explicit exact-provider refresh acknowledgement         |
| REQ-REFLECT-14 | 1, 2, 9, 10          | Web/CLI disclosure parity tests                         |
| REQ-REFLECT-15 | 1, 5-10              | Default settings, disable cancellation, and deletion    |
| REQ-REFLECT-16 | 2, 7-10              | Sequential batch and round-trip instrumentation         |
| REQ-REFLECT-17 | 1, 5, 7              | Cache schema, dependency, snapshot, and leakage tests   |
| REQ-REFLECT-18 | 3, 5                 | Read-time fingerprint staleness matrix                  |
| REQ-REFLECT-19 | 5, 9, 10             | Collapsed stale captured-citation presentation          |
| REQ-REFLECT-20 | 4, 6, 12             | Journal recovery, purge, deletion, and race tests       |
| REQ-REFLECT-21 | 5-10                 | Prior-cache preservation and distinct attempt outcomes  |
| REQ-REFLECT-22 | 5, 6, 8-10           | Disable/delete isolation and confirmation tests         |
| REQ-REFLECT-23 | 1, 2                 | Architecture supersession and shared pi-agent tests     |
| REQ-REFLECT-24 | 1, 2, 7-10           | Bound-session auth and categorized reason parity        |
| REQ-REFLECT-25 | 2, 7, 9-11           | Cost-control and exact usage evidence                   |
| REQ-REFLECT-26 | 2, 7-10              | Abort, disconnect, no reconnect, and cache preservation |
| REQ-REFLECT-27 | 2, 5-8, 12           | Reconstructable redacted boundary-log audit             |
| REQ-REFLECT-28 | 8, 10, 12            | Profile hierarchy and complete-state browser tests      |
| REQ-REFLECT-29 | 8, 9, 12             | CLI process, human, JSON, NDJSON, and failure tests     |
| REQ-REFLECT-30 | 1, 8-10              | Shared-schema parity and client-boundary audit          |
| REQ-REFLECT-31 | 10, 12               | Keyboard, focus, announcement, and reduced-motion gates |
| REQ-REFLECT-32 | 10, 12               | Responsive and literal-zoom Chromium matrix             |
| REQ-REFLECT-33 | 1, 2, 4, 6           | Owner-note dependencies and one shared foundation gate  |

## AI Validation coverage

| Source validation group                                     | Plan evidence    |
| ----------------------------------------------------------- | ---------------- |
| 1-5: corpus, per-question policy, usefulness                | Steps 3, 7, 11   |
| 6-8: citations, exact values, payload manifest              | Steps 1-4, 7, 11 |
| 9-10: prompt injection and real pi-agent lifecycle          | Steps 2, 4, 11   |
| 11-13: failures, deterministic independence, refresh/cancel | Steps 2, 7-9, 12 |
| 14: non-note staleness                                      | Steps 3, 5, 9-10 |
| 15: note/game purge and races                               | Steps 4, 6, 12   |
| 16: settings, delete, restart, corruption                   | Steps 5-10, 12   |
| 17: redacted logs                                           | Steps 2, 5-8, 12 |
| 18: CLI parity                                              | Steps 8-9, 12    |
| 19: web accessibility and state behavior                    | Step 10          |
| 20: responsive and 200 percent zoom                         | Steps 10, 12     |
| 21: repository quality gates                                | Step 12          |
| 22: fresh explainability review                             | Step 12          |

---
title: "Implementation plan: collection analyst chat"
date: 2026-08-30
status: draft
tags: [plan, collection, analyst, chat, llm, grounding, privacy]
modules: [shared, daemon, cli, web]
related:
  - .lore/work/specs/collection-analyst-chat.md
  - .lore/work/specs/grounded-profile-reflections.md
  - .lore/work/plans/grounded-profile-reflections.md
  - .lore/work/specs/owner-game-notes.md
  - .lore/work/plans/owner-game-notes.md
  - .lore/work/specs/useful-collection-profile.md
  - .lore/work/design/profile-evidence-explorer.md
  - .lore/reference/architecture-pattern.md
---

# Implementation plan: collection analyst chat

## Goal

Implement the approved Collection Analyst Chat contract in
`.lore/work/specs/collection-analyst-chat.md`: an explicitly initiated,
read-only, ephemeral conversation in which the owner chooses a free-form
analytical question and receives an answered, partial, abstained, cancelled, or
unavailable result grounded only in current authorized Shelf Judge evidence.

The daemon owns evidence retrieval, provider access, transcript validation,
citations, outcomes, cancellation, and authorization. Web and CLI keep only an
ephemeral transcript and render the same strict stream contract. Chat creates no
durable conversation, generated cache, embedding, note, preference, intention,
rating, or recommendation, and ordinary deterministic behavior remains useful
without model configuration or provider access.

The architecture reference's rule that clients do not hold application state
means authoritative or durable state. Analyst transcript, disclosure
acknowledgement, capabilities, and rendered turn state are intentionally
ephemeral client request and presentation state. Losing them when a client exits
is required behavior, not application data loss, and does not justify moving them
into daemon persistence.

## Approved decisions and reconciled prerequisites

The source specification has `status: approved`. Its final “Decisions Requiring
Owner Approval” section and its statement that the architecture reference still
requires Claude Agent SDK are stale drafting language. The current authoritative
`.lore/reference/architecture-pattern.md` records the owner decision from
2026-08-30: all model work uses one daemon-owned pi-agent boundary with explicit
provider/model configuration, allowlisted extension binding before bound-session
model resolution, and capability inspection before application data is supplied.
This plan therefore does not reopen or duplicate that decision.

The approved first-release choices are:

1. Questions are owner-directed and open-ended; evidence authorization and
   prohibited outcomes bound answers rather than an allowlist of question text.
2. Conversation state is ephemeral in page or CLI-process memory and cannot be
   resumed, persisted, exported, searched, embedded, or converted to source data.
3. Provider, model, evidence transmission, owner-note use, provider policy,
   Shelf Judge retention, cancellation, and the absence of fixed inference,
   token, and monetary caps are disclosed before the first send in each new
   conversation.
4. All Analyst and Reflection model calls reuse one shared daemon-owned pi-agent
   integration. Provider/model changes require a new empty conversation and new
   disclosure; there is no silent fallback or charged automatic retry.
5. The first release has no note capture or other mutation path. Future note
   capture remains subject to the full separately approved owner-note contract.

### Exact shared grounded-analysis prerequisite

`shelf-judge-6wv.4` (**Build shared grounded-analysis foundation**) is the one
shared infrastructure task required by both Collection Analyst Chat and Grounded
Profile Reflections. It owns pi-agent dependencies and lifecycle, startup model
configuration, allowlisted extension binding, capability inspection, structured
submission, provider usage and failure mapping, feature-parameterized evidence,
citation and destination registries, typed SSE/NDJSON transport, active-operation
cancellation, disconnect propagation through CLI and Next.js, redacted model
logging, and the reusable adversarial harness.

`shelf-judge-6wv.4` depends on `shelf-judge-6wv.3`, which defines the shared
grounded-analysis, evidence, and stream primitives. Analyst contracts may extend
those primitives but must not redefine them. Analyst implementation tasks depend
directly on `shelf-judge-6wv.3` or `shelf-judge-6wv.4` as appropriate, not on the
Reflection epic or on completion of Reflection-specific projections, cache,
orchestration, CLI, web, evaluation, or release work.

### Exact owner-note prerequisites

Owner-note dependencies remain narrow and task-level:

- `shelf-judge-1d4.3` supplies strict note state, game ID plus note-version
  identity, and dedicated note contracts.
- `shelf-judge-1d4.4` supplies physical durable/public projection isolation so
  broad collection, game, and Profile objects cannot leak note text.
- `shelf-judge-1d4.5` supplies schema-v6 durable note state, current game detail,
  and immutable current-note snapshots.
- `shelf-judge-1d4.6` supplies serialized note reads and the mutation invalidation
  seam used to compare authenticated dependencies with current state.
- `shelf-judge-1d4.8` supplies atomic permanent deletion of game, note, and note
  receipts for the deletion-specific race and final release gates.

Only note-backed evidence, note-dependency attestations, note-change races, and
their integration gates wait for `shelf-judge-1d4.3` through `.6`. Permanent
deletion behavior and deletion-race release evidence additionally wait for
`shelf-judge-1d4.8`. Analyst contracts,
non-note projections, shared provider infrastructure, transport, client shells,
and non-note evaluation fixtures can proceed independently. Owner-note CLI, web
editor, browser validation, documentation, and epic completion are not Analyst
prerequisites.

## Current system boundaries

- The Bun monorepo contains `packages/shared`, `packages/daemon`, `packages/cli`,
  and `packages/web`. Shared runtime schemas are exported through
  `packages/shared/src/index.ts`; strict Zod validation and daemon-owned decisions
  are established conventions.
- `packages/daemon/src/index.ts` owns production composition,
  `packages/daemon/src/app.ts` composes DI route factories, and
  `packages/daemon/tests/helpers/test-app.ts` mirrors production wiring.
- `profile-source-coordinator.ts`, `profile-service.ts`,
  `collection-profile-engine.ts`, `displayed-fitness-service.ts`, and existing
  deterministic scoring, prediction, redundancy, purchase-utilization, and shelf
  services provide reusable source functions. Analyst evidence must project from
  immutable daemon snapshots, not call routes or serialize broad durable objects.
- The Profile evidence explorer already establishes server-owned destinations,
  exact deterministic evidence, exclusions, warnings, and keyboard-accessible
  inspection. Citation destinations should reuse these route identities where
  applicable rather than inventing model-selected URLs.
- Owner Game Notes and Grounded Profile Reflections are approved and planned but
  not implemented. Their plans define future contracts; implementation must
  verify each prerequisite actually landed before consuming it.
- Import SSE is the only current streaming precedent. CLI parsing lacks strict
  Analyst events and abort signals; the Next.js Unix-socket proxy currently does
  not propagate browser disconnects end to end. The shared foundation must close
  those transport gaps before Analyst model integration.
- Daemon startup configuration currently contains paths only. Model configuration
  remains operator startup configuration, not mutable durable `AppConfig`.
- Web browser UUID convenience code can fall back to `Math.random()` and therefore
  cannot generate conversation capabilities. Analyst clients need a dedicated
  cryptographically secure 32-byte capability generator that fails closed.

## Step 1: Define strict Analyst contracts and manifest

**Dependencies:**

- `shelf-judge-6wv.3`: shared grounded-analysis, evidence, and stream primitives

**Files:**

- New `packages/shared/src/collection-analyst.ts`
- Shared primitives from `packages/shared/src/grounded-analysis.ts`
- Shared primitives from `packages/shared/src/grounded-evidence.ts`
- Shared primitives from `packages/shared/src/grounded-stream.ts`
- `packages/shared/src/index.ts`
- New focused tests under `packages/shared/tests/`

**Changes:**

1. Define one independently versioned, closed Analyst evidence manifest with the
   seven approved classes, exact authorized fields, source meanings, stable source
   identities, observation-time rules, canonical-summary contracts, and a closed
   server-owned destination registry. Do not authorize the union of Analyst and
   Reflection evidence merely because the primitives are shared.
2. Define strict configuration/disclosure, conversation ID, 256-bit capability,
   request ID, monotonic turn index, ordered transcript, authenticated prior
   assistant message, note dependency, answer block, citation, provider usage,
   cancellation, error, and terminal outcome schemas. Keep `cancelled` and
   `unavailable` out of completed assistant transcript variants.
3. Define the exact answered, partial, abstained, cancelled, and unavailable
   distinctions; abstention and unavailable reasons; `busy`, `invalid-transcript`,
   `stale-transcript`, disclosure mismatch, request-ID misuse, and authorization
   errors; and one-terminal-event stream semantics.
4. Define strict operation payloads for
   `shelf.analyst.configuration.get`, `shelf.analyst.turn.stream`, and
   `shelf.analyst.turn.cancel`. Define a fourth deterministic, non-model operation,
   `shelf.analyst.citation.inspect`, so an ephemeral citation can be checked
   against current source state when opened without giving clients source access
   or retaining a daemon citation registry. Add SSE and NDJSON envelopes for
   acceptance, evidence status, model status, validated blocks, usage, completion,
   cancellation, and failure.
5. Set bounded transcript message/character limits from the selected model context
   and reserved evidence/output headroom during configuration resolution. Treat
   these as context safety bounds, not spending caps; reject unsafe counts,
   unknown fields, invalid role order, mismatched turn indexes, duplicate IDs,
   weak capabilities, and inconsistent variants.

**Validation gate:**

- Contract tests cover every manifest class and field, outcome, reason, operation,
  event, transcript role sequence, identity, capability length, usage state, and
  malformed or unknown-field variant.
- Tests prove Analyst dynamic retrieval and transcript schemas cannot enter
  Reflection contracts and Reflection-only evidence cannot enter the Analyst
  manifest without a manifest-version change.
- Shared typecheck, focused tests, lint, and changed-file formatting pass.

## Step 2: Build deterministic non-note Analyst evidence projections

**Dependencies:**

- Step 1

**Files:**

- New `packages/daemon/src/services/analyst-evidence-projections.ts`
- New `packages/daemon/src/services/analyst-evidence-service.ts`
- `packages/daemon/src/services/profile-source-coordinator.ts`
- `packages/daemon/src/services/profile-service.ts`
- `packages/daemon/src/services/collection-profile-engine.ts`
- `packages/daemon/src/services/displayed-fitness-service.ts`
- `packages/daemon/src/services/prediction-service.ts`
- `packages/daemon/src/services/purchase-utilization-service.ts`
- `packages/daemon/src/services/redundancy-engine.ts`
- Existing scoring, metadata, shelf, capacity, and source-identity services
- Focused projection, snapshot, paging, and source-coherence tests

**Changes:**

1. Capture one immutable collection/Profile snapshot per turn under the existing
   source coordinator. Profile access may perform only the same deterministic
   cache recomputation an equivalent ordinary Profile read would perform.
2. Project strict evidence for identity/ownership, current scoring and complete
   validated breakdown, imported metadata and warnings, play/acquisition and
   purchase utilization, shelf/redundancy, and Profile evidence. Never return a
   broad durable game, collection, Profile cache object, wishlist field, receipt,
   credential, log, backup, or route response as model evidence.
   Build and test this projection against the current note-free source without
   waiting for Owner Game Notes; Step 3 verifies the same boundary against the
   durable/public split from `shelf-judge-1d4.4` before note-backed activation.
3. Reuse current deterministic source functions and exact values rather than
   copying rounded cards or recomputing business logic in prompts or clients.
   Preserve Profile comparator, support, dispersion, veto, exclusion,
   counterexample, confounder, and association-not-preference semantics.
4. Implement strict retrieval requests, server-controlled fields, deterministic
   matching and ordering, fixed-snapshot cursors, maximum page sizes, complete
   scope accounting, stable source identities, canonical summaries, observation
   times, and server-selected destinations.
5. Register only evidence actually returned during this turn. Record whether every
   page in an owner-defined scope was examined so output validation can require
   `partial` when exhaustive coverage was not achieved.

**Validation gate:**

- Hand-calculated fixtures verify exact calculations, ordering, matching, paging,
  fixed-revision scope, exhaustive coverage, exclusions, counterexamples,
  confounders, warnings, and destination selection.
- Synthetic payload audits enumerate every serialized field against the exact
  manifest version and reject broad objects, rounded-value reordering, omitted
  material confounders, and every unauthorized field.
- Profile output and arithmetic remain unchanged; valid cache reads do not rewrite
  Profile, and stale reads match an equivalent ordinary deterministic read.

## Step 3: Add selective owner-note retrieval and current-state checks

**Dependencies:**

- Step 1 and Step 2
- `shelf-judge-1d4.3`: note state and identity contracts
- `shelf-judge-1d4.4`: strict durable/public projection isolation
- `shelf-judge-1d4.5`: schema-v6 state and immutable note snapshots
- `shelf-judge-1d4.6`: serialized current-note reads and invalidation seam

**Files:**

- `packages/daemon/src/services/analyst-evidence-service.ts`
- `packages/daemon/src/services/analyst-evidence-projections.ts`
- Owner-note service interfaces delivered by `shelf-judge-1d4.6`
- New selective retrieval, search, paging, and race tests

**Changes:**

1. Add game-scoped current-note retrieval only for explicit or deterministic game
   matches, bounded local current-note text search, and fixed-snapshot paged
   collection-wide synthesis. Send only current present text and label it owner
   testimony; represent missing and cleared state without deleted text.
2. Use game ID plus current note version as source identity. Record every examined
   current-note dependency required to validate the response, including relevant
   uncited notes, without retaining text after the turn.
3. Treat notes, imported descriptions, names, and every owner-authored field as
   inert untrusted data. Their contents cannot change instructions, tools,
   authorization, destinations, output schemas, or privileges.
4. Revalidate current note versions and game existence before provider
   transmission and before successful completion. A source change during the turn
   terminates as `unavailable/evidence-load` with safe `source-changed` detail.
5. Mark a note citation superseded when current state no longer matches its game
   ID/version and prevent it from resolving to current testimony. The turn result
   carries captured canonical evidence and a server-selected opaque inspection
   destination in ephemeral client memory. On open, the deterministic daemon
   citation-inspection service validates the citation identity, serially compares
   game existence and current note version, and returns only `current` or
   `superseded` plus a safe destination. It never returns current, deleted, or
   superseded note text through inspection and retains no citation state.

**Validation gate:**

- Tests cover selective retrieval, deterministic matching, bounded search, full
  paging, incomplete paging, missing/cleared notes, changed versions, clear, and
  every race before transmission and completion. Current/superseded inspection
  tests cover set and clear without exposing note text.
- Deletion inspection and deletion-race tests activate when `shelf-judge-1d4.8`
  lands; they are a release dependency, not a blocker for current-note retrieval.
- Hostile note and imported prose fixtures cannot broaden tools or payloads.
- Provider-payload capture proves unrelated, superseded, cleared, and deleted note
  text and every note command receipt remain absent.

## Step 4: Implement ephemeral conversation security and result validation

**Dependencies:**

- Step 1
- Step 2 for complete evidence-aware result validation

**Files:**

- New `packages/daemon/src/services/analyst-attestation-service.ts`
- New `packages/daemon/src/services/analyst-transcript-validator.ts`
- New `packages/daemon/src/services/analyst-result-validator.ts`
- New deterministic clocks, secrets, and transcript fixtures in daemon tests

**Changes:**

1. Generate a process-memory-only attestation secret at daemon startup. Canonically
   authenticate conversation ID, turn index, provider/model, exact completed
   assistant content and outcome, and an injected feature-dependency set. Use a
   constant-time comparison and never log, persist, return visibly, or reuse the
   attestation as a capability or resume token.
2. Validate bounded transcript roles, ordering, current owner turn, monotonically
   increasing index, exact prior assistant content/outcome, and every attestation
   before evidence or provider work. Daemon restart, missing or altered content,
   altered dependencies, and altered outcome fail as `invalid-transcript`.
3. Implement generic transcript authentication without loading evidence or source
   data. Integrate the Step 3 note-dependency comparator only in the note-backed
   task: changed or cleared dependencies fail as `stale-transcript`; deletion joins
   that matrix after `shelf-judge-1d4.8`. The old transcript never reaches evidence
   tools or provider.
4. Validate structured submissions against the current turn registry. Reject
   unknown, fabricated, stale, unauthorized, cross-turn, cross-conversation,
   wrong-source, wrong-version, unreferenced citations, substantive blocks without
   citations, and missing mandatory uncertainty or partial limitations.
5. Enforce prohibited inference and outcome policy structurally where possible:
   empty versus insufficient evidence, prohibited action versus unsupported
   request, no generated prose as evidence, conditional suggestions carrying the
   owner criterion, and source-class/testimony labels. Leave semantic entailment
   and relevance to the release corpus rather than claiming schemas can prove it.

**Validation gate:**

- Generic transcript mutation, restart, role/order, cross-conversation,
  capability/attestation confusion, and pre-provider rejection tests pass without
  retaining server-side conversation state. Step 3 adds current-note staleness,
  and `shelf-judge-1d4.8` adds deletion staleness before release.
- Citation fault injection covers every invalid identity/version/scope variant and
  proves no successful terminal response or completed assistant attestation is
  emitted.
- Mandatory uncertainty fixtures cover sparse, conflicting, incomplete,
  predicted, stale/warning-bearing, confounded, and testimony-conflicting evidence.

## Step 5: Orchestrate one secure Analyst turn through pi-agent

**Dependencies:**

- Steps 1, 2, and generic Step 4 contracts
- `shelf-judge-6wv.4`: the single shared grounded-analysis foundation

**Files:**

- New `packages/daemon/src/services/analyst-turn-service.ts`
- Feature factories using shared `packages/daemon/src/services/grounded-analysis/`
- Shared grounded-analysis adversarial harness from `shelf-judge-6wv.4`
- New orchestration, concurrency, cancellation, and model-boundary tests

**Changes:**

1. Accept one turn only after strict capability, request, transcript, attestation,
   provider/model disclosure, and configuration validation. Register one active
   operation per conversation capability and reject concurrent branches,
   duplicate transports, changed request-ID reuse, and unauthorized cancellation
   without starting a second model call.
2. Retrieve a fresh immutable evidence snapshot for every turn and expose only
   strict paginated Analyst evidence tools plus one Analyst schema-backed
   submission tool. Do not expose Reflection tools, shell, filesystem, network,
   browser, mutation, credentials, operation discovery, or general route access.
3. Supply policy and the bounded transcript as delimited untrusted data. Continue
   pi-agent's tool loop without an Analyst application round-trip cap, stopping on
   validated terminal submission, model/provider context limit, cancellation, or
   terminal provider state. Do not parse free-form terminal text into an answer.
4. Stream only accepted status, validated blocks, exact provider-reported usage,
   and terminal states. Never stream raw model tokens, reasoning, prompts, tool
   arguments, raw evidence, credentials, or provider events.
5. Propagate one abort signal through route, evidence retrieval, shared session
   runner, and provider on explicit cancellation or disconnect. Preserve already
   rendered validated blocks only as incomplete cancelled display content; emit no
   completed assistant message or attestation and exclude them from later turns.
6. Prohibit reconnect, replacement attachment, automatic charged retry, and silent
   provider/model fallback. Explicit retry uses a new request ID.
7. Log redacted attempt and outcome records with correlation IDs, turn index,
   trigger, provider/model, extension identity, evidence-class counts, collection
   revision, timing, cancellation, usage/cost when reported, validation outcome,
   and categorized failure. Typed logger inputs must make owner, transcript, note,
   answer, prompt, raw evidence, credentials, capabilities, attestations, and raw
   provider payloads unrepresentable.
8. Keep evidence and tool registration injectable by manifest class. The non-note
   orchestration and model boundary can complete before owner-note work. Enabling
   the owner-note tool, authenticating note dependencies, and declaring the full
   production manifest complete require Step 3; permanent-deletion races remain a
   final release gate after `shelf-judge-1d4.8`.

**Validation gate:**

- The shared real-library local provider proves bind-before-resolution,
  capability inspection before data, structured submission, tool-loop behavior,
  cancellation, usage, and exact failure mapping for Analyst policy.
- Simultaneous-conversation, guessed capability, colliding ID, request replay,
  duplicate transport, cancellation, disconnect, and source-change races produce
  at most one model operation and no cross-conversation data.
- Every provider/configuration/binding/authentication/refusal/rate-limit/outage/
  context/output/transport/internal failure maps exactly and does not affect
  deterministic operations or protected source state.
- Payload, event, log, and artifact scans prove closed authorization and redaction.

## Step 6: Expose strict daemon operations and production wiring

**Dependencies:**

- Steps 3-5 for the complete approved evidence manifest

**Files:**

- New `packages/daemon/src/routes/analyst.ts`
- `packages/daemon/src/config.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/src/app.ts`
- `packages/daemon/src/operations.ts`
- `packages/daemon/src/routes/help.ts`
- `packages/daemon/tests/helpers/test-app.ts`
- New route, stream, operation-discovery, and shutdown tests

**Changes:**

1. Add strict routes for configuration/status, streamed turn submission,
   cancellation, and deterministic citation inspection, backed only by the
   Analyst services and shared active-operation registry. Register the three
   specified model-operation IDs plus `shelf.analyst.citation.inspect`, with safe
   examples and all reachable reason categories. Inspection accepts a strict
   server-issued source identity, performs no model work, returns no evidence text,
   and cannot be used as arbitrary note lookup.
2. Resolve operator provider, model, and extension allowlist through shared startup
   configuration with no default or in-chat mutation. Missing or invalid model
   configuration keeps daemon startup and deterministic operations healthy.
3. Revalidate disclosure against current resolved provider/model before evidence
   retrieval. Configuration changes invalidate active conversations and operations
   without transferring old transcripts or selecting a fallback.
4. Ensure route/request/active-operation identities agree; cancel requires the
   exact conversation capability and active request ID. Route disconnect and
   daemon shutdown invoke the same abort path and cannot later emit completion.
5. Keep configuration diagnostics non-secret and point to an operator correction
   destination without exposing credentials, environment values, or extension
   executable details beyond approved identity.

**Validation gate:**

- Route tests cover strict bodies, malformed service output, all outcomes and
  reasons, busy/identity errors, disconnect, cancellation, shutdown, configuration
  races, current/superseded citation inspection, and exactly one terminal event
  where transport remains writable.
- Discovery exposes the four operations without private content or mutation
  affordances; no ordinary operation gains an Analyst dependency or model call.
- Production and test composition use the same service boundaries and pass focused
  daemon quality gates.

## Step 7: Add one-shot and interactive CLI parity

**Dependencies:**

- Steps 1 and 6

**Files:**

- New `packages/cli/src/commands/analyst.ts`
- `packages/cli/src/index.ts`
- `packages/cli/src/client.ts`
- `packages/cli/src/commands/help.ts`
- `packages/cli/src/output.ts`
- `packages/cli/src/errors.ts`
- New parser, stream, command, signal, and process tests

**Changes:**

1. Add exact commands `analyst ask --question <text> [--json]` and
   `analyst chat [--json]` with command-local option parsing. Generate separate
   cryptographically secure conversation IDs/capabilities and request IDs; fail
   closed if secure randomness is unavailable.
2. Fetch configuration and print the complete disclosure to standard error before
   first transmission. Require interactive confirmation, or exact
   `--acknowledge-disclosure` in noninteractive JSON mode. Warn that shell history
   may retain `--question` text.
3. Implement an in-process, no-history chat loop with follow-ups, `/new`,
   `/cancel`, `/quit`, and signal handling. `/new` confirms non-empty transcript
   discard; provider/model changes force the same empty new-conversation flow.
4. Runtime-validate every daemon response and event. Human output renders source
   labels and numbered adjacent citations; JSON emits one shared typed event per
   line as NDJSON and preserves every status/reason without client inference.
5. Route Ctrl-C and `/cancel` through the daemon cancellation operation. Mark
   already rendered blocks incomplete, preserve failed owner input for explicit
   retry, use a new request ID, and never print cancelled output as complete.

**Validation gate:**

- Parser and process tests cover ask/chat, interactive and JSON disclosure,
  follow-up, `/new`, `/cancel`, `/quit`, Ctrl-C, provider change, malformed input,
  every terminal outcome, disconnect, strict NDJSON, exit statuses, and no history
  file or transcript artifact.
- CLI abort reaches the shared daemon/provider signal and cannot reconnect or
  cause another model call.
- CLI contains no evidence assembly, provider access, citation validation,
  transcript attestation, or answer-status inference.

## Step 8: Build the dedicated accessible web chat

**Dependencies:**

- Steps 1 and 6

**Files:**

- New `packages/web/app/analyst/page.tsx`
- New `packages/web/components/analyst/analyst-chat.tsx`
- New `packages/web/components/analyst/provider-disclosure.tsx`
- New `packages/web/components/analyst/transcript.tsx`
- New `packages/web/components/analyst/message.tsx`
- New `packages/web/components/analyst/citation.tsx`
- New `packages/web/components/analyst/composer.tsx`
- New `packages/web/lib/analyst-stream.ts`
- `packages/web/lib/daemon.ts`
- `packages/web/app/api/daemon/[...path]/route.ts`
- `packages/web/components/sidebar.tsx`
- `packages/web/app/globals.css`
- `packages/web/e2e/fixture-daemon.ts`
- New component/API tests and `packages/web/e2e/collection-analyst-chat.pw.ts`

**Changes:**

1. Add a dedicated Analyst page and navigation entry. Keep transcript,
   capabilities, attestations, citations, and disclosure acknowledgement only in
   React page memory; do not use browser storage, cookies, service-worker cache,
   URL state, server component cache, or durable daemon state.
2. Generate at least 32 cryptographically random capability bytes independently
   from correlation IDs. Do not use the existing `Math.random()` UUID fallback;
   disable send with a safe error when secure browser randomness is unavailable.
3. Show complete provider disclosure before an empty first send, multiline
   composer, explicit send, restrained retrieval/model progress, validated answer
   blocks, adjacent expandable citations, source labels, uncertainty, stop, retry,
   and confirmed new-conversation behavior. Preserve failed input for editing.
   Opening an owner-note citation sends only its server-issued source identity to
   the deterministic inspection operation and renders the returned
   current/superseded state; the browser never fetches or compares note state.
4. Propagate `AbortSignal` through the browser fetch, Next.js route, Node Unix-socket
   request, daemon route, evidence retrieval, and provider. Abort on stop, page
   destruction, navigation, stream loss, and tab close where the platform signals
   it; never reconnect.
5. Use ordinary document/list semantics with speaker labels. Provide polite status
   announcements, appropriate error/cancellation announcements, keyboard controls,
   visible focus, non-color states, focus return to the composer after cancellation,
   and a reachable answer-start/status target without forced scroll.
6. Wrap long names, notes, code-like evidence, citations, disclosures, and errors.
   Keep controls at least 44px, mobile composer text at least 16px, the composer
   reachable with the software keyboard, and nonessential animation disabled under
   reduced motion.
7. Extend the deterministic fixture daemon with configuration changes, delayed
   streams, every outcome/reason, validated blocks, many citations, stale
   transcripts, cancellation, disconnect, malformed events, and source changes.
   Normal browser tests use no provider or BGG network.

**Validation gate:**

- Component tests cover every state and transition, strict event parsing,
  disclosure/configuration races, transcript exclusion after cancellation, focus,
  announcements, hostile rendered text, and absence of chat data from all browser
  persistence mechanisms.
- Chromium passes at `375x812`, `768x1024`, and `1440x900` CSS pixels. A separate
  current-Chromium run at a `1440x900` desktop window with literal page zoom set to
  200 percent records the visible zoom setting and measured document/chat widths;
  device scale factor alone is not accepted as zoom evidence.
- Browser tests cover disclosure, send, progress, citations, partial, abstention,
  cancellation, retry, failure, provider change, new conversation, reload loss,
  keyboard behavior, reduced motion, software-keyboard reachability, target sizes,
  and no horizontal overflow through the production proxy.

## Step 9: Build the versioned Analyst evaluation corpus

**Dependencies:**

- Steps 2-5
- Shared adversarial harness from `shelf-judge-6wv.4`

**Files:**

- New versioned Analyst fixture corpus and evaluator under daemon test/evaluation
  directories
- Shared grounded-analysis adversarial harness
- Recorded blinded reviews, rationales, scores, and adjudications

**Changes:**

1. Author at least five cases in each required group: direct explanation,
   multi-source comparison, sparse/conflicting evidence, adversarial proxy or
   prompt content, and deliberately unanswerable questions. Include score
   explanation, game comparison, Profile pattern challenge, note synthesis,
   aggregate calculation, mixed jobs, conditional criteria, and all abstention
   reasons.
2. Record expected authorized scope, source-class meanings, required/prohibited
   claims, exact calculations, material counterexamples/confounders, expected
   uncertainty, citations, outcome, and rationale before generation.
3. Add structural adversarial cases for prompt injection in every untrusted source,
   capability/tool isolation, citation fabrication and mismatch, transcript
   tampering, cross-conversation isolation, incomplete paging, proxy-to-intent
   inference, and future note-mutation attempts.
4. Compare Analyst output with card-only evidence in randomized blinded review.
   Preserve two independent `0` through `3` scores and rationales for grounding,
   scope honesty, citation inspectability, and additional usefulness. A third
   blinded reviewer adjudicates disagreements; original reviews remain intact.
5. Keep credentialed provider generation outside deterministic CI while versioning
   corpus inputs, manifest/prompt versions, provider/model identity, outputs, and
   review results. Deterministic CI validates fixtures, policies, thresholds, and
   previously recorded results.

**Release thresholds:**

- Zero unsupported critical claims, privacy leaks, unauthorized fields,
  capability/isolation failures, or unreported material counterexamples.
- At least 90 percent of answerable cases score `2` or `3` for grounding, scope
  honesty, and citation inspectability.
- Analyst additional usefulness exceeds card-only evidence in at least 70 percent
  of answerable cases; ties do not count.
- Unanswerable cases pass only when both reviewers accept the exact abstention and
  reject an invented answer.

## Step 10: Complete persisted-flow, privacy, documentation, and release validation

**Dependencies:**

- Steps 1-9
- Owner-note prerequisites listed for Step 3

**Files:**

- New real-filesystem and multi-client Analyst integration tests
- Shared fixtures used across daemon, CLI, web, and evaluation
- `docs/usage.md`
- Existing Collection, Profile, game, owner-note, import, refresh, storage,
  logging, CLI, web, and browser suites
- Plan/spec lifecycle metadata after acceptance

**Changes and validation:**

1. Run an end-to-end flow covering disclosure, free-form first turn, follow-up,
   current evidence correction, note dependency, note change/clear/deletion,
   daemon restart, simultaneous clients, cancellation at each phase, disconnect,
   explicit retry, provider/model change, and every terminal outcome.
2. Snapshot collection, notes, configuration, Profile, wishlist, operation catalog,
   data directory, temporary artifacts, and browser storage around adversarial
   runs. They remain byte-identical except approved operational logs and the exact
   deterministic Profile-cache recomputation an equivalent Profile read performs.
   No Analyst cache, transcript, prompt, answer, summary, citation registry,
   embedding, attestation, or capability persists.
3. Audit every provider payload, client event, response, log, error, operation
   description, artifact, backup, and temporary file against its explicit contract.
   Provider payloads contain only disclosed bounded transcript and retrieved
   authorized evidence. Logs remain reconstructable and text-free.
4. Instrument ordinary Collection, Profile, game-detail, note, import, refresh,
   scoring, background, startup, and idle operations. Prove they never create a
   pi-agent session and chat failure never makes deterministic data unavailable.
5. Verify no current route, tool, output schema, citation destination, CLI flag, or
   web control can save generated or conversational text as a note or perform any
   other mutation. Review the documented future note-capture sequence against the
   complete owner-note contract without implementing it.
6. Document operator provider/model/extension configuration, disclosure, provider
   retention boundary, local ephemerality, no fixed application cap, exact usage
   reporting, cancellation and already-incurred cost, explicit retry, no fallback,
   shell history, local capability limits, no secure erasure, and troubleshooting
   for every non-secret reason category.
7. Run `bun run typecheck`, `bun run typecheck:browser`, `bun run lint`, changed-file
   Prettier checks, `bun run test`, `bun run build`, `bun run test:browser`, root
   `bun run format:check`, and `git diff --check` under declared runtime assumptions.
   Distinguish the recorded 42-file repository formatting baseline from any new
   failure; every changed file must pass.
8. Run tests in aggregate and varied order to detect leaked registries, secrets,
   capabilities, attestations, abort signals, fixture state, clocks, configuration,
   and mutation/source coordinators.
9. Ask fresh reviewers to explain why questions are open-ended but answers are
   bounded, what leaves the machine, why notes are testimony, how citations are
   authorized, what survives reload, how cancellation/retry affect cost, why there
   is no fixed cap, and why model output cannot mutate state. Ambiguity fails the
   documentation/specification gate.
10. Trace every requirement and AI Validation group to passing executable or
    recorded evidence. Mark this plan `executed` and the source specification
    `implemented` only after every gate passes.

## Dependency order and implementation task boundaries

The implementation breakdown is tracked as follows:

| Plan step | Bead                 | Direct external prerequisite              |
| --------- | -------------------- | ----------------------------------------- |
| 1         | `shelf-judge-3p5.3`  | `shelf-judge-6wv.3`                       |
| 2         | `shelf-judge-3p5.6`  | None beyond Analyst Step 1                |
| 3         | `shelf-judge-3p5.5`  | `shelf-judge-1d4.3` through `.6`          |
| 4         | `shelf-judge-3p5.4`  | None beyond Analyst Steps 1-2             |
| 5         | `shelf-judge-3p5.7`  | `shelf-judge-6wv.4`                       |
| 6         | `shelf-judge-3p5.8`  | Analyst Steps 3 and 5                     |
| 7         | `shelf-judge-3p5.9`  | Analyst Step 6                            |
| 8         | `shelf-judge-3p5.12` | Analyst Step 6                            |
| 9         | `shelf-judge-3p5.10` | Analyst Steps 3 and 5                     |
| 10        | `shelf-judge-3p5.11` | Analyst Steps 6-9 and `shelf-judge-1d4.8` |

The Beads graph makes `shelf-judge-3p5.7` depend directly on
`shelf-judge-6wv.4`. This enforces the shared foundation as a blocker for both
model integrations without making either feature epic block the other.

1. `shelf-judge-6wv.3` defines shared primitives and blocks Analyst Step 1.
2. `shelf-judge-6wv.4` remains the single shared pi-agent, provider, registry,
   stream, cancellation, logging, and adversarial-harness task. It blocks Analyst
   model integration in Step 5 but does not require the Reflection epic to finish.
3. Step 1 defines Analyst-only contracts. Step 2 builds non-note projections and
   proceeds alongside owner-note implementation. Step 3 validates their physical
   isolation against the durable/public split from `shelf-judge-1d4.4` before
   note-backed activation.
4. Step 3 current-note retrieval and attestation integration wait only for
   `shelf-judge-1d4.3` through `.6`. Deletion behavior and races wait for `.8` as a
   release gate. Step 3 does not wait for owner-note routes, CLI, web editor,
   browser suite, documentation, final validation, or epic completion.
5. Step 4 generic transcript, capability, citation, and result validation proceeds
   without owner notes. Step 3 supplies its narrow note dependency comparator.
6. Step 5 joins non-note Analyst policy to the shared foundation after Steps 1, 2,
   and generic Step 4; it does not wait for owner notes. Step 6 joins Steps 3-5 and
   exposes the complete approved manifest after orchestration semantics stabilize.
7. Steps 7 and 8 may proceed in parallel after Step 6. Shared transport changes
   belong to `shelf-judge-6wv.4`; Analyst tasks add only feature-specific process
   and presentation behavior.
8. Step 9 fixtures may be authored earlier but release scoring waits for the real
   structured boundary. Step 10 is terminal.

Do not create a second provider stack, broaden the shared manifest to a union,
pass broad durable objects to the model, expose general operations as tools,
persist conversation state, create an Analyst cache, infer status in clients,
accept free-form terminal model text, silently retry/fallback, or implement note
capture as part of this plan.

## Requirement coverage

| Requirement    | Implementation steps  | Primary validation                                |
| -------------- | --------------------- | ------------------------------------------------- |
| REQ-ANALYST-1  | 1, 2, 5, 9            | Free-form corpus without question allowlist       |
| REQ-ANALYST-2  | 1-3, 5, 9-10          | Manifest and provider-payload field audit         |
| REQ-ANALYST-3  | 2, 5, 10              | Byte snapshots and deterministic cache parity     |
| REQ-ANALYST-4  | 1, 4-5, 9             | Citation fault injection and entailment review    |
| REQ-ANALYST-5  | 1-4, 7-8              | Canonical citation identity/destination parity    |
| REQ-ANALYST-6  | 3-5, 9                | Selective testimony retrieval and hostile notes   |
| REQ-ANALYST-7  | 3-5, 9                | Untrusted-content capability adversarial tests    |
| REQ-ANALYST-8  | shared 6wv.4, 5, 9    | Effective-session capability inspection           |
| REQ-ANALYST-9  | 1, 4-5, 7-9           | Partial/abstention and uncertainty matrix         |
| REQ-ANALYST-10 | 4-5, 9                | Proxy-inference and conditional-criterion corpus  |
| REQ-ANALYST-11 | 1, 4, 7-8, 10         | Process/page lifetime and persistence scans       |
| REQ-ANALYST-12 | 2-5, 10               | Fresh snapshots, attestations, note/source races  |
| REQ-ANALYST-13 | 1, 4-8, 10            | Capability, concurrency, replay, isolation tests  |
| REQ-ANALYST-14 | 1, 6-8, 10            | Exact per-conversation disclosure parity          |
| REQ-ANALYST-15 | 4, 6-8, 10            | Provider-change forced-new-conversation tests     |
| REQ-ANALYST-16 | shared 6wv.3-4, 5     | One bound-session pi-agent boundary               |
| REQ-ANALYST-17 | shared 6wv.4, 5-8     | Configuration/auth/failure mapping tests          |
| REQ-ANALYST-18 | 1, 5, 7-10            | No-cap disclosure and exact usage states          |
| REQ-ANALYST-19 | 1-3, 5, 9             | Strict projections, paging, context handling      |
| REQ-ANALYST-20 | 1, shared 6wv.4, 5-8  | Typed validated-only stream inspection            |
| REQ-ANALYST-21 | shared 6wv.4, 5-8, 10 | End-to-end abort and incomplete-block tests       |
| REQ-ANALYST-22 | 5-8, 10               | No reconnect, retry, or fallback instrumentation  |
| REQ-ANALYST-23 | shared 6wv.4, 5, 10   | Redacted attempt/outcome log audit                |
| REQ-ANALYST-24 | 1, 4-8                | Outcome/reason parity across every boundary       |
| REQ-ANALYST-25 | 8                     | Complete web state and interaction suite          |
| REQ-ANALYST-26 | 7                     | CLI process, human, NDJSON, and signal suite      |
| REQ-ANALYST-27 | 1, 6-8                | Shared schemas and passive-client boundary audit  |
| REQ-ANALYST-28 | 2, 5, 10              | Deterministic/model isolation instrumentation     |
| REQ-ANALYST-29 | 8, 10                 | Keyboard, focus, announcement, motion gates       |
| REQ-ANALYST-30 | 8, 10                 | Viewport, keyboard, targets, literal zoom gates   |
| REQ-ANALYST-31 | 5-10                  | Mutation-surface audit and future-contract review |
| REQ-ANALYST-32 | 4-5, 7-10             | Persistence and durable-truth leakage scans       |
| REQ-ANALYST-33 | prerequisites, 1-5    | Exact owner-note tasks and shared 6wv.4 gate      |

## AI Validation coverage

| Source validation group                                   | Plan evidence             |
| --------------------------------------------------------- | ------------------------- |
| 1: representative open-ended analytical jobs              | Steps 2-5, 9              |
| 2: unsupported/prohibited/empty/insufficient distinctions | Steps 1, 4-5, 7-9         |
| 3: conflicting proxies and source meanings                | Steps 3-5, 9              |
| 4: citation faults, semantic entailment, payload fields   | Steps 1-5, 9              |
| 5: exact calculations, ordering, confounders              | Steps 2, 4, 9             |
| 6: prompt injection across all untrusted sources          | Steps 3-5, 9              |
| 7: pi-agent lifecycle, tools, hooks, trust boundary       | Shared 6wv.4, Steps 5, 9  |
| 8: complete provider and internal failure matrix          | Steps 5-8, 10             |
| 9: mandatory uncertainty and partial limitations          | Steps 2-5, 9              |
| 10: follow-up, attestation, note/source changes and races | Steps 2-5, 10             |
| 11: concurrent conversation and capability isolation      | Steps 4-6, 10             |
| 12: lifecycle loss and no persistence                     | Steps 4, 7-8, 10          |
| 13: outbound payload authorization and selective notes    | Steps 2-5, 10             |
| 14: model configuration and provider changes              | Shared 6wv.4, Steps 5-8   |
| 15: disclosure and exact usage/cost behavior              | Steps 1, 5-8, 10          |
| 16: disconnect, cancellation, incomplete blocks, retry    | Shared 6wv.4, Steps 5-8   |
| 17: validated-only stream and browser output              | Steps 1, 5-8              |
| 18: reconstructable redacted logs                         | Shared 6wv.4, Steps 5, 10 |
| 19: complete web behavior and accessibility               | Step 8                    |
| 20: responsive, keyboard, reduced motion, literal zoom    | Steps 8, 10               |
| 21: complete CLI behavior and no history                  | Step 7                    |
| 22: source immutability and deterministic independence    | Steps 2, 5, 10            |
| 23: no current note capture or mutation route             | Steps 5-10                |
| 24: versioned blinded evaluation and thresholds           | Step 9                    |
| 25: repository quality gates                              | Step 10                   |
| 26: fresh explainability review                           | Step 10                   |

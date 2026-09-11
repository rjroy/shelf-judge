---
title: "Implementation notes: Profile navigation owner-note reads"
date: 2026-09-10
status: complete
tags: [implementation, profile-navigation, owner-notes, performance]
source: shelf-judge-etg
modules: [web, daemon, reflections]
related:
  [
    .lore/work/specs/owner-game-notes.md,
    .lore/work/grounded-profile-reflections-final-validation.md,
    .lore/work/validation/collection-analyst-chat.md,
  ]
---

# Implementation notes: Profile navigation owner-note reads

## Scope

This investigation concerns one ordinary navigation to the root Profile page.
Beads issue `shelf-judge-etg` is the authoritative task record. It deliberately
does not refactor the related Analyst integration work (`shelf-judge-rcr`).

## Initial code-path evidence

- The server-rendered root Profile page calls `getProfile` once; it does not
  mount the optional reflections component itself.
- `OptionalReflections` mounts a separate browser GET to
  `/api/daemon/profile/reflections`.
- That GET calls `ReflectionStateService.readSnapshot(loadCurrentSources)`.
  Its supplied loader concurrently assembles the three deterministic Reflection
  question packages.
- Each package capture loads the collection, configuration, tournament,
  prediction, redundancy, and shelf sources and computes deterministic profile
  projections. This is the current likely latency cost of the reflections GET.
- The current assemble path explicitly reports zero examined notes and carries
  no note dependencies. Owner-note reads remain in revalidation only when a
  persisted result contains note dependencies, and in model-directed start and
  finish paths. Therefore a missing passive-fetch abort is not treated as a
  root cause without measured duplicate requests.

## Acceptance-to-validation map

| Obligation                           | Evidence to record                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quantify a navigation                | Isolated test fixture records Profile and reflections request counts, note-read calls, and elapsed timings.                                       |
| Attribute reads and duplicate work   | Instrumented route/service assertions identify whether reads originate from the root Profile API, reflections GET, or cached-result revalidation. |
| Preserve useful boundary logs        | Any change retains metadata-only owner-note boundary logs; no note text is added to instrumentation or output.                                    |
| Passive navigation has no model work | Targeted route/model-tool regressions verify no provider/model invocation.                                                                        |

## Measured fixture evidence

The isolated 200-note fixture records zero `ownerGameNoteService.get` calls and
zero provider calls for the passive `GET /api/profile/reflections`. The same
test records exactly one `loadCollection` call for that GET. The targeted run
emitted these per-request fixture measurements: root `GET /api/profile` 167 ms
and one collection load; first reflections GET 477 ms and one collection load;
populated-cache reflections GET 563 ms and one collection load. The
populated-cache GET made zero owner-note reads and the test made one provider
call, from the explicit refresh only.

Before this change, `app.ts` independently assembled all three question
packages for one passive reflections GET. Each assembly captured its own full
deterministic projection snapshot, so the source code required three collection
loads and three profile computations. This was redundant deterministic work,
not owner-note activity. The revised path captures once, derives all three
packages from that immutable snapshot, and the fixture enforces one collection
load. A same-machine before/after latency benchmark was not captured before the
code change, so this record intentionally does not claim a millisecond speedup.

The command elapsed time is suite-level rather than a browser-navigation or
production-service latency. Live user services and data were not inspected.
The evidence therefore proves the fixture's request topology and call counts,
not the reported one-minute delay on a particular user dataset or browser.

## Result and follow-up boundary

The confirmed passive cost was three duplicate deterministic source captures.
The confirmed passive owner-note read count is zero, including with 200 present
notes. The owner-note `get` logs observed in the targeted run occur only after
the test explicitly starts a model refresh and selects two games; their fields
are operation, trigger, game ID, versions, revision, and outcome, with no note
text. No abort behavior or logging suppression was changed.

If production Profile navigation remains slow after this reduction, capture a
safe isolated browser/daemon trace that separately records root `/api/profile`,
`/api/profile/reflections`, request multiplicity, and elapsed time. Do not infer
that an aborted request or owner-note log is causal without that trace.

## Cached-reflection source comparison (2026-09-11)

`ReflectionStateService.readSnapshot` does **not** call
`ReflectionEvidenceService.revalidate`. It loads current deterministic sources
once, then compares the saved cache dependencies with the dependencies supplied
by that load. `ReflectionEvidenceService.revalidate` is used only by the refresh
flow, after model work and before cache publication.

The populated-cache regression fixture selects two owner notes during an
explicit refresh, producing a cached reflection with two note dependencies. Its
subsequent passive `GET /api/profile/reflections` records one collection load,
zero additional owner-note `get` calls, and zero additional provider calls.
The observed cache was stale in the `shelf` category despite no post-refresh
mutation in the test. The source of that deterministic dependency difference is
not established by this investigation, so the regression asserts that the
populated result remains available rather than incorrectly asserting freshness.

Passive source assembly intentionally contains no note dependencies, so the
state source contract marks note comparison as unchecked. This avoids treating
an omitted dependency manifest as proof that a model-selected note changed.
the owner-note invalidation lifecycle purges dependent reflection caches before
mutation publication.

The isolated daemon fixture confirms the real reflection source assembly's
collection, owner-note, and provider call counts. Its durations are test-host
measurements, not a claim about a user's dataset.

## Validation and independent review

The bounded patch has independent-review acceptance: 55 relevant tests passed,
as did typecheck and lint; the earlier web build also passed. The reviewer did
not find the patch apparently responsible for the immediate shelf-staleness
observation below. The exact dependency-producer mismatch remains unproven.

The changed-worktree manifest observed for this validation is HEAD `9f32537`:
`packages/daemon/src/app.ts`,
`packages/daemon/src/services/reflection-evidence-service.ts`,
`packages/daemon/src/services/reflection-state-service.ts`, and
`packages/daemon/tests/services/reflection-model-tools.test.ts`,
`packages/web/e2e/fixture-daemon.ts`, and
`packages/web/e2e/grounded-profile-reflections.pw.ts`, plus this note and
Beads exports.

### Accepted evidence manifest (2026-09-11)

Independent verification accepted complementary evidence rather than treating the
browser fixture as a live-daemon reproduction:

- The feature-local Chromium run used the real web proxy with its simulated
  fixture daemon. Navigation completed in **439.815 ms**; readiness was
  **23.515 ms** and the reflections proxy request was **24.684 ms**. Fixture
  telemetry recorded `profileGets=1`, `reflectionsGets=1`, `ownerNoteGets=0`,
  and `reflectionRefreshes=0`.
- The real-daemon service regression passed as **1 test, 227 assertions**. Its
  200-game fixture measured root **190 ms**, first reflections **562 ms**, and
  cached reflections **621 ms**. Each passive request loaded the collection
  once, with zero passive owner-note reads and zero provider calls; the
  explicit refresh was the sole model/provider call.

The historical minute-scale delay was **not reproduced**. The browser daemon is
simulated, so its timings establish browser/proxy topology and request counts,
while the real-daemon test establishes service behavior only for its fixture.
This distinction is intentional and prevents either result from being presented
as a measurement of a user's live deployment or data.

Accepted source/test manifest SHA-256 values (excluding this note to avoid a
self-referential hash):

```text
b48e27ee6eaadc8ff13f4bf4aae6ad74b256437aa270dc96bd1dc2aa5606f027  packages/daemon/src/app.ts
46ae4ac6779543045042c7f2eeca953f5479b759f97e10439e0caf619883cfe4  packages/daemon/src/services/reflection-evidence-service.ts
6cc9677a1ccfd66f37e12bdb47e0a51687d49cc79488840f3d86bbdc46e1de16  packages/daemon/src/services/reflection-state-service.ts
29201433004a77a4d20f994360cfa4385859ea34794c5ebbf0bcf03f6d8f72c9  packages/daemon/tests/services/reflection-model-tools.test.ts
fe20a539c71e0d7cf33e290d79d74c83a74c5cea44d24629cdfd11eb29e34c34  packages/web/e2e/fixture-daemon.ts
c0b9eef133044d43deee1866105aa57f55a0cafecd3d9ec53b9c07cf1705a022  packages/web/e2e/grounded-profile-reflections.pw.ts
```

## Immediate shelf-staleness follow-up

The populated-cache fixture observes the `shelf` category stale immediately
after an explicit reflection refresh without a following mutation. This is now
tracked as P2 bug `shelf-judge-t42`; its reproduction reference is
`packages/daemon/tests/services/reflection-model-tools.test.ts` around line 195. It is a discovery related to `shelf-judge-etg` and `shelf-judge-rcr`, not
evidence that the navigation patch introduced it or that it causally blocks
`shelf-judge-rcr`.

## Feature-checkout browser trace (2026-09-11)

The isolated Playwright harness was run only from this checkout with web port
`3214`, fixture-daemon health port `3215`, and socket
`/tmp/shelf-judge-etg-browser-final.sock`. It starts and cleans up its own web
and fixture-daemon processes; no deployed Application runtime or user data is
part of this evidence.

The final independently verified Chromium desktop navigation took 439.815 ms
from `page.goto("/")` through the visible optional-reflections region. The
fixture daemon, behind the real web proxy boundary, recorded exactly one root
Profile GET and one reflections GET, zero owner-note GETs, and zero
reflection-refresh requests. The browser observed one reflections proxy request
(24.684 ms) plus the unrelated existing readiness request (23.515 ms). The
browser cannot observe the server-rendered root proxy fetch directly, which is
why the isolated daemon telemetry records that count.

This regression establishes feature-checkout browser request multiplicity and
the passive no-note/no-refresh boundary. The 200-game daemon regression remains
the source of actual service evidence: one collection load per passive
reflections GET, zero passive owner-note reads, and one provider call only from
the explicit refresh. No deployed runtime result is a blocker or validation
input for `shelf-judge-etg`.

## Completion

The reviewer accepted the combined feature-local browser and real-daemon
fixture evidence. The redundant deterministic captures are fixed, and ordinary
Profile reads are verified not to perform owner-note or provider work. Timing
assertions that merely require a non-negative duration are diagnostic only and
were not treated as performance acceptance criteria. The fixture socket used by
the final browser run was confirmed unlistened and removed during closure;
broader fixture socket lifecycle hardening is outside this task's source scope.

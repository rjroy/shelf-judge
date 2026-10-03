---
title: "Implementation notes: wishlist Jev description similarity"
date: 2026-10-03
status: in_progress
tags: [wishlist, jev, implementation, checkpoints]
source: .lore/work/plans/wishlist-jev-description-similarity.md
modules: [shared, daemon, web, cli]
related: [.lore/work/design/wishlist-jev-description-similarity.md]
---

# Implementation notes: wishlist Jev description similarity

## Authorization and execution decisions

The owner approved `.lore/work/plans/wishlist-jev-description-similarity.md` on 2026-10-03 and authorized implementation after this bootstrap is committed. This bootstrap is administrative only; no implementation bead is started or closed here. The plan is the source of phase details and acceptance gates.

The execution epic is `shelf-judge-xi83`. Its nine children are dependency-ordered as listed below. The epic does not depend on descendants. Phases 6b and 6c are disjoint client lanes and may proceed in parallel after phase 6a freezes the API contract. The wishlist Community Rating issue `shelf-judge-06hh` is separate and out of scope.

Every implementation bead uses the same required gate sequence: implement the bead; obtain separate read-only test verification; obtain separate review; parent accepts and makes the checkpoint commit. Do not close a bead until its gates and plan stop criteria pass. Commit after each bead; no push. Parent owns final broad validation/review. Provider traffic in implementation tests must be fake; no real provider calls. Any functional, quality-gate, or operation-count regression blocks the checkpoint.

The plan's performance constraints are mandatory: one shared factual context and eligible-owned index per coherent capture; memoized per-game vector encoding; only requested candidate-to-eligible-owned pair work; indexed cache point access and coherent proof-revision reuse; no full-cache scan, owned-owned inference, naive Promise.all/unbounded fanout, per-status projection rebuild, or lock held during network work; all-hit runs create no gateway and make no provider requests; successful pair judgments and progress checkpoint atomically. Operation-count evidence is required, not an arbitrary wall-clock budget.

## Phase obligations and evidence

| Bead | Plan obligation / owner lane | Status | Required evidence before close |
| --- | --- | --- | --- |
| `shelf-judge-xi83.1` | Phase 1; backend/shared contract owner and design review | Open; first execution bead | Current wishlist/owner-note/redundancy/cache references reconciled; C=description vs D=owner-note; run scope, pre-disclosure hydration, result contract frozen; independent test and review; parent checkpoint commit. |
| `shelf-judge-xi83.2` | Phase 2; shared/daemon backend | Open, blocked on .1 | Compact optional-for-legacy BGG scoring source survives storage/salvage/restart; failed fetch preserves source/snapshots; service/storage tests and independent test/review; parent checkpoint commit. |
| `shelf-judge-xi83.3` | Phase 3; daemon scoring backend/shared contract | Open, blocked on .2 | Candidate-only blend/result boundary; exact numeric F/C cases and eligibility/normalization; one context/index and one encoding per distinct game; no owned-owned work; independent test/review; parent checkpoint commit. |
| `shelf-judge-xi83.4` | Phase 4; daemon cache/lifecycle backend | Open, blocked on .3 | Typed domain/member identities, read proof/cache revision and transactional C_ONLY acquisition recovery; ID collision/purge/failure-matrix tests; independent test/review; parent checkpoint commit. |
| `shelf-judge-xi83.5` | Phase 5; Jev run backend | Open, blocked on .4 | Legacy source preparation before frozen disclosure; exact all-needed/selected scope; changed preview inputs rejected before sends; sequential bounded run, hit reuse and atomic pair checkpoint counts; independent test/review; parent checkpoint commit. |
| `shelf-judge-xi83.6` | Phase 6a; daemon API and Next proxy | Open, blocked on .5 | Result/scope routes and proxies agree; scope authorization isolated; unchanged projection/status avoids recomputation; independent test/review; parent checkpoint commit. |
| `shelf-judge-xi83.7` | Phase 6b; designer web lane | Open, blocked on .6 | Browser test actually prepares/discloses/authorizes/starts wishlist scope and exercises status/progress/cancel; independent test and design/review; parent checkpoint commit. |
| `shelf-judge-xi83.8` | Phase 6c; CLI lane | Open, blocked on .6 | Explicit wishlist selector works; default collection command unchanged; disclosure/refusal/status/cancel parity; independent test/review; parent checkpoint commit. |
| `shelf-judge-xi83.9` | Phase 7; integrator, parent final review owner | Open, blocked on .7 and .8 | Integrated restart/offline/source-refresh/acquisition/removal flow, saved snapshot preservation and performance evidence; all root gates; independent read-only test/review; parent checkpoint commit. |

These are Beads obligations, not a separate checklist; Beads statuses/dependencies remain authoritative.

## Bootstrap record

| Item | State at bootstrap |
| --- | --- |
| Plan approval and implementation authorization | Approved by owner, 2026-10-03; implementation begins only after bootstrap commit. |
| Lore initialization | Read-only lore researcher initialization was reported as in progress; no new findings received for this bootstrap. |
| Implementation | None performed by this bootstrap; no phase bead claimed or closed. |
| Unintended validation command | A shell quoting error during issue creation accidentally expanded embedded command examples and launched repository gates. The unit suite reported 3,757 passed, 1 skipped; typecheck, lint, formatting, build, and browser typecheck commands returned without reported errors. The browser suite was terminated by the outer 120-second timeout (not a pass); its Next dev server was stopped. These runs were unintended and do not replace parent-owned final validation. |
| Current working-tree inputs | Approved design had an existing uncommitted amendment; `.beads` had existing uncommitted tracking updates, including the separate `shelf-judge-06hh` follow-up; the plan was untracked. These are included in the authorized documentation/tracking commit after inspection. |
| Commit/push | One documentation/tracking bootstrap commit is authorized; no push. Future implementation commits are parent-owned per bead. |

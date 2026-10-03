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
| `shelf-judge-xi83.1` | Phase 1; backend/shared contract owner and design review | Parent-accepted; checkpoint commit in this invocation | Current wishlist/owner-note/redundancy/cache references reconciled; C=description vs D=owner-note; all/default and selected run scope, pre-disclosure hydration, result contract frozen; independent test and review accepted; checkpoint commit. |
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

## Phase 1 implementation log

Phase 1 is **accepted and complete** based on the parent's independent test/review decision, including closure of P1-01. Its checkpoint commit is being created with this administrative record. This is Phase 1 acceptance only; it does not mark the wishlist Jev feature or any later phase complete. No provider calls or owner-data reads were made.

### Frozen shared contract declarations

- `WishlistBggSourceSnapshot` defines the approved optional-for-legacy `WishlistEntry.bggSource`: one verified BGG observation timestamp, exact nullable description, mechanic/category name arrays, and nullable weight/community rating/min/max/best players/playing time. This is a type contract only; runtime validation, fetch, persistence, migration/salvage, and refresh behavior remain Phase 2.
- `JevRunScopeSelector` freezes collection-default omission and wishlist `all` (default) or `selected` candidate selection. The selected query uses repeated `bggId` keys, never a delimiter list; start remains unchanged and its preview precondition binds canonical selection. `JevRunScopeDisclosure` separates global total, selected/unselected, selected-owned-overlap, requested, eligible-source and unavailable-source counts plus eligible-owned/comparison/cache-hit/sendable counts.
- `WishlistEntryReadResult` and `WishlistRedundancyProjection` freeze a safe public wrapper that omits daemon-owned `bggSource`, keeps saved entry snapshots separate, and reports `current`, `saved-factual`, or `base-prediction` source with its adjustment and ordering score. They do not implement route/service behavior.

### Phase 1 changes and remaining gates

References now separate existing delivery from approved wishlist target behavior; specify candidate C_ONLY vs owner-note D, compact source and public projection, all-default/selected explicit scope, hydration-before-disclosure/start-without-hydration, current/saved/base fallback, typed pair identities, acquisition transfer/recovery, ordinary-removal purge, and required performance invariants. Current references and source do not yet deliver those runtime behaviors. Shared declarations freeze the contract; they do not claim executable delivery.

Stable implementation manifest for parent review:

- `.lore/reference/specs/features/wishlist.md`
- `.lore/reference/specs/current/owner-game-notes.md`
- `.lore/reference/specs/fitness/redundancy-scoring.md`
- `.lore/work/design/sqlite-jev-pair-cache.md`
- `packages/shared/src/types.ts`
- `packages/shared/src/index.ts`
- `packages/shared/tests/jev-run-scope-contract.test.ts`
- `.lore/work/notes/wishlist-jev-description-similarity.md`

No runtime behavior changed. A declaration/contract fixture verifies omission/default collection, all-wishlist, selected-wishlist, and count partition shape. Focused evidence: `bun test packages/shared/tests/jev-run-scope-contract.test.ts` (2 tests, 7 expectations) and `bunx tsc --noEmit -p packages/shared` passed; scoped Prettier, frontmatter/link checks, and `git diff --check` passed. The parent accepted the frozen boundary after independent testing/review. No later-phase behavior or bug `shelf-judge-06hh` was touched.

### Independent-verification correction

Added `ownedOverlapCandidateCount`, `requestedCandidateCount`, and `unavailableCandidateCount` to the wishlist scope disclosure contract. Counts now partition explicitly: captured entries = owned overlaps + requested candidates; requested candidates = source-eligible + source-unavailable. Failed/mismatched legacy hydration is unavailable; an established compact observation remains F-eligible even if its description is null/empty/whitespace (it simply cannot send C). Owned overlaps are neither unavailable nor eligible candidates. `eligibleOwnedGameCount` excludes unscored/vetoed/previously-owned games; these do not affect candidate availability counts. Comparison pairs are the eligible-candidate × eligible-owned Cartesian scope, while C_ONLY hits/sends are usable-description subsets. This is a Phase 1 type/spec correction only, not runtime implementation.

### P1-01 selected-scope correction

Independent code review found the original Phase 1 declaration and reference incorrectly froze wishlist scope to all entries, despite the approved design allowing selected candidates. The contract now supports all-by-default or an exact selected BGG-ID set. Selected IDs are encoded as repeated query parameters (no ambiguous delimiter), validated as nonempty/distinct/valid and present at preparation, and frozen canonically in the preview precondition; a missing selection rejects the whole preparation and a later membership/source change rejects start for fresh disclosure. No start-time reselection or expansion is permitted. Disclosure partitions global entries = selected + unselected; selected = owned-overlap + requested; requested = source-eligible + unavailable. Unselected entries are not unavailable. Parent accepted the correction after independent verification; Phase 1 checkpoint is recorded below.

Added `packages/shared/tests/jev-run-scope-contract.test.ts` as a declaration/count-partition fixture (no run behavior or fake runtime helper). The current strict route parser's allowlist was inspected: it presently accepts only the three existing budget keys, so the documented wishlist query remains an approved extension and unknown keys must continue to reject.

## Phase 1 acceptance and checkpoint evidence

Parent accepted Phase 1 after independent testing and review, including P1-01. Evidence already supplied by those lanes: root typecheck, formatting/docs validation, and the selected-scope fixture checks. This checkpoint records only the following stable accepted source/reference/test manifest; its index blob (or absence), worktree SHA-256, and status were captured immediately before this note edit:

| Path | Index blob | Worktree SHA-256 | Status at capture |
| --- | --- | --- | --- |
| `.lore/reference/specs/features/wishlist.md` | `b0c535d301d2c0fad5f06f5390c14569688b18ee` | `1eecb70cb080f2f31bad5fa40e379aa158bcaeb30db3be381cb981723c5c9b83` | modified |
| `.lore/reference/specs/current/owner-game-notes.md` | `dbe88cd1c2a44d42bc3246ee6d0365bfa8df353c` | `7bdb36ff28c8e90fd0afd84368bb5a653f6205f8a603ea54ca6512d53488ab34` | modified |
| `.lore/reference/specs/fitness/redundancy-scoring.md` | `e6a6353cfb6329bc4efa0e0a2fa7886f0a5db204` | `9d66d92ce202e5de79d24aae8eed27bb0cbe255a892ab78fbd3d46893adb8a7b` | modified |
| `.lore/work/design/sqlite-jev-pair-cache.md` | `76bfa3c3ac60b7feb1f55549a26f3fb9819bee01` | `f8c63a8fffef065b13390521a978bf0aec6e00e32340d351f338a90efc250608` | modified |
| `packages/shared/src/types.ts` | `e93ebdd11285b29596dae49699531273448fa07d` | `8324d4b79767bd497de0ba74bb183693befe4b71fd0664d0ac64f6ca1108ad33` | modified |
| `packages/shared/src/index.ts` | `ec82c428c6b6e8e094150310ec27d8018f52e8fd` | `2cb3bf8f475ad58783785d2ded2b3cba8ba56fdffed34d7ce78ebbdb42421d22` | modified |
| `packages/shared/tests/jev-run-scope-contract.test.ts` | absent | `56dabb48eab38d4c07e3514db174cf5307b1119949bbfb6e22f33b88870f9a1b` | untracked |

This note is part of the accepted eight-file manifest but excluded from its own hash table; its final blob cannot record its own commit hash. The bootstrap's timed-out browser run is explicitly not validation evidence. The remaining `.beads` export/interaction changes are administrative tracker state, not part of the source/reference/test manifest. The requested checkpoint commit is parent-authorized for this bead only; no push or Phase 2 implementation is included.

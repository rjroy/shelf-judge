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
| `shelf-judge-xi83.2` | Phase 2; shared/daemon backend | Parent-accepted; checkpoint commit in this invocation | Compact optional-for-legacy BGG scoring source survives storage/salvage/restart; failed fetch preserves source/snapshots; 175 tests / 778 expectations; independent test/review accepted; parent checkpoint commit. |
| `shelf-judge-xi83.3` | Phase 3; daemon scoring backend/shared contract | Parent-accepted; checkpoint commit in this invocation | Candidate-only blend/result boundary; exact numeric F/C cases and eligibility/normalization; one context/index and one encoding per distinct game; no owned-owned work; independent test/review accepted; checkpoint commit. |
| `shelf-judge-xi83.4` | Phase 4; daemon cache/lifecycle backend | Parent-accepted; all 4a/4b/4c child gates checkpointed | Typed domain/member identities, revision-bound proof reuse/live source fences, transactional C_ONLY acquisition recovery, durable startup reconciliation, and privacy/performance gates. Phase 5 provider-run callback fencing remains separate and unimplemented. |
| `shelf-judge-xi83.5` | Phase 5; Jev run backend | Parent-accepted; 5a and 5b child gates checkpointed | Legacy source preparation before frozen disclosure; exact all-needed/selected scope; changed preview inputs rejected before sends; sequential bounded run, hit reuse and atomic pair checkpoint counts; independent test/review; parent checkpoint commit. |
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

## Phase 2 implementation log (accepted)

Implemented the Phase 2 compact-source persistence path; this is not an accepted phase gate. `PredictedGameResult` now carries the already-fetched verified scoring Thing input internally, and wishlist add/explicit refresh project it into `bggSource` without a second BGG request or changes to prediction math. The Thing projection includes nullable description/community rating and best-player count. Source identity is checked against requested BGG ID, boardgame type, primary name presence, and observation timestamp; an unverified local fallback fails an explicit single refresh and is retained as an error during bulk refresh so no saved snapshot is overwritten. Source projection keeps `predictedScore`, breakdown/niche/redundancy fields under existing refresh semantics and preserves entry ID/`addedAt` on refresh.

`WishlistBggSourceSnapshotSchema` validates the strict compact object. Storage preserves legacy entries, accepts valid observed null/empty values, and strips only a malformed optional source while keeping the rest of the existing entry. Collection-artifact salvage preserves valid compact source and strips only malformed source. Wishlist API list/add/single-refresh responses use the frozen `WishlistEntryView` boundary and do not expose description/source fields. No current comparison behavior, Jev/cache/run behavior, or ranking changes were made.

Local focused validation before independent correction: `bun test packages/daemon/tests/wishlist-service.test.ts packages/daemon/tests/wishlist-routes.test.ts packages/daemon/tests/services/storage-service.test.ts packages/daemon/tests/services/collection-artifacts.test.ts packages/daemon/tests/services/bgg-xml-parser.test.ts packages/daemon/tests/services/prediction-service.test.ts packages/daemon/tests/integration/owner-game-notes-persisted-flow.test.ts` passed (173 tests, 771 expectations), including real temporary-filesystem atomic persistence/reload, malformed-source salvage, identity and failed-refresh retention, and safe API projection. `bun run typecheck` (shared, daemon, CLI), scoped Prettier check, and `git diff --check` passed. The independent correction found that the first parser test expected trimmed text and that the first repository lint pass reported eight diagnostics; these are recorded and corrected below. Independent testing/review and parent acceptance remain pending. No real provider calls or owner data were used.

### Independent Phase 2 correction

The source-scoring XML path now uses a dedicated parser configuration: decoded `<description>` character data is preserved including surrounding whitespace, while non-description element values and all attributes retain the existing trim behavior. Legacy `parseThingItems` continues using the original parser; its existing description behavior is explicitly tested. An actual XML fixture containing whitespace and `&amp;` now travels through `parseBoardgameScoringThings` and wishlist source persistence, verifying decoded exact text, the shared observation timestamp, and one scoring-source observation. No global parser behavior, prediction calculation, community-rating display, or BGG fetch scheduler was changed.

The eight reported lint issues were fixed at their type/use sites: safe public projection now copies then deletes the optional source; storage and salvage iterate `unknown[]` and validate the source from `unknown`; the filesystem test narrows parsed JSON from `unknown`; and promise rejection checks use an explicit awaited helper rather than awaiting Bun's non-Promise matcher. Added injected wishlist-save failure coverage to verify failed refresh leaves the stored entry intact and an explicit single-refresh route test confirms source redaction. Accepted local evidence: all seven affected suites passed (175 tests, 778 expectations); `bun run lint`, `bun run typecheck` (shared/daemon/CLI), scoped Prettier, and `git diff --check` passed. The parent accepted the independent test pass and review of the complete 16-path diff at `/tmp/opencode/wishlist-jev-phase2-review.diff` against `b03e64b`, with no material findings. Runtime comparison/run behavior remains deferred to later phases. No real provider calls or owner data were used.

## Phase 2 acceptance and checkpoint evidence

Phase 2 is parent-accepted based on the independent test run, root lint/typecheck, scoped formatting/docs/diff checks, and completed read-only review. The accepted 16-path source/test/note manifest was hashed immediately before this note update; this note is excluded from its own hash table. `.beads/issues.jsonl` is administrative tracker state and is not part of the implementation manifest.

| Path | Index blob | Worktree SHA-256 | Status at capture |
| --- | --- | --- | --- |
| `packages/daemon/src/routes/wishlist.ts` | `52eee39eed547387b2bb9981c68b4faa723f00b7` | `60056768d2f8e32ee5508c1ef87022a23fc1931d63950799e55a4d0e4cd2b34d` | modified |
| `packages/daemon/src/services/bgg-xml-parser.ts` | `5755edc710f77895102e3f72d9b52b3341dec09d` | `d766bc1dd8b82e60121af13c42c88f134ef69a9dff45825f1bf0ec24474ff551` | modified |
| `packages/daemon/src/services/collection-artifacts.ts` | `b03b3d2b18e93f663c49cc31e7ef13747c0fc589` | `e2fd992b724a0f8fd7994c0be4bedf01d4653dc26dab1b6f8d8d6c0403f69246` | modified |
| `packages/daemon/src/services/prediction-service.ts` | `cde3645e2d7753a83aad179b187f7282b41e5827` | `c0cccccb4a8a7ed923f9588f9cc69c524bd02f0bcc063767651ab3bf77dcce71` | modified |
| `packages/daemon/src/services/storage-service.ts` | `0f4e46bcb5186b5d89bf922068079a4b79952ba3` | `867ec04ff1c0505c7b53912c9fe58ae4a1f255ba59aec6939c9e103a92c552e9` | modified |
| `packages/daemon/src/services/wishlist-service.ts` | `4c08842554f06e46dba44cbb5cd1243d6a317284` | `d8541cbd2a1c011cec9e8efefcaf13b5e82332ab856ed2e588765b3dedddf400` | modified |
| `packages/shared/src/index.ts` | `2ba3cca80a272bf4bb727d50c7df2282a8a0e208` | `5937e9933694acba734e787c0ffd279ab672f02633dc15eb80f134c6d025c3a0` | modified |
| `packages/shared/src/validation.ts` | `64487db526b7045f45615a71bf05fab81d016ea0` | `ac0d75d7faa89d17a00bddf7606225e4643f6e6067d2751f6b933594ff130f4e` | modified |
| `packages/daemon/tests/integration/owner-game-notes-persisted-flow.test.ts` | `57088a8b229e6895168133d263171907c536d5cb` | `8238381cb6ce22cdf85f802af8eaa8ece5711e68e0b24551b8e1da74b0f18f4f` | modified |
| `packages/daemon/tests/services/bgg-xml-parser.test.ts` | `27657f25021c113aeb76896348dfa5bf475b2e36` | `1628d90b1fbcc2c454956d199e484fffbbd35e7e51909e468fd57dc638e3b6d8` | modified |
| `packages/daemon/tests/services/collection-artifacts.test.ts` | `28fdf21d2682fa2ca9300ab31155b67e3e90a5a7` | `0555f923866b920a3419c07d1fba1a301f949b770bae70f01b7feb9795e0ce46` | modified |
| `packages/daemon/tests/services/prediction-service.test.ts` | `3ae5a3f3e93ccd16196219612ebe51f2dc22501a` | `6fce36abcfe432dfefea11958348d2e500a3fa31fab22ef3b32f282f258fdc77` | modified |
| `packages/daemon/tests/services/storage-service.test.ts` | `a163b04841290d0e6e7dab01257695dcfb27eaed` | `08fd44a11776c1b072860523f97ed97d92d77ec3af7bf9a85f0e7cbcd2dd995a` | modified |
| `packages/daemon/tests/wishlist-routes.test.ts` | `f886146b43cbbaa7b397fa4fb0c0c97ba9350574` | `fe3f92f6ad9e9295f722641e43df0add375d01e0eb93cc409dc72c88994c6175` | modified |
| `packages/daemon/tests/wishlist-service.test.ts` | `258351fa17bb2813e2f9ac6dd7e4d4c6be14416d` | `4d716effc15ebec52b616a974c9831fc19e8e631f95ee7d1eff782eab290d43f` | modified |

This acceptance closes Phase 2 only. Runtime comparison/run behavior remains deferred, no later phase is started here, and the authorized checkpoint does not include a push.

## Phase 3 implementation log (accepted)

Implemented and parent-accepted the candidate-only scoring boundary and service-level current read projection. `computeWishlistRedundancyReadResults` consumes persisted compact BGG factual fields, one captured collection/scored-owned set, saved base prediction snapshots, and an optional injected description-signal capture resolver. The resolver receives collection ID, sorted candidate BGG IDs, sorted eligible-owned local IDs, only factual/description enabled weights, and candidate-owned pairs with candidate BGG ID/name/verified compact source plus a minimal owned ID/BGG ID/name/description projection (no owner-note state/text). Its positional `Promise<readonly (number | null)[]>` aligns exactly to requested usable-description pairs; only finite `[0,1]` values (including zero) count, null/invalid per-pair values are omitted, and a failed or mismatched-length capture trusts no C while retaining factual fallback. Phase 4 must implement this as one proof-bound resolution per coherent candidate projection/capture, reusing the cache mutation-revision proof and indexed pair point lookups rather than re-resolving proofs/scanning pairs per candidate or repeated currentness check. This interface does not imply a SQLite batch API. No SQLite identity/read-proof/cache implementation or C_ONLY inference request is included in Phase 3.

One shared factual context is built per result capture against all current collection games with BGG data, including ineligible normalization sources. One eligible-owned index includes only current owned games with a finite positive, non-vetoed score; BGG overlap candidates are excluded. Candidate compact fields project to the encoder's factual-only input without persisting a `Game` or vector. Vectors memoize collection members by local ID and candidate projections by disjoint object identity. The candidate scorer reuses shared available-weight blend and the extracted neighbor/penalty arithmetic; it compares only requested candidate-to-eligible-owned pairs, does not call `computeRedundancyAnalysis`, and does not compute owned-owned or candidate-candidate pairs. Zero qualifying neighbors produce a current zero-penalty/base-score adjustment when at least one signal class is enabled; when eligible pairs exist but every signal is unavailable, the scorer falls back rather than fabricating a comparison.

`WishlistService.listWithCurrentRedundancy()` exposes the frozen safe `WishlistEntryReadResult` boundary and requires owned predictions from `listGamesWithPredictionsFromSnapshot` using the same captured collection/tournament/settings. It never refreshes wishlist predictions or mutates stored entry snapshots; returned entries omit `bggSource`. The existing list route/CLI/web are unchanged and do not consume this new method until Phase 6.

Implementation-local evidence: the ten scorer, redundancy, wishlist, ownership and feature-vector suites passed (234 tests, 989 expectations). `bun run typecheck` (shared/daemon/CLI), `bun run lint`, scoped Prettier, and `git diff --check` passed. Structural counter fixture records one vocabulary/range/context build, seven vector encodes for four candidates plus three eligible owned games, and exactly 12 candidate-owned comparisons (4×3), with no owned-owned work. Numeric assertions cover F-only, F+C, valid C=0 denominator, disabled/zero-weight/all-unavailable signals, heterogeneous pair fallback, threshold/penalty, and no-neighbor zero penalty. Additional cases cover noneligible normalization effects without neighbor membership, eligibility exclusions, ID-collision-safe vector memoization, offline JSON source reload, saved/current/base precedence, source redaction, and snapshot immutability. No provider or BGG calls were used.

Phase 3 implementation manifest:

- `packages/daemon/src/services/feature-vector.ts`
- `packages/daemon/src/services/redundancy-factual.ts`
- `packages/daemon/src/services/redundancy-engine.ts`
- `packages/daemon/src/services/wishlist-redundancy-scoring.ts`
- `packages/daemon/src/services/wishlist-service.ts`
- `packages/daemon/tests/wishlist-redundancy-scoring.test.ts`
- `packages/daemon/tests/wishlist-service.test.ts`
- `packages/daemon/tests/wishlist-routes.test.ts`
- `packages/daemon/tests/ownership-routes.test.ts`
- `.lore/work/notes/wishlist-jev-description-similarity.md`

## Phase 3 acceptance and checkpoint evidence

Parent accepted Phase 3 after separate independent validation and read-only review. Independent validation passed its focused ten-suite run (225 tests, 874 assertions), root typecheck/lint, scoped formatting/docs/diff checks. The complete review diff `/tmp/opencode/wishlist-jev-phase3-review.diff` was reviewed against baseline `4aeb8f2` with no material findings. These are separate evidence sets: the implementation-local ten-suite run above was 234 tests/989 expectations; it is not the independent 225/874 run. No Phase 4 implementation was included.

The accepted implementation source/test manifest was captured after review and immediately before this note update. Index blobs, worktree SHA-256, and status are recorded below. This note is part of the accepted ten-path manifest and is excluded from its own hash table; `.beads` changes are administrative tracker state.

| Path | Index blob | Worktree SHA-256 | Status at capture |
| --- | --- | --- | --- |
| `packages/daemon/src/services/feature-vector.ts` | `ce828cdd47c7cd2ceaf7680b2c2e431a80085fac` | `941e0c42b74bb72ff877de82c69b13fb70e5798615348d790f3ac201c15f836b` | modified |
| `packages/daemon/src/services/redundancy-factual.ts` | `ef6d86a284523dbcfc9db18d41e020f46df2bdff` | `27b89c0f3c576a75ea27d67fd76abf2cf24ebb4525c879938d8d9a94b15889da` | modified |
| `packages/daemon/src/services/redundancy-engine.ts` | `00c7f2da1cc90077c0af0e16ef82fae6c22a4bf2` | `0cc5b1aee47768e3ee111eba2d2bda4e13c0de9f0815aab3299bdc70b755742d` | modified |
| `packages/daemon/src/services/wishlist-service.ts` | `d1ab2a897936a2b2ded0ba01753dffb5306a096d` | `bee2c3f030b2606a0b748847833eb80d3f0919107af353a5c9f75cabc526beef` | modified |
| `packages/daemon/src/services/wishlist-redundancy-scoring.ts` | `778c479e7362a64477ffe21a299c55da36f6837b` | `a86d6b755fb163b649cacb8cfc3511ec3324145a65008f51d3c215614bae46fa` | untracked at pre-stage capture |
| `packages/daemon/tests/wishlist-redundancy-scoring.test.ts` | `69bb6f69d1a38273c76d5feaae502e054a21e8bc` | `15c9ebc79a0f4bb64d1e47a6c4d994d02b17d689f92e8fcbf107d9b980fa6896` | untracked at pre-stage capture |
| `packages/daemon/tests/wishlist-service.test.ts` | `465b2dea750dfdf26025ebbe2e7bee62c05da3a7` | `c1c532c1780665b44bea8cc5c9faf2bc20f7274651847b4ffa5470d879823872` | modified |
| `packages/daemon/tests/wishlist-routes.test.ts` | `3745f73dd753f92853d2137afbb6bd78c4624994` | `e081aeaf5ba0f8bd7350cd0163f67cce546009a48bbc70eebb510c7dda2a52a1` | modified |
| `packages/daemon/tests/ownership-routes.test.ts` | `e28576990f8164745bb6697ea9513b89cae810b3` | `ea2e6164961c064dd262a5740b0b0fa8b2aa1f8d31f9208f79a03ea600f6bce0` | modified |

Phase 3 is closed by the parent and that checkpoint records only Phase 3 acceptance. Phase 4 remains in progress under its parent bead; its implementation is split into 4a/4b/4c child beads.

## Phase 4a implementation log (parent-accepted)

Implementing only `shelf-judge-xi83.4.1` (cache/schema identity foundation). The explicit `JevPairDomain` is `collection` or `wishlist-candidate`; omitted legacy keys/judgments remain in the collection domain. Schema version 4 adds the domain to the judgment primary key and domain/member indexes. Existing version-3 rows are transactionally copied into the collection namespace and retain their judgment, dependency JSON, completion time, and provenance. The default collection lookup, checkpoint, purge, and invalidation contract remains source-compatible; candidate operations must name their domain.

Candidate members use reversible canonical JSON tuples: `JSON.stringify(["wishlist-bgg", collectionId, bggId])` and `JSON.stringify(["owned-local", collectionId, localGameId])`. Candidate-row validation requires exactly one of each typed member from the row's collection and C_ONLY/C signal, with the existing name/description fingerprints and no note fields. Raw text is not persisted. The bounded `transferCandidateCOnlyPair` cache primitive validates the existing row and owned-local identity, rewrites both members and dependency IDs to the raw collection-owned IDs, rejects conflicting existing collection rows, then atomically writes/rekeys while retaining value, completion and model/rubric/schema/policy provenance. Replaying after source removal is a no-op. Source fingerprint/model/rubric/eligibility proof and acquisition coordination remain Phase 4b/4c work; this primitive alone is not acquisition authorization.

### P4A-01 existing-target comparison correction

Review found that comparing projected and transferred judgments with raw `JSON.stringify` depended on object insertion order. The transfer now compares an explicit canonical persisted representation: every judgment field (including optional consent/confidence normalized to null), sorted canonical pair IDs, and sorted dependencies with every optional fingerprint/version included. Thus semantically identical target content can be reused regardless of property/dependency order, while any real persisted-content difference still rejects transfer and retains the candidate row. Tests use actual temporary SQLite rows for existing-identical target cleanup, injected delete failure with both rows/revision unchanged, and conflicting target rejection with candidate evidence retained. Parent accepted this P4A-01 correction after independent testing and review.

The cache test fixture covers a version-3 reopen migration, identical numeric BGG/local identifiers, opposite candidate/owned roles, domain-isolated lookup and purge, candidate-specific purge isolation, indexed point-query plan, atomic candidate C checkpoint/progress, successful rekey/reopen, and transaction-trigger failure preserving source/target/revision. Indexed key lookup remains domain-scoped; no cache enumeration or batch API was added. Before P4A-01, the broader collection redundancy and existing run regression set passed (191 tests, 1,149 expectations). For P4A-01, focused cache/read-proof/coverage/run-pair suites passed (65 tests, 405 expectations). Parent-accepted independent evidence: 72 tests/474 expectations plus targeted P4A-01 3 tests/12 expectations, root lint/typecheck, scoped formatting/diff checks, and full review of `/tmp/opencode/wishlist-jev-phase4a-review.diff` against baseline `8c9e7b1`. Those independent runs are distinct from the implementation-local test counts above. Parent closed `shelf-judge-xi83.4.1`; 4b and 4c and the Phase 4 parent remain open. No route, read-proof/resolver integration, acquisition lifecycle, run, or client changes are part of this bead. No real provider or owner data was used.

Phase 4a implementation manifest:

- `packages/daemon/src/services/jev-pair-cache-service.ts`
- `packages/daemon/src/services/jev-pair-identity.ts`
- `packages/daemon/tests/services/jev-pair-cache-service.test.ts`
- `.lore/work/notes/wishlist-jev-description-similarity.md`

### Phase 4a acceptance and checkpoint evidence

Phase 4a is closed by the parent after independent testing/review, including P4A-01. The accepted source/test manifest's index blobs, worktree SHA-256, and pre-note-update status were captured immediately before this note amendment:

| Path | Index blob | Worktree SHA-256 | Status at capture |
| --- | --- | --- | --- |
| `packages/daemon/src/services/jev-pair-cache-service.ts` | `7beda45a8ef987f0725ef76266054e193dd15821` | `dda116167c29a8b8e57d41fa5c03e049f3dba2f75cc48d2198f57b9105ca1d8e` | modified |
| `packages/daemon/src/services/jev-pair-identity.ts` | `ad9926efe23a7c55bb6b76fd38c938c62737c08c` | `c2fdc34edcfe58be9c23ec7ed4a66e19d40b713c2067be4df179bd2f8b5103fd` | modified |
| `packages/daemon/tests/services/jev-pair-cache-service.test.ts` | `dc965918f66005a323822f5d5cd3e950f8eb5639` | `9123e5471f7b8601768f212399f7600f2b7d310f3fc871efe529c2ddc039d466` | modified |

The implementation note is the fourth accepted path and is excluded from its own hash table; this checkpoint also stages the current `.beads` export and interaction log, including Phase 4 split tracking and the accepted 4a closure. The 4b proof/resolver, 4c acquisition/recovery, and Phase 4 parent integration remain unfinished. This checkpoint authorizes no push.

## Phase 4b implementation log (parent-accepted)

Implementing only `shelf-judge-xi83.4.2`. Added a candidate-domain C_ONLY validator and injected resolver for the existing Phase 3 wishlist signal boundary. It derives reversible typed candidate/owned member keys and uses only indexed `wishlist-candidate` C lookups. Validation checks collection/domain/member identities, current candidate and owned names and exact descriptions, source observation identity, all current model/rubric/question/request-schema/score-mapping/policy provenance, numeric value including zero, and absence of consent/note dependencies. It does not inspect or require owner-note state or permission. Collection-domain rows, D/shared rows and mismatched sources/provenance are omitted as unavailable C; no source text is written to cache/logs or returned.

The resolver proof identity binds the request collection, sorted candidate/eligible-owned membership, each usable candidate's full persisted BGG source snapshot, owned identity/name/description, effective semantic weights, and the current judgment contract. It obtains mutation revision before and after the exact requested candidate×eligible-owned point reads; changed/unknown revisions, unavailable cache and thrown reads fail closed without memoizing values. One bounded latest-capture memo returns aligned C values (including valid zero) for unchanged requests; its `isCurrent(request)` fence checks the supplied current capture and revision only and performs no pair reads. This keeps resolver work proportional to the supplied pairs and does not require owned-owned work, full cache enumeration, BGG calls, gateway calls, or owner-note data. The exported row validator/dependency projection is available for Phase 4c to reuse as a source/provenance proof; acquisition transfer and lifecycle wiring remain deferred.

Daemon app composition injects the lifecycle-owned pair cache into the existing wishlist service resolver boundary. It does not change public routes or reads, which remain a later phase. No acquisition, startup reconciliation, run, status, UI, CLI, or ordinary BGG hydration behavior was added. Collection read-proof/coverage paths were not changed.

Initial implementation-local evidence: `bun test packages/daemon/tests/wishlist-candidate-read-proof.test.ts packages/daemon/tests/jev-pair-read-proof.test.ts packages/daemon/tests/services/jev-pair-read-service.test.ts packages/daemon/tests/jev-pair-coverage.test.ts packages/daemon/tests/wishlist-redundancy-scoring.test.ts` passed (41 tests, 287 expectations) before the P4B-01 fence correction. This earlier run is retained as historical evidence and is not merged with later counts.

Phase 4b implementation manifest (including this note):

- `packages/daemon/src/services/wishlist-candidate-read-proof.ts`
- `packages/daemon/src/app.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/tests/wishlist-candidate-read-proof.test.ts`
- `.lore/work/notes/wishlist-jev-description-similarity.md`

### P4B-01 live-authority publication fence correction

Review found that a resolver's `isCurrent(oldRequest)` plus a stable cache revision did not establish that wishlist/collection/settings authority remained current while prediction snapshot scoring and C resolution were pending. The service now captures wishlist entries, collection (including ownership/source/eligibility inputs), redundancy and prediction settings, and tournament data under the shared profile source coordinator; it builds the owned prediction capture and candidate projection outside the lock. Immediately before returning a computed projection it rereads and hashes those same durable authorities under the coordinator, then checks the resolver's supplied-capture/cache-revision proof when any C value was used. All wishlist-service saves (add, refresh/refreshAll, remove/clear, and BGG-ID removal) now use that same short coordinator for their persistence commit, so source removal/refresh cannot pass between final validation and publication. No lock spans prediction computation, BGG/provider activity, or Jev work.

If source authority changed or cannot be read at final validation, the service retries one fresh coherent capture; a second invalidation/unreadable source falls back to safe saved factual/base projections from the latest readable wishlist (or last captured entries if even that read fails), never labels the obsolete projection current. If only the cache revision changed after C resolution, the scorer discards every C value and recomputes the projection from the already-built factual context; a final source-only fence confirms it before publication. This preserves F fallback where available and saved prediction snapshots where it is not, without rebuilding the context or issuing extra pair lookups. A cache-unavailable/miss result with no C consumed does not block a current F-only projection. The concrete resolver's `isCurrent` remains a supplied-capture/revision check, but it is now called only after the service has matched that capture to freshly reread live authority under the coordinator.

Barrier tests use fake scoring/resolver/storage inputs: explicit factual refresh changes candidate description during owned scoring and causes retry with the new source; coordinated wishlist removal during scoring causes retry with the removed candidate absent; collection policy and owned-veto changes during scoring force retry; simulated cache revision change after resolver completion before final publication discards C and matches F-only output; unreadable final source authority returns the saved base prediction rather than stale current comparison. The scorer test confirms stale-C removal reuses one factual context/vocabulary/range build. Implementation-local focused validation passed (67 tests, 386 expectations); the separate parent-owned independent run also passed 67 tests/386 expectations, root typecheck/lint, root formatting and diff checks. The parent accepted the refreshed nine-path review diff at `/tmp/opencode/wishlist-jev-phase4b-review.diff` against baseline `177fbdd`, including P4B-01. An earlier partial-scope 79-test/408-expectation run is historical, not additive evidence for this acceptance. No real provider calls or owner data were used. Phase 4b is accepted only; Phase 4c and the Phase 4 parent remain in progress.

Updated Phase 4b implementation manifest:

- `packages/daemon/src/services/wishlist-candidate-read-proof.ts`
- `packages/daemon/src/services/wishlist-redundancy-scoring.ts`
- `packages/daemon/src/services/wishlist-service.ts`
- `packages/daemon/src/app.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/tests/wishlist-candidate-read-proof.test.ts`
- `packages/daemon/tests/wishlist-redundancy-scoring.test.ts`
- `packages/daemon/tests/wishlist-service.test.ts`
- `.lore/work/notes/wishlist-jev-description-similarity.md`

### Phase 4b acceptance and checkpoint evidence

The parent accepted Phase 4b after independent testing, refreshed read-only review and P4B-01 closure. Independent evidence: 67 tests/386 expectations, root typecheck, lint, formatting and diff checks. The accepted review diff is `/tmp/opencode/wishlist-jev-phase4b-review.diff`, reviewed against `177fbdd`. No implementation tests are rerun for this administrative checkpoint. Phase 4b is closed; Phase 4 remains active and Phase 4c remains open/ready. This checkpoint contains no Phase 4c implementation and authorizes no push.

The accepted eight-file source/test manifest was hashed immediately before this note update. Index blobs (or absence), worktree SHA-256, and status at capture:

| Path | Index blob | Worktree SHA-256 | Status at capture |
| --- | --- | --- | --- |
| `packages/daemon/src/services/wishlist-candidate-read-proof.ts` | absent | `49cfb56d35dbaf96bf6c4decaae0d139fe72d4f09a644ef2365a61f492b99932` | untracked |
| `packages/daemon/src/services/wishlist-redundancy-scoring.ts` | `778c479e7362a64477ffe21a299c55da36f6837b` | `91d7108929fd0796ce5107a448dceeb2a2a46e3bf4d19de72e6e4af9fe969d25` | modified |
| `packages/daemon/src/services/wishlist-service.ts` | `d1ab2a897936a2b2ded0ba01753dffb5306a096d` | `0e8a2f91bf63a7530c279cb6572b853d6fbf31d48221ecc8e315f9860e2092dd` | modified |
| `packages/daemon/src/app.ts` | `881573f20d82dfe7179aa041c93b575f0d5cf177` | `33dd686d9e526ef71d96abd743528d36252e9d9b8debce1c2ec48b2073166454` | modified |
| `packages/daemon/src/index.ts` | `920e2495dbaad74e96b7eeec2e0c8164e22e7fb9` | `00e21cfd28b9cd9462d99ab2d35a2adcfd750f70da67f6b248029f9bc29f641d` | modified |
| `packages/daemon/tests/wishlist-candidate-read-proof.test.ts` | absent | `3b1d729f38c50c65cc05ca99f8035de85086c7a53f10934b99110f815e714cc6` | untracked |
| `packages/daemon/tests/wishlist-redundancy-scoring.test.ts` | `69bb6f69d1a38273c76d5feaae502e054a21e8bc` | `13ac34ecef83232b9c0d18fd8b1fa0f7f4c82d00f43787da1486586f2058695d` | modified |
| `packages/daemon/tests/wishlist-service.test.ts` | `465b2dea750dfdf26025ebbe2e7bee62c05da3a7` | `9d5d23ca54b0bc8893bb31c508a3e7aa6759387a112fcf698204bee5946ef25e` | modified |

The note is the ninth accepted path and is excluded from its own hash table; its final blob cannot hash itself. The authoritative tracker export records `.4.2` closed, `.4.3` open, and the Phase 4 parent active. The checkpoint stages all nonignored `.beads` state alongside exactly these nine manifest paths.

## Phase 4c implementation log (parent-accepted)

Implementing only `shelf-judge-xi83.4.3`. The game-add route now delegates BGG acquisitions to the wishlist service's coordinated entry point. BGG retrieval remains in `gameService.addGame` outside the source coordinator; after the existing collection mutation commits, a short coordinator section verifies durable BGG/local identity and current scoring eligibility, validates each candidate C_ONLY row against the accepted Phase 4b proof, then performs one SQLite transaction to rekey proven rows and purge remaining candidate rows for that typed wishlist member. The wishlist JSON entry is removed only after cache finalization succeeds. Existing identical owned judgments remain; real target conflicts fail closed and retain candidate evidence. No cross-store transaction/rollback is claimed.

Collection/wishlist BGG overlap is excluded from ordinary `list()` and the Phase 3 current projection. Startup creates the same wishlist lifecycle service and reconciles durable overlaps before `createApp` exposes routes; an unresolved cache/storage error aborts startup. The game-add route returns HTTP 500 with `acquisition_recovery_pending` and the committed game projection if collection commit succeeded but cache/wishlist finalization did not. Ordinary remove, clear, and BGG-ID removal purge candidate rows under the existing short source coordinator before saving the wishlist removal; acquisition uses its distinct transfer/recovery path, not that purge operation. Recovery after SQLite success and wishlist-save failure is idempotent and retains original completion/provenance. Cache candidate enumeration is a typed-member indexed query, not a whole-table scan.

Initial implementation-local evidence before the independent correction was 103 tests / 459 expectations in the same four-suite command; it is superseded by the correction run below. No independent gate is claimed by these implementation-local checks.

Phase 4c stable implementation manifest (including this note):

- `packages/daemon/src/services/jev-pair-cache-service.ts`
- `packages/daemon/src/services/wishlist-candidate-read-proof.ts`
- `packages/daemon/src/services/wishlist-service.ts`
- `packages/daemon/src/routes/games.ts`
- `packages/daemon/src/app.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/src/services/wishlist-acquisition-startup.ts`
- `packages/daemon/tests/services/jev-pair-cache-service.test.ts`
- `packages/daemon/tests/wishlist-candidate-read-proof.test.ts`
- `packages/daemon/tests/wishlist-service.test.ts`
- `packages/daemon/tests/wishlist-routes.test.ts`
- `packages/daemon/tests/ownership-routes.test.ts`
- `.lore/work/notes/wishlist-jev-description-similarity.md`

The complete explicit Jev run admission/callback fence is Phase 5 and was not changed here; these tests do not claim an in-flight Jev run exists or prove its future callback lifecycle. Phase 4c implementation, independent validation, and review are accepted by the parent; the checkpoint is recorded below. No real provider calls or owner data were used.

### P4C independent-verification corrections (parent-accepted)

The correction now exercises transferred rows through the actual `createJevPairReadService` and collection proof validator after closing/reopening SQLite. With cached owner-note use disabled and missing note inputs, the collection reader accepts the transferred raw-ID C_ONLY value and retains its original completion/provenance. Durable restart coverage uses real temporary `wishlist.json`, `collection.json`, and SQLite files with newly created storage/cache/service instances. An injected post-collection-commit cache failure leaves the persisted wishlist source as recovery evidence and hides the BGG overlap; failed recovery does not call the application factory. After removing the injected failure, recovery transfers and cleans up before the application factory runs. No network or provider dependency was introduced.

Batch finalization now has two candidate pairs in a real SQLite fixture: a trigger fails on the second target after the first target write has begun, and the test proves transaction rollback leaves both candidate sources, no target rows, and the prior mutation revision. The subsequent successful batch produces both raw-owned rows with a single mutation-revision increment. Target conflict/source matching remain fail-closed. The proof matrix exercises candidate/owned source fingerprint, model, rubric and policy mismatches plus vetoed, zero-score and null-score owned members; only the compatible row transfers and the remaining candidate evidence is purged. A synthetic raw SHARED_CD row is rejected/purged and never appears as a candidate C_ONLY transfer. Ordinary remove/clear tests prove one candidate's purge leaves another candidate and unrelated collection C rows intact until clear.

P4C performance correction replaces per-cache-row `collection.games.find` scans with one captured `gameById` map per finalization. The deterministic fixture has 24 collection games and 3 candidate rows; structural observer counts assert one map build, three O(1) member lookups, and one owned scoring capture per finalization rather than per row. It does not use elapsed-time thresholds.

### P4C-01 ownership-disclosure and P4C-02 membership-index corrections

Current redundancy reads now build one primary-plus-additional BGG ownership set from the coherent collection capture and filter wishlist entries before both current scoring and saved-projection fallback. The final publication fence still compares the complete unfiltered source capture; if ownership changes during scoring, the request retries against a fresh capture and cannot publish an acquired overlap. If collection authority is unreadable, the saved fallback returns no entries rather than disclosing entries with unknown ownership. Tests cover additional-ID overlap with zero resolver calls, a barrier-controlled acquisition overlap during C resolution, cache-transfer and wishlist-save recovery entries hidden from both list methods, and fail-closed fallback when membership authority cannot be read.

Candidate row proof now receives a captured `ReadonlySet` membership index for requested candidate IDs and the complete eligible-owned IDs; resolver sets are built once per request and acquisition reuses its single eligible set. Validation uses one candidate and one owned `.has` probe per row rather than linear `includes` over the full owned list. Operation evidence: the acquisition fixture has 24 eligible owned members and 3 rows with exactly 3 candidate plus 3 owned proof probes per finalization; the proof fixture increases the full eligible set to 124 members and still records exactly 3+3 probes for 3 rows. Full membership validation remains intact; no eligibility check was removed.

Correction-local focused evidence: `bun test packages/daemon/tests/wishlist-service.test.ts packages/daemon/tests/wishlist-routes.test.ts packages/daemon/tests/services/jev-pair-cache-service.test.ts packages/daemon/tests/ownership-routes.test.ts packages/daemon/tests/wishlist-candidate-read-proof.test.ts` passed (114 tests, 568 expectations). `bun run typecheck`, `bun run lint`, scoped Prettier, and `git diff --check` passed after formatting. Parent-accepted independent evidence supersedes local counts: 202 tests / 1,104 expectations across the focused ten-suite gate, root lint/typecheck, root formatting and diff checks, and refreshed review of the 13-path diff against `c58e794f`. P4C-01/02 were closed after confirming durable filesystem restart recovery before app construction, production owned-reader acceptance without D permission, real second-target SQLite rollback with one successful batch revision, and constant 124-member eligibility probes. No provider calls or owner data were used.

The earlier 106-test/507-expectation implementation run is retained as historical evidence and is not combined with later counts. Phase 5 late Jev callback admission/publication fencing remains explicitly deferred and was not tested as existing behavior.

### Phase 4c acceptance and checkpoint evidence

Parent accepted Phase 4c after independent testing and review. The accepted 13-path source/test manifest's index blobs, worktree SHA-256, and status were captured immediately before this note edit. The note is excluded from its own hash table; `.beads` is administrative tracking state.

| Path | Index blob | Worktree SHA-256 | Status at capture |
| --- | --- | --- | --- |
| `packages/daemon/src/services/jev-pair-cache-service.ts` | `1152c501b723f09b04c4dfcecd362695102b034f` | `8916a03687c975a60ea26b9f0fa86d56ae8339e05ceb21cb240f49fba118d76d` | modified |
| `packages/daemon/src/services/wishlist-candidate-read-proof.ts` | `29442b16b6d61ac7e143240cd3735bdb6a515e12` | `153ae300f2041672564a697be35906f92dda462f0e669dbc63c27d44c42716dd` | modified |
| `packages/daemon/src/services/wishlist-service.ts` | `a15668336ce377dce941fd2f19089c67cdea7fd9` | `00c4da233929118bc54e5d66f5550d91609002f474f07201f907f1a69436f492` | modified |
| `packages/daemon/src/routes/games.ts` | `145781e2ae66fb0181763d97fd00e33f218563b2` | `8b2b00c0e8f2551c4a924aab2a50282935a4ee7666ef2bf51d0e137b4fc6e338` | modified |
| `packages/daemon/src/app.ts` | `f698a9c77dde437986f2cce7c469070570940f0d` | `2f3f9c7616a4134e9e61b9a0e6d756cde73f7aa22d3de9e19705f7d33929fe39` | modified |
| `packages/daemon/src/index.ts` | `53ead95d41d17c0dbc5ee1377d9de22330e656c8` | `badb39536b6b4fb323f3bb1a8fb255ca98c4c31456139ff7023a94f8c6852a49` | modified |
| `packages/daemon/src/services/wishlist-acquisition-startup.ts` | absent | `51299bfe43cdd4cc9e6e9c64fc4bea1163f72c7b85d4ac9b874f4f1a8170af69` | untracked |
| `packages/daemon/tests/services/jev-pair-cache-service.test.ts` | `4013c5a91ca50b25ef0a447a890027849bf271ca` | `583b6935f215f5df01907f6e3264cc42a6fe5c03222f9f445b62480160b8fe5c` | modified |
| `packages/daemon/tests/wishlist-candidate-read-proof.test.ts` | `e86401ca84456f62e51d61ceff7f4883dbde9945` | `85749400c7c8923ca8fd4b5a8ac3bbd3ca415a29c06b2170e722b1f7b8ff9d00` | modified |
| `packages/daemon/tests/wishlist-service.test.ts` | `453a37079dcc0bf1710797d9559a4c3a358f4124` | `d217559c732a19d0e88a1f551e59eb2450760b734d0cb5b90987b225a7aed75e` | modified |
| `packages/daemon/tests/wishlist-routes.test.ts` | `3745f73dd753f92853d2137afbb6bd78c4624994` | `e4cd5c6e7642659c8af854aade3f17264c1f611a74b783ac9c7f6b0d6420201d` | modified |
| `packages/daemon/tests/ownership-routes.test.ts` | `e28576990f8164745bb6697ea9513b89cae810b3` | `c95ffc45a5b534dff2acfac7fde10f48e02e85eae9b91138b2a95f55a17a7891` | modified |

The current delivery ends at the accepted Phase 4 cache/read-proof/acquisition/recovery boundary. Parent aggregate reconciliation confirmed all three child beads closed and is now complete; the overall wishlist feature remains in progress and Phase 5 is next. This checkpoint authorizes no push.

## Phase 4 aggregate acceptance and checkpoint

Parent confirmed `shelf-judge-xi83.4.1`, `.4.2`, and `.4.3` are all closed in dependency order, with no parent dependency on its descendants. The accepted contracts compose as follows: 4a provides collection-default-compatible domain migration, reversible typed members, indexed domain lookups, and atomic rekey/checkpoint primitives; 4b validates C_ONLY source/provenance against captured membership and mutation revision, reuses unchanged proof values without pair requery, and fences publication against current source authority; 4c composes that proof with collection-first acquisition, atomic evidence transfer/purge, ordinary-removal cleanup, durable startup reconciliation, and fail-closed partial recovery. The 4c independent 202-test/1,104-expectation integration gate exercised the actual owned reader after SQLite reopen without D permission, durable filesystem restart before app construction, SQLite batch rollback/revision behavior, and bounded membership/index operation counts. Earlier accepted 4a/4b independent gates and checkpoints remain recorded in their sections; source and tests were unchanged after the accepted 4c review.

The Phase 4 aggregate is accepted. Its last implementation checkpoint is `df4b0094` (`feat: transfer wishlist Jev judgments on acquisition and recover at startup`); this separate note/tracker commit records the parent close. This completes Phase 4 only. No tests claim real provider behavior, a late callback from a Phase 5 Jev run, or complete wishlist feature delivery. Phase 5 is the next open execution task; the overall epic remains in progress and no push was made.

## Phase 5a implementation progress

Phase 5a (`shelf-judge-xi83.5.1`, based on `b0a87e9f`) is in implementation and remains pending independent testing/review and the parent checkpoint. The new preparation boundary defaults omission to `{ kind: "all" }`, canonicalizes selected BGG IDs, rejects empty/duplicate/stale selections, hydrates only missing/invalid source snapshots before capture/disclosure, and persists source-only observations without changing prediction fields. It captures selected/owned-overlap/unavailable partitions and only candidate-by-eligible-owned C_ONLY pairs; preview authorization binds the prepared identity and start revalidates it without hydration or expansion. The current run service and controller explicitly refuse to dispatch wishlist scope (503 while unchanged; stale preparation is 412); the wishlist executor, provider loop, routes, query parsing, and clients remain Phase 5b/6 work.

Initial implementation-local evidence before P5A-01/02 correction: the four focused suites passed 117 tests/608 expectations. This historical run is superseded by the correction run below and is not combined with it. No live provider or real owner data was used.

### P5A-01 / P5A-02 corrections in progress

Independent review found that the previous eligibility identity included the semantic evidence epoch, which production owner-note mutations advance, and that currentness read wishlist state separately from its final source-authority read. The correction replaces that identity with prediction-source revisions (tournament, prediction settings, collection identity, and algorithm/representation), deliberately excluding note-only evidence epochs, per-game `updatedAt`, and storage freshness epochs that note writes also advance. Collection game scoring/ownership state, prediction policy, factual weights, and external source revisions remain checked. Currentness now checks source authority, durable wishlist/collection state, selection, and cache revision under one short reentrant profile-source coordinator section; preview authorization publication and the fail-closed start guard perform their final currentness check under that same coordinator. No BGG hydration, scoring-context construction, pair lookups, or gateway calls occur during currentness validation. A production-service test uses the actual owner-note mutation path and verifies note-only edits preserve C_ONLY currentness while an ownership change invalidates it; a barrier test commits a real optimistic wishlist refresh between currentness and start, then verifies 412 with no gateway construction and no extra hydration/cache lookup. Correction-local validation at that stage: the four focused suites passed 120 tests/629 expectations. The later acceptance record below supersedes the then-pending gate status. These corrections do not change collection-run or D-signal identity semantics.

#### P5A-02 mutable capture-alias correction

Independent testing found that the prepared DTO used a frozen clone, but its `isCurrent` closure still compared durable state against the source adapter's original mutable capture object. Preparation now clones and deeply freezes the adapter capture immediately, then uses that same snapshot for scoring, candidate/owned pair proofs, identity, prepared output, and currentness. It likewise snapshots and freezes the captured wishlist entries and collection before building selected membership and pairs; there is no per-currentness clone, pair lookup, or index rebuild. A regression returns a mutable capture object from the adapter, prepares and previews, then mutates the original owned description/name and durable collection. The prepared DTO retains its original description, currentness becomes false, start returns 412, and no gateway construction, hydration, or additional pair lookup occurs. Correction-local validation at that point: the four focused suites passed 121 tests/637 expectations. The later acceptance record below supersedes the then-pending gate status.

#### P5A-03 complete C_ONLY collection source identity correction

An additional audit found that removing note epochs had left out collection axes and their complete scoring configuration from wishlist eligibility identity. Added one shared `wishlistCollectionSourceIdentity` that hashes collection ID/schema, the complete ordered axes array, and complete ordered game records while excluding only per-game `ownerNote` and `updatedAt`. Array order is preserved. The source adapter uses it with existing tournament/prediction/algorithm revisions; preparation uses the same identity for initial capture matching, frozen prepared identity, and currentness. Existing policy, factual-weight, external-source, cache-revision, and collection-run/D identity checks remain unchanged. The helper is computed once when each immutable capture is formed and once per live collection authority read, not per candidate/pair.

Coverage includes note/timestamp independence and invalidation for axis weight/veto, game ratings/manual values/factual description, and game/axis ordering. A production-backed regression uses storage snapshots, the real prediction snapshot service and AxisService: an owned game is vetoed, producing zero eligible-owned games, zero comparison pairs, and null cache revision; removing the veto leaves source-vector tournament/prediction revisions unchanged but makes the prepared scope stale. Start rejects with 412 and performs no gateway construction, prediction rebuild, BGG hydration, or pair lookup; a fresh preparation includes the owned game. Correction-local focused validation passed: `bun test packages/daemon/tests/wishlist-service.test.ts packages/daemon/tests/services/jev-run-controller.test.ts packages/daemon/tests/services/jev-run-service.test.ts packages/daemon/tests/services/jev-run-source-adapter.test.ts` (123 tests, 654 expectations). Root `bun run typecheck`, `bun run lint`, scoped Prettier, and `git diff --check` passed. The acceptance record below closes Phase 5a only; no Phase 5b or later behavior is included.

### Phase 5a acceptance and checkpoint evidence

The parent accepted `shelf-judge-xi83.5.1` after independent verification and review, including closure of P5A-01, P5A-02, and P5A-03. The independent focused run passed 123 tests/654 expectations across the four suites, with root typecheck/lint, scoped formatting, docs validation, and diff checks. The complete 11-path review diff is `/tmp/opencode/wishlist-jev-phase5a-review.diff`, reviewed against `b0a87e9f`. Phase 5a's local gate is complete; this acceptance does not complete Phase 5 or the feature.

The accepted 10-path source/test manifest was captured immediately before this note amendment. Index blobs (or absence), worktree SHA-256, and status at capture:

| Path | Index blob | Worktree SHA-256 | Status at capture |
| --- | --- | --- | --- |
| `packages/daemon/src/index.ts` | `776be7044170c1601133dc2b743861ed29d698b9` | `3acf50e0bb51bfef75c416c69f052c66312a5c9266bf282e29a24c77389f0f78` | modified |
| `packages/daemon/src/services/jev-run-controller.ts` | `cce2c57a10e74026bac6701af06c7bad247b4831` | `dfc54607eeac53176fc43304610d3883315f58c76b239d96d5ebc3a003fc320a` | modified |
| `packages/daemon/src/services/jev-run-service.ts` | `a3e80cca60ae901adb7b78818c74afdd958b7a80` | `f0dc8bc0798b1546a24a3b44c9257be13eae4c765e08ab4fb3faa0e16b73f956` | modified |
| `packages/daemon/src/services/jev-run-source-adapter.ts` | `6de6470f692e467b66c3be77dddbc80db62d1b0f` | `de778a0455285042d55f920cf191b52664a25ebfea3e727e50668e907a2319da` | modified |
| `packages/daemon/src/services/wishlist-collection-source-identity.ts` | absent | `cf892dda02698c3f29a451944c874d15c4dde20cade067d6980ebd8f23dd320d` | untracked |
| `packages/daemon/src/services/wishlist-run-preparation.ts` | absent | `dd5ab1ae4184b909f3c7f9af45f317807f39fe9e8ac8d7c3ee68f69044052fd0` | untracked |
| `packages/daemon/tests/services/jev-run-controller.test.ts` | `f6aae7a5e6926d82d50754c63c42ad5774b427d5` | `9cb8abe90043d06bdf121a662ca0152496857fa567b675e19727058ef11218d4` | modified |
| `packages/daemon/tests/services/jev-run-service.test.ts` | `086d150c92b1646915633b9b56928b6ad6d3d061` | `6df7f8fbe640d6ae824473e374fad5e8a16556afe9bf150ab36648438ed4faa4` | modified |
| `packages/daemon/tests/services/jev-run-source-adapter.test.ts` | `2ea62f4812daba8b5a95baf4f5cfa1573c22e2a8` | `019bde86bae4dd2726c9cba266cd5eb8b5e71ea6ec254296652aa7c8322242f1` | modified |
| `packages/daemon/tests/wishlist-service.test.ts` | `dd2422d0c6edca58bf35a0c4206c9e88d658a94f` | `32c4246643d226c630fc55b0ffed64feed2e09e52bbdd3309b11f5d091fed3ae` | modified |

This note is the eleventh accepted path and is excluded from its own hash table; `.beads` is administrative tracker state. The current preview/start boundary intentionally returns 503 for an unchanged wishlist scope until child 5b supplies the executor; this checkpoint does not claim wishlist execution, provider-loop, or late-result behavior. Parent closed only child 5a; the Phase 5 parent remains active and child 5b is next. No provider traffic or real owner data was used.

## Phase 5b implementation progress

Phase 5b (`shelf-judge-xi83.5.2`, based on `c6dd872f`) is in implementation and remains pending parent-owned independent validation/review/checkpoint. The service now accepts only an opaque Phase 5a frozen wishlist preparation as the wishlist-discriminated run input; it does not rebuild collection scope, hydrate, or recapture/reselect the wishlist at start. It serially revalidates source authority and candidate-domain cache proofs for only frozen candidate-by-eligible-owned pairs, lazily creates the gateway only for an authorized miss, sends description-only payloads, validates C_ONLY responses, and checkpoints candidate-domain judgments with progress transactionally. Cached hits are revalidated as point reads; original misses may become hits before dispatch, while a disclosed hit that becomes stale is not newly authorized for transmission. All-hit execution completes without gateway construction. It does not use collection-wide coverage activation for wishlist completion; collection run processing remains on its prior path.

Final source authority checks run under the short profile coordinator before dispatch and before cache publication; provider work is outside the coordinator. A response after wishlist membership/source changes is discarded and the run fails rather than recreating an obsolete candidate row. Cancellation is checked again after awaited source fences. New integration evidence uses the real temporary SQLite cache and persisted wishlist fixture: one frozen C_ONLY miss sends only the two descriptions (no owner-note field/sentinel), persists typed wishlist-candidate identity and the score; a second all-hit run has zero gateway construction and exact hit progress; removing the entry during a blocked provider call discards the response without a cache row; and an injected SQLite trigger rejecting judgment insertion leaves completed/failed pair progress at zero with no judgment. Existing collection executor and cache/read-proof tests remain regression coverage. No live provider or real owner data was used.

Correction-local implementation check: `bun test packages/daemon/tests/wishlist-service.test.ts --test-name-pattern 'wishlist Jev preparation hydrates'` passed the execution/hit/removal/checkpoint-failure integration case (1 test, 37 expectations). Full focused regression command: `bun test packages/daemon/tests/services/jev-run-service.test.ts packages/daemon/tests/services/jev-run-controller.test.ts packages/daemon/tests/services/jev-run-source-adapter.test.ts packages/daemon/tests/services/jev-pair-cache-service.test.ts packages/daemon/tests/services/jev-pair-read-service.test.ts packages/daemon/tests/jev-pair-read-proof.test.ts packages/daemon/tests/wishlist-candidate-read-proof.test.ts packages/daemon/tests/wishlist-redundancy-scoring.test.ts packages/daemon/tests/wishlist-service.test.ts` passed 192 tests/1,145 expectations. Root `bun run typecheck`, `bun run lint`, scoped `bunx prettier --check` for the touched implementation/tests/note, and `git diff --check` passed. Parent-owned independent validation and review remain pending. Phase 5b remains in progress, and this note does not claim full barrier-matrix coverage, feature completion, Phase 6 public route/query/client behavior, or real provider behavior.

### P5B-01 monotonic wishlist-write revocation correction

Oracle review found that Phase 5a's content fingerprints could not distinguish an A→B→A wishlist mutation that restores the same entry ID, `addedAt`, observed BGG time, and exact entry/list bytes. Added a process-local monotonic generation in the existing profile-source authority WeakMap, keyed by the exact storage-service object. The production storage boundary now serializes wishlist reads and writes with source captures, compares persisted canonical wishlist content, and advances the generation before effective writes; an ambiguous write failure conservatively advances it if it had not already done so. A no-op identical save leaves it stable. Ordinary remove/remove-by-BGG/clear advance before cache purge so failed later persistence cannot restore authority after destructive revocation. The generation is frozen into prepared identity and checked O(1) under the existing coordinator by both full preview currentness and per-pair source fences. It is process-local only: no schema, journal, disk watcher, cache dependency, or restart-resumable run authority was added. Existing full scoring-source fingerprints and note-independent C_ONLY semantics remain in force.

Production-backed tests now use real temporary filesystem storage, SQLite, the wishlist service, controller, and fake gateway barriers. Actual refresh A→B→A preserves the final durable entry bytes but invalidates the old preparation; an old preview returns 412 with no gateway construction. Actual add/remove of another candidate restores the captured whole list but also invalidates the old scope. Clear/restore and remove with injected save failure revoke authority; a no-op save preserves generation, and an injected ambiguous storage write failure revokes it. A two-owned-pair run checkpoints both serially while its prepared source generation stays current; maximum concurrent fake evaluations is one. While provider response is held, actual refresh A→B→A and actual acquisition complete without waiting for provider release; releasing the old callback leaves no candidate-domain row, and a pre-existing raw-owned cache judgment remains unchanged. These tests prove coordinator release across provider waits. The acquisition-race fixture had no compatible cache row eligible for proven transfer, so it does not claim a transferred-target overwrite race; the accepted Phase 4 acquisition tests remain the transfer/rekey evidence. No automatic restart dispatch, real provider, or real owner data is claimed.

Correction-local validation: `bun test packages/daemon/tests/services/jev-run-service.test.ts packages/daemon/tests/services/jev-run-controller.test.ts packages/daemon/tests/services/jev-run-source-adapter.test.ts packages/daemon/tests/services/jev-pair-cache-service.test.ts packages/daemon/tests/services/jev-pair-read-service.test.ts packages/daemon/tests/jev-pair-read-proof.test.ts packages/daemon/tests/wishlist-candidate-read-proof.test.ts packages/daemon/tests/wishlist-redundancy-scoring.test.ts packages/daemon/tests/wishlist-service.test.ts` passed (193 tests, 1,181 expectations). Root `bun run typecheck`, `bun run lint`, scoped Prettier check for the touched implementation/tests/note, and `git diff --check` passed. The focused integration case `bun test packages/daemon/tests/wishlist-service.test.ts --test-name-pattern 'production wishlist writes monotonically'` passed (1 test, 36 expectations). These are implementation-local results only; independent parent validation and review remain pending. Phase 5b remains in progress, with no claim of restart-resumable run authority, transfer-target callback race coverage in this correction, Phase 6 behavior, or real provider behavior.

#### P5B test-evidence completion round 2

Added deterministic production-filesystem/SQLite barrier evidence without changing run/storage production code. The existing ABA integration now starts controller-authorized executions whose fake provider deliberately ignores abort until released: both actual `WishlistService.remove()` and `clear()` finish while the provider is blocked, then `StorageService.saveWishlist()` restores the exact original persisted entry/list. The old source fence is false before release; afterward each late callback leaves no candidate C row and no successful pair checkpoint. These are labeled exact-restoration cases, not add-with-new-UUID ABA. A separate active-run case exercises controller cancellation/status with a blocked uncooperative provider and verifies terminal interrupted progress, zero completed/failed pairs and no judgment row. The production axis-veto preview case still rejects stale authorization; its active pair uses a real settings-policy persistence mutation while SQLite mutation revision stays unchanged, then verifies source currentness fails, no pair checkpoint occurs, and no candidate row is written.

The two-pair serial fixture now wraps actual SQLite cache methods and records six keyed candidate lookups (three per authorized miss), two atomic `checkpointPair` calls with a mutation-revision increase for each, zero candidate-row enumerations, two provider requests, and maximum one concurrent evaluation. The second pair is successfully checkpointed after the first checkpoint changed cache revision, while the prepared wishlist generation remains unchanged. A restart fixture uses persisted wishlist/collection files and closes/reopens the real SQLite cache after a blocked provider is canceled and released; fresh preparation/controller/service instances read interrupted progress only, have no active run, reject the old preview precondition with 412, and construct no gateway. No persisted authorization or automatic execution is restored.

Round-2 local focused command: `bun test packages/daemon/tests/services/jev-run-service.test.ts packages/daemon/tests/services/jev-run-controller.test.ts packages/daemon/tests/services/jev-run-source-adapter.test.ts packages/daemon/tests/services/jev-pair-cache-service.test.ts packages/daemon/tests/services/jev-pair-read-service.test.ts packages/daemon/tests/jev-pair-read-proof.test.ts packages/daemon/tests/wishlist-candidate-read-proof.test.ts packages/daemon/tests/wishlist-redundancy-scoring.test.ts packages/daemon/tests/wishlist-service.test.ts` passed (194 tests, 1,235 expectations). Targeted production barrier run passed (4 tests, 105 expectations) before final additions and is superseded by the aggregate count. These tests used only fake provider responses and synthetic fixtures; no live provider or owner data. Independent parent validation/review remain pending; this closes no Beads item and claims no Phase 6 behavior.

### P5B-02 production gateway cache-hit disposition correction

Review found that a valid C_ONLY row appearing after the executor's initial miss was signaled by a private exception from the admission hook. `createJevGateway` correctly wraps arbitrary hook failures as `JevGatewayError("admission-rejected")`, so the executor's `instanceof` branch could not recognize this one expected skip and incorrectly failed the run. The correction uses a private mutable disposition scoped to one frozen pair/evaluation attempt. It is set only after the coordinator-protected admission rechecks source currentness and validates a current C_ONLY hit; the hook then rejects dispatch as before. On gateway rejection, only that local disposition converts the pair to a cache hit. Other admission/source/cancel errors retain normal failure handling. The public gateway contract, retry/rate budget, collection executor, and all-hit lazy-gateway behavior are unchanged.

The regression composes the real `createJevGateway`, actual temporary-filesystem `StorageService`, and SQLite cache. Its factory barrier runs only after the executor's keyed worker-loop lookup observed the frozen authorized miss; it inserts a compatible persisted candidate row before the real gateway invokes dispatch admission. The real gateway wraps the internal no-dispatch rejection, fake transport call count stays zero, progress completes with one hit/no failure, no pair checkpoint/upsert occurs beyond the injected row, mutation revision remains at its inserted-hit value, and the judgment including completion/provenance is byte-for-byte equivalent to its persisted preimage. A contrast changes the live source-authority identity at admission with cache revision unchanged; the same real gateway path yields one failed pair, zero hits, and zero transport requests. No gateway-wide flag or exception-class identity is used.

P5B-02 validation: `bun test packages/daemon/tests/services/jev-gateway.test.ts packages/daemon/tests/jev-run-composition.test.ts packages/daemon/tests/services/jev-run-service.test.ts packages/daemon/tests/services/jev-run-controller.test.ts packages/daemon/tests/services/jev-run-source-adapter.test.ts packages/daemon/tests/services/jev-pair-cache-service.test.ts packages/daemon/tests/services/jev-pair-read-service.test.ts packages/daemon/tests/jev-pair-read-proof.test.ts packages/daemon/tests/wishlist-candidate-read-proof.test.ts packages/daemon/tests/wishlist-redundancy-scoring.test.ts packages/daemon/tests/wishlist-service.test.ts` passed (222 tests, 1,619 expectations); the targeted production-gateway regression passed (1 test, 23 expectations). Root `bun run typecheck`, `bun run lint`, scoped Prettier, and `git diff --check` passed. Parent independent validation/review accepted the complete ten-path implementation manifest against `c6dd872f`; see the acceptance record below.

### Phase 5b acceptance and checkpoint evidence

The parent accepted `shelf-judge-xi83.5.2` after independent validation and review, including P5B-02. Independent evidence includes the targeted production-gateway race (1 test/23 expectations), related focused regression suites (146 tests/1,160 expectations), and the previously recorded broader production mutation-race/serial-counter/restart proof (285 tests/1,777 expectations). These are distinct runs and are not added together. Root lint/typecheck, formatting, and diff checks passed. Review: `/tmp/opencode/wishlist-jev-phase5b-review.diff` against baseline `c6dd872f`.

The accepted nine-file source/test manifest was rehashed after review and before this note amendment. Source contents match the accepted review; the index blobs, current worktree SHA-256, and status are:

| Path | Index blob | Worktree SHA-256 | Status at capture |
| --- | --- | --- | --- |
| `packages/daemon/src/services/jev-run-controller.ts` | `33b98608a2a7923dd197c3440f0ed7b9135e06c2` | `a27688ee8fb6780f47359092b2593a8aa1ef4a7e5d71efb4c4d8853d1ae9b9c3` | modified |
| `packages/daemon/src/services/jev-run-service.ts` | `67140cafe20e2a7ec541555323f05e13a128d557` | `3d9554e00cb46223a3bc5230497d1a654ccd9045811b1bb02efb814ba146c844` | modified |
| `packages/daemon/src/services/profile-source-coordinator.ts` | `14604c9e4e3a00b8925839111908fce08f392d1e` | `e57ebb24bb5c0e992cdd286b74483d81c3c80ce891a15ebc1b5a80d0bfe7c55e` | modified |
| `packages/daemon/src/services/storage-service.ts` | `92061cf646107f53891a9aa8cfa3880e26749480` | `31defbb56b90395c10e716646d1986f0dc9400091bf26439aa6fc481c3d2d9a4` | modified |
| `packages/daemon/src/services/wishlist-run-preparation.ts` | `f39190bb10b980d6f80d749095e287daa84b0fd2` | `b00e17334c23d70135c087961eab8e07269e884d7c405e064a74a290f3d1c6f9` | modified |
| `packages/daemon/src/services/wishlist-service.ts` | `545c39e06a462655fc4dc95b5756710ea916ced4` | `6a78634ae27bb61a4cff982694d773689dc808b5b1388d0a9f712b107d6dbc37` | modified |
| `packages/daemon/tests/services/jev-run-controller.test.ts` | `4533305952406ed4219686975ebb96501bf38c98` | `fd904790b4ce355fb9840825af44aa0c7a6f70a1fb939bbf9de531ee9e7e1fef` | modified |
| `packages/daemon/tests/services/jev-run-service.test.ts` | `fb49d492d30a7f86be22378b62ac73356ec2c023` | `70b411cc912eb7767580e2ff089d5c518f396b49795d72fea11eea8130781b41` | modified |
| `packages/daemon/tests/wishlist-service.test.ts` | `a16af8adc9a48d037a24a7150dbc4a52f768f45f` | `362bbe1db44abfc484bb980ba9ff8dccda99b64b61291cbacc2ac4e48ebbbf47` | modified |

This note is the tenth accepted path and is excluded from its own hash table. The checkpoint includes all current non-ignored `.beads` state. P5B-02's disposition is private to the specific pair admission attempt; the monotonic wishlist-write generation is process-local to its storage authority and is not an out-of-band disk watcher. Phase 6 route/query/client integration remains deferred. No provider calls or real owner data were used.

## Phase 5 aggregate acceptance and checkpoint

The parent confirmed `shelf-judge-xi83.5.1` and `.5.2` are closed in dependency order, with no parent dependency on descendants. Phase 5 obligations are accepted across the child evidence: legacy source hydration is preparation-only and precedes frozen disclosure; selection and source/eligibility/policy identity are immutable and checked before dispatch; C_ONLY reads and payloads are note-independent; exact frozen sendable misses execute serially with lazy gateway creation, budget/cancellation behavior, valid-hit reuse and atomic judgment/progress checkpoints; live source, membership, cache and monotonic wishlist-write fences reject stale previews/callbacks; restart does not restore authorization or auto-resume. The P5B production gateway race correction preserves a valid admission-time cache hit without HTTP dispatch while genuine source failures remain failures. Independent evidence remains in separate sets: Phase 5a's 123 tests/654 expectations; Phase 5b's targeted P5B-02 1/23 and related 146/1,160 suites; and the separately recorded broader 285/1,777 production mutation-race, operation-count and restart run. Root lint/typecheck, formatting, and diff gates passed.

The Phase 5 aggregate is accepted and checkpointed by the parent; the overall wishlist feature remains in progress and Phase 6a is next. This acceptance does not claim route/query/client integration, full feature completion, out-of-band disk mutation detection, or real provider behavior. No push was made or authorized.

## Phase 6a acceptance and checkpoint evidence

The parent accepted `shelf-judge-xi83.6` after independent validation and review. The accepted review diff is `/tmp/opencode/wishlist-jev-phase6a-review.diff`, against baseline `ec5647a4`. Independent evidence: daemon focused suites passed (227 tests, 1,399 expectations), web transport proxy suite passed (12 tests, 42 expectations), and root lint, typecheck, browser typecheck, formatting and diff checks passed. No implementation tests were rerun for this administrative checkpoint. This closes Phase 6a only; Phase 6b web and Phase 6c CLI remain separate, ready lanes, while the feature epic remains in progress.

The accepted 14-path source/test manifest was checked after review and immediately before this note amendment; no source/test contents changed. Index blobs and worktree SHA-256 values are recorded below. This note is the fifteenth manifest path and is excluded from its own hash table.

| Path | Index blob | Worktree SHA-256 |
| --- | --- | --- |
| `packages/shared/src/types.ts` | `38f1d9d66c0809a256c4c02fb0ba0210bbedc47f` | `a103d27b63c60c0fb707b18b3c96804e7995993b0c819e5f60d1645d1ea4b4d6` |
| `packages/shared/src/index.ts` | `cd28437222f10a37bd236ce66f9ce2be1a91853c` | `97512237cebb1dda4e91e46d9a19041d1a9e6069627f83e13f91da770b60e5b8` |
| `packages/daemon/src/app.ts` | `ceeb1858b42be919c385449e76aaecdf54d1866c` | `1999cc2dada3f2b1b1d951ee856891afe1bd12ad2c8397220e2b650480bafd61` |
| `packages/daemon/src/routes/redundancy.ts` | `bc6972dc7b4511460be6a874dff5206b207f0f2a` | `ae669892082b0baed54d3736bba61482e5824a893bf28d92f6c5919ff5524600` |
| `packages/daemon/src/routes/wishlist.ts` | `ef7e17102bf5f61736decc98451f372edda36b94` | `368caee0a18f494d8db0808728d3b37d721e1b72806bd56255abbd8fbe1259bd` |
| `packages/daemon/src/services/jev-pair-cache-service.ts` | `d2e6eb5e02a2727a28003abe1c2cd1befa8ac8e1` | `0cd2f2c10d6c9da6a9e0f03cbe5c8e9a68e4ac1171710efd1f755022b8772523` |
| `packages/daemon/src/services/jev-pair-status.ts` | `ae5d8932108983c2186901ace7e78128be84166b` | `84e56832bb6166fc93da9cc5d253b50b0e87a60b584175ed8df7fe4a30b654dc` |
| `packages/daemon/src/services/jev-run-controller.ts` | `33b98608a2a7923dd197c3440f0ed7b9135e06c2` | `5ee540bc57e32fc8cd5cc053bc1dbd129fc42c7814009005aba9a8ce1637dcde` |
| `packages/daemon/src/services/jev-run-service.ts` | `67140cafe20e2a7ec541555323f05e13a128d557` | `9cc4ea39c64d2e047436c62774cc4723403a3bf77918c93da9a3422c5bf166d4` |
| `packages/daemon/tests/semantic-redundancy-routes.test.ts` | `b5fe10accff6b54bcce99e9f2e191fa2f224076e` | `16134d81007f0b4dd52a76261d500c4be9b51d0dd2a65c7dff4a2e135130f792` |
| `packages/daemon/tests/wishlist-routes.test.ts` | `f94d6b282c1e08189526ff279e5f333d801dc272` | `7ad2a1c82555b9ec2a08a8227664cb910d544fafa5bb03ca6d82d6fb98b78df8` |
| `packages/daemon/tests/services/jev-pair-cache-service.test.ts` | `4e0c48bc3ebbf152c303f83bdabec4d2c72b8d81` | `3602466f9847780a4dc4354334d6d040fd5f319190f8f31a0844655cb58f7159` |
| `packages/daemon/tests/jev-run-composition.test.ts` | `241978dc77af8b40746e40c3e4f7c17ba2db1083` | `e8b160eb08efe2cb142934248e11c8990c32829d9241cb3f50b779ec365e5d00` |
| `packages/web/tests/daemon-transport.test.ts` | `a583efe5c0fe2d88a5703cf626dee147cd257f1f` | `2c3f8cff3cdb25264b5d2e0171d41c4d2c385ace9b341942ed1a5b48a48d7f11` |

The 6a handoff contract is recorded above: clients use `GET /api/wishlist/redundancy` for explicit current/saved/base projection; preview uses the existing Run path with omitted/collection scope or `scope=wishlist` and repeated `bggId` for exact selection; start sends only `{ requestId, precondition, noteTransmissionAuthorized: false }` for wishlist runs. Progress fields and paths are documented there. The web lane owns UI/page and browser workflow; the CLI lane owns CLI selectors/workflow. Those lanes should coordinate on the shared types and existing route contract, not edit this note concurrently. `.beads` changes are administrative tracking state included in the checkpoint; no push is authorized.

## Phase 6c acceptance and checkpoint evidence

The parent accepted `shelf-judge-xi83.8` after the independent CLI test and review gates. The accepted CLI diff is `/tmp/opencode/wishlist-jev-phase6bc-review.diff`, against baseline `e2406c3c`; the CLI source/test paths below were unchanged after that accepted review. Independent CLI evidence: 487 tests / 1,278 expectations. On the combined worktree, root typecheck, browser typecheck, lint, formatting and build also passed. The focused web results (10 tests / 30 expectations and browser E2E 16 / 16) are not Phase 6b acceptance: the web reviewer identified two findings, and the designer lane remains in progress. No web files are included in this checkpoint.

The accepted eight-path CLI manifest was rehashed immediately before this note update. Index blobs and worktree SHA-256 values:

| Path | Index blob | Worktree SHA-256 |
| --- | --- | --- |
| `packages/cli/src/commands/help.ts` | `ec4c60a5c79e669897faf7ff34f3b46ea0a70ecd` | `50dca0298419841142f0751aa9eb1f791903254ceca86721fe1e54ed235caa77` |
| `packages/cli/src/commands/redundancy.ts` | `0466b343ba977bc3df420b6b3a7ed62d58938562` | `a75c837adbc8faba44423855bfed04a0f137c0764a944fb3885f31845e92e2c7` |
| `packages/cli/src/commands/wishlist.ts` | `799ab89cb8b7cf387a495bd9f682cf2571cc0a6b` | `86de4372da7cace4ff7832daa74cf27dcccc63f4501a60b7efd6087945d907e2` |
| `packages/cli/src/index.ts` | `ed7d216cb0513353b780fa3a33e4845c5ae9daf8` | `7b4d164dec7fab458b051d435de0ed2e1ac1f8472fe20ecddf9a055770645d65` |
| `packages/cli/tests/commands/help.test.ts` | `e91ffc87d02ac6d5fa39c57ee8e2eccc20402498` | `359c8f19598f5f902fc7d4f3ed769e2959655959a95a27e8b5a2e67b037b0d83` |
| `packages/cli/tests/commands/redundancy.test.ts` | `c5069c1bfd2a63292d51ff5fa740ef74d3569751` | `71a91b31df7bf4d66ab7225701d9197b35ff8b306e797bf5f8d440a315d0da14` |
| `packages/cli/tests/commands/wishlist.test.ts` | `98d8f6ab30e332230eddf3e5af0bdeed7d911501` | `8705d77a2d6e05cae17bac51c6d2706ca8a0ffb772528a25e80fab82a7cb1fa0` |
| `packages/cli/tests/index.test.ts` | `652c208086748b11e415d814430a70ba339fc87a` | `416c69778e220aa0b4f767c859e4e1a89586784ebf0c15a49807bad9991845ed` |

The CLI checks recorded at implementation were `bun test packages/cli/tests` (487/1,278), `bunx tsc --noEmit -p packages/cli`, scoped ESLint and Prettier, and `git diff --check`; these were not rerun for this administrative checkpoint. Provider transport was fake, with no real provider calls or owner data. At the CLI checkpoint, `.7` was still in progress; it has since been accepted in the separate Phase 6b checkpoint below. `.9` remains open. This closes the CLI lane only, not Phase 6 overall or the full feature. The web source was excluded from the CLI checkpoint; no push was made or authorized.

## Phase 6b acceptance and checkpoint evidence

The parent accepted `shelf-judge-xi83.7` after the corrected independent web test and design/review gates. The corrected accepted review diff is `/tmp/opencode/wishlist-jev-phase6b-corrected-review.diff`, against baseline `e15d82f7`; a reverse-apply check confirmed the current four-file web delta matches that review exactly. Independent evidence: 10 web unit tests / 30 assertions and 28/28 browser tests across all four projects using fake daemons at ports 32111/32110. Browser typecheck and scoped lint, formatting and diff checks passed after the corrections. Root typecheck, lint, format and build are additionally reported as passing on the combined worktree before the two corrections; final Phase 7 gates will rerun them. No provider calls or owner data were used.

The accepted four-path web manifest was rehashed immediately before this note update. Index blobs and worktree SHA-256 values:

| Path | Index blob | Worktree SHA-256 |
| --- | --- | --- |
| `packages/web/app/wishlist/page.tsx` | `574b4f5a049ff50eca7fdb0ce7a44dc4d900a690` | `64f4a6baeba04254a9647a98f2c5e0d69a03d3d3388f4ca5984294dff67d6d49` |
| `packages/web/tests/wishlist-sorting.test.ts` | `83c0793f5cb18e42cefa32dff3abe55fde8e5eeb` | `5b5acda92183241728d533b29ec93875caeedc9a42ef17bd9249805bd782842a` |
| `packages/web/tests/wishlist-redundancy.test.tsx` | `60cd078d2107098d2faaba39216b4eba8479494d` | `ca3d0513b5ed1537b3fbfb9eaa565ea247b5ac9209e3d1e0df26dc668899f491` |
| `packages/web/e2e/wishlist-run.pw.ts` | absent (new file) | `6ea773ace31fb36b73bfdc78fc8c057fc5102b19bfa52e9c9700bfc11ced4963` |

The focused results before review correction are not acceptance evidence; the accepted counts above are the corrected run set. The exact accepted four-file source/test manifest, this note and current `.beads` metadata are included in this checkpoint; no CLI, daemon or shared source was changed. Phase 6b is closed; Phase 7 remains open, and the full wishlist feature is not yet complete. No push was made or authorized.

## Phase 7.1 unmount-polling correction acceptance

The parent accepted child `shelf-judge-xi83.9.1`. The accepted source delta is exactly the reviewed change in `/tmp/opencode/wishlist-jev-phase7-review.diff` (reverse-apply check passed); the full implementation review artifact is `/tmp/opencode/wishlist-jev-full-implementation-review.diff` (also reverse-apply checked). Independent testing established that the old page's poller is cleared on unmount, distinguished the newly mounted wishlist page's legitimate shared-endpoint poll, and added deterministic coverage for interval identity, in-flight response disposal, and no subsequent old-page ticks. The focused test passed 4/4 browser projects; the full browser run passed 404 tests with 60 intentional skips and no failures. Browser TypeScript, scoped lint, format, and diff checks passed. The prior four failures were test attribution to the shared status endpoint, not a runtime unmount defect. No test was weakened and no real provider/data was used.

The `.9.1` implementation manifest is only `packages/web/e2e/redundancy-controls.pw.ts`; its worktree SHA-256 at this checkpoint is `e95760358d672b7e65117450ca31adaeefce317d1b64a956ed6f1af0fab42608`. The Phase 7 daemon integration test remains untracked and excluded from this child checkpoint. Child `.9.1` is closed; parent Phase 7 remains in progress. This checkpoint records the child only and does not close Phase 7 or the feature.

## Phase 7 acceptance and checkpoint evidence

The parent accepted `shelf-judge-xi83.9` and the full wishlist Jev feature after independent testing and review. The exact accepted implementation is confirmed by reverse-apply checks against `/tmp/opencode/wishlist-jev-phase7-review.diff` and `/tmp/opencode/wishlist-jev-full-implementation-review.diff` (the artifact is named `wishlist-jev-full-implementation-review.diff`). The accepted implementation delta includes `packages/daemon/tests/wishlist-jev-phase7.integration.test.ts`; its SHA-256 is `b3e86e7afbf2d480ef8e84c6dcef9de71e53718a6a1d8d124cb881160ac507ee`. This administrative note update and the Beads export are the only post-review edits; no source or test content changed.

Phase 7's focused daemon verification passed 53 tests / 508 assertions across the new integration test and existing Jev composition and wishlist service suites; the new test alone passed 2 / 59. It uses temporary real filesystem storage and SQLite, actual wishlist/read-proof/run worker/controller paths, an in-process verified BGG Thing fixture and fake provider transport. The integration evidence covers compact-source persistence, frozen disclosure and note-free C_ONLY transmission, serial cache misses, one current adjustment, restart/offline cache reuse, failed and changed source refresh behavior, compatible C_ONLY acquisition transfer and owned-reader acceptance without D permission, and authorization revocation/removal while a provider response is blocked. The exact transfer-failure-after-collection-commit and startup-recovery failure matrix remains covered by the already accepted Phase 4c production recovery tests; the new test does not claim to repeat that scenario. No real provider or owner data was used; synthetic fixture transport does not validate semantic calibration.

Accepted whole-branch gates: `bun test` reported 3,844 passed, 1 skipped, 0 failed (22,874 assertions across 232 files); root typecheck, browser typecheck, lint, format check and build passed. Full browser verification reported 404 passed and 60 intentional skips; the corrected unmount test passed in all four browser projects. The independent reviewer accepted the whole feature with no material findings. Phase 7 and its child `.9.1` are closed; the feature-level gate is complete. These results are inherited from the parent-accepted validation and were not rerun for this administrative checkpoint.

The `.9` implementation checkpoint contains only `packages/daemon/tests/wishlist-jev-phase7.integration.test.ts`, this note, and current related `.beads` metadata. Its source SHA remains the reviewed value above. No push or Dolt sync was performed.

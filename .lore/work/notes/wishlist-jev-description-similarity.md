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
| `shelf-judge-xi83.4` | Phase 4; daemon cache/lifecycle backend | Parent active; 4a/4b accepted, 4c open after 4b checkpoint | Typed domain/member identities, read proof/cache revision and transactional C_ONLY acquisition recovery; ID collision/purge/failure-matrix tests; independent test/review; parent checkpoint commit. |
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

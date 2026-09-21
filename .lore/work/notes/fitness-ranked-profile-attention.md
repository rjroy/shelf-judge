---
title: "Fitness-ranked Profile attention implementation"
status: in_progress
source_plan: .lore/work/plans/fitness-ranked-profile-attention.md
---

# Fitness-ranked Profile attention implementation

## Seven-phase tracker

- [x] Phase 1: source schema, additive contracts, and compatibility cutover preparation (accepted)
- [x] Phase 2: pure rule catalog and candidate oracle (accepted)
- [ ] Phase 3: disposable candidate persistence and freshness coordination (pending)
- [ ] Phase 4: atomic disposition commands and source mutations (pending)
- [ ] Phase 5: Profile, config, and CLI contract cutover (pending)
- [ ] Phase 6: web rendering and command relay (pending)
- [ ] Phase 7: cross-cutting oracle, performance, and authority reconciliation (pending)

## Accepted Phase 2

`shelf-judge-cq1.2` is closed as accepted. Phase 2 adds the pure, registry-driven attention candidate oracle, four built-in rules, exact rational score handling, canonical purchase-utilization projection reuse, per-game winner selection, dispositions-before-selection, supersession, and deterministic global ranking. It deliberately does not cut over the public Profile contract or begin Phase 3 persistence work.

### Correction history

- **P2-1:** Prevented canonical projection metadata leaking through established game responses; restored response parity.
- **P2-2 to P2-6:** Aligned stale-play trust with Profile semantics; structured and globally fingerprinted dependencies; consumed canonical utilization projections; retained zero-score applicability; and enforced reduced, canonical exact fractions, including `0/1`.
- **P2-7:** Declared only displayed-fitness global identities actually consumed by underused-purchase and made intentional suppression invalidate on relevant changes only.
- **P2-8:** Derived each declared production dependency from rule metadata and validated valid plus empty, non-hex, uppercase, and wrong-length identities through the production path.
- **P2-9:** Validated dormant fixtures as collections and corrected BGG/current-observation ordering and fingerprint coverage.
- **P2-10:** Exercised production snooze and disposition boundaries, including the unsnoozed no-rule control and schema-valid null-winner expiry case.
- **P2-11:** Compared boundary timestamps as instants while retaining the selected original serialization and rejecting invalid timestamps.
- **P2-12:** Reused normalized Unicode code-point ordering for deterministic equal-instant ties and ranking invariance.

Following review escalations, the user explicitly authorized the third P2-6 correction, the P2-8/P2-9/P2-10 evidence correction, and the remaining P2-8/P2-10 evidence repair. Terminal review accepted all approved Phase 2 obligations and closed P2-1 through P2-12.

## Final accepted validation evidence

- Focused candidate/Profile Phase-2 suite: **101 passed, 905 assertions**.
- Full suite: **3,029 passed, 1 skipped, 0 failed**.
- `bun run typecheck`, `bun run lint`, `bun run build`, changed-file Prettier, and `git diff --check`: **passed**.
- Terminal reviewer: accepted all approved Phase 2 obligations; P2-1 through P2-12 closed.

## Accepted current-worktree manifest

Captured after closing `shelf-judge-cq1.2`, before the notes’ final self-reference. Each entry records exact porcelain status, index blob identity or `ABSENT`, and working-tree SHA-256 or deletion marker. This notes file is intentionally recorded with `SELF-REFERENCE: omitted`; no self-hash is claimed.

| Status | Path | Index | Working tree |
| --- | --- | --- | --- |
| ` M` | `.beads/interactions.jsonl` | `69b686a799e5b2816e1b245c4f816a4f6ddd432a` | `e149f73e03ebe3752a34285fcb8180da30bd08779013eebbd88df6bea445d902` |
| ` M` | `.beads/issues.jsonl` | `50e17aa53a27fedf5b69a36daae1d32400da77d4` | `57d8985fd8f5fcfa84eeeef72287b4f7303c6cbf0f27e94e97d5a1b378cdb4e8` |
| ` M` | `.lore/work/notes/fitness-ranked-profile-attention.md` | `c27a4c57fc5c38581532efaa03aef2c5a31ae4c8` | `SELF-REFERENCE: omitted` |
| ` M` | `packages/daemon/src/services/collection-profile-engine.ts` | `ee77a22d946d02ae93a42aa59bd383d19cf2c264` | `a11bf1201cd8b8b7ed685a21d202affa2ef6205d8cf4eab972fb0d9b83775ca6` |
| ` M` | `packages/daemon/src/services/purchase-utilization-service.ts` | `021e22b63f7d7902713b2396dd12939a6661682d` | `a4bd3e07ca7eebf9c4ebb1b6a9a70f32597177e71736d0dce77fffff1b782e72` |
| ` M` | `packages/daemon/tests/services/game-projection.test.ts` | `3930e85aaa1cf0cb9e3d4078453c0906ab082117` | `21691334daba328e18eeaf77ce7eae4e4047a1e9f3332e30f4d2d3cda2be7146` |
| ` M` | `packages/shared/src/index.ts` | `5a6b99da8333f1def70f50f40ea5ad33c4248a43` | `2fcdd9d62cdf1f9f03aeb6c4331d3fb5df7edc5402d25ebd696c5d21a9bb2ddd` |
| ` M` | `packages/shared/src/validation.ts` | `ddbe623dcbf8acc0e9ec105e0f3d7073a0505de5` | `2f5186e13b8a497abc2d49b14c6c900bef042c1d2aafed834f25d9ae3aa928aa` |
| ` M` | `packages/shared/tests/purchase-utilization.test.ts` | `b6e9f108405c461711a354ba6fae9fd67ac9b3e2` | `31d5c4d8b18903fa6f043016b9faf27f692faa487287b858db3c36e09b10c880` |
| `??` | `packages/daemon/src/services/attention-candidate-engine.ts` | `ABSENT` | `a53c795b01c21a8d78048db3dea4b81eab139cafd5a902770168fd52354bafde` |
| `??` | `packages/daemon/src/services/attention-rule-catalog.ts` | `ABSENT` | `27ffaa7db991cdaa739dfb4543344d627590a9cf1bb13ad71a61637cb56073f3` |
| `??` | `packages/daemon/src/services/purchase-utilization-projection.ts` | `ABSENT` | `d47fb9cc9995bbef977b5061a943efa0787ba708d73a79f341e75cbfe4214d7e` |
| `??` | `packages/daemon/tests/attention-candidate-engine.test.ts` | `ABSENT` | `c84d7921625b3e64f16a1995e58ed08a99543ed9e23f7232c6ea613c8fd787d8` |
<!-- CURRENT-WORKTREE-MANIFEST -->

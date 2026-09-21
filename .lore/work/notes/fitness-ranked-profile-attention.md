---
title: "Fitness-ranked Profile attention implementation"
status: in_progress
source_plan: .lore/work/plans/fitness-ranked-profile-attention.md
---

# Fitness-ranked Profile attention implementation

## Seven-phase tracker

- [x] Phase 1: source schema, additive contracts, and compatibility cutover preparation (accepted)
- [ ] Phase 2: pure rule catalog and candidate oracle (pending)
- [ ] Phase 3: disposable candidate persistence and freshness coordination (pending)
- [ ] Phase 4: atomic disposition commands and source mutations (pending)
- [ ] Phase 5: Profile, config, and CLI contract cutover (pending)
- [ ] Phase 6: web rendering and command relay (pending)
- [ ] Phase 7: cross-cutting oracle, performance, and authority reconciliation (pending)

## Accepted Phase 1

Phase 1 adds Collection schema v8, durable attention dispositions and receipts, the `profileAttentionCardLimit` default and validation boundary, additive internal candidate contracts, and deterministic v7-to-v8 migration. Existing Profile contract 9 and algorithm 12 remain unchanged. Historical v0-v7 schemas remain strict; only valid v7 data gains empty attention disposition state.

The accepted correction series is complete:

- CQ1-1 removed `responseAt` from intentional dispositions while retaining the complete snoozed-disposition record.
- CQ1-2 requires current attention dispositions in both CollectionV8 and Profile-source CollectionV8 to reference currently owned games.
- CQ1-3 validates receipt accepted versions, requested rules, durable-state consistency, and the strict accepted-state union.
- CQ1-4 restored the established v7 persisted-collection recovery boundary before sequential v7-to-v8 migration; eligible recovery remains limited to malformed acquisition and entertainment-benchmark values.

User clarification is preserved: migration remains the sequential `v1→v2→v3→v4→v5→v6→v7→v8` chain. Only v7-to-v8 initializes empty dispositions and accepts the receipt variant; the accidental v3-to-v4 field injection remains removed.

## Final accepted validation evidence

- Focused Phase-1 suite and changed tests: passed.
- Full suite: 3,009 passed, 1 documented skip, 0 failed.
- `bun run typecheck`, `bun run lint`, and `bun run build`: passed.
- CQ1-4 targeted real-filesystem test: 1 passed, 9 expectations.
- Final lint: passed.
- CQ1-1 through CQ1-4 terminal findings: resolved.

## Accepted worktree manifest

Captured after closing `shelf-judge-cq1.1`. Each entry records exact porcelain status, the index blob identity (or `ABSENT`), and the working-tree SHA-256. The notes file cannot hash itself after embedding this manifest, so its working-tree value is intentionally `SELF-REFERENCE: omitted`.

| Status | Path | Index | Working tree |
| --- | --- | --- | --- |
| ` M` | `.beads/interactions.jsonl` | `78ee415ed12c581eb28e99c9b78427d931a0cc2a` | `dcbe0f9b59e43bfacbf199f593e2afd871396049f3b448a2121106827118d080` |
| ` M` | `.beads/issues.jsonl` | `d4e8685a3f2294df5ea7f9f381d0f9e8336d8677` | `24e41bb1d82b04fcea86b177fc124b77dc3056f9cd4ab47f2c3e1b11810ada8d` |
| ` M` | `packages/daemon/src/routes/config.ts` | `eaf5e0b53b0140039a465f7b4c553d478ee35816` | `edb239c511a038e827f877c72cff39e80c6fc5189f0944bd9c75361e9e9b431a` |
| ` M` | `packages/daemon/src/services/collection-migration.ts` | `31aa360146e2bd0229887eae3f66ff99d0614a4f` | `a689fb5aff7c08403ecad064dd13ea87d726df9840b041b6a74dad7da21c19a5` |
| ` M` | `packages/daemon/src/services/storage-service.ts` | `ea97430c269c33db039229b131d1fc1a50cff813` | `06eb5b94061bd5174f8ffb98a9bbbdb81d060ba1f09191bee46880f7d6d038e4` |
| ` M` | `packages/daemon/tests/capacity-service.test.ts` | `0bdcda67c62c77d6933b9bde4aa0c872e09fa0a2` | `86e075573bf9acda98c08c543245cb95fb054e647486826e659b8b9f1841ebae` |
| ` M` | `packages/daemon/tests/collection-profile-engine.test.ts` | `0b4157fb22103fb2d4bcd41f36436a72d7f65fbd` | `85115a672685cff67a7633dcaf25a105e27232166612c984ce917bc07f3a1a67` |
| ` M` | `packages/daemon/tests/dimensions-routes.test.ts` | `33b9b10a05fd151cb1573c361cde76c529141dd4` | `a1dd03b3d40104caa29b79898dc0a159cf882e059a4e3195e4229d90ff845cd9` |
| ` M` | `packages/daemon/tests/helpers/test-app.ts` | `d31eaeab26ac85d33891dd3542e610dcfa80a7ac` | `866371e83a4f0ec758b1a1448c3fb71ab21c925e594bbe58bb5c7aa436313682` |
| ` M` | `packages/daemon/tests/integration/end-to-end.test.ts` | `1561c59230f6ff68c8136b2ac34cef503079ec36` | `ebbf2307948018dfdc51ab3edb0e82c5e210a480fac49794f75f11147b69d498` |
| ` M` | `packages/daemon/tests/integration/owner-game-notes-persisted-flow.test.ts` | `d952243abbe96ed7de398edd3e83b9f30d5a38c9` | `dcfb5539a69f799581ee4bca652554bc86b7e037ef130dbd0cc1db370c62aa72` |
| ` M` | `packages/daemon/tests/integration/purchase-utilization-persisted-flow.test.ts` | `7bbf981263772329ecbbe063d5ae823de03b1820` | `b22f6b3952b863c7d9ce6b7a799efcc9b0efc51e40b52c906e1b606c871427ed` |
| ` M` | `packages/daemon/tests/integration/purchase-utilization-response-parity.test.ts` | `c6a2986919230476ff3b1d2b00e131b06170192c` | `ef620aea34e1c713d045f801c7994fceb93b00636000e9a3fd847601a43a7b3d` |
| ` M` | `packages/daemon/tests/integration/useful-profile-persisted-flow.test.ts` | `354b3d3aca6cd5050d0ff14760d90af8b2d6c476` | `d36658f3dfae5ecf8e49d5b02c28c0c50f3619e5aa52d3cf617e1eaa6a842679` |
| ` M` | `packages/daemon/tests/niche-settings-integration.test.ts` | `e4afce36504c4cd6c9fa6663271bf3736b434b3e` | `152cc96c2a64bd2c200c8bf55e07d152c3a798b94263f7b4d60a833c0501e5db` |
| ` M` | `packages/daemon/tests/ownership-routes.test.ts` | `323afe62c829e789f5167a937129318c6463d926` | `bd5c5457124991121fdcdb0d9debe522b87c7d02cd9f465af8bfe91cbbc627fc` |
| ` M` | `packages/daemon/tests/redundancy-integration.test.ts` | `c5d418a6309ea7e197503db120dc873300626290` | `382d049d8614114efef92835007a589b4233adcdff8278af62ac26121224ff00` |
| ` M` | `packages/daemon/tests/services/collection-migration.test.ts` | `f9ef18d4236081d754000ec87a380daba393c94c` | `46891d63db6c72f9e9758b3f8fd94d295547b6d6c0cd2e618b6f4170787a1dd6` |
| ` M` | `packages/daemon/tests/services/collection-mutation-service.test.ts` | `9b5f46bc015b52f1532a802d40dd2e334ce4435f` | `4be40ec9dfe8f271e2a9a869fd3dd89f27f38e2f369955d6997d9010a93a4604` |
| ` M` | `packages/daemon/tests/services/game-projection.test.ts` | `cb23e64cb0fc0d4a40bf1cb5861c0432edc0c8d8` | `4e06ac1d95bcd51cf14e5adfcfc991737b847766235fb0c1d08e84f358ad3293` |
| ` M` | `packages/daemon/tests/services/intention-service.test.ts` | `e144fd35a5ec7bc1518f2c06b3677a9fd5d6e458` | `8640329f4905cbc733b88f623d38cc50f58589e45a6d3be4fa70ee3960a7679d` |
| ` M` | `packages/daemon/tests/services/owner-game-note-service.test.ts` | `18c6bb54ff8b5e370fdfb94a8b2d6ad63d3f1450` | `1823384a7197023df4395b64bcf4b111ca4f91c17100ce5505ddd89d33ce5373` |
| ` M` | `packages/daemon/tests/services/prediction-service.test.ts` | `3ad47ca1e4f84b4bbef32808f97a9097cf092951` | `f5dc1562f6dd47d464e88ffd352613a7429a1aeeb86043f8ab10d0faaba21652` |
| ` M` | `packages/daemon/tests/services/purchase-utilization-service.test.ts` | `3984d7a3e56372b81d5eea259258f4bb4ce86de7` | `f48b8ab3f746f45160980d5891f66dbbe942344b2096ba7655ba5a4431bed0b2` |
| ` M` | `packages/daemon/tests/services/reflection-evidence-projections.test.ts` | `ce4cc7d08dcd2459522d9f7f3cae99169432312d` | `f53c3f2c6d6ce8f56be81c8bbfd5db80408faf8d2dc81da7c4e41e50c8f8054a` |
| ` M` | `packages/daemon/tests/services/storage-collection-migration.test.ts` | `b6e6ef25ec3640202fa24e9982e9763f001a3852` | `f11ae97f5c12b732558b47ed2230cefb33015c465b2b7465b501e3eab414eceb` |
| ` M` | `packages/daemon/tests/services/storage-service.test.ts` | `1dec188d57c7a181bc514b0dee3017064768a4d6` | `5e0d887aa1a922dcf485171f40d5df32aab0fb50b0040930dc0f97841ea26e28` |
| ` M` | `packages/daemon/tests/shelf-routes.test.ts` | `3a29b99196590a472c1724c26deb01ddf557ff81` | `6ef4dd381d48497bb2544ad6337cc5c410b7a94972eaafeb0d3a286c272f0988` |
| ` M` | `packages/daemon/tests/shelf-service.test.ts` | `64049c978df586bed50b44fa5cda76855a84d0bc` | `a69a6d2aeb0e627963929332e61c94f4e0c98bff9029cd80f77807edd453d23d` |
| ` M` | `packages/daemon/tests/wishlist-service.test.ts` | `71a00e92d99b25f8e45f3856d8a2e635cdd772c7` | `250f5c7b9e57b4b1b0baeb5c4bec57dc969c4e7fb70dff26f0cc7e3d83fc3be4` |
| ` M` | `packages/shared/src/collection-profile-validation.ts` | `ff15e19978ef9d4697c0a8b9aa5e8ad94f1ad59b` | `7545783111f914bbb48802e06f75ae8e27ba176b75fe8ffeaf57102b42dc5a09` |
| ` M` | `packages/shared/src/index.ts` | `358fc8b9b7975db856a85a2fc729557b5d954aed` | `222b4f31d75db5583fd16dab96c2b616942819261c7eac860f0a55167d03d615` |
| ` M` | `packages/shared/src/types.ts` | `aefb58827d0a99f00d9c706e16cc07deae419bbe` | `b9448d87bae1d3d2dbdfa04b6ef2ad8e33e270527f513c2a70db966523f4de57` |
| ` M` | `packages/shared/src/validation.ts` | `34b5f62db1863ec140037beed9e1196c8e146010` | `d56a3756c02a393a252b7a3b3b5f32c82f48e61725af419533c062a99eeae267` |
| ` M` | `packages/shared/tests/current-axis-validation.test.ts` | `1311bbad4287ca07eacb545b2af51d73fd05f5e3` | `02fe5dacaa59a13dede12662bc73d274c7c4e784bb7336d9440919ac128f7f12` |
| ` M` | `packages/shared/tests/derived-axis-registry.test.ts` | `3b45a840304a30a47a54e7ce9176901f24fd19b1` | `1ba7074a8ce480ce54a223f5a521b9678ab495f1dd5791a6412dcc33fde14bb5` |
| ` M` | `packages/shared/tests/owner-game-note.test.ts` | `baf9c889bac9949ba0b94cb60c8243a5901670c7` | `fc426ebc312407bc60b7b4ca7a67e82642aac9d90c3d18a834a543ffccdd78ed` |
| ` M` | `packages/shared/tests/useful-profile-contract.test.ts` | `8d370459a5ac74389e58fd1afe50a9894f0f4753` | `3863562a627485a828dd396405711a4fa10f4d09cd4602c62b2e7045a9dc85ff` |
| `??` | `.lore/work/notes/fitness-ranked-profile-attention.md` | `ABSENT` | `SELF-REFERENCE: omitted` |
| `??` | `.lore/work/plans/fitness-ranked-profile-attention.md` | `ABSENT` | `715453765773c7715e0e9160f49fd3515944e3d2ba71c041be61daa8df0ff11e` |
| `??` | `.lore/work/specs/fitness-ranked-profile-attention.md` | `ABSENT` | `e1d754fb69820f958c8335e5d268316d6e9201bd364e83cbd1cf8a0a700e2da0` |

---
title: Jev-backed redundancy similarity components
date: 2026-09-28
status: approved
tags: [redundancy, similarity, jev, owner-notes, cache]
modules: [daemon, shared, web, cli]
related: [.lore/reference/specs/fitness/redundancy-scoring.md, .lore/reference/specs/current/owner-game-notes.md, .lore/reference/architecture-pattern.md]
---

# Jev-backed redundancy similarity components

## Decision and scope

**Approved direction:** extend the existing *redundancy* Component Weights with two semantic signals: C from the pair of BGG descriptions, D from the pair of current owner game notes. Remove `personalAxes` from redundancy similarity and its settings, not personal ratings or tournament results themselves. Keep the current feature encoding, weighted flattening, and cosine calculation for the existing factual components. Do not change prediction similarity, shelf placement, niche clusters, or rating calculation as a side effect. The current labels are approximate: the continuous vector also contains BGG community rating and playing time.

The target contract is owner-approved, but this document is not authorization to transmit private notes to a provider. Implementation and any outbound refresh remain separately gated. The approved narrow exception is carried by the maintained redundancy and owner-note references. Removing the personal-axis redundancy component is an explicit scoring change; semantic scoring is a separate opt-in mode, not silently enabled by a settings migration.

## Current implementation, not a replacement algorithm

`ComponentWeights` is currently `{ binary, continuous, personalAxes }` (`packages/shared/src/types.ts:1458`). Redundancy uses `flattenWeighted` and one pairwise cosine over the combined vector (`packages/daemon/src/services/redundancy-engine.ts:25-61, 118-150`). Defaults are `0.4/0.3/0.3`; the UI calls the last component “Your Personal Ratings,” but the encoder can also use tournament-derived axis values. The axes are not the game notes. Prediction explicitly excludes those axes and uses a different Jaccard/Manhattan composite. Only the redundancy settings and scoring path are in scope here; changing `FeatureVector` globally would accidentally change other consumers.

The proposed factual baseline is the *existing* cosine calculated with binary and continuous feature blocks, preserving their existing encoding and weighting. New C and D scores combine with that baseline after the cosine; they do not enter the feature vector or cosine itself. Preserve existing binary/continuous ratio for migrated settings unless the owner explicitly changes it. The illustrative `4A, 1B, 5C, 10D` suggests possible emphasis, **not** a specification to replace the existing 4:3 factual ratio or to pretend the combined-vector cosine equals a sum of separate cosines. New default weights and migration behavior need approval.

For a factual baseline weight F and semantic weights Cw and Dw, compute `(F * factualCosine + Cw * descriptionScore + Dw * noteScore) / sum(weights of available components)`. With only C available, omit Dw from the denominator. A binary/continuous zero-weight configuration must never divide by zero. Keep the displayed similarity, threshold neighbor membership, rankings, penalties, and preview semantics consistent with the chosen policy.

**Approved publication policy:** factual-only is the default after migration (binary + continuous, personal axes removed). Semantic scoring is opt-in and has a *published generation* for a defined set of eligible collection games and **enabled signals**. A C-only generation requires C coverage for every pair with two usable descriptions; D is disabled, has zero effective weight, and is not required even if owner notes exist. A C+D generation requires that C coverage plus one D Score judgment for every pair with two present notes. Enabling D requires a new complete C+D generation; disabling/revoking D immediately withdraws its generation and returns to factual-only until a complete C-only generation is published. Genuinely absent required sources are `unavailable`, not numerical zero; sparse notes do not create a separate D eligibility gate. A pending, failed, or stale requested judgment leaves the previous published generation intact when its source identities and authorization remain valid; if no valid generation exists, retain factual-only output with a visible `not ready` status. Never publish a partly refreshed generation. An inference outage does not renormalize away a temporarily missing score. An accepted source edit invalidates affected judgments and withdraws the active semantic generation synchronously, returning to factual-only with an explicit `stale` status until a new complete generation is published. This does change outputs at the moment source data changes, but not merely because refresh progress or provider availability changes. Annotation and integrated mode read the same published generation; integrated mode must not activate on a partial generation. The owner-approved coverage policy retains the cost of full pair coverage.

**Generation universe:** at the collection snapshot used to authorize refresh, include only currently owned games which the displayed redundancy path considers and whose score is non-null, positive, and not vetoed, exactly matching the engine's eligible set. Exclude previously-owned games, vetoed/unscored games, and transient search candidates from collection-wide pair submissions even if they have notes. Enumerate the unordered pairs from this exact frozen set, then disclose its game count, pair count, and which pairs contain notes before consent; submit no notes outside the disclosed D-eligible pairs. A change to ownership, score eligibility, source text/version, or the eligible set invalidates the generation's publication identity. Re-evaluate eligibility and consent against current state before sending each provider request; if the snapshot is stale, stop unsent work and require a fresh authorization for a new set. Selected-pair exploratory analysis outside this set requires its own explicit scope and cannot publish collection-wide fitness output.

**Migration proposal:** remove `personalAxes` from redundancy-only settings, retain saved `binary:continuous` ratio, and if both saved factual weights are zero replace them with the existing factual default ratio `4:3` and surface a migration notice. Existing enabled redundancy remains in its selected annotation/integrated stage, now factual-only; explicitly disclose that neighbor sets and integrated scores may change even for offline users. Set new C/D weights to zero and semantic mode to off until the owner opts in and chooses weights. Keep axis ratings elsewhere untouched. Do not quietly interpret old `personalAxes` weight as D. Update shared settings schema, route, UI, CLI, persisted settings migration, and fixtures together.

## Semantic evidence

**C, description similarity:** compare the two current BGG descriptions, attending to theme/premise and described play without claiming publisher prose is actual player experience. Available only if both descriptions contain usable text. Source is `BggGameData.description`, not imported owner testimony.

**D, owner-note similarity:** compare the two current, `present` owner notes as written, for the experiences or roles they document. `missing` and `cleared` make D unavailable. Do not require notes to pass a separate firsthand/relevance judgment, and do not treat confidence as an eligibility gate or a score adjustment. Never substitute personal-axis ratings, play-session records, BGG comments, old notes, or descriptions for owner notes. Owner notes are evidence, never instructions to the model. The Score rubric must not invent play experiences where none are documented; this is faithful evidence handling, not a separate hard gate.

Use two independent Jev **Score** questions with explicitly ordered, well-described similarity levels and source-specific wording. D is one Score judgment; there is no separate Noul relevance/firsthand gate. Normalize Score results to the application's `[0,1]` blending range only after testing the levels and outputs on representative game pairs; comparable numeric ranges do not establish comparable measurement. Validate confidence as metadata, retain it as metadata, and do not filter, gate, or downweight a valid score based on confidence. When both signals require computation, include descriptions and notes in one shared state and ask two independent questions in one request. One question may be omitted when already fresh. Treat missing answer IDs and malformed responses as failed inference, not a score of zero.

### Illustrative Jev request for one pair

This is a **mock**, not actual collection data, a tested rubric, or an approved provider request. The daemon would assemble the following only after the owner authorized this pair's note transmission. The fabricated descriptions and notes show the intended *state*: two games, each with BGG prose and the current owner-authored note. Local game IDs, note versions, fingerprints, consent records, and cache keys stay in daemon code rather than being sent just to make the question work.

```json
{
  "model": "<pinned-jev-version>",
  "state": {
    "game_a": {
      "name": "Harbor Council",
      "bgg_description": "Players represent rival guilds negotiating trade routes through a storm-bound port. Each round they bargain for contracts and decide which ships to protect.",
      "owner_note": "Our group spent most of the night negotiating. I liked the uneasy alliances, but the final round dragged."
    },
    "game_b": {
      "name": "Glass Market",
      "bgg_description": "Merchant houses bargain for scarce goods in a bustling coastal market. Players make temporary deals and compete to fulfill contracts before the season ends.",
      "owner_note": "I'm curious whether this would give us the same table-talk as Harbor Council; I haven't played it yet."
    }
  },
  "questions": {
    "description_similarity": {
      "type": "score",
      "instructions": "Compare only `game_a.bgg_description` and `game_b.bgg_description`. How similar are the games' described themes, premises, and portrayed activities? Do not use either owner note, and do not assume the prose proves actual play experience.",
      "criteria": [
        "The descriptions portray unrelated premises and activities.",
        "They share a broad theme or activity but portray substantially different premises.",
        "They portray substantially similar premises and activities, with meaningful differences.",
        "They portray very similar premises and activities, with only minor differences."
      ]
    },
    "note_similarity": {
      "type": "score",
      "instructions": "Compare only what `game_a.owner_note` and `game_b.owner_note` actually document about the games' experiences or roles. How similar are those documented accounts? Do not use BGG descriptions, treat questions or expectations as observations, or invent play experiences that are not documented. A note may be sparse or prospective; judge the notes as evidence without applying a separate relevance or firsthand-play gate.",
      "criteria": [
        "The documented accounts describe substantially different experiences or roles.",
        "The accounts share a few broad qualities, but the documented experiences or roles differ substantially.",
        "The documented experiences or roles substantially overlap, with meaningful differences.",
        "The accounts document very similar experiences or roles, with only minor differences."
      ]
    }
  }
}
```

This fabricated pair demonstrates that D remains one Score question when a note is prospective: the Score should reflect only what each note documents and must not invent a play experience for the unplayed game. This is not a second eligibility gate; confidence likewise does not gate or discount a validated Score. The questions share the same state and execute independently: the instruction to ignore notes in C is a rubric constraint, **not** a privacy boundary. Because notes are present in the request, even the C answer depends on note authorization and versions for cache provenance. If notes are missing or not authorized, send a C-only request whose state contains **no** `owner_note` fields and whose questions contain only `description_similarity`. No actual Jev answers or similarity numbers are implied by this mock.

Request fields and Score shapes follow the current [TypeSafe API](https://docs.typesafe.ai/api.md) and [Score](https://docs.typesafe.ai/primitives/score.md) references. The exact wording and levels are design examples to test, not production-calibrated thresholds.

## Consent, lifecycle, and execution

Existing owner-note authority explicitly excludes network transmission and model prompts (`.lore/reference/specs/current/owner-game-notes.md:145-153, 201-217, 292-315`). Existing AI architecture requires the daemon-owned pi-agent grounded-analysis boundary (`.lore/reference/architecture-pattern.md:14-26, 97-110`). Direct calls from the web, CLI, or redundancy scoring loop to TypeSafe would violate this boundary. **Proposed architecture amendment:** retain one daemon-owned inference gateway and add an explicitly approved typed-Jev capability behind that gateway, alongside (not masquerading as) pi-agent grounded analysis. The gateway owns TypeSafe authentication/configuration, model pinning and response validation, retry/rate/budget accounting, cancellation, and redacted logging. No feature service creates a separate provider stack. This is a change to the current pi-agent-only hard constraint and cannot be implemented until approved; do not assume pi-agent natively exposes Jev Score.

**Proposed authorization amendment:** the owner explicitly enables semantic analysis for a disclosed provider and pinned model, accepts that one selected refresh sends the *current* note text of both games for each D-eligible pair (including in shared C+D requests), and separately enables ongoing use of cached D in annotation/integrated scoring. Consent to refresh is scoped to that request and its displayed pair set; future refreshes require a new explicit trigger. A C-only refresh without owner notes remains available if note transmission is declined. Disabling cached D use immediately withdraws the semantic generation and purges D/shared C results; it does not pretend the provider can erase data already sent. Disabling note transmission prevents future submissions and cancels in-flight requests where possible, with the same publication fence as a note edit. Describe provider/model, network transmission, possible provider retention, pair count, estimated budget, and integrated-fitness effect before each refresh. This exception must be approved in the owner-note reference contract and consent represented in persisted daemon settings, not inferred from opening a page.

An explicit, owner-triggered **refresh/analysis** operation lives in the daemon. Ordinary collection reads, score calculations, and note saves remain free of provider calls. Expose refresh/status through daemon operations so CLI and web remain clients. A cache miss does not trigger an undisclosed request or block a collection read on network inference. The published-generation policy above governs failures and coverage.

## Cache identity and deletion safety

Durable, daemon-owned cache keyed by unordered stable game IDs and signal-specific source identity. Store only numeric result, confidence metadata/answer quality, model version, rubric/question version, source fingerprints or versions, and refresh status/timestamps. Never persist note text, prompts, quotes, or free-form model explanations in cache or logs. C validity depends on both current BGG descriptions; D validity depends on both current present note versions. Include resolved model version, not just moving `jev-latest`, and exact question/state schema identity. Any rubric/question wording or version change requires a version bump and invalidation of judgments produced under the prior version before reuse or publication. Fingerprints do not prove erasure and must not be exposed as owner-note content. Distinguish cache working entries from the last published generation; readers use only the generation whose source identities still match current collection state.

**Shared-request dependency:** if C and D are evaluated together in state containing notes, even C's result was produced in the presence of those notes. Mark that C entry dependent on both note versions too; purge it on note changes. A separate C-only judgment may remain valid across note edits. This trades some cache reuse for honest provenance.

On BGG description changes, invalidate C for affected pairs; on any accepted owner-note set/edit/clear, purge D and all shared-request C entries involving that note **before mutation success is visible**, including identical-text new note versions. Clear makes D immediately unavailable. Permanent game deletion purges all related pair entries, C-only included. Preserve existing deletion blockers and previously-owned note semantics. Never retain superseded note text in durable artifacts. In-flight inference must recheck game existence, current source versions, and authorization at publication; cancel superseded work where possible, but use a publication fence even if cancellation fails. On startup reject stale/orphan entries. Mutations must not wait while holding a lock across network inference.

**Atomic visibility proposal:** persist numeric pair-cache entries, active generation pointer, consent state, and source identities **inside the revisioned collection source**, not in a separate cache file. Publish refreshed generations through the same serialized atomic collection-write path with compare-and-swap on source revision and consent. Accepted note edits/clears/game deletion remove affected entries and withdraw the active generation *in the same collection write*; failure to write leaves the prior collection/note state intact. Recheck source revision, per-note versions, BGG description identities, and consent before every publication; readers load one collection revision and accept only a generation valid against it. Reject stale entries on startup. No network work occurs under the collection mutation lock. Before a collection mutation commits, invalidate any independently persisted profile/displayed-score artifacts that could contain old D-derived numbers, using the existing artifact hooks; if this pre-invalidation fails, abort the mutation (a failed collection write after successful artifact invalidation is safe but may cause recomputation). The implementation must prove this ordering with crash/restart tests.

**Wishlist contract amendment:** existing `wishlist.json` redundancy previews are durable snapshots (REQ-WISH-4). Do not put owner-note-derived semantic similarity into those snapshots. Existing wishlist add/refresh persists only factual-only preview values; any explicit candidate semantic preview is transient, never persisted in `wishlist.json`. Its display must say which similarity mode it uses. This avoids storing D-dependent wishlist output while retaining the existing snapshot behavior; amend the wishlist reference to say previews are intentionally factual-only when semantic mode is active. Existing artifact invalidation on other source changes remains in force.

**Candidate previews:** a transient BGG search candidate ordinarily has no owner note, so D is unavailable, never fabricated. C is available only when both candidate and owned-game descriptions are usable. Its cache identity is candidate BGG ID plus a description fingerprint and owned-game ID/source fingerprint, not an ephemeral local game ID. Candidate preview uses factual-only results unless a complete, explicitly requested preview refresh of the candidate's relevant pairs has produced valid C; show `not ready` or `stale` status rather than silently implying parity with collection semantic similarity. The explicit semantic preview is transient; persisted wishlist previews remain factual-only as above.

There are up to 19,900 unordered pairs for 200 games. Do not infer them all implicitly during normal reads. The refresh operation should have explicit pair selection, progress, concurrency/budget controls, retry/backoff, and cancellation, with a reproducible source snapshot. A requested collection generation is published only after required coverage for its eligible game set is complete; selected-pair analysis can be exploratory without changing live collection fitness. Persisted scores make ordinary reads offline and deterministic once coverage is established.

## Validation before implementation approval

- Trace every current redundancy consumer and settings path; verify prediction and shelf calculations remain unchanged, and personal ratings still function elsewhere.
- Compare factual-only old/new neighbor ordering and score behavior with personal-axis weight disabled, plus settings migration and zero-weight cases.
- Evaluate Jev Score rubrics against owner-reviewed pairs: mechanical/theme disagreement, rich/thin descriptions, tentative notes, missing/cleared notes, and irrelevant prose. Establish whether scores and blend thresholds produce useful neighbors, not just plausible numbers.
- Verify paired C+D request questions are independent, both answers validated, per-signal provenance retained, and no note text appears in persistent caches/logs.
- Test edit/clear/deletion and BGG-refresh invalidation, process restart, model/rubric change, concurrent refresh, provider outage, and stale in-flight completion after clear. An old shared C+D completion must not be returned, persisted, or reused after note clear. Verify failure to purge aborts mutation and previous note state stays visible.
- Test integrated-mode fitness and preview behavior under incomplete coverage and offline reads; test disclosure/authorization and daemon-only inference ownership.
- Exercise existing enabled installs with custom personal-axis weights, C-only authorization, D revocation, transient search candidate previews, persisted wishlist previews, and deletion/clear before and after restart.

## Approved decisions and remaining release gate

1. The narrow owner-note exception, per-refresh consent, C-only fallback, cached-D-use separation, and revocation contract are approved in `.lore/work/design/jev-contract-amendments.md`.
2. The daemon-owned gateway with typed Jev capability, separate semantic opt-in, factual-only migration, and all-or-nothing publication are approved. The implementation is not yet delivered.
3. Approved initial opt-in weights are F=7, C=5, D=10; retain the factual binary:continuous 4:3 ratio unless changed by the owner. These are not calibrated values.
4. Calibration under this amended single-D-Score rubric remains unresolved until explicit owner authorization. Before using semantic mode on real data, validate rubric/question behavior and threshold/weight effects; bump the rubric/question version and invalidate prior-version judgments. No live provider call is implied by this document.

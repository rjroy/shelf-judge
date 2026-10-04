---
title: Owner game notes
date: 2026-08-30
status: implemented
tags: [collection, game-detail, notes, owner-context]
modules: [shared, daemon, cli, web]
related:
  - .lore/work/design/unified-similarity-prediction-redundancy.md
  - .lore/reference/specs/current/useful-collection-profile.md
  - .lore/work/specs/grounded-profile-reflections.md
  - .lore/work/specs/collection-analyst-chat.md
  - .lore/work/design/jev-redundancy-similarity.md
  - .lore/work/design/jev-contract-amendments.md
  - .lore/work/design/wishlist-jev-description-similarity.md
  - .lore/reference/specs/features/wishlist.md
  - .lore/reference/designs/current/manual-game-value-edit-lifecycle.md
  - .lore/reference/specs/current/game-view-next-previous-navigation.md
req-prefix: GAME-NOTE
---

# Owner Game Notes

> **Current derived-scoring authority — 2026-10-04:** The [approved unified-similarity design](../../../work/design/unified-similarity-prediction-redundancy.md) and accepted Phase 6 activation extend the existing explicit JEV exception: current authorized note evidence can affect pair similarity, prediction neighbor selection, score, confidence, redundancy and wishlist ordering. A shared C+D judgment is note-dependent even at zero O weight; wishlist ordering can inherit dependence through owned-game prediction although its direct candidate evidence is C_ONLY. Revocation fences the complete transitive result before cleanup and requires whole recomputation or unavailable output. This does not authorize note use in ordinary reads, profile interpretation, or any provider operation other than explicitly disclosed Run. Existing JEV history/design/amendment links below remain discoverable, subject to the unified design.

## Goal

Shelf Judge must let the owner preserve context about an individual game that ratings, play counts, BGG metadata, and ownership status cannot express. A note can record why a game matters, the role or occasion the owner associates with it, reservations, memories, or questions worth revisiting.

The first release provides one durable plain-text note slot on every game. The note is owner-authored testimony: it records what the owner wrote, but it does not automatically become a rating, play intention, collection role, model input, factual correction, profile claim, or recommendation.

The approved Jev design establishes a narrow exception to the no-transmission boundary below: a separate, explicitly requested **Run** may use current `present` notes of eligible games as evidence for derived pairwise similarity judgments. Those judgments may transitively affect current predictions, confidence, redundancy and ordering as described in the unified-similarity authority notice. The supported interface is aggregate preview followed by one Run, with active-run progress, cancellation, and refreshable status; this documentation does not claim that live provider behavior has been validated. The note itself never becomes an instruction, rating, verified experience, or ordinary profile input.

The feature must work for owned and previously owned games, games with or without BGG identities, and fully offline use. The game-detail page is the canonical editing destination. The CLI provides equivalent read, set, and clear operations.

## Representative Experiences

### Recording Why A Game Belongs

The owner opens _Captain Sonar_ and writes:

> Keep for larger groups. It creates a kind of noisy team coordination that none of my other games provide, but it needs exactly the right group.

The owner explicitly saves. Shelf Judge confirms the save and later displays the text with its line breaks intact. The note remains attached to the game after BGG refreshes, rating changes, shelf moves, daemon restarts, and a transition to previously owned and back.

Shelf Judge does not create a `large-group` role, replay intention, attention item, or profile statement from the prose. A later feature may use this note only through its separately approved evidence and privacy contract.

The approved Jev redundancy exception permits a separately authorized derived pairwise redundancy signal to affect redundancy annotation or integrated fitness when the feature is implemented. It does not change the note, turn it into a rating or structured role, or make it an automatic profile claim. A note edit or any ordinary read cannot initiate that analysis.

### Protecting A Draft From A Stale Edit

The owner opens the same game in two browser tabs. Both load note version 4. The first tab saves an edit, producing version 5. The second tab then tries to save its different draft with expected version 4.

Shelf Judge rejects the second save instead of overwriting version 5. The page keeps the unsaved draft, shows the current saved note and version, and asks the owner to review the conflict. Saving after review is a new command against version 5.

If the first tab's response is lost after the daemon commits it, retrying the same command ID with the same canonical request returns the original accepted result. It does not create version 6. Reusing that command ID with different text fails.

### Clearing And Permanently Deleting

The owner clears a note through a separate destructive action and confirms that note reads cannot display or restore the prior text. The game now records that its note was cleared, including a new version and update time, but it retains no prior note text. This state is visibly different from a game on which no note has ever been authored. Clear is not a secure-erasure facility for old filesystem copies, process memory, or owner-created backups.

A separately approved model feature may already have rendered ephemeral output that quoted the then-current note. That output is not note storage or a restore path: Shelf Judge must not persist it, resolve its citation as current testimony, or retransmit it to a provider after the note changes. Durable note-derived artifacts must purge the affected output before the note mutation is observable. Ephemeral output already present in page or process memory may remain visible until that context is discarded, with its citation marked superseded when revalidated; this is part of the stated process-memory limitation rather than retained note history. For the approved Jev feature, only numeric pairwise judgments and minimal provenance may be durable; no note text, prompt, excerpt, or free-form explanation may be retained.

When permanent deletion is otherwise allowed, deleting the game also deletes its note state and note command receipts. Notes do not remove existing deletion blockers such as durable intention history. The existing permanent-delete confirmation must disclose when owner note content will also be deleted. Changing the game to previously owned is not permanent deletion and preserves an editable note.

### Migrating An Existing Collection

When Shelf Judge first loads a schema-version-5 collection, it migrates every game to an honest never-authored note state. It does not copy BGG descriptions, BGG collection comments, wishlist fields, axis descriptions, or any inferred context into owner notes.

The migration writes the complete schema-version-6 collection atomically. Failure leaves the prior valid collection loadable for another attempt. After version 6 is written, downgrading to a Shelf Judge release that only understands version 5 is unsupported.

## Note Model

### One Plain-Text Slot

Each game has exactly one owner-note slot. The first release does not provide multiple entries, sections, tags, Markdown, attachments, reactions, generated text, or an immutable text history.

The slot has three states:

| State     | Meaning                                                                 | Text                            | Version               | Update time            |
| --------- | ----------------------------------------------------------------------- | ------------------------------- | --------------------- | ---------------------- |
| `missing` | No note has ever been successfully authored for this game.              | None                            | `0`                   | None                   |
| `present` | The current owner-authored note exists.                                 | Non-empty normalized plain text | Positive safe integer | Daemon acceptance time |
| `cleared` | A prior note was explicitly cleared. Its content is no longer retained. | None                            | Positive safe integer | Daemon acceptance time |

Setting text changes `missing`, `present`, or `cleared` to `present`. Every accepted set increments the note version by exactly one, even when the normalized text equals the current text, because it records a new explicit owner action and supplies an unambiguous replay result. Clearing from `present` changes the state to `cleared` and increments the version by exactly one. Clearing `missing` or `cleared` returns `already-clear`: it leaves the note version, note update time, and game update time unchanged, but atomically persists a durable command receipt and advances the collection revision so the command ID remains reserved and safely replayable.

Once a slot leaves `missing`, it never returns to `missing`. Clearing records that an owner action occurred without retaining the cleared text. Permanently deleting the game removes the entire slot.

### Text Rules

Notes are plain Unicode text. Shelf Judge must:

- convert CRLF and bare CR line endings to LF before validation and comparison;
- accept between 1 and 10,000 Unicode code points after line-ending normalization, counted as `[...text].length` under the pinned ECMAScript runtime rather than as UTF-16 code units;
- preserve all accepted code points and intentional line breaks without Unicode normalization, trimming, or whitespace reformatting;
- reject text containing NUL or C0 control characters other than tab and LF;
- reject text matching `^\p{White_Space}*$` with ECMAScript Unicode property escapes under the pinned runtime rather than treating it as a clear command; and
- render text as escaped plain text, never as HTML or Markdown.

Clear is a distinct operation so blank input cannot accidentally destroy a note. The daemon's pinned-runtime validation is authoritative if a client-side counter or predicate disagrees. Long unbroken content must wrap in the web interface rather than create horizontal page overflow.

### Provenance And Meaning

Every present note is `owner` source evidence associated with its game ID and note version. Web and CLI are entry surfaces, not different authors. The daemon supplies the accepted version and update time; clients cannot backdate them.

The note is not authoritative evidence that:

- a BGG fact is incorrect;
- a game has a structured collection role;
- the owner intends to play, replay, keep, remove, buy, or sell it;
- a preference is stable or shared by other games; or
- the scoring model should change.

Those meanings require their own explicit structured operations. Reads and unrelated mutations must never interpret or transform note text into durable source data.

## Visible Behavior

### Game Detail

The game-detail page displays a labeled **Owner note** editor for both owned and previously owned games. It provides:

- the current state and saved update time when one exists;
- a multiline plain-text field containing the present note or an empty draft for missing and cleared states;
- visible character usage and the 10,000-code-point limit;
- an explicit **Save note** action;
- an explicit **Clear note** action only when the current state is present;
- a visible unsaved-changes state; and
- success, validation, transport, persistence, replay, and stale-version feedback.

Saving is explicit. The first release does not autosave. A failed or stale save preserves the local draft. A stale response presents both the local draft and current server note without silently merging or overwriting either and disables ordinary save. The owner must explicitly choose **Keep my draft** or **Load saved note**. Keeping the draft adopts the displayed server version as the new baseline and generates a new command ID before save is enabled. Loading the saved note discards the local draft only after confirmation when the texts differ.

Clearing requires confirmation because no prior text history or restore operation exists. After success, focus returns to the note region and the cleared state is announced. When a dirty note is about to be abandoned, the browser must warn where the platform permits; this warning is not a substitute for server-side concurrency control.

BGG description and other imported text must remain visually and semantically distinct from the owner note.

### Collection And Profile

The initial release does not show note excerpts, note-presence badges, note search results, note filters, or note-derived ordering in the Collection. It does not add notes or note-derived content to the Collection Profile. A note edit may advance the canonical collection revision and invalidate disposable derived artifacts, but ordinary profile computation must not read or interpret note text.

The complete note field, including note presence and metadata, must be omitted from Collection list, Profile, search, prediction, Tournament, add-game, and unrelated mutation responses. This limits accidental disclosure and prevents broad collection consumers from becoming an implicit note API. Strict public projections must separate durable game storage from each response shape rather than relying on the durable `Game` type everywhere. Only game-detail and dedicated note responses include the complete note. Note mutation responses include accepted metadata but not note text.

### CLI

The CLI exposes discoverable equivalents of the web operations:

```text
shelf-judge game note get <game-id> [--json]
shelf-judge game note set <game-id> --expected-version <n> --text <text> [--command-id <uuid>] [--json]
shelf-judge game note clear <game-id> --expected-version <n> [--command-id <uuid>] [--json]
```

Quoted CLI text may contain shell-supported line breaks. Interactive editor launching, file input, and stdin input are outside the first release. When `--command-id` is omitted for a mutating command, the CLI generates one and prints it to standard error before sending the request so the owner can retry after an ambiguous lost response.

Human-readable `get` output distinguishes missing, present, and cleared states and prints present text without interpreting it. JSON output preserves the complete validated dedicated note contract. Mutation failures write the structured error to standard error and exit nonzero.

### Privacy And Security Boundary

Owner notes are durable local application data stored with the collection. They are available to local clients that can access Shelf Judge's daemon and are included in a raw backup of the Shelf Judge data directory. Shelf Judge has no stronger user-authentication boundary in this release.

Note text must not appear in routine logs, operation-discovery examples, error messages, profile payloads, collection-list payloads, telemetry, or generated test snapshots containing real owner data. Logs may include operation, trigger, game ID, expected and resulting note versions, command ID, replay status, and outcome. Jev cache and collection metadata may retain numeric judgments and minimal provenance only; they must not retain prompts, note excerpts, prior note text, or free-form model explanations.

No note operation makes a network or model call. Notes are not sent to a model by profile reads, profile recomputation, BGG refresh, or any background process. The Jev redundancy Run is the sole exception to the general prohibition on model prompts/network transmission: only an explicit owner-triggered Run, through the daemon-owned typed-Jev capability, may transmit eligible current notes under the one-execution authorization and source checks below. This describes the implemented Run interface, not validated live provider behavior. Future reflections or chat still require their own explicit owner-visible model operation, transmitted evidence scope, citation contract, stale-note behavior, and failure behavior before receiving note text.

### Approved Jev Redundancy Run Exception

The SQLite storage and run-flow contract described in this section and under **Derived Artifacts** follows the [approved SQLite Jev pair-cache design](../../../work/design/sqlite-jev-pair-cache.md). The implemented interface provides direct aggregate preview, explicit one-click Run, active-run progress, cancellation, and refreshable status. This is not a claim that live provider behavior has been validated.

> **Scoring authority amendment — 2026-10-01 (owner correction):** This current note-use contract supersedes the earlier complete-required-coverage gate: for every eligible pair, use F plus whichever positive-weight C/D cached signals are valid, current, and permitted, normalized by included weight. Omit missing, stale, failed, or blocked components for that pair rather than treating them as zero; a valid cached score of zero is present. F+D and F-only both score. Omit a pair only if no positive-weight signal is available. Partial cache therefore improves valid pairs immediately on a subsequent read while other pairs remain factual-only; status must report honest partial state and aggregate coverage. Full coverage is not required to score, and activation metadata is advisory/inert. Reads still never call providers. Explicit Run remains permission-gated and must enforce exact source and stale-result fences. This is an authority correction, not a claim of live provider validation.

> **Status of the following wishlist amendment block:** The 2026-10-03 material is retained as historical contract history. Use the named current references linked below for normative scope and current-read behavior. In particular, the candidate × currently-owned-only scope and saved-derived fallback statements are superseded; the C_ONLY privacy boundary, verified compact source, selected-scope validation, and acquisition-transfer constraints remain only where consistent with the current wishlist/design contracts.

> **Historical wishlist amendment — 2026-10-03 (preserved for discoverability; its candidate-scope description is superseded):** The owner approved persisted wishlist-candidate-to-eligible-owned description comparisons. The following amendment text records the earlier contract proposal, not the complete active run-scope contract. Current authority is the [unified-similarity design](../../../work/design/unified-similarity-prediction-redundancy.md), [wishlist specification](../features/wishlist.md), and [prediction-engine specification](../fitness/prediction-engine.md). In particular, the old candidate × positive-owned-only scope and saved-derived fallback statements below are superseded: current runs freeze the exact deduplicated P∪R pair set; P may use genuinely rated previously-owned references, R uses only current owned positive non-veto games, and cache-only owned wishlist prediction dependencies do not authorize inference. Current reads never use saved predictions as fallback. The C_ONLY/no-note privacy constraints remain current.

> **Historical source/projection amendment (retained; saved-derived fallback is superseded):** The approved wishlist source is an optional-for-legacy compact BGG observation persisted with each wishlist entry: observation time, exact nullable description, mechanic/category names, weight/community rating, and min/max/best players and playing time. Existing BGG identity and name must match the same verified Thing observation. It is sufficient for current factual encoding after restart/offline; derived vectors/ranges and full `Game` objects are not persisted. It is not owner-note state. Existing wishlist factual snapshots remain saved and historical. The earlier “saved factual adjustment / base prediction” fallback precedence and “valid saved prediction remains rankable” language are superseded by the current [wishlist specification](../features/wishlist.md) and [prediction-engine specification](../fitness/prediction-engine.md): a read uses current prediction/redundancy or explicit unavailable/null, never saved derived scores.

> **Historical run amendment, current selector details retained subject to frozen-scope authority:** The existing explicit Jev Run gains a `scope` selector on `GET /redundancy/semantic/run-preview`: omission or `scope=collection` preserves collection behavior; `scope=wishlist` defaults to all current entries, with an optional selected subset encoded as `selection=selected&bggId=<id>&bggId=<id>` using repeated query keys. Omitted/all normalizes to `{kind: "all"}`; selected IDs are sorted numerically in the canonical `{kind: "selected", bggIds}` identity. Selected IDs must be distinct, valid, and present in the captured wishlist or the entire preview is rejected; missing entries are never silently dropped. Selected entries overlapping owned BGG IDs are disclosed separately and fenced out. Hydration/persistence is limited to the exact selected entries and finishes before disclosure. The exact precondition binds scope, canonical selection, source, eligibility, settings/policy and the frozen pair set; existing start body consumes that precondition and never hydrates or expands scope. Ordinary reads/status remain BGG-hydration- and inference-free. Current P/R/U0 pair membership is defined by the [wishlist specification](../features/wishlist.md) and [approved unified design](../../../work/design/unified-similarity-prediction-redundancy.md), not by the older candidate × owned-only statement above. The wishlist disclosure partitions global size as `wishlistEntryCount = selectedCandidateCount + unselectedEntryCount`, selected as `selectedCandidateCount = ownedOverlapCandidateCount + requestedCandidateCount`, and requested as `requestedCandidateCount = eligibleCandidateCount + unavailableCandidateCount`. It also reports source-authorized pair and sendability counts and is distinct from collection authorization.

> Candidate-cache rows use a distinct pair domain and reversible canonical typed members `JSON.stringify(["wishlist-bgg", collectionId, bggId])` and `JSON.stringify(["owned-local", collectionId, localGameId])`; a domain tag alone cannot prevent raw-ID collisions. Candidate rows never enter collection readers. Acquisition remains collection-first across separate durable stores: exclude an acquired BGG ID immediately, transactionally convert only fully verified C_ONLY rows and dependencies to raw owned IDs, then remove the wishlist entry. Preserve numeric value, original completion and provenance; derive restart recovery from owned/wishlist overlap, fail closed while recovery is incomplete, and do not claim cross-store atomicity. Ordinary removal/clear fences and purges instead of transferring.

> The implementation must retain the existing performance contracts: one factual context and memoized eligible-owned index per coherent capture, memoized vectors per distinct game, only requested candidate-owned pairs, keyed SQLite point access, proof reuse until source/policy/membership/cache revision changes, atomic per-pair result/progress checkpoints, lazy serial bounded gateway dispatch, no network-duration locks, and cheap status reads without full candidate rebuild or cache rescan. These are approved target requirements; they do not assert delivery or authorize implementation by this reference alone.

This section records an approved contract amendment associated with [the Jev redundancy design](../../../work/design/jev-redundancy-similarity.md) and [the contract-amendment proposal](../../../work/design/jev-contract-amendments.md). It documents the available user controls and privacy boundary; it does not claim that any note has been transmitted or that live provider behavior has been validated.

The owner starts with a direct aggregate preview and may explicitly trigger one **Run** to transmit current `present` notes for eligible pairs to the configured provider and pinned Jev model. Before Run, disclose TypeSafe/Jev and the pinned model; eligible scope and aggregate pair/note-bearing counts; the fact of transmission and possible provider retention; request budget/limits; and the possible effect of cached D on integrated fitness. Do not require downloading, browsing, or acknowledging a complete pair manifest or reviewing pairs one by one. Authorization is for that execution only; a later Run requires fresh disclosure and authorization. Do not lock pairs or block edits during a run: check exact current inputs before sending and storing results, discard stale pair results, and leave newly required work outstanding for a later explicitly authorized Run. The active run exposes aggregate progress and can be canceled; status can be refreshed without inference. Cancellation prevents further submissions and activation but cannot recall text already transmitted. Declining note use leaves C-only description analysis available. Consent to transmit for one execution is distinct from permission to use already cached D in annotation/integrated scoring. Neither an edit, clear, note read, profile read, BGG refresh, standard prediction, nor background task can initiate a request.

Before each request, the daemon must verify the active authorization, current pair eligibility, current note states and versions, and unchanged source identity. A changed pair is not sent under stale authorization; unrelated pairs need not be blocked. The one-execution transmission authorization is consumed and expires when that execution ends; it is not a continuing condition for using results that remain valid under cached-D-use permission. Revoking/canceling an active transmission authorization prevents new submissions, cancels in-flight requests where possible, and fences publication of that run even if cancellation fails. This transmission-only revocation or authorization expiry does not by itself withdraw already valid cached judgments. Separately revoking cached-D-use permission durably withdraws any score depending on D before success is observable; physical cleanup of D and shared-request C entries follows and is retryable. If cleanup fails after the authoritative revocation commits, report that revocation succeeded but cache cleanup remains pending; never report that the permission is still enabled or allow those entries to score. Revocation cannot promise erasure of text already transmitted or provider-held copies.

The collection is authoritative for owner notes, Jev semantic preferences/weights, cached-D-use permission, and durable monotonic policy/source fences. The daemon-owned SQLite database stores only disposable derived numeric pair judgments, active-run progress, and advisory activation metadata; it is not embedded in collection JSON. Do not persist note text in consent or run metadata and do not mirror Jev permission flags into the legacy factual redundancy settings file. A cached signal is usable only after validating current collection policy/permission, eligibility, and exact source identity; missing, corrupt, stale, failed, or blocked signal data is omitted for that pair, not treated as zero. Score each eligible pair from F and its available positive-weight C/D signals, normalized by included weight; F+D and F-only are valid outcomes, and a pair with no available positive-weight component is omitted. A cached numeric zero is a present valid signal. Valid pairs may therefore be partially blended while other pairs remain factual-only; report honest partial status and aggregate coverage. Full coverage is not a scoring prerequisite, and activation metadata is advisory/inert for scoring. Keep source/policy fences distinct from the collection revision, which by itself is not an evidence identity. Note writes, relevant source changes, and revocations must be coordinated with cache invalidation and result publication so stale provider results cannot recreate purged rows. Use a short serialized local critical section for mutation/purge or durable-fence updates, final authoritative-input verification plus SQLite result upsert, and activation/revocation checks. Do not hold a transaction or coordinator during a provider/network call; revalidate exact sent inputs and current authorization/permission after the response before storing its judgment. This is coordinated ordering across authorities, not an atomic cross-file transaction. Transmission authorization is one-execution only and is not a continuing condition for later reuse of results that remain valid under cached-D-use permission. Changing or revoking cached-D-use permission withdraws D-dependent scoring immediately through the collection-authoritative permission/fence, then purges D and shared-request C entries; transmission-only revocation fences the active Run but does not by itself withdraw otherwise valid cached judgments. If required invalidation or verification fails, fail closed rather than serve stale semantic scores.

D is one Jev Score comparing two current `present` notes; there is no separate relevance/firsthand gate. The rubric must compare only what the notes document and must not invent play experiences where none are documented. Confidence is validated and retained as metadata, but never filters or downweights a valid score. Do not substitute ratings, BGG descriptions/comments, or historical note text. Every accepted note set increments its note version, including an identical-text set; a clear from `present` increments it as well. C+D requests contain both notes in shared state, so both judgments depend on both notes and versions, even when C instructions say to ignore notes. A C-only request contains no note fields. Cache only numeric answers and minimal provenance; never persist prompts, note excerpts, free-form answers, or prior note text. A rubric/question version change invalidates cached judgments from the prior version before reuse/publication. A note set, clear, or game deletion must invalidate/purge affected D and shared-request C judgments before mutation success is observable; note edits do not invalidate independent C-only judgments where their inputs remain valid. Revoking cached-D-use similarly withdraws D-dependent scoring and purges D and shared-request C entries. Stale in-flight results must be fenced after provider completion and discarded rather than reinserted. Independently persisted note-derived profile/display artifacts require targeted invalidation before mutation success; do not clear factual-only wishlist snapshots as a substitute.

Note text is untrusted content. All clients must escape it for their output context. Web presentation does not create active links, execute markup, or interpolate note content into executable prompts or commands.

## Lifecycle And Special Cases

### Ownership And Refresh

- Notes remain readable and editable when a game changes between `owned` and `previously-owned`.
- Re-owning a game preserves the same note state and version.
- BGG refresh, BGG ID changes, rating changes, manual-value changes, play-evidence changes, acquisition changes, shelf moves, scoring, and profile recomputation preserve note state exactly.
- Manual games and games without a BGG ID support notes identically to BGG-linked games.
- BGG collection import initializes new games as `missing` and skips existing games under its current identity rules without changing their notes.
- BGG `<comment>`, private notes, descriptions, and play-session comments are not imported into owner notes.

### Permanent Deletion

Notes do not independently block permanent deletion and do not override any existing non-note deletion blocker. In particular, intention history continues to block deletion under its approved contract. When deletion is otherwise eligible, it removes the current note state and every note command receipt associated with the game in the same accepted collection mutation and creates no note tombstone outside the game.

The permanent-delete confirmation must state that an existing owner note will be deleted and cannot be restored by Shelf Judge. A failed or blocked deletion preserves the game, note, and receipts together. Runtime collection validation must reject a note receipt whose game no longer exists. Command IDs are globally unique across durable intention and note command records so one accepted command ID cannot acquire a second meaning in another command family.

### Backup, Import, And Export

Shelf Judge has no first-class collection export or restore operation in this release. Manual filesystem recovery is supported only by stopping the daemon, copying or replacing the complete data directory as one unit, and allowing normal validation and migration to run when the daemon restarts. Because owner notes are durable collection source data, that complete-directory backup and recovery includes them. Documentation must tell the owner to stop the daemon and back up the complete data directory before a schema-version-6 upgrade and must not describe `profile.json` or other derived artifacts as the source of notes.

BGG import and any BGG-oriented export do not read or write owner notes. A future first-class private export must explicitly define whether it includes notes and command metadata; this specification does not establish such a format.

### Concurrency And Replay

Every mutating request carries a client-generated UUID command ID and the exact expected note version. The daemon evaluates it inside the shared serialized collection-mutation boundary.

- The expected version must equal the current note version before a new command can change state.
- A stale expected version returns a conflict containing the complete current note state and performs no write.
- Every valid set or clear reserves its command ID through a durable receipt and advances the collection revision atomically. A state-changing command also persists the resulting note. An `already-clear` command leaves note and game versions and update times unchanged.
- Replaying the same command ID with the same canonical operation, route-owned game ID, expected version, and normalized payload returns the original accepted mutation metadata without another write or version increment.
- Reusing a command ID with a different canonical payload, operation, game ID, or expected version fails as command reuse.
- Persistence failure reports no success and leaves no note change or receipt.
- Note version and collection revision overflow are rejected without a write.

Receipts must not retain prior note text. A set receipt may retain a cryptographic fingerprint of the canonical request plus the accepted game ID, state, note version, update time, and collection revision needed to validate and replay the acceptance metadata. The retried request supplies its own text; Shelf Judge exposes no history or retrieval operation for superseded text. The fingerprint is not a promise of forensic erasure against an attacker testing guesses against raw storage. Secure deletion of old storage copies and metadata-resistant receipts are outside this release. Receipts follow the current durable no-expiry replay policy until a separately specified retention policy replaces it.

Multiple independent daemon processes writing the same collection remain outside the supported concurrency model. Web tabs, CLI processes, and other clients using one daemon are protected by note versions and the shared mutation coordinator.

## Requirements

1. **REQ-GAME-NOTE-1:** Every game must have exactly one durable owner-note slot in state `missing`, `present`, or `cleared`, with the state, version, update-time, and text invariants defined by the Note Model.
2. **REQ-GAME-NOTE-2:** A new or migrated game must begin at `missing` version `0` with no text or update time, and migration must not derive note content from BGG, wishlist, axis, rating, play, ownership, or other existing data.
3. **REQ-GAME-NOTE-3:** An accepted set command must normalize and validate plain text by the Text Rules, change the slot to `present`, use daemon acceptance time, and increment the note version exactly once.
4. **REQ-GAME-NOTE-4:** Whitespace-only, over-limit, NUL-containing, or otherwise invalid text must fail with field-specific validation and must never be interpreted as a clear command.
5. **REQ-GAME-NOTE-5:** A clear command on a present note must remove its text, change the slot to `cleared`, and increment its version exactly once; clearing a missing or cleared slot must return `already-clear`, reserve and replay the command ID, and leave note version, note update time, and game update time unchanged.
6. **REQ-GAME-NOTE-6:** The durable collection must retain only the current note state. It must not retain prior note text through revisions, clear operations, command receipts, caches, logs, or durable generated artifacts. Note-dependent durable artifacts must purge superseded text before mutation success is observable; already delivered ephemeral output may remain only in page or process memory under the explicit non-restoration, no-retransmission, and superseded-citation rules.
7. **REQ-GAME-NOTE-7:** Notes must remain owner testimony only and must not automatically create or alter ratings, axes, intentions, roles, attention items, ownership decisions, profile claims, or recommendations.
8. **REQ-GAME-NOTE-8:** The daemon must own note reads and mutations through strict shared runtime contracts and the common serialized collection-mutation boundary; clients must not edit collection files directly.
9. **REQ-GAME-NOTE-9:** Set and clear must require a globally unique command ID and expected note version, reject stale versions with current note state, durably reserve every valid command ID including `already-clear`, replay the same canonical command without another mutation, and reject changed command-ID reuse across note and intention command families.
10. **REQ-GAME-NOTE-10:** An accepted note mutation, collection revision, and replay receipt must persist atomically; validation, overflow, or persistence failure must preserve the prior game, note, collection revision, and receipt set.
11. **REQ-GAME-NOTE-11:** Note command receipts must support replay without retaining prior note text, must reference an existing game, and must be removed atomically when their game is permanently deleted; receipt fingerprints do not constitute a secure-erasure guarantee.
12. **REQ-GAME-NOTE-12:** The dedicated note read contract and game-detail response must expose complete validated note state; Collection list, Profile, search, prediction, Tournament, add-game, and unrelated mutation responses must use strict projections that omit the entire note field, while note mutation results omit text.
13. **REQ-GAME-NOTE-13:** The web game-detail page must provide equivalent read, set, and confirmed-clear behavior for owned and previously owned games, use explicit save rather than autosave, and preserve an unsaved draft through validation, transport, persistence, and stale-version failures.
14. **REQ-GAME-NOTE-14:** A web stale-version response must show the current server note while preserving the local draft and disabling save; only explicit **Keep my draft** selection may adopt the current version and enable a new command, while **Load saved note** must confirm before discarding a differing draft.
15. **REQ-GAME-NOTE-15:** The CLI must provide discoverable `get`, `set`, and `clear` commands with human and JSON output, print an auto-generated command ID before a mutation attempt, and return structured failures on standard error with a nonzero exit status.
16. **REQ-GAME-NOTE-16:** Notes must work offline and identically for manual, BGG-linked, owned, and previously owned games; BGG import and refresh must never populate, replace, clear, or reinterpret them.
17. **REQ-GAME-NOTE-17:** Ownership transitions, re-ownership, and unrelated game mutations must preserve note state exactly; when no existing non-note blocker prevents permanent game deletion, deletion must disclose and atomically remove the note and associated receipts without creating a separate archive.
18. **REQ-GAME-NOTE-18:** Collection schema version 5 must migrate atomically and repeatably to version 6 with honest missing note states; failed or interrupted migration must leave the last valid collection loadable, and downgrade after a successful version-6 write is unsupported.
19. **REQ-GAME-NOTE-19:** Documentation must state that stopped-daemon complete-data-directory backup and recovery include notes, no first-class application export or restore exists, and BGG import/export does not carry owner notes.
20. **REQ-GAME-NOTE-20:** Routine logs, errors, operation discovery, Collection and Profile payloads, telemetry, and fixtures derived from real owner data must omit note text while retaining enough identifiers, versions, triggers, and outcomes to diagnose mutations.
21. **REQ-GAME-NOTE-21:** Note reads, saves, clears, profile reads, profile recomputation, BGG operations, standard predictions, and background work must make no model call and must not transmit note text outside the local Shelf Judge boundary. The sole approved exception is an explicit owner-triggered Jev redundancy **Run**, through the daemon-owned typed-Jev capability, using only current notes for eligible pairs and only under the aggregate disclosure, one-execution authorization, source checks, and publication fences in **Approved Jev Redundancy Run Exception**. Without note authorization, a Run may use descriptions only and must contain no note fields.
22. **REQ-GAME-NOTE-22:** Web output must render notes as escaped plain text with preserved line breaks and wrapping, never as active HTML or Markdown; other consumers must treat note text as untrusted content for their output context.
23. **REQ-GAME-NOTE-23:** The note editor must have an accessible name and description, associated length and field-error feedback, keyboard operation, visible focus, non-color-only dirty/pending/success/error/conflict states, status announcements, and focus recovery after mutation.
24. **REQ-GAME-NOTE-24:** The note editor, conflict presentation, confirmation, and complete note text must fit without horizontal page overflow in current Chromium at `375x812`, `768x1024`, and `1440x900` CSS pixels and at 200% desktop zoom; actions may stack, touch targets must be at least `44x44` CSS pixels, and mobile form text must be at least `16px`.
25. **REQ-GAME-NOTE-25:** Reads must never mutate note state, update time, version, command receipts, collection revision, or disposable artifacts.
26. **REQ-GAME-NOTE-26:** Collection and profile behavior must remain unchanged apart from safe cache invalidation caused by the canonical collection revision; neither surface may add note badges, excerpts, search, filters, ordering, or generated interpretation. When Jev redundancy is enabled, its authorized numeric pairwise signal may affect redundancy annotation/integrated fitness as specified by that feature; it does not add note content or note-derived claims to Collection/Profile surfaces.

## Technical Contract

This section constrains boundaries needed for consistent behavior. Exact file placement and implementation sequence belong in the plan.

### Durable State

The current collection schema advances from version 5 to version 6. Every durable game contains:

```ts
type OwnerGameNote =
  | { state: "missing"; version: 0; updatedAt: null }
  | {
      state: "present";
      version: number; // positive safe integer
      updatedAt: string; // daemon-supplied ISO 8601
      text: string;
    }
  | {
      state: "cleared";
      version: number; // positive safe integer
      updatedAt: string; // daemon-supplied ISO 8601
    };
```

The game ID plus note version identifies evidence for future consumers; the first release needs no separate note ID. `Game.updatedAt` and note timestamps advance only for a state-changing set or clear. `Collection.updatedAt` and the collection revision advance whenever a valid mutating command and receipt are persisted, including `already-clear`.

The migration from version 5 to 6 adds `{ state: "missing", version: 0, updatedAt: null }` to every game. It preserves every other validated field. New manual and BGG-imported games receive the same initial state.

### Public Operations

Operation discovery exposes stable operations equivalent to:

| Operation               | Request                                                     | Successful result                                     |
| ----------------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| `shelf.game.note.get`   | Route-owned game ID                                         | Complete current `OwnerGameNote`                      |
| `shelf.game.note.set`   | Route-owned game ID, `commandId`, `expectedVersion`, `text` | Accepted note metadata and replay status              |
| `shelf.game.note.clear` | Route-owned game ID, `commandId`, `expectedVersion`         | Accepted or unchanged note metadata and replay status |

Request schemas are strict. A body-supplied game ID is not accepted. `commandId` is a UUID. `expectedVersion` is a nonnegative safe integer. The daemon canonicalizes line endings before hashing, validation, command-reuse comparison, persistence, and response validation.

A successful mutation result contains the command ID, game ID, resulting note state without text, resulting note version and update time, resulting collection revision, and whether the result was replayed or `already-clear`. The client obtains canonical text through its preserved set request or a subsequent validated note/detail read. This keeps durable replay metadata from becoming note history.

Errors form a shared discriminated runtime contract for:

- field validation;
- game not found;
- stale expected note version with complete current note state;
- command ID reused with a different canonical request;
- note or collection revision overflow; and
- persistence failure.

Exact HTTP paths and status mappings belong in design, but web and CLI must consume the same operation semantics.

### Derived Artifacts

Owner notes are durable source data. Profile caches, future reflection results, search indexes, embeddings, and model summaries are derived artifacts and cannot become the only copy of note text. Jev pairwise numeric judgments are derived artifacts, not note history or a replacement source; their minimal provenance must identify current source versions and authorization without storing note text.

An accepted note mutation advances the collection revision. Existing disposable profile data may be invalidated and recomputed even though the current deterministic profile ignores notes. Profile output and arithmetic must otherwise remain identical. Future note-aware reflections must version their own evidence and staleness contracts rather than changing note source semantics.

The Jev pair cache uses daemon-owned SQLite for disposable derived pair judgments and related active-run progress/activation metadata; the collection remains authoritative for notes, semantic preferences, cached-D-use permission, and durable validity fences. Any accepted note set (including identical text), clear, or deletion must invalidate/purge affected D and shared-request C judgments before the source mutation is observable. Independent C-only judgments may remain valid when note inputs were not sent. A description change invalidates affected C judgments and D judgments from shared C+D requests, but not independent D-only judgments. Revoking cached-D-use withdraws D-dependent scoring immediately and purges D plus shared-request C rows. At read time, each eligible pair uses F and whichever positive-weight C/D cache entries remain individually valid/current/permitted, normalized by included weight; omit missing/stale/blocked components rather than assigning zero, while preserving cached zero as valid. F-only pairs remain scored, valid rows on other pairs can be blended, and no complete-coverage activation is required. Aggregate status/coverage must honestly describe partial availability; activation is advisory/inert for scoring. Independently persisted note-derived profile/display artifacts require targeted invalidation before mutation becomes observable. Writers capture the exact source, policy, and consent identities; final verification and result write must serialize with collection mutation/revocation in a short local critical section, with post-provider checks, never a lock held during computation or network calls. Serving validates cache identity against current collection authority, including after restart. No other writer may persist note-derived artifacts. Invalidation failure aborts note mutation; a successful purge followed by collection-write failure leaves the original note state intact and may require benign recomputation. There is no atomic transaction spanning collection storage and SQLite; order them through the coordinator and fail closed on uncertainty. Do not use a broad wishlist invalidator that erases factual-only wishlist snapshots.

## Out Of Scope

- Multiple notes, chronological journals, revision browsing, undo, restore, or prior-text retention
- Structured roles, occasions, tags, sentiment, decisions, or note templates
- Markdown, rich text, HTML, attachments, images, links, or embedded media
- Autosave, collaborative editing, field-level merging, or multiple-daemon-process coordination
- Collection-row note badges, excerpts, search, filters, sorting, or bulk editing
- Importing BGG comments, BGG private notes, play-session comments, wishlist annotations, or other external prose
- First-class application export or restore, cloud backup, sync, sharing, authentication, secure erasure, or encryption at rest
- Automatic conversion of notes into intentions, roles, ratings, axes, corrections, attention, or profile identity
- LLM summarization, reflection, chat, embeddings, and any unrequested or automatic prompt construction or network transmission of note text. The sole approved exception is the explicit Jev redundancy Run contract above; it does not authorize any call outside that user-triggered operation.
- CLI editor launching, file input, or stdin note input

## AI Validation

1. Trace each requirement to the goal, one representative experience, or a named lifecycle/privacy boundary. Reject any behavior that treats notes as structured roles, intentions, ratings, profile claims, or model instructions.
2. Parse exact fixtures for missing, present, and cleared notes. Reject missing states with text or timestamps, present states with absent/invalid text, cleared states with text, unsafe versions, malformed timestamps, unknown fields, and collection games lacking the current note field.
3. Exercise text normalization and validation with CRLF, bare CR, LF, tabs, leading/trailing whitespace, whitespace-only strings, combining characters, astral Unicode code points, exactly 10,000 and 10,001 code points, NUL, other C0 controls, long unbroken strings, and HTML/Markdown-like text. Verify accepted text round-trips exactly after line-ending normalization and renders inertly.
4. Run the complete note lifecycle: missing to present, present to present, present to cleared, cleared to present, and permanent game deletion. Verify exact version, timestamp, game update time, collection update time, collection revision, and receipt behavior; verify clearing missing or cleared returns `already-clear`, reserves its command ID, advances only collection-level mutation metadata, and replays exactly.
5. Open one note in two clients, save one edit, and submit the other against the stale version. Verify the second write is rejected, the saved text remains current, the web preserves and displays the unsaved draft beside current state, save remains disabled, **Keep my draft** adopts the displayed version and enables a new command ID, and **Load saved note** confirms before discarding differing text.
6. Simulate a lost successful response, restart the daemon, and replay the same command ID and canonical request. Verify the original acceptance metadata returns without another note or collection revision. Reuse the ID with changed text, line-ending-equivalent text, changed expected version, changed operation, and changed game ID; accept only the canonically identical request and reject every substantive change.
7. Inspect persisted collection data after several edits and a clear. Verify no prior note text exists in current state, receipts, profile cache, wishlist artifacts, logs, errors, temporary files after successful atomic replacement, or generated snapshots. Verify receipts can still distinguish changed command reuse without storing the text, document that a request fingerprint is not forensic erasure, and find no Shelf Judge operation that restores superseded text.
8. Inject validation, note-version overflow, collection-revision overflow, and persistence failures. Verify no success is reported and game state, note state, collection revision, and receipts remain at the last accepted values. Exercise a process restart after failure.
9. Migrate real-filesystem fixtures from every supported historical collection version through version 6. Verify each game gains exactly the missing state, no source text is copied, all existing data remains valid, repeat load is stable, derived artifacts are safely invalidated, and simulated migration interruption preserves the prior valid collection.
10. Create notes on a manual game, BGG-linked game, owned game, and previously owned game. Exercise BGG refresh, BGG ID edits, rating, manual value, acquisition, play count, shelf, ownership, re-ownership, scoring, profile reads, and daemon restart. Verify every unrelated operation preserves note state byte-for-byte.
11. Import a BGG collection containing comments and private-note-like fields. Verify new games start missing, existing games retain their notes, and no external prose enters owner-note state. Confirm the import still works offline where its existing contract permits and note operations never require BGG access.
12. Permanently delete a game with a present note and receipts. Verify existing intention history still blocks deletion and preserves all data; when otherwise eligible, verify the UI discloses irreversible note deletion, accepted deletion removes all associated note data atomically, failed deletion preserves all of it, and runtime validation rejects orphan receipts or duplicate command IDs across command families.
13. Inspect daemon logs, operation discovery, errors, Collection list, Profile, search, prediction, Tournament, add-game, unrelated mutation JSON, CLI help, and production browser output. Verify the entire note field appears only in approved dedicated note/game-detail reads and owner-requested CLI output, mutation results contain metadata without text, and no note text appears in logs, broad payloads, or executable markup.
14. Exercise web and CLI get, set, clear, generated command ID, explicit command ID, human output, JSON output, validation error, stale conflict, command reuse, transport failure, persistence failure, replay, missing game, missing state, present state, and cleared state. Validate every request and response at each process boundary.
15. Verify explicit save, dirty-state visibility, clear confirmation, draft preservation, conflict review, focus behavior, status announcements, label and description association, field errors, keyboard operation, visible focus, non-color states, and inert rendering with a screen-reader-oriented accessibility audit.
16. Exercise the rendered game-detail page in current Chromium at `375x812`, `768x1024`, and `1440x900` CSS pixels and at 200% desktop zoom. Verify no horizontal page overflow, clipped text, hidden draft/current conflict content, hover-only behavior, target below `44x44` CSS pixels, mobile input zoom, or inaccessible confirmation.
17. Stop the daemon, back up and replace the complete data directory, then restart and verify normal validation preserves current notes and replay behavior. Verify documentation accurately states the schema upgrade, unsupported downgrade, stopped-daemon recovery procedure, lack of first-class application export/restore, and BGG import exclusion.
18. Instrument network and model boundaries while reading and mutating notes, loading Collection and Profile, recomputing the profile, refreshing BGG data, running standard prediction, and waiting idle. Verify no note text leaves the local Shelf Judge boundary and no model call occurs in these operations. For the Jev Run interface, verify direct aggregate preview, explicit Run, active-run progress/cancel/refresh-status, and that C-only requests contain no note fields while note-bearing requests require fresh one-execution disclosure/authorization. Test exact pair eligibility and current source/version checks, cached-D-use separation, consent mismatch, edit/clear/deletion invalidation without blocking edits, revocation and activation fencing, stale in-flight completion, restart, shared-request C dependency, absence of text from responses/logs/cache, and failure compensation. Do not require or test pair-manifest download, pair-by-pair acknowledgement, or pair locks. Verify no request starts from a note mutation/read, profile read, BGG refresh, prediction, or background task. Prove artifact writers cannot recreate invalidated note-derived output and factual-only wishlist snapshots survive note changes.
19. Run repository typecheck, lint, changed-file formatting checks, all automated tests, production build, and browser suite. Distinguish accepted repository-wide baseline failures from feature-introduced failures.
20. Ask a fresh reviewer to explain missing versus cleared, why notes do not imply structured meaning, how stale drafts and lost responses are protected, where note text may appear, what migration fabricates, and what permanent deletion removes. Treat any ambiguous answer as a specification defect.

## Owner Review Decisions

The owner approved these first-release choices on 2026-08-30:

1. **Note model:** one plain-text note per game; multiple entries and structured semantics are deferred.
2. **History:** retain current state and distinguish an explicit clear, but do not retain prior note text.
3. **Mutation safety:** require note-local version conflicts and durable command-ID replay.
4. **Permanent deletion:** delete the note with the permanently deleted game rather than blocking deletion or archiving the note separately.

The owner subsequently approved the narrow Jev redundancy transmission exception and one daemon-owned inference gateway with a typed-Jev capability alongside the existing grounded pi-agent capability. These are authoritative future contracts, not statements of implementation or permission for any transmission before the feature and controls are implemented. Existing note lifecycle, no-history, broad-response omission, and pi-agent grounded-analysis boundaries remain intact.

Changing one of these choices requires updating the examples, requirements, technical contract, and validation together before approval.

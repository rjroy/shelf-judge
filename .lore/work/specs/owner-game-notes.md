---
title: Owner game notes
date: 2026-08-30
status: approved
tags: [collection, game-detail, notes, owner-context]
modules: [shared, daemon, cli, web]
related:
  - .lore/work/specs/useful-collection-profile.md
  - .lore/work/specs/grounded-profile-reflections.md
  - .lore/work/specs/collection-analyst-chat.md
  - .lore/work/design/manual-game-value-edit-lifecycle.md
  - .lore/work/specs/game-view-next-previous-navigation.md
req-prefix: GAME-NOTE
---

# Owner Game Notes

## Goal

Shelf Judge must let the owner preserve context about an individual game that ratings, play counts, BGG metadata, and ownership status cannot express. A note can record why a game matters, the role or occasion the owner associates with it, reservations, memories, or questions worth revisiting.

The first release provides one durable plain-text note slot on every game. The note is owner-authored testimony: it records what the owner wrote, but it does not automatically become a rating, play intention, collection role, model input, factual correction, profile claim, or recommendation.

The feature must work for owned and previously owned games, games with or without BGG identities, and fully offline use. The game-detail page is the canonical editing destination. The CLI provides equivalent read, set, and clear operations.

## Representative Experiences

### Recording Why A Game Belongs

The owner opens _Captain Sonar_ and writes:

> Keep for larger groups. It creates a kind of noisy team coordination that none of my other games provide, but it needs exactly the right group.

The owner explicitly saves. Shelf Judge confirms the save and later displays the text with its line breaks intact. The note remains attached to the game after BGG refreshes, rating changes, shelf moves, daemon restarts, and a transition to previously owned and back.

Shelf Judge does not create a `large-group` role, replay intention, attention item, or profile statement from the prose. A later feature may use this note only through its separately approved evidence and privacy contract.

### Protecting A Draft From A Stale Edit

The owner opens the same game in two browser tabs. Both load note version 4. The first tab saves an edit, producing version 5. The second tab then tries to save its different draft with expected version 4.

Shelf Judge rejects the second save instead of overwriting version 5. The page keeps the unsaved draft, shows the current saved note and version, and asks the owner to review the conflict. Saving after review is a new command against version 5.

If the first tab's response is lost after the daemon commits it, retrying the same command ID with the same canonical request returns the original accepted result. It does not create version 6. Reusing that command ID with different text fails.

### Clearing And Permanently Deleting

The owner clears a note through a separate destructive action and confirms that note reads cannot display or restore the prior text. The game now records that its note was cleared, including a new version and update time, but it retains no prior note text. This state is visibly different from a game on which no note has ever been authored. Clear is not a secure-erasure facility for old filesystem copies, process memory, or owner-created backups.

A separately approved model feature may already have rendered ephemeral output that quoted the then-current note. That output is not note storage or a restore path: Shelf Judge must not persist it, resolve its citation as current testimony, or retransmit it to a provider after the note changes. Durable note-derived artifacts must purge the affected output before the note mutation is observable. Ephemeral output already present in page or process memory may remain visible until that context is discarded, with its citation marked superseded when revalidated; this is part of the stated process-memory limitation rather than retained note history.

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

Note text must not appear in routine logs, operation-discovery examples, error messages, profile payloads, collection-list payloads, telemetry, or generated test snapshots containing real owner data. Logs may include operation, trigger, game ID, expected and resulting note versions, command ID, replay status, and outcome.

No note operation makes a network or model call. Notes are not sent to an LLM by profile reads, profile recomputation, BGG refresh, or any background process. Future reflections or chat must define an explicit owner-visible model operation, transmitted evidence scope, citation contract, stale-note behavior, and failure behavior before receiving note text.

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
21. **REQ-GAME-NOTE-21:** Note reads, saves, clears, profile reads, profile recomputation, BGG operations, and background work must make no model call and must not transmit note text outside the local Shelf Judge boundary.
22. **REQ-GAME-NOTE-22:** Web output must render notes as escaped plain text with preserved line breaks and wrapping, never as active HTML or Markdown; other consumers must treat note text as untrusted content for their output context.
23. **REQ-GAME-NOTE-23:** The note editor must have an accessible name and description, associated length and field-error feedback, keyboard operation, visible focus, non-color-only dirty/pending/success/error/conflict states, status announcements, and focus recovery after mutation.
24. **REQ-GAME-NOTE-24:** The note editor, conflict presentation, confirmation, and complete note text must fit without horizontal page overflow in current Chromium at `375x812`, `768x1024`, and `1440x900` CSS pixels and at 200% desktop zoom; actions may stack, touch targets must be at least `44x44` CSS pixels, and mobile form text must be at least `16px`.
25. **REQ-GAME-NOTE-25:** Reads must never mutate note state, update time, version, command receipts, collection revision, or disposable artifacts.
26. **REQ-GAME-NOTE-26:** Collection and profile behavior must remain unchanged apart from safe cache invalidation caused by the canonical collection revision; neither surface may add note badges, excerpts, search, filters, ordering, or generated interpretation in this release.

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

Owner notes are durable source data. Profile caches, future reflection results, search indexes, embeddings, and model summaries are derived artifacts and cannot become the only copy of note text.

An accepted note mutation advances the collection revision. Existing disposable profile data may be invalidated and recomputed even though the current deterministic profile ignores notes. Profile output and arithmetic must otherwise remain identical. Future note-aware reflections must version their own evidence and staleness contracts rather than changing note source semantics.

## Out Of Scope

- Multiple notes, chronological journals, revision browsing, undo, restore, or prior-text retention
- Structured roles, occasions, tags, sentiment, decisions, or note templates
- Markdown, rich text, HTML, attachments, images, links, or embedded media
- Autosave, collaborative editing, field-level merging, or multiple-daemon-process coordination
- Collection-row note badges, excerpts, search, filters, sorting, or bulk editing
- Importing BGG comments, BGG private notes, play-session comments, wishlist annotations, or other external prose
- First-class application export or restore, cloud backup, sync, sharing, authentication, secure erasure, or encryption at rest
- Automatic conversion of notes into intentions, roles, ratings, axes, corrections, attention, or profile identity
- LLM summarization, reflection, chat, embeddings, prompt construction, or network transmission of note text
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
18. Instrument network and model boundaries while reading and mutating notes, loading Collection and Profile, recomputing the profile, refreshing BGG data, and waiting idle. Verify no note text leaves the local Shelf Judge boundary and no model call occurs.
19. Run repository typecheck, lint, changed-file formatting checks, all automated tests, production build, and browser suite. Distinguish accepted repository-wide baseline failures from feature-introduced failures.
20. Ask a fresh reviewer to explain missing versus cleared, why notes do not imply structured meaning, how stale drafts and lost responses are protected, where note text may appear, what migration fabricates, and what permanent deletion removes. Treat any ambiguous answer as a specification defect.

## Owner Review Decisions

The owner approved these first-release choices on 2026-08-30:

1. **Note model:** one plain-text note per game; multiple entries and structured semantics are deferred.
2. **History:** retain current state and distinguish an explicit clear, but do not retain prior note text.
3. **Mutation safety:** require note-local version conflicts and durable command-ID replay.
4. **Permanent deletion:** delete the note with the permanently deleted game rather than blocking deletion or archiving the note separately.

Changing one of these choices requires updating the examples, requirements, technical contract, and validation together before approval.

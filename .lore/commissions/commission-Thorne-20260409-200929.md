---
title: "Commission: Review: Utility Curves Phase 5+6"
date: 2026-04-10
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review Phase 5 (Web UI) and Phase 6 (CLI) of the utility curves implementation.\n\nRead the plan at `.lore/plans/utility-curves.md` for Phase 5 and Phase 6 context.\n\n**Phase 5 (Web) checks:**\n1. Axis config UI: shape selector, sweet spot controls, curve preview, veto threshold config\n2. Score breakdown: raw vs effective columns, curve-affected highlighting, veto banner\n3. Collection table: veto badge display\n4. curve-math.ts: Does the client-side math match the daemon's curve-engine.ts?\n5. Local Axis type: Updated to include curve fields?\n6. API helpers: createAxis/updateAxis accept curve config?\n\n**Phase 6 (CLI) checks:**\n1. New flags: --shape, --ideal, --tolerance, --lean, --veto-below, --veto-above, --no-veto\n2. axisList: Shape column and veto indicator\n3. Score display: Raw column, curve-affected markers, veto output\n4. JSON output: Mirrors FitnessResult with all new fields\n5. Arg parsing: New flags recognized in index.ts\n\n**Cross-cutting:**\n- Native-scale values shown correctly for both personal and BGG axes (REQ-CURVE-26)\n- Veto display visually distinct from low scores (REQ-CURVE-22)\n\nRun `bun run test` and `bun run typecheck`.\n\nReport all findings."
dependencies:
  - commission-Dalton-20260409-200910
  - commission-Dalton-20260409-200920
linked_artifacts:
  - .lore/plans/utility-curves.md

activity_timeline:
  - timestamp: 2026-04-10T03:09:29.609Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T03:09:29.611Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-10T03:59:36.661Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-10T03:59:36.663Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-10T03:59:36.684Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-10T03:59:42.125Z
    event: progress_report
    reason: "Starting review of Phase 5 (Web UI) and Phase 6 (CLI) utility curves implementation. Reading the plan first."
  - timestamp: 2026-04-10T04:00:13.060Z
    event: progress_report
    reason: "Plan fully read. Starting parallel file reads for Phase 5 (Web UI) and Phase 6 (CLI) implementation files."
  - timestamp: 2026-04-10T04:01:03.511Z
    event: progress_report
    reason: "All source files read. Now running typecheck and tests, plus checking for the veto confirmation dialog requirement and BGG axes onNameChange/onDescChange props."
  - timestamp: 2026-04-10T04:01:25.963Z
    event: progress_report
    reason: "Blocked: no shell/Bash tool available to run `bun run typecheck` and `bun run test`. Requested user provide output or grant browser code execution permission."
  - timestamp: 2026-04-10T04:03:41.136Z
    event: progress_report
    reason: "Static review complete. 7 findings identified. Typecheck/tests could not be run (sub-agent lacked shell access). Compiling final report."
  - timestamp: 2026-04-10T04:04:38.573Z
    event: result_submitted
    reason: "## Review: Phase 5 (Web UI) and Phase 6 (CLI) — Utility Curves\n\n**Scope**: Static code review of all files listed in the plan for Phase 5 and Phase 6. Typecheck and test suite could not be executed (sub-agent lacked shell access). Findings are based on reading the implementation against the plan and spec requirements.\n\n---\n\n### Finding 1 — DEFECT: Game detail page divergence check uses vetoed score\n\n**File**: `packages/web/app/games/[id]/page.tsx:55`\n**Impact**: Every vetoed game with tournament data shows a false \"Score divergence\" banner.\n\nThe divergence check computes `Math.abs(score.score - tournamentStats.normalizedScore) > 2.0`. When a game is vetoed, `score.score` is 0. Any game with a tournament rank above 2.0 triggers the banner, which then renders \"This game's fitness score (0.0)\" (line 197), which is misleading.\n\nThe CLI handles this correctly at `packages/cli/src/commands/score.ts:143`:\n```\nconst compareScore = data.vetoed ? data.hypotheticalScore : data.score;\n```\n\nThe game detail page should use the same pattern. Line 254 has the same issue: \"How 0.0 was calculated\" badge shows for vetoed games.\n\n**Fix**: Replace `score.score` with `score.vetoed ? score.hypotheticalScore ?? 0 : score.score` in the divergence check and in any display that renders inside a potentially-vetoed context.\n\n---\n\n### Finding 2 — DEFECT: BGG AxisCard missing required props\n\n**File**: `packages/web/app/axes/page.tsx:362-389`\n**Impact**: BGG axis editing for name, weight, and description is broken or won't compile.\n\nThe personal axes section (lines 345-347) passes `onNameChange`, `onWeightChange`, and `onDescChange` to `AxisCard`. The BGG axes section (lines 362-389) omits all three. These are required props in the `AxisCardProps` interface (lines 416-418). If TypeScript strict mode is working, this should be a compile error. If it somehow compiles, editing a BGG axis's name/weight/description would crash at runtime.\n\n**Fix**: Add the three missing handlers to the BGG `AxisCard` instances, same as the personal section.\n\n---\n\n### Finding 3 — DEFECT: Client-side curve-math.ts diverges from daemon curve-engine.ts\n\n**File**: `packages/web/lib/curve-math.ts:33, 82`\n**Impact**: Preview behavior silently masks errors that the daemon would reject.\n\nTwo divergences:\n\n1. **getNativeScale** (line 33): Client returns `{min: 1, max: 10}` for unknown bggField. Daemon throws `Error(\"Unknown BGG field: ...\")` (curve-engine.ts:52). If a new BGG field type is added to shared types but not to the curve functions, the daemon rejects it while the client preview renders incorrect curves silently.\n\n2. **Sweet-spot without idealValue** (line 82): Client returns `5` silently. Daemon throws `Error(\"idealValue is required...\")` (curve-engine.ts:123). The preview shows a flat line at 5 instead of signaling a configuration error.\n\nThe plan explicitly calls out that these should be \"the same math\" (~50 lines). The daemon's error-throwing behavior is the correct one. The client's silent fallbacks hide problems.\n\n**Fix**: Match the daemon behavior: throw on unknown bggField, throw (or render an error state) when sweet-spot lacks idealValue.\n\n---\n\n### Finding 4 — MISSING: Veto confirmation dialog\n\n**File**: `packages/web/app/axes/page.tsx` (handleCreate, handleUpdate)\n**Impact**: Users can accidentally set veto thresholds that zero out game scores with no warning.\n\nThe plan (line 489) specifies: \"Enable confirmation dialog before saving ('This will set any game scoring [below/above] [threshold] on this axis to fitness 0. Continue?')\". Neither `handleCreate` (line 132) nor `handleUpdate` (line 164) checks for veto config and prompts for confirmation. The `handleDelete` function (line 192) does use `confirm()` for a destructive action, establishing the pattern. Veto is equally destructive (scores go to 0) and deserves the same treatment.\n\n**Fix**: Before the fetch call in both handlers, check if veto is being enabled. If so, show `confirm(\"This will set any game scoring [below/above] [threshold] on this axis to fitness 0. Continue?\")` and return early if declined.\n\n---\n\n### Finding 5 — DEFECT: CLI formatBreakdown uses exact float comparison\n\n**File**: `packages/cli/src/output.ts:57`\n**Impact**: Spurious \"Raw\" column may appear for personal axes due to floating-point arithmetic.\n\nThe CLI checks `e.rawValue !== e.effectiveRating` (exact equality) to decide whether to show the Raw column. The web uses `Math.abs(entry.rawValue - entry.effectiveRating) > 0.05` (score-breakdown.tsx:69). For personal axes with higher-is-better, rawValue and effectiveRating should be identical, but floating-point operations could introduce tiny differences (e.g., `7.000000000000001`). The web's threshold approach is robust; the CLI's exact comparison is fragile.\n\n**Fix**: Replace `e.rawValue !== e.effectiveRating` with `Math.abs(e.rawValue - e.effectiveRating) > 0.05`.\n\n---\n\n### Finding 6 — MINOR: AxisSortAltScores shows \"0.0\" for vetoed games\n\n**File**: `packages/web/components/collection-table.tsx:568-569`\n**Impact**: Minor display inconsistency when sorting by axis.\n\nThe primary score cell correctly renders a \"VETOED\" badge (lines 531-538). But in the alternate scores column (visible when sorting by axis), `AxisSortAltScores` renders `score.score.toFixed(1)` without checking for veto. Vetoed games show \"0.0\" with a score dot, indistinguishable from a genuinely zero-scoring game. The main score cell handles this; this secondary display doesn't.\n\n**Fix**: Check `score.vetoed` and render a small veto indicator or use hypotheticalScore, matching the primary column behavior.\n\n---\n\n### Finding 7 — UNABLE TO VERIFY: Typecheck and test suite\n\nThe commission requested `bun run test` and `bun run typecheck`. The sub-agent lacked shell access and could not execute them. **Finding 2** (missing required props) should produce a TypeScript error. If typecheck passes despite this, investigate whether the AxisCardProps interface has been made partial or whether the build is using a less strict configuration.\n\n---\n\n### Requirements Verification (Phase 5)\n\n| Requirement | Status | Notes |\n|---|---|---|\n| REQ-CURVE-18: Shape selector with descriptions | Satisfied | Three-option radio with one-line descriptions (lines 596-628) |\n| REQ-CURVE-19: Sweet spot slider + curve preview | Satisfied | Number input with native scale bounds (lines 632-698), SVG preview (lines 761-901) |\n| REQ-CURVE-20: Curve preview showing effective ratings | Satisfied | SVG renders 60-step polyline, updates live (lines 769-783) |\n| REQ-CURVE-21: Veto threshold config | Partially satisfied | Config UI present (lines 704-747), but missing confirmation dialog per plan |\n| REQ-CURVE-22: Veto visual in collection table | Satisfied | VETOED badge with hypothetical score (collection-table.tsx:531-538, CSS lines 1979-1999) |\n| REQ-CURVE-26: Native-scale values shown for BGG axes | Satisfied | Slider min/max from getNativeScale, step 0.25 for weight (line 644) |\n| Local Axis type updated with curve fields | Satisfied | Lines 12-26 include all curve fields |\n| API helpers accept curve config | Satisfied | createAxis and updateAxis in api.ts include all curve fields |\n\n### Requirements Verification (Phase 6)\n\n| Requirement | Status | Notes |\n|---|---|---|\n| REQ-CURVE-23: CLI flags for curve config | Satisfied | --shape, --ideal, --tolerance, --lean, --veto-below, --veto-above, --no-veto all parsed (index.ts:111-124) and passed through (index.ts:224-250) |\n| REQ-CURVE-24: CLI score display with curves | Satisfied | Raw column, * marker, VETOED header with hypothetical (score.ts:62, 130-135) |\n| REQ-CURVE-26: Native-scale BGG values in CLI | Satisfied | Raw column shows native-scale values from daemon response |\n| axisList Shape column | Satisfied | formatShapeColumn with linear↑/linear↓/sweet@X and V indicator (axis.ts:19-34) |\n| JSON output mirrors FitnessResult | Satisfied | printOutput passes daemon response through directly (score.ts:51, 116) |\n| Arg parsing in index.ts | Satisfied | All new flags recognized and passed to command handlers |\n\n### Cross-cutting\n\n| Check | Status |\n|---|---|\n| curve-math.ts matches curve-engine.ts | **Partial** — core math is identical; error handling diverges (Finding 3) |\n| Veto visually distinct from low scores | Satisfied in primary displays; not in AxisSortAltScores (Finding 6) |"
  - timestamp: 2026-04-10T04:04:51.266Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Static review complete. 7 findings identified. Typecheck/tests could not be run (sub-agent lacked shell access). Compiling final report."
projectName: shelf-judge
---
## Review: Phase 5 (Web UI) and Phase 6 (CLI) — Utility Curves

**Scope**: Static code review of all files listed in the plan for Phase 5 and Phase 6. Typecheck and test suite could not be executed (sub-agent lacked shell access). Findings are based on reading the implementation against the plan and spec requirements.

---

### Finding 1 — DEFECT: Game detail page divergence check uses vetoed score

**File**: `packages/web/app/games/[id]/page.tsx:55`
**Impact**: Every vetoed game with tournament data shows a false "Score divergence" banner.

The divergence check computes `Math.abs(score.score - tournamentStats.normalizedScore) > 2.0`. When a game is vetoed, `score.score` is 0. Any game with a tournament rank above 2.0 triggers the banner, which then renders "This game's fitness score (0.0)" (line 197), which is misleading.

The CLI handles this correctly at `packages/cli/src/commands/score.ts:143`:
```
const compareScore = data.vetoed ? data.hypotheticalScore : data.score;
```

The game detail page should use the same pattern. Line 254 has the same issue: "How 0.0 was calculated" badge shows for vetoed games.

**Fix**: Replace `score.score` with `score.vetoed ? score.hypotheticalScore ?? 0 : score.score` in the divergence check and in any display that renders inside a potentially-vetoed context.

---

### Finding 2 — DEFECT: BGG AxisCard missing required props

**File**: `packages/web/app/axes/page.tsx:362-389`
**Impact**: BGG axis editing for name, weight, and description is broken or won't compile.

The personal axes section (lines 345-347) passes `onNameChange`, `onWeightChange`, and `onDescChange` to `AxisCard`. The BGG axes section (lines 362-389) omits all three. These are required props in the `AxisCardProps` interface (lines 416-418). If TypeScript strict mode is working, this should be a compile error. If it somehow compiles, editing a BGG axis's name/weight/description would crash at runtime.

**Fix**: Add the three missing handlers to the BGG `AxisCard` instances, same as the personal section.

---

### Finding 3 — DEFECT: Client-side curve-math.ts diverges from daemon curve-engine.ts

**File**: `packages/web/lib/curve-math.ts:33, 82`
**Impact**: Preview behavior silently masks errors that the daemon would reject.

Two divergences:

1. **getNativeScale** (line 33): Client returns `{min: 1, max: 10}` for unknown bggField. Daemon throws `Error("Unknown BGG field: ...")` (curve-engine.ts:52). If a new BGG field type is added to shared types but not to the curve functions, the daemon rejects it while the client preview renders incorrect curves silently.

2. **Sweet-spot without idealValue** (line 82): Client returns `5` silently. Daemon throws `Error("idealValue is required...")` (curve-engine.ts:123). The preview shows a flat line at 5 instead of signaling a configuration error.

The plan explicitly calls out that these should be "the same math" (~50 lines). The daemon's error-throwing behavior is the correct one. The client's silent fallbacks hide problems.

**Fix**: Match the daemon behavior: throw on unknown bggField, throw (or render an error state) when sweet-spot lacks idealValue.

---

### Finding 4 — MISSING: Veto confirmation dialog

**File**: `packages/web/app/axes/page.tsx` (handleCreate, handleUpdate)
**Impact**: Users can accidentally set veto thresholds that zero out game scores with no warning.

The plan (line 489) specifies: "Enable confirmation dialog before saving ('This will set any game scoring [below/above] [threshold] on this axis to fitness 0. Continue?')". Neither `handleCreate` (line 132) nor `handleUpdate` (line 164) checks for veto config and prompts for confirmation. The `handleDelete` function (line 192) does use `confirm()` for a destructive action, establishing the pattern. Veto is equally destructive (scores go to 0) and deserves the same treatment.

**Fix**: Before the fetch call in both handlers, check if veto is being enabled. If so, show `confirm("This will set any game scoring [below/above] [threshold] on this axis to fitness 0. Continue?")` and return early if declined.

---

### Finding 5 — DEFECT: CLI formatBreakdown uses exact float comparison

**File**: `packages/cli/src/output.ts:57`
**Impact**: Spurious "Raw" column may appear for personal axes due to floating-point arithmetic.

The CLI checks `e.rawValue !== e.effectiveRating` (exact equality) to decide whether to show the Raw column. The web uses `Math.abs(entry.rawValue - entry.effectiveRating) > 0.05` (score-breakdown.tsx:69). For personal axes with higher-is-better, rawValue and effectiveRating should be identical, but floating-point operations could introduce tiny differences (e.g., `7.000000000000001`). The web's threshold approach is robust; the CLI's exact comparison is fragile.

**Fix**: Replace `e.rawValue !== e.effectiveRating` with `Math.abs(e.rawValue - e.effectiveRating) > 0.05`.

---

### Finding 6 — MINOR: AxisSortAltScores shows "0.0" for vetoed games

**File**: `packages/web/components/collection-table.tsx:568-569`
**Impact**: Minor display inconsistency when sorting by axis.

The primary score cell correctly renders a "VETOED" badge (lines 531-538). But in the alternate scores column (visible when sorting by axis), `AxisSortAltScores` renders `score.score.toFixed(1)` without checking for veto. Vetoed games show "0.0" with a score dot, indistinguishable from a genuinely zero-scoring game. The main score cell handles this; this secondary display doesn't.

**Fix**: Check `score.vetoed` and render a small veto indicator or use hypotheticalScore, matching the primary column behavior.

---

### Finding 7 — UNABLE TO VERIFY: Typecheck and test suite

The commission requested `bun run test` and `bun run typecheck`. The sub-agent lacked shell access and could not execute them. **Finding 2** (missing required props) should produce a TypeScript error. If typecheck passes despite this, investigate whether the AxisCardProps interface has been made partial or whether the build is using a less strict configuration.

---

### Requirements Verification (Phase 5)

| Requirement | Status | Notes |
|---|---|---|
| REQ-CURVE-18: Shape selector with descriptions | Satisfied | Three-option radio with one-line descriptions (lines 596-628) |
| REQ-CURVE-19: Sweet spot slider + curve preview | Satisfied | Number input with native scale bounds (lines 632-698), SVG preview (lines 761-901) |
| REQ-CURVE-20: Curve preview showing effective ratings | Satisfied | SVG renders 60-step polyline, updates live (lines 769-783) |
| REQ-CURVE-21: Veto threshold config | Partially satisfied | Config UI present (lines 704-747), but missing confirmation dialog per plan |
| REQ-CURVE-22: Veto visual in collection table | Satisfied | VETOED badge with hypothetical score (collection-table.tsx:531-538, CSS lines 1979-1999) |
| REQ-CURVE-26: Native-scale values shown for BGG axes | Satisfied | Slider min/max from getNativeScale, step 0.25 for weight (line 644) |
| Local Axis type updated with curve fields | Satisfied | Lines 12-26 include all curve fields |
| API helpers accept curve config | Satisfied | createAxis and updateAxis in api.ts include all curve fields |

### Requirements Verification (Phase 6)

| Requirement | Status | Notes |
|---|---|---|
| REQ-CURVE-23: CLI flags for curve config | Satisfied | --shape, --ideal, --tolerance, --lean, --veto-below, --veto-above, --no-veto all parsed (index.ts:111-124) and passed through (index.ts:224-250) |
| REQ-CURVE-24: CLI score display with curves | Satisfied | Raw column, * marker, VETOED header with hypothetical (score.ts:62, 130-135) |
| REQ-CURVE-26: Native-scale BGG values in CLI | Satisfied | Raw column shows native-scale values from daemon response |
| axisList Shape column | Satisfied | formatShapeColumn with linear↑/linear↓/sweet@X and V indicator (axis.ts:19-34) |
| JSON output mirrors FitnessResult | Satisfied | printOutput passes daemon response through directly (score.ts:51, 116) |
| Arg parsing in index.ts | Satisfied | All new flags recognized and passed to command handlers |

### Cross-cutting

| Check | Status |
|---|---|
| curve-math.ts matches curve-engine.ts | **Partial** — core math is identical; error handling diverges (Finding 3) |
| Veto visually distinct from low scores | Satisfied in primary displays; not in AxisSortAltScores (Finding 6) |

## Decisions

**Does curve-math.ts (client-side) match curve-engine.ts (daemon) in behavior?**
Two behavioral divergences found between client and daemon curve math.
*Reasoning: 1. getNativeScale: daemon throws on unknown bggField (curve-engine.ts:52), client returns {min:1, max:10} as fallback (curve-math.ts:33). The plan says these should be "the same math" (~50 lines duplicated). The daemon's throw is the correct defensive behavior per the plan. The client's silent fallback could mask data integrity issues. 2. Sweet-spot without idealValue: daemon throws (curve-engine.ts:123), client returns 5 silently (curve-math.ts:82). The daemon behavior is correct per the plan. The client's silent fallback means if idealValue is somehow missing, the preview would show a flat line at 5 instead of erroring, which could confuse the user into thinking the configuration is valid.*

**Does the game detail page handle vetoed games correctly in the divergence check?**
Defect: divergence check uses score.score (0 when vetoed) instead of hypotheticalScore, causing false divergence banners for vetoed games.
*Reasoning: Game detail page line 55: `Math.abs(score.score - tournamentStats.normalizedScore) > 2.0`. When vetoed, score.score is 0, so any game with a tournament normalizedScore > 2.0 would show a misleading divergence banner saying "fitness score (0.0) and tournament rank differ". The CLI handles this correctly at score.ts:143: `const compareScore = data.vetoed ? data.hypotheticalScore : data.score`. The game detail page should use the same pattern. Additionally, line 197 renders "This game's fitness score (0.0)" inside the divergence banner, and line 254 shows "How 0.0 was calculated" badge, both misleading for vetoed games.*

**Are BGG AxisCard components receiving all required props?**
BGG AxisCard instances are missing onNameChange, onWeightChange, and onDescChange required props (axes/page.tsx lines 362-389). Awaiting typecheck confirmation.
*Reasoning: The personal axes section (lines 319-349) passes onNameChange={setEditName}, onWeightChange={setEditWeight}, onDescChange={setEditDescription}. The BGG axes section (lines 362-389) only passes onCurveChange={setEditCurve} without the other three. The AxisCardProps interface declares all three as required (lines 416-418). If typecheck passes, something unexpected is happening. If typecheck fails, this is a confirmed compile error.*

**Is the veto confirmation dialog implemented as specified in the plan?**
Missing. The plan specifies a confirmation dialog before saving veto config (plan line 489), but the implementation has no such dialog.
*Reasoning: Plan states: "Enable confirmation dialog before saving ('This will set any game scoring [below/above] [threshold] on this axis to fitness 0. Continue?')". Neither handleCreate nor handleUpdate in axes/page.tsx checks for veto config and shows a confirmation. The user can enable a veto and save without any warning about the impact. This is a UI safety gap: veto sets all matching games to fitness 0, which is a destructive action that should have confirmation.*

**Does the CLI formatBreakdown use float-safe comparison for rawValue vs effectiveRating?**
CLI uses exact equality (e.rawValue !== e.effectiveRating) while web uses threshold (Math.abs > 0.05). The CLI should use a threshold.
*Reasoning: output.ts:57: `e.rawValue != null && e.effectiveRating != null && e.rawValue !== e.effectiveRating`. This is an exact float comparison. score-breakdown.tsx:69 uses `Math.abs(entry.rawValue - entry.effectiveRating) > 0.05`. For personal axes with higher-is-better where raw and effective should be identical, floating-point arithmetic could produce tiny differences. This would cause the CLI to show a spurious Raw column. The web handles this correctly with a threshold.*

**Does the AxisSortAltScores component handle vetoed games?**
No. It displays score.score (0 for vetoed) without distinguishing veto from genuinely low scores.
*Reasoning: collection-table.tsx:568-569 shows `score.score.toFixed(1)` for all scored games. The main score cell (lines 531-545) correctly shows a VETOED badge, but when sorting by axis, the alternate scores column (AxisSortAltScores) renders "0.0" with a score dot for vetoed games, indistinguishable from a genuinely zero score. This is a minor inconsistency since the primary score cell is correct, but it could confuse users who sort by axis.*

**Does getScoreDisplay handle vetoed games?**
Not directly, but not a defect because the caller (GameRow) short-circuits vetoed rendering before using getScoreDisplay's output.
*Reasoning: collection-utils.ts:270 shows `score.score.toFixed(1)` for the fitness field, which would be "0.0" for vetoed games. However, in collection-table.tsx:531-538, the GameRow component checks `score?.vetoed` first and renders a VETOED badge, only falling through to the getScoreDisplay-based rendering for non-vetoed games. So getScoreDisplay's ignorance of veto is not a bug in the primary render path. The issue is only in AxisSortAltScores (already recorded).*

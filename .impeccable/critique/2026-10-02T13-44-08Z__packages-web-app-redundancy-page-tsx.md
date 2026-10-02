---
target: redundancy settings page
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/home/rjroy/Projects/games/shelf-judge/packages/web/app/redundancy/page.tsx"
target_fingerprint: "sha256:48b5e1d6fccd702e65552861f2ca3b39a5cb34cb5b9da4c63602468eca21ab7a"
target_path: /home/rjroy/Projects/games/shelf-judge/packages/web/app/redundancy/page.tsx
timestamp: 2026-10-02T13-44-08Z
slug: packages-web-app-redundancy-page-tsx
---
⚠️ DEGRADED: single-context (nested subagents and the desktop browser are unavailable)

## Redundancy settings critique

**Design health: 21/40, acceptable.** Source-based assessment of `packages/web/app/redundancy/page.tsx` and `packages/web/app/globals.css`; live visual behavior could not be inspected.

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | System status | 2 | Run progress is buried below configuration and polls every 60 seconds. |
| 2 | Real-world language | 2 | “JEV,” “reported-token stop threshold,” and “annotation” assume prior knowledge. |
| 3 | Control and freedom | 2 | A prepared run can remain available after editing semantic weights. |
| 4 | Consistency | 3 | Both settings groups use similar save/status patterns. |
| 5 | Error prevention | 2 | Run preview can become inconsistent with unsaved semantic edits. |
| 6 | Recognition over recall | 2 | Users must connect the two save groups, run limits, preview, and status themselves. |
| 7 | Flexibility and efficiency | 2 | Direct controls help repeat use, but advanced options dominate routine setup. |
| 8 | Aesthetic minimalism | 2 | The main task is stretched across two dense sections and a long disclosure. |
| 9 | Error recovery | 2 | General errors appear at the top, away from the affected control. |
| 10 | Help and documentation | 2 | Inline explanations exist, but do not make the limits easy to choose. |
| **Total** | | **21/40** | **Acceptable** |

### Design specificity

The page fits Shelf Judge’s evidence-first approach: it distinguishes factual from written-text comparison and makes provider transmission an explicit step. Its structure is still closer to a technical configuration form than an owner’s decision about how similar games should affect a collection. The run process occupies more cognitive space than the actual scoring choice.

**Detector:** `impeccable detect --json packages/web/app/redundancy/page.tsx` returned **0 findings**. The browser was disconnected, so rendered desktop/mobile views and a live overlay could not be inspected.

### What works

- The **Set preferences → Preview → Run once** sequence makes the provider boundary explicit.
- Local saving is clearly separated from sending descriptions or notes; the preview names the provider, signal scope, and limits.
- Status, loading, retry, and unsaved-change messages are present, with visible focus styling in page CSS.

### Priority issues

1. **[P1] A prepared run can outlive edited semantic weights.** `updateWeight()` at lines 483–488 changes the draft without calling `clearPreparedDisclosure()`, unlike the other settings changes. The preview remains visible, and its **Run one refresh** button at lines 933–939 is not gated by `semanticDirty`. A user can change “Your game notes” weight, then run the previously saved configuration while looking at the newer draft. **Fix:** invalidate the preview for every semantic weight edit and prevent starting whenever either settings group is unsaved. **Suggested command:** `/impeccable harden`.

2. **[P1] The primary decision is obscured by implementation controls.** Two weight systems, similarity threshold, maximum penalty, neighbor behavior, provider attempt limit, token stop threshold, and run duration compete on one page. The introductory three-step strip implies a short path, but the real path requires interpreting many controls before preview. **Fix:** lead with the scoring effect and source/privacy choices; group tuning and per-run limits under clearly labeled advanced sections, with usable defaults. **Suggested command:** `/impeccable distill`.

3. **[P2] Important terms lack decision-level explanations.** “Annotation,” “Integrated,” “JEV,” and “reported-token stop threshold” do not tell a collector what choosing them changes. The stage explanation updates after selection rather than helping compare options before selection. **Fix:** label options by outcome and explain provider, limit, and cost uncertainty next to the controls. **Suggested command:** `/impeccable clarify`.

4. **[P2] Feedback is too far from the active task.** Save and run failures use the top-level error banner at lines 517–520, while the user may be working far down the page. Refresh status appears after preview controls and updates only once per minute while active. **Fix:** place contextual feedback beside each save/run action, and make active progress and cancellation prominent at the start of the run area. **Suggested command:** `/impeccable layout`.

### Cognitive and emotional read

**Moderate-to-high cognitive load:** chunking, one-decision-at-a-time, minimal-choice, and progressive-disclosure checks fail; there are more than four simultaneous configuration decisions before a run. The reassuring “saved locally” message is a strong opening, but uncertainty rises again at the dense provider disclosure and slow-to-update progress. A run outcome should end with a clear statement of what changed in scoring, what remained partial, and what to do next.

**Persona red flags:** Jordan, a first-timer, is likely to stall on “Annotation” versus “Integrated” and the three run-limit fields. Alex, a repeat user, must scroll past explanatory material to check an active run. Sam, using keyboard and screen reader, receives a single run-limit error association on all three number inputs, even though validation identifies one field.

**Minor observations:** both factual weights can be set to zero before save, with no nearby preventive guidance; note-comparison deletion is explained in body text rather than reinforced at the toggle; a failed manual status reload does not clear the prior status error on later success.

**Questions to consider:** Can most owners use a recommended scoring preset without ever setting raw similarity weights? When a run is active, should its status become the page’s primary focus rather than another section below configuration?

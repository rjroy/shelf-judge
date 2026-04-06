---
title: "Commission: Spec: Utility Curves for Axis Ratings"
date: 2026-04-06
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Read `.lore/issues/deferred-utility-curves.md` and write a specification for utility curves.\n\nUse the `/lore-development:specify` skill. Read the existing fitness algorithm design at `.lore/designs/fitness-algorithm.md`, the data model at `.lore/designs/data-model.md`, and the vision at `.lore/vision.md` for context.\n\n## Core problem the user described\n\nThe current system treats axis ratings linearly: higher is always better. But for some axes, the user has a sweet spot. The user's example:\n\n**Game complexity:** A score of 2.75 is perfect. A score of 5 is too complex. A score of 0 is too simple. So 2.75 should contribute the most to fitness, 5 should contribute less (but maybe more than 0), and the relationship is non-linear.\n\nThis means each axis needs a way to define \"what's my ideal value, and how does fitness fall off as the rating moves away from it?\"\n\n## Key design constraint from the user\n\n**The user should not need a calculator.** Whatever mechanism defines the curve must be intuitive. A user should be able to express \"I like medium complexity, not too heavy, not too light\" without understanding math. The spec should address how the curve is configured through the UI, not just the underlying model.\n\nConsider:\n- Is this a per-axis \"ideal value\" with a falloff shape?\n- Is it a piecewise curve the user draws or defines with a few control points?\n- Is it presets like \"higher is better\", \"lower is better\", \"sweet spot at X\"?\n- How does this interact with the existing weight system? Does the curve replace weights, modify them, or sit alongside them?\n- What's the minimum viable version vs the full vision?"
dependencies: []
linked_artifacts:
  - .lore/specs/utility-curves.md

  - .lore/issues/deferred-utility-curves.md
  - .lore/issues/deferred-utility-curves.md
resource_overrides:
  model: opus

activity_timeline:
  - timestamp: 2026-04-06T20:07:04.633Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T20:07:04.634Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-06T20:07:04.654Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-06T20:07:10.826Z
    event: progress_report
    reason: "Starting utility curves spec. Reading issue file, fitness algorithm design, data model, and vision for context."
  - timestamp: 2026-04-06T20:08:18.871Z
    event: progress_report
    reason: "Context gathered: read issue file, fitness model design, data model, brainstorm (Approach 4 covers utility curves), vision, and current implementation. The fitness service uses a simple weighted average today. Axis type has no curve parameters. Now invoking /specify to write the spec."
  - timestamp: 2026-04-06T20:09:30.832Z
    event: progress_report
    reason: "All context gathered. Current axis config: name, weight, description, source/bggField. UI shows axis cards with weight bars. Writing the utility curves spec now."
  - timestamp: 2026-04-06T20:12:36.092Z
    event: progress_report
    reason: "Spec written and reviewed. Reviewer found 3 priority issues: (1) tolerance levels need quantitative anchors, (2) veto semantics for sweet spot curves are undefined, (3) success criteria missing for \"lower is better\" and asymmetric lean. Addressing these now."
  - timestamp: 2026-04-06T20:14:04.143Z
    event: result_submitted
    reason: "Wrote utility curves specification at `.lore/specs/utility-curves.md` (25 requirements, REQ-CURVE-1 through REQ-CURVE-25).\n\nThe spec defines three preference shapes (higher-is-better, lower-is-better, sweet spot) that transform raw axis ratings into effective ratings before they enter the existing weighted average. Key design decisions:\n\n- **Presets over free-form curves.** Three shapes cover the common cases without exposing math. A [STUB: custom-curve-editor] exit point preserves the path to full curve control.\n- **Additive aggregation preserved.** The MVP's weighted average stays. Vetoes are an explicit mechanism (fitness drops to 0) rather than a side effect of multiplicative aggregation.\n- **Weights and curves are orthogonal.** Weight controls importance; shape controls what \"good\" means. They compose naturally.\n- **Tolerance has quantitative anchors.** Flexible/Moderate/Strict defined by effective rating at 3 points from ideal (no lower than 7 / between 4-5 / no higher than 2.5).\n- **Veto on sweet spot axes uses a single directional threshold**, same as other shapes. Double-ended vetoes require deliberate duplication.\n\nFresh-eyes review identified and resolved: underspecified tolerance levels, ambiguous sweet spot veto semantics, missing \"lower is better\" and asymmetric lean success criteria, boundary behavior at scale endpoints, and terminology alignment with the existing fitness model design.\n\nAlso updated `.lore/issues/deferred-utility-curves.md` status to resolved with a resolution note."
  - timestamp: 2026-04-06T20:14:08.283Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Spec written and reviewed. Reviewer found 3 priority issues: (1) tolerance levels need quantitative anchors, (2) veto semantics for sweet spot curves are undefined, (3) success criteria missing for \"lower is better\" and asymmetric lean. Addressing these now."
projectName: shelf-judge
---
Wrote utility curves specification at `.lore/specs/utility-curves.md` (25 requirements, REQ-CURVE-1 through REQ-CURVE-25).

The spec defines three preference shapes (higher-is-better, lower-is-better, sweet spot) that transform raw axis ratings into effective ratings before they enter the existing weighted average. Key design decisions:

- **Presets over free-form curves.** Three shapes cover the common cases without exposing math. A [STUB: custom-curve-editor] exit point preserves the path to full curve control.
- **Additive aggregation preserved.** The MVP's weighted average stays. Vetoes are an explicit mechanism (fitness drops to 0) rather than a side effect of multiplicative aggregation.
- **Weights and curves are orthogonal.** Weight controls importance; shape controls what "good" means. They compose naturally.
- **Tolerance has quantitative anchors.** Flexible/Moderate/Strict defined by effective rating at 3 points from ideal (no lower than 7 / between 4-5 / no higher than 2.5).
- **Veto on sweet spot axes uses a single directional threshold**, same as other shapes. Double-ended vetoes require deliberate duplication.

Fresh-eyes review identified and resolved: underspecified tolerance levels, ambiguous sweet spot veto semantics, missing "lower is better" and asymmetric lean success criteria, boundary behavior at scale endpoints, and terminology alignment with the existing fitness model design.

Also updated `.lore/issues/deferred-utility-curves.md` status to resolved with a resolution note.

---
title: "Commission: Revise MVP spec to follow specify format"
date: 2026-04-05
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "The MVP spec at `.lore/specs/mvp.md` needs revision. It deviates from the standard spec format defined by your `specify` skill. Load the `specify` skill first to understand the expected format.\n\nThe main issue the user called out: the spec numbering scheme (DEF-1, CON-1, SC-1, etc.) is unexpected. Align the spec to the format your `specify` skill defines.\n\nRead the current spec, load the skill, identify all deviations from the standard format, and revise the spec in place. Keep all the content and decisions intact. This is a formatting/structure pass, not a content rewrite."
dependencies: []
linked_artifacts:
  - .lore/specs/mvp.md

activity_timeline:
  - timestamp: 2026-04-05T01:33:08.162Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-05T01:33:08.164Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-05T01:33:08.175Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-05T01:33:20.319Z
    event: progress_report
    reason: "Read current MVP spec and loaded the specify skill. Now reading the frontmatter schema to understand the full expected format before identifying deviations."
  - timestamp: 2026-04-05T01:34:01.797Z
    event: progress_report
    reason: "Identified deviations from standard spec format. Starting revision: fix numbering scheme (DEF/CON/SC → REQ-MVP-N and checklists), add missing sections (Entry Points, Exit Points, AI Validation, Context), fix title format and frontmatter."
  - timestamp: 2026-04-05T01:36:55.718Z
    event: progress_report
    reason: "Spec revised. Verifying the result by reading it back to confirm structure is correct."
  - timestamp: 2026-04-05T01:37:17.867Z
    event: result_submitted
    reason: "Revised `.lore/specs/mvp.md` to align with the standard `specify` skill format. All content and decisions preserved; this was purely structural.\n\n**Changes made:**\n\n1. **Numbering scheme** (primary issue): Removed `DEF-1`..`DEF-8`, `CON-1`..`CON-6`, and `SC-1`..`SC-12` prefixes. The \"What's In\" items became `REQ-MVP-1` through `REQ-MVP-7`. Deferred items and constraints became plain bullets. Success criteria became `- [ ]` checklists.\n\n2. **Title format**: `# MVP Specification: Shelf Judge` → `# Spec: Shelf Judge MVP`\n\n3. **Frontmatter**: Added `modules`, `related`, and `req-prefix: MVP` fields. Updated tags.\n\n4. **Added missing sections**: Entry Points, Exit Points (with STUB references to deferred features), AI Validation (defaults + custom checks for score math and BGG parsing), Context (links to vision, brainstorm, research, architecture docs).\n\n5. **Section hierarchy**: Technical detail sections (Data Model, Fitness Score Model, BGG Integration, API Surface, Web UI, CLI Surface) moved under Requirements as sub-sections, keeping all content in place."
  - timestamp: 2026-04-05T01:37:22.040Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Spec revised. Verifying the result by reading it back to confirm structure is correct."
projectName: shelf-judge
---

Revised `.lore/specs/mvp.md` to align with the standard `specify` skill format. All content and decisions preserved; this was purely structural.

**Changes made:**

1. **Numbering scheme** (primary issue): Removed `DEF-1`..`DEF-8`, `CON-1`..`CON-6`, and `SC-1`..`SC-12` prefixes. The "What's In" items became `REQ-MVP-1` through `REQ-MVP-7`. Deferred items and constraints became plain bullets. Success criteria became `- [ ]` checklists.

2. **Title format**: `# MVP Specification: Shelf Judge` → `# Spec: Shelf Judge MVP`

3. **Frontmatter**: Added `modules`, `related`, and `req-prefix: MVP` fields. Updated tags.

4. **Added missing sections**: Entry Points, Exit Points (with STUB references to deferred features), AI Validation (defaults + custom checks for score math and BGG parsing), Context (links to vision, brainstorm, research, architecture docs).

5. **Section hierarchy**: Technical detail sections (Data Model, Fitness Score Model, BGG Integration, API Surface, Web UI, CLI Surface) moved under Requirements as sub-sections, keeping all content in place.

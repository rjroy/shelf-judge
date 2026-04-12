---
title: "Commission: Brainstorm: Shelf layout designer"
date: 2026-04-12
status: completed
tags: [commission]
worker: Celeste
workerDisplayTitle: "Guild Visionary"
prompt: "Brainstorm the shelf layout designer idea described in `.lore/issues/shelf-layout-designer.md`.\n\nThe issue says: \"Store the box size of all games (w x h x l). Store the configuration of a shelf configuration (w x h x l per shelf and its neighbors). Use game box sizes to optimally fill the shelves. Use similarity to prioritize games that share a shelf or are in a neighboring shelf.\"\n\nThis is an early-stage idea that needs exploration before it's ready for a spec. Think through:\n\n**Data questions:**\n- Where do box dimensions come from? BGG has some dimension data but it's inconsistent. Manual entry? Import from BGG? Both?\n- What does a \"shelf configuration\" look like as a data model? A shelf unit has shelves, each shelf has dimensions. How do you model adjacency (\"neighbors\")?\n- How does this relate to the existing game data model?\n\n**Algorithm questions:**\n- What does \"optimally fill\" mean? Minimize wasted space? Maximize accessibility? Keep series together?\n- The \"similarity\" constraint is interesting. The niche engine already computes game similarity via shared tags. How would that feed into shelf placement? Is the goal that similar games are physically near each other for browsing?\n- Is this a bin-packing problem? A constrained optimization? What's the computational complexity look like for a realistic collection (50-200 games)?\n- How do you handle games that don't fit any shelf? Games stored horizontally vs vertically?\n\n**UX questions:**\n- Is this a one-shot \"compute optimal layout\" or an interactive designer where you drag games between shelves?\n- How do you visualize the result? Top-down view? Front-facing shelf view?\n- Does the user care about the algorithm or just the result?\n\n**Feasibility:**\n- How much of this is realistic for a local-only tool? What's the MVP slice vs the dream version?\n- Does this align with the project's vision (`.lore/vision.md`)? Shelf Judge is about curation decisions. Does physical shelf layout serve that goal or is it a different tool?\n\nRead `.lore/vision.md` and the existing data model at `.lore/designs/data-model.md` for grounding. Check what BGG data is already available in the game types at `packages/shared/src/types.ts`.\n\nWrite your brainstorm to `.lore/brainstorms/shelf-layout-designer.md`."
dependencies: []
linked_artifacts:
  - .lore/brainstorms/shelf-layout-designer.md

activity_timeline:
  - timestamp: 2026-04-12T07:30:19.725Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T07:30:19.727Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T07:30:19.751Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T07:30:26.636Z
    event: progress_report
    reason: "Reading vision, data model, existing types, and the shelf layout designer issue to ground the brainstorm."
  - timestamp: 2026-04-12T07:31:03.826Z
    event: progress_report
    reason: "Context gathered. Now checking BGG XML API for dimension data availability, then reading the redundancy brainstorm for patterns to build on."
  - timestamp: 2026-04-12T07:31:36.069Z
    event: progress_report
    reason: "Context gathering complete. Writing the brainstorm artifact now. Key findings: BGG versions endpoint has box dimension data but coverage is inconsistent; existing feature-vector similarity engine is directly reusable; the idea stretches vision boundaries in interesting ways worth naming."
  - timestamp: 2026-04-12T07:34:48.828Z
    event: result_submitted
    reason: "Wrote brainstorm to `.lore/brainstorms/shelf-layout-designer.md` with 6 proposals exploring the shelf layout designer idea at two altitudes.\n\n**Curation-aligned proposals (extend existing vision):**\n- **Proposal 1: Box Dimensions as Game Metadata** (Small) - Add physical dimensions to Game type, populate from BGG `versions=1` endpoint or manual entry. Useful independently of shelf layout.\n- **Proposal 4: \"What Doesn't Fit\" as a Curation Signal** (Small) - Compare total collection volume to total shelf capacity, show lowest-fitness games that would free space. Directly serves Principle 5 (\"the shelf has a carrying capacity\") with literal carrying capacity.\n- **Proposal 6: Shelf-Aware Similarity in Niche Display** (Small) - Annotate existing niche display with physical shelf location, surfacing when niche neighbors are physically separated.\n\n**Scope-expanding proposals (build toward spatial optimization):**\n- **Proposal 2: Shelf Configuration Data Model** (Medium) - Model shelf units, individual shelves, and adjacency relationships as a separate data entity.\n- **Proposal 3: Similarity-Aware Shelf Assignment** (Large) - Constrained assignment algorithm using existing feature-vector similarity to group similar games on the same/neighboring shelves.\n- **Proposal 5: Interactive Shelf Visualizer** (Large) - Front-facing 2D shelf view with drag-and-drop, auto-arrange, and niche-colored game boxes.\n\n**Key finding:** The idea sits at a crossroads between curation (which games stay?) and organization (where do games go?). The brainstorm names this tension explicitly and recommends starting with Proposals 1 and 4, which are clearly vision-aligned, before committing to the spatial optimization features that would expand the project's scope. Four open questions for the user are included to help decide direction."
  - timestamp: 2026-04-12T07:34:55.923Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Context gathering complete. Writing the brainstorm artifact now. Key findings: BGG versions endpoint has box dimension data but coverage is inconsistent; existing feature-vector similarity engine is directly reusable; the idea stretches vision boundaries in interesting ways worth naming."
projectName: shelf-judge
---
Wrote brainstorm to `.lore/brainstorms/shelf-layout-designer.md` with 6 proposals exploring the shelf layout designer idea at two altitudes.

**Curation-aligned proposals (extend existing vision):**
- **Proposal 1: Box Dimensions as Game Metadata** (Small) - Add physical dimensions to Game type, populate from BGG `versions=1` endpoint or manual entry. Useful independently of shelf layout.
- **Proposal 4: "What Doesn't Fit" as a Curation Signal** (Small) - Compare total collection volume to total shelf capacity, show lowest-fitness games that would free space. Directly serves Principle 5 ("the shelf has a carrying capacity") with literal carrying capacity.
- **Proposal 6: Shelf-Aware Similarity in Niche Display** (Small) - Annotate existing niche display with physical shelf location, surfacing when niche neighbors are physically separated.

**Scope-expanding proposals (build toward spatial optimization):**
- **Proposal 2: Shelf Configuration Data Model** (Medium) - Model shelf units, individual shelves, and adjacency relationships as a separate data entity.
- **Proposal 3: Similarity-Aware Shelf Assignment** (Large) - Constrained assignment algorithm using existing feature-vector similarity to group similar games on the same/neighboring shelves.
- **Proposal 5: Interactive Shelf Visualizer** (Large) - Front-facing 2D shelf view with drag-and-drop, auto-arrange, and niche-colored game boxes.

**Key finding:** The idea sits at a crossroads between curation (which games stay?) and organization (where do games go?). The brainstorm names this tension explicitly and recommends starting with Proposals 1 and 4, which are clearly vision-aligned, before committing to the spatial optimization features that would expand the project's scope. Four open questions for the user are included to help decide direction.

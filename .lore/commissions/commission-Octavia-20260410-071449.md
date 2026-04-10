---
title: "Commission: Retrofit Spec: Collection Profiling with Option D Outlier Metric"
date: 2026-04-10
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Update the spec at `.lore/specs/collection-profiling.md` to resolve Open Question #2 (Outlier distance metric) using Option D from the research at `.lore/research/outlier-distance-metric.md`.\n\n**Option D: Phased Approach** means shipping with Option A (Composite Metric + Centroid Distance):\n- Jaccard distance for mechanics/categories\n- Normalized Manhattan distance for continuous BGG attributes\n- Normalized Manhattan distance for personal axis ratings (where available)\n- Weighted combination into [0,1] distance\n- Outlier threshold: 2 standard deviations from mean distance (adjustable)\n\nThe user says this is the MVP of the profiling feature. Retrofit the spec accordingly:\n\n1. Resolve Open Question #2 by replacing it with the settled decision and rationale (referencing the research artifact).\n2. Update any requirements that reference the outlier distance metric (REQ-PROFILE-11, REQ-PROFILE-12, and any others) to specify the composite metric concretely: Jaccard for binary, normalized Manhattan for continuous, weighted combination, centroid-based detection with 2σ threshold.\n3. Add a note that LOF is the upgrade path if centroid distance proves inadequate for diverse collections, but it's explicitly out of scope for this version.\n4. Make sure the spec reflects this is the MVP scope. If there are requirements that feel like post-MVP extensions, mark them as deferred rather than removing them.\n5. Update the spec status if appropriate.\n\nRead the full research document for context on why this option was chosen over alternatives. Read the full spec to understand all the requirements that touch outlier detection."
dependencies: []
linked_artifacts:
  - .lore/specs/collection-profiling.md

activity_timeline:
  - timestamp: 2026-04-10T14:14:49.719Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T14:14:49.721Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-10T14:14:49.741Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-10T14:15:02.545Z
    event: progress_report
    reason: "Read both the research artifact and the full spec. Now drafting edits: resolving Open Question #2, updating REQ-PROFILE-11 and REQ-PROFILE-12 with composite metric specifics, adding LOF as deferred upgrade path, and reviewing remaining requirements for MVP scoping."
  - timestamp: 2026-04-10T14:18:21.899Z
    event: result_submitted
    reason: "Updated `.lore/specs/collection-profiling.md` with five categories of changes:\n\n**1. Resolved Open Question #2** (outlier distance metric). Replaced the open question with a settled decision referencing the research artifact. Neither Euclidean nor cosine is appropriate as a unified metric. The decision: composite metric with Jaccard for binary, normalized Manhattan for continuous, weighted combination into [0,1].\n\n**2. Updated REQ-PROFILE-11** with full composite metric specification: three component distances (binary/Jaccard, continuous BGG/normalized Manhattan, personal axes/normalized Manhattan), weighted combination (0.4/0.3/0.3 defaults), weight redistribution when personal axes are unavailable, and per-component transparency in the profile response.\n\n**3. Updated REQ-PROFILE-12** with centroid-based detection specifics: mean feature vector as centroid, 2σ threshold on composite distance distribution, percentile-based alternative if distribution is skewed. Added LOF upgrade path note with rationale for deferral.\n\n**4. Deferred LLM narration to post-MVP.** Marked REQ-PROFILE-18 through REQ-PROFILE-28 plus REQ-PROFILE-34 as [DEFERRED]. Added section header note explaining why they remain in the spec (to guide the algorithmic profile's data model). Updated dependent items: REQ-PROFILE-30 narration line, success criteria, manual verification, AI validation, and constraints.\n\n**5. Updated success criteria and validation.** Added composite metric test criteria (Jaccard computation, weighted combination, per-component availability). Updated outlier test criteria to reference composite distance. Added weight sensitivity validation.\n\nAlso resolved Open Question #3 (session resumption: out of scope entirely), added research artifact to related list and context section, and updated Agent SDK research context entry to note deferral."
  - timestamp: 2026-04-10T14:18:26.183Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Read both the research artifact and the full spec. Now drafting edits: resolving Open Question #2, updating REQ-PROFILE-11 and REQ-PROFILE-12 with composite metric specifics, adding LOF as deferred upgrade path, and reviewing remaining requirements for MVP scoping."
projectName: shelf-judge
---
Updated `.lore/specs/collection-profiling.md` with five categories of changes:

**1. Resolved Open Question #2** (outlier distance metric). Replaced the open question with a settled decision referencing the research artifact. Neither Euclidean nor cosine is appropriate as a unified metric. The decision: composite metric with Jaccard for binary, normalized Manhattan for continuous, weighted combination into [0,1].

**2. Updated REQ-PROFILE-11** with full composite metric specification: three component distances (binary/Jaccard, continuous BGG/normalized Manhattan, personal axes/normalized Manhattan), weighted combination (0.4/0.3/0.3 defaults), weight redistribution when personal axes are unavailable, and per-component transparency in the profile response.

**3. Updated REQ-PROFILE-12** with centroid-based detection specifics: mean feature vector as centroid, 2σ threshold on composite distance distribution, percentile-based alternative if distribution is skewed. Added LOF upgrade path note with rationale for deferral.

**4. Deferred LLM narration to post-MVP.** Marked REQ-PROFILE-18 through REQ-PROFILE-28 plus REQ-PROFILE-34 as [DEFERRED]. Added section header note explaining why they remain in the spec (to guide the algorithmic profile's data model). Updated dependent items: REQ-PROFILE-30 narration line, success criteria, manual verification, AI validation, and constraints.

**5. Updated success criteria and validation.** Added composite metric test criteria (Jaccard computation, weighted combination, per-component availability). Updated outlier test criteria to reference composite distance. Added weight sensitivity validation.

Also resolved Open Question #3 (session resumption: out of scope entirely), added research artifact to related list and context section, and updated Agent SDK research context entry to note deferral.

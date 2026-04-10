---
title: "Commission: Retrofit Spec: Collection Profiling with Option D Outlier Metric"
date: 2026-04-10
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Update the spec at `.lore/specs/collection-profiling.md` to resolve Open Question #2 (Outlier distance metric) using Option D from the research at `.lore/research/outlier-distance-metric.md`.\n\n**Option D: Phased Approach** means shipping with Option A (Composite Metric + Centroid Distance):\n- Jaccard distance for mechanics/categories\n- Normalized Manhattan distance for continuous BGG attributes\n- Normalized Manhattan distance for personal axis ratings (where available)\n- Weighted combination into [0,1] distance\n- Outlier threshold: 2 standard deviations from mean distance (adjustable)\n\nThe user says this is the MVP of the profiling feature. Retrofit the spec accordingly:\n\n1. Resolve Open Question #2 by replacing it with the settled decision and rationale (referencing the research artifact).\n2. Update any requirements that reference the outlier distance metric (REQ-PROFILE-11, REQ-PROFILE-12, and any others) to specify the composite metric concretely: Jaccard for binary, normalized Manhattan for continuous, weighted combination, centroid-based detection with 2σ threshold.\n3. Add a note that LOF is the upgrade path if centroid distance proves inadequate for diverse collections, but it's explicitly out of scope for this version.\n4. Make sure the spec reflects this is the MVP scope. If there are requirements that feel like post-MVP extensions, mark them as deferred rather than removing them.\n5. Update the spec status if appropriate.\n\nRead the full research document for context on why this option was chosen over alternatives. Read the full spec to understand all the requirements that touch outlier detection."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-10T14:14:49.719Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T14:14:49.721Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---

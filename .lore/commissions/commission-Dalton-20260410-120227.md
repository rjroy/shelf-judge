---
title: "Commission: Collection Profiling Phase 1+2: Types, Validation, Feature Vectors"
date: 2026-04-10
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phases 1 and 2 of `.lore/plans/collection-profiling.md`.\n\n**Phase 1: Shared Types and Validation**\n- Add `subdomains: BggTag[]` to `BggGameData` in shared types\n- Add all profile types: `AxisDistribution`, `AxisWeightEntry`, `AttributeCluster`, `WeightRangeCluster`, `UtilityCurveDeclaration`, `DivergentGame`, `ComponentDistances`, `OutlierClassification`, `CollectionOutlier`, `AxisSuggestion`, `CollectionProfile`, `ProfileData`\n- Extract `boardgamesubdomain` links in `bgg-xml-parser.ts`\n- Add `subdomains` to `BggGameDataSchema` in validation.ts (as `z.array(BggTagSchema).default([])`)\n- Re-export all new types from index.ts\n\n**Phase 2: Feature Vector Module**\n- Create `packages/daemon/src/services/feature-vector.ts` as a pure-function module\n- Implement: `buildVocabulary`, `encodeGame`, `jaccardDistance`, `normalizedManhattanDistance`, `compositeDistance`, `computeCentroid`, `cosineSimilarity`\n- Export `FeatureVector` type separating binary and continuous portions\n- Default component weights: binary 0.4, continuous BGG 0.3, personal axes 0.3\n- Comprehensive tests in `packages/daemon/tests/feature-vector.test.ts`\n\nRead the full plan for detailed type definitions, function signatures, and test requirements. Follow it closely.\n\nVerify: typecheck clean across all packages, existing tests pass, all new feature vector tests pass."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-10T19:02:27.237Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T19:04:13.329Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---

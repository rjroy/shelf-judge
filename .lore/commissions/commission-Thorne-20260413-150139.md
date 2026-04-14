---
title: "Commission: Shelf Capacity: Review Shelf Config Backend (C8)"
date: 2026-04-13
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the shelf configuration backend (Phases 3 and 4).\n\n**Context:**\n- `.lore/plans/shelf-capacity.md` (Phases 3, 4)\n- `.lore/specs/shelf-capacity.md` (REQ-SHELF-8 through REQ-SHELF-15)\n\n**Review focus:**\n- Storage follows atomic write pattern\n- Validation: width > 0, depth > 0, height > 0 or null, names non-empty\n- Update semantics: shelves with id updated, without id added, absent removed (REQ-SHELF-14)\n- PUT config replaces entirely\n- Test coverage matches the plan's test list\n- Route response shapes match spec\n\n**Files:** `packages/daemon/src/services/storage-service.ts`, `packages/daemon/src/services/shelf-service.ts`, `packages/daemon/src/routes/shelf.ts`, `packages/daemon/src/app.ts`, `packages/daemon/tests/shelf-*.test.ts`\n\nRecord all findings."
dependencies:
  - commission-Dalton-20260413-150131
linked_artifacts:
  - packages/daemon/src/services/shelf-service.ts

  - packages/daemon/src/routes/shelf.ts
  - packages/daemon/src/services/storage-service.ts
  - packages/daemon/src/app.ts
  - packages/daemon/tests/shelf-service.test.ts
  - packages/daemon/tests/shelf-routes.test.ts
  - packages/daemon/src/routes/shelf.ts
  - packages/daemon/src/services/storage-service.ts
  - packages/daemon/src/app.ts
  - packages/daemon/tests/shelf-service.test.ts
  - packages/daemon/tests/shelf-routes.test.ts
activity_timeline:
  - timestamp: 2026-04-13T22:01:39.640Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-13T22:10:22.776Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-13T22:23:21.355Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-13T22:23:21.358Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-13T22:23:21.382Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-13T22:23:28.212Z
    event: progress_report
    reason: "Starting review. Reading spec, plan, and implementation files."
  - timestamp: 2026-04-13T22:24:01.950Z
    event: progress_report
    reason: "All source files and test files read. Analyzing against spec requirements REQ-SHELF-8 through REQ-SHELF-15. Recording findings now."
  - timestamp: 2026-04-13T22:26:59.135Z
    event: result_submitted
    reason: "## Review: Shelf Configuration Backend (Phases 3 & 4)\n\n### Verdict: Clean implementation. Two low-severity findings, no blockers.\n\n### Requirement Coverage\n\nAll requirements in scope (REQ-SHELF-8 through REQ-SHELF-15) are satisfied:\n\n| Requirement | Status | Evidence |\n|---|---|---|\n| REQ-SHELF-8 (data model hierarchy) | **Satisfied** | types.ts:542-566 matches spec verbatim |\n| REQ-SHELF-9 (height: null for unconstrained) | **Satisfied** | Type allows null, validation accepts null, tested |\n| REQ-SHELF-10 (types in shared package) | **Satisfied** | All four interfaces in packages/shared/src/types.ts |\n| REQ-SHELF-11 (separate shelf-config.json file) | **Satisfied** | storage-service.ts:263, separate from collection.json |\n| REQ-SHELF-12 (atomic write pattern) | **Satisfied** | storage-service.ts:277 calls atomicWrite (temp file + rename) |\n| REQ-SHELF-13 (five API endpoints) | **Satisfied** | All five routes in shelf.ts, wired at app.ts:121 |\n| REQ-SHELF-14 (PUT replaces, update semantics) | **Satisfied** | setConfig replaces wholesale; updateUnit implements add/update/remove shelf semantics |\n| REQ-SHELF-15 (validation rules) | **Satisfied** | width > 0, depth > 0, height > 0 or null, names non-empty; 400 on failure |\n\n### Test Coverage\n\nAll tests from the plan's Phase 3 and Phase 4 test lists are present:\n\n- **shelf-service.test.ts** (14 tests): Creation + persistence, update semantics (add/update/remove shelves), removal, all dimension validation paths (width <= 0, negative width, depth <= 0, height <= 0, negative height), null height accepted, empty name rejection (unit and shelf), full config replace, empty config.\n- **shelf-routes.test.ts** (14 tests): GET empty, GET with data, PUT replace, PUT validation, POST 201 with IDs, POST persistence, POST validation (missing name, missing shelves, invalid dimensions), PUT update name, PUT update shelves, PUT 404, PUT validation, DELETE success, DELETE 404.\n\n### Findings\n\n**Finding 1 (Low): Phantom shelf IDs silently become new shelves**\nFile: `packages/daemon/src/services/shelf-service.ts:159-165`\n\nWhen `updateUnit` receives a shelf with an `id` that doesn't match any existing shelf in the unit, the ID is silently discarded and a new UUID is generated. The spec says \"shelves with an id are updated,\" implying the id should reference an existing shelf. A typo in a shelf ID during update would silently create a duplicate instead of returning an error.\n\nImpact: Data integrity surprise for CLI or programmatic callers. The web UI likely won't hit this because it reads shelf IDs from the server before sending updates.\n\nRecommendation: When `shelfInput.id` is truthy but doesn't appear in `existingShelfIds`, throw a `ShelfValidationError` rather than silently creating a new shelf.\n\n**Finding 2 (Low): loadShelfConfig generates a fresh createdAt on every call when no file exists**\nFile: `packages/daemon/src/services/storage-service.ts:265-267`\n\n`loadShelfConfig` returns `{ units: [], createdAt: new Date().toISOString(), updatedAt: now }` when the file doesn't exist, but doesn't persist this default. Each call generates a new timestamp. This means `createdAt` isn't stable until the first write. This matches the established pattern for other settings files (prediction, niche, redundancy, wishlist), so it's consistent, just worth knowing.\n\nImpact: Negligible. The timestamp stabilizes on first save.\n\n### What's correct\n\n- Service layer cleanly separates validation, UUID generation, and storage concerns.\n- Error types (ShelfValidationError, ShelfNotFoundError) are well-defined and correctly mapped to HTTP status codes in routes.\n- Route layer validates structural requirements (body is object, required fields present) before delegating to service.\n- All five operation definitions have correct operationIds, paths, methods, and parameter declarations.\n- Mock storage in tests uses `structuredClone` to prevent shared-state leakage between operations.\n- The `buildShelf` helper correctly uses `input.id ?? uuidv4()` for the new-vs-existing distinction.\n- `setConfig` preserves `createdAt` from the existing config while updating `updatedAt`."
  - timestamp: 2026-04-13T22:27:06.396Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All source files and test files read. Analyzing against spec requirements REQ-SHELF-8 through REQ-SHELF-15. Recording findings now."
projectName: shelf-judge
---
## Review: Shelf Configuration Backend (Phases 3 & 4)

### Verdict: Clean implementation. Two low-severity findings, no blockers.

### Requirement Coverage

All requirements in scope (REQ-SHELF-8 through REQ-SHELF-15) are satisfied:

| Requirement | Status | Evidence |
|---|---|---|
| REQ-SHELF-8 (data model hierarchy) | **Satisfied** | types.ts:542-566 matches spec verbatim |
| REQ-SHELF-9 (height: null for unconstrained) | **Satisfied** | Type allows null, validation accepts null, tested |
| REQ-SHELF-10 (types in shared package) | **Satisfied** | All four interfaces in packages/shared/src/types.ts |
| REQ-SHELF-11 (separate shelf-config.json file) | **Satisfied** | storage-service.ts:263, separate from collection.json |
| REQ-SHELF-12 (atomic write pattern) | **Satisfied** | storage-service.ts:277 calls atomicWrite (temp file + rename) |
| REQ-SHELF-13 (five API endpoints) | **Satisfied** | All five routes in shelf.ts, wired at app.ts:121 |
| REQ-SHELF-14 (PUT replaces, update semantics) | **Satisfied** | setConfig replaces wholesale; updateUnit implements add/update/remove shelf semantics |
| REQ-SHELF-15 (validation rules) | **Satisfied** | width > 0, depth > 0, height > 0 or null, names non-empty; 400 on failure |

### Test Coverage

All tests from the plan's Phase 3 and Phase 4 test lists are present:

- **shelf-service.test.ts** (14 tests): Creation + persistence, update semantics (add/update/remove shelves), removal, all dimension validation paths (width <= 0, negative width, depth <= 0, height <= 0, negative height), null height accepted, empty name rejection (unit and shelf), full config replace, empty config.
- **shelf-routes.test.ts** (14 tests): GET empty, GET with data, PUT replace, PUT validation, POST 201 with IDs, POST persistence, POST validation (missing name, missing shelves, invalid dimensions), PUT update name, PUT update shelves, PUT 404, PUT validation, DELETE success, DELETE 404.

### Findings

**Finding 1 (Low): Phantom shelf IDs silently become new shelves**
File: `packages/daemon/src/services/shelf-service.ts:159-165`

When `updateUnit` receives a shelf with an `id` that doesn't match any existing shelf in the unit, the ID is silently discarded and a new UUID is generated. The spec says "shelves with an id are updated," implying the id should reference an existing shelf. A typo in a shelf ID during update would silently create a duplicate instead of returning an error.

Impact: Data integrity surprise for CLI or programmatic callers. The web UI likely won't hit this because it reads shelf IDs from the server before sending updates.

Recommendation: When `shelfInput.id` is truthy but doesn't appear in `existingShelfIds`, throw a `ShelfValidationError` rather than silently creating a new shelf.

**Finding 2 (Low): loadShelfConfig generates a fresh createdAt on every call when no file exists**
File: `packages/daemon/src/services/storage-service.ts:265-267`

`loadShelfConfig` returns `{ units: [], createdAt: new Date().toISOString(), updatedAt: now }` when the file doesn't exist, but doesn't persist this default. Each call generates a new timestamp. This means `createdAt` isn't stable until the first write. This matches the established pattern for other settings files (prediction, niche, redundancy, wishlist), so it's consistent, just worth knowing.

Impact: Negligible. The timestamp stabilizes on first save.

### What's correct

- Service layer cleanly separates validation, UUID generation, and storage concerns.
- Error types (ShelfValidationError, ShelfNotFoundError) are well-defined and correctly mapped to HTTP status codes in routes.
- Route layer validates structural requirements (body is object, required fields present) before delegating to service.
- All five operation definitions have correct operationIds, paths, methods, and parameter declarations.
- Mock storage in tests uses `structuredClone` to prevent shared-state leakage between operations.
- The `buildShelf` helper correctly uses `input.id ?? uuidv4()` for the new-vs-existing distinction.
- `setConfig` preserves `createdAt` from the existing config while updating `updatedAt`.

## Decisions

**Does shelf-service.ts buildShelf correctly handle the id field for new vs existing shelves?**
Correct. buildShelf uses `input.id ?? uuidv4()`, so shelves with an id keep it, shelves without get a new UUID. In addUnit, shelves are explicitly passed with `id: undefined` to force new IDs.
*Reasoning: shelf-service.ts:58-66 shows buildShelf. Line 125 in addUnit forces `id: undefined`. Lines 159-165 in updateUnit check `shelfInput.id && existingShelfIds.has(shelfInput.id)` to distinguish update vs add.*

**REQ-SHELF-8: Does the data model correctly represent the shelf hierarchy (units contain shelves)?**
Satisfied. Types match the spec exactly.
*Reasoning: packages/shared/src/types.ts:542-566 defines BoxDimensions, Shelf (with id, name, width, height: number|null, depth), ShelfUnit (with id, name, shelves: Shelf[]), and ShelfConfiguration (with units, createdAt, updatedAt). All match REQ-SHELF-8 verbatim.*

**REQ-SHELF-9: Does height: null work for unconstrained shelves?**
Satisfied. Shelf type has `height: number | null`. Validation accepts null. Tests verify it.
*Reasoning: types.ts:552 has `height: number | null`. shelf-service.ts:42 validates `shelf.height !== null && ... shelf.height <= 0` which correctly allows null through. shelf-service.test.ts:89-96 tests null height.*

**REQ-SHELF-10: Are Shelf, ShelfUnit, ShelfConfiguration defined in packages/shared/src/types.ts?**
Satisfied.
*Reasoning: All three interfaces plus BoxDimensions are exported from packages/shared/src/types.ts:542-566.*

**REQ-SHELF-11: Is shelf config stored in shelf-config.json, separate from collection.json?**
Satisfied.
*Reasoning: storage-service.ts:263 uses `path.join(dataDir, "shelf-config.json")`. Line 265-267: when file doesn't exist, returns empty config with `units: []`. Separate from collectionPath at line 108.*

**REQ-SHELF-12: Does shelf config storage use atomic write?**
Satisfied.
*Reasoning: storage-service.ts:277 calls `atomicWrite(shelfConfigPath, ...)` which writes to a temp file then renames (lines 100-104).*

**REQ-SHELF-13: Do all five API endpoints exist with correct methods and paths?**
Satisfied. All five endpoints are present.
*Reasoning: shelf.ts: GET /shelf/config (line 17), PUT /shelf/config (line 27), POST /shelf/units (line 56), PUT /shelf/units/:id (line 88), DELETE /shelf/units/:id (line 118). App wiring at app.ts:121 `app.route("/api", shelfRouteModule.routes)` makes them accessible at /api/shelf/...*

**REQ-SHELF-14: Does PUT /shelf/config replace entirely? Do unit update shelf semantics match (add new, update existing, remove absent)?**
Satisfied with one concern: PUT /shelf/config accepts units with pre-existing IDs but doesn't validate shelf dimensions within those units' shelves. Wait, it does - setConfig at shelf-service.ts:96-99 iterates all shelves and validates each. Confirmed correct.
*Reasoning: shelf-service.ts:90-111 setConfig replaces units wholesale, preserves createdAt, updates updatedAt. Lines 148-169 in updateUnit implement the add/update/remove shelf semantics: builds a set of existing IDs, shelves with matching ID are updated, without ID get new UUID, absent shelves are dropped. Both are tested.*

**Does updateUnit silently discard shelf IDs that don't match existing shelves?**
FINDING (Low severity): When a shelf input in updateUnit provides an id that doesn't match any existing shelf in the unit, the id is silently discarded and a new UUID is generated. This means a typo in a shelf ID during an update would silently create a duplicate instead of failing. The spec doesn't explicitly require an error here, but this is a potential data integrity concern.
*Reasoning: shelf-service.ts:159-165. The condition `shelfInput.id && existingShelfIds.has(shelfInput.id)` gates the "update" path. The else branch always generates a new ID regardless of whether the input had one. A non-matching ID is treated as "add new" rather than "error: shelf not found." The spec says "shelves with an id are updated, shelves without an id are added, and shelves present in the stored unit but absent from the request are removed." This implies shelves "with an id" should be updating existing ones. A phantom ID violates this intent.*

**REQ-SHELF-15: Does validation reject width <= 0, depth <= 0, height <= 0 (but allow null), and empty names?**
Satisfied. All validation rules match the spec.
*Reasoning: shelf-service.ts:35-48 validateShelfInput checks: name non-empty (line 36), width > 0 (line 39), height > 0 or null (line 42), depth > 0 (line 45). Lines 51-56 validateUnitName checks non-empty. Routes return 400 on ShelfValidationError (shelf.ts:48-49, 79-80, 107-108). Tests cover all validation paths.*

**Do route response shapes match the spec (REQ-SHELF-14)?**
Satisfied. All five endpoint responses match.
*Reasoning: GET /shelf/config returns ShelfConfiguration (shelf.ts:20). PUT /shelf/config returns ShelfConfiguration (shelf.ts:45). POST /shelf/units returns ShelfUnit with 201 (shelf.ts:78). PUT /shelf/units/:id returns ShelfUnit with 200 (shelf.ts:104-105). DELETE /shelf/units/:id returns { removed: true } with 200 (shelf.ts:123). All match spec shapes in REQ-SHELF-14.*

**Does test coverage match the plan's test lists for Phases 3 and 4?**
Satisfied. All planned tests are present. shelf-service.test.ts covers: unit creation + persistence (line 66), update semantics (line 177), removal (line 237), all dimension validation paths (lines 119-162), empty name rejection (lines 98-117), full config replace (line 254), empty config (line 305). shelf-routes.test.ts covers: GET empty (line 65), GET with units (line 73), PUT replace (line 90), POST 201 (line 133), PUT update name (line 202), PUT update shelves (line 213), DELETE (line 259), DELETE 404 (line 267), validation 400s (lines 107, 121, 162, 172, 241).
*Reasoning: Systematically compared each plan test item against actual test descriptions in both test files. Every planned test is accounted for.*

**Are all five operation definitions present and well-formed?**
Satisfied. Five operations with correct operationIds matching the spec: shelf.config.get, shelf.config.set, shelf.units.add, shelf.units.update, shelf.units.remove. Path parameters declared for the two that need them.
*Reasoning: shelf.ts:132-175. All five operations defined with correct paths, methods, and hierarchy.*

**Does loadShelfConfig write the default to disk on first access, or just return an in-memory default?**
FINDING (Low severity): loadShelfConfig returns an in-memory default when the file doesn't exist (storage-service.ts:265-267) but does not write it to disk. This differs from loadCollection (lines 115-120) and loadConfig (lines 144-151) which write the default file on first access. The practical impact is minimal: the file gets created on first save. But each call to loadShelfConfig when no file exists generates a new `createdAt` timestamp, which means createdAt won't be stable until the first write. This is consistent with some other settings (e.g. loadPredictionSettings at line 205 also returns in-memory defaults), so it matches the established pattern for settings files.
*Reasoning: Compared storage patterns. Collection and config write defaults on first load. Settings files (prediction, niche, redundancy, wishlist, shelf) return in-memory defaults. The shelf config follows the settings pattern, which is reasonable since it's a settings-like entity.*

**Is the shelf service correctly wired into the app?**
Satisfied. app.ts:78-79 creates the service and routes. Line 94 adds shelf operations to allOperations. Line 121 mounts routes under /api.
*Reasoning: app.ts:78 `const shelfService = createShelfService({ storageService })` and line 79 `const shelfRouteModule = createShelfRoutes({ shelfService })`. Line 94 spreads operations. Line 121 routes the Hono app.*

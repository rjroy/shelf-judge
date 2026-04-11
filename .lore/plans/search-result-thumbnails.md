---
title: "Implementation plan: search-result-thumbnails"
date: 2026-04-11
status: approved
tags: [plan, web-ui, bgg, search, thumbnails]
modules: [shared, daemon, web]
related:
  - .lore/issues/search-result-thumbnails.md
  - .lore/research/bgg-api.md
  - .lore/designs/mvp-web-ui.md
---

# Plan: Search Result Thumbnails

## Goal

Display game thumbnail images alongside BGG search results in the web UI. Currently, search results show only game name and year. Adding thumbnails gives users visual recognition of games before adding them to their collection.

## Codebase Context

### BGG API Constraint

The BGG `/search` endpoint returns only `id`, `name`, and `yearpublished` per result. No thumbnail or image data. This is confirmed by both the API research (`.lore/research/bgg-api.md`, section 4) and the test fixture (`packages/daemon/tests/fixtures/search-wingspan.xml`).

Thumbnails are available from the `/thing` endpoint, which returns both `<thumbnail>` (200x150 small image) and `<image>` (original resolution). The `/thing` endpoint supports batch requests up to 20 IDs.

### Current Data Flow

1. **Shared type** (`packages/shared/src/types.ts:218-222`): `BggSearchResult` has three fields: `bggId`, `name`, `yearPublished`.

2. **XML parser** (`packages/daemon/src/services/bgg-xml-parser.ts:252-265`): `parseSearchResponse()` extracts those three fields from BGG's search XML. The `BggXmlItem` interface (line 51) has `image?: string` but no `thumbnail` field. `ThingMetadata` (line 171) has `imageUrl` extracted from `<image>` but no thumbnail URL.

3. **BGG client** (`packages/daemon/src/services/bgg-client.ts:196-207`): `searchGames()` calls the search endpoint, parses the response, and returns `BggSearchResult[]`. No enrichment step.

4. **Web UI search page** (`packages/web/app/search/page.tsx`): Defines a local `BggSearchResult` interface (line 11-15, duplicating the shared type per known issue `duplicated-web-daemon-types`). Renders results as name + year with Preview and Add buttons. No thumbnail rendering.

### Existing Thumbnail Rendering Pattern

The game detail page (`packages/web/app/games/[id]/page.tsx:97`) renders the game image with a fallback:

```tsx
{
  game.imageUrl ? <img src={game.imageUrl} alt={game.name} /> : <span>🎲</span>;
}
```

This lives inside a `.game-cover` container within a `.game-hero` section. For search results, we need a smaller variant (thumbnail-sized, inline with the result row).

### Latency Trade-off

Search already takes ~5 seconds due to BGG API rate limiting. Adding a batch `/thing` call for thumbnails adds another ~5 seconds. This is acceptable for now: users expect BGG searches to be slow, and the visual improvement justifies the wait. If latency becomes a problem, a future optimization could return results immediately and lazy-load thumbnails via a secondary request.

### Batch Size

Most searches return fewer than 20 results (the wingspan fixture has 14). Enrichment covers the first 20 results in a single `/thing` batch. Results beyond 20 get `thumbnailUrl: null`. This is a reasonable trade-off: few searches exceed 20 results, and the alternative (multiple batches with 5s delays between them) is not worth the latency.

## Implementation Steps

### Step 1: Add `thumbnailUrl` to Shared Type

**Files**: `packages/shared/src/types.ts`

Add `thumbnailUrl: string | null` to the `BggSearchResult` interface at line 218:

```typescript
export interface BggSearchResult {
  bggId: number;
  name: string;
  yearPublished: number | null;
  thumbnailUrl: string | null;
}
```

No Zod schema exists for `BggSearchResult`, so no validation changes needed.

### Step 2: Add Thumbnail Parsing to XML Parser

**Files**: `packages/daemon/src/services/bgg-xml-parser.ts`

Three changes:

1. Add `thumbnail?: string` to the `BggXmlItem` interface (line 51), alongside the existing `image?: string`.

2. Add `thumbnailUrl: string | null` to the `ThingMetadata` interface (line 171). Extract it in **both** functions that construct `ThingMetadata`:
   - `parseThingMetadata()` at line 199: add `thumbnailUrl: item.thumbnail ?? null`
   - `parseThingItems()` at line 233: add `thumbnailUrl: item.thumbnail ?? null` (this function builds `ThingMetadata` inline rather than calling `parseThingMetadata`, so both must be updated)

3. Update `parseSearchResponse()` (line 252) to include `thumbnailUrl: null` in its return value, since BGG's search XML doesn't contain thumbnails.

### Step 3: Enrich Search Results in BGG Client

**Files**: `packages/daemon/src/services/bgg-client.ts`

Modify `searchGames()` to:

1. Call the search endpoint as before and parse into results.
2. If results are non-empty, take the first 20 BGG IDs and batch-fetch thing data: `${BGG_BASE_URL}/thing?id=${idList}&type=boardgame` (no `stats=1`, we only need thumbnails).
3. Parse the thing response with `parseThingItems()` (already imported, consistent with the pattern in `getGames()`). Access `.metadata.thumbnailUrl` on each item.
4. Build a `Map<number, string>` of `bggId → thumbnailUrl`.
5. Merge thumbnail URLs into the search results: for each result, set `thumbnailUrl` from the map or `null` if not found.
6. Return enriched results.

The thing batch call omits `stats=1` to reduce response size since we only need the `<thumbnail>` element. `parseThingItems` handles responses without stats gracefully (rating fields default to 0/null).

Error handling: if the thing batch call fails, log the error at warn level and return results with `thumbnailUrl: null` for all entries. Search results without thumbnails are still useful; a thumbnail enrichment failure should not break search.

### Step 4: Test Fixtures

**Files**: `packages/daemon/tests/fixtures/` (new file)

Create `thing-search-batch.xml`: a minimal thing response containing 2-3 items with `<thumbnail>` elements, matching BGG IDs from the existing `search-wingspan.xml` fixture (e.g., IDs 266192 and 339017). This fixture supports testing the enrichment flow without hitting the real API.

The fixture needs only `<thumbnail>`, `<name>`, and `<yearpublished>` per item (enough for `parseThingItems` to produce valid `ThingMetadata`), not the full thing response with stats, links, and polls.

### Step 5: Tests

**Files**: `packages/daemon/tests/services/bgg-xml-parser.test.ts`, `packages/daemon/tests/services/bgg-client.test.ts`

**Parser tests** (in `bgg-xml-parser.test.ts`):

1. Update the existing `parseThingMetadata` test to verify `thumbnailUrl` is extracted from the Wingspan fixture. The fixture at `thing-wingspan-266192.xml` already contains `<thumbnail>https://cf.geekdo-images.com/.../__small/...jpg</thumbnail>`.
2. Update the `parseThingItems` test (if one exists for the Wingspan fixture) to also verify `metadata.thumbnailUrl` is populated, since `parseThingItems` builds `ThingMetadata` inline.
3. Update `parseSearchResponse` test to verify `thumbnailUrl` is `null` in parsed results (since search XML has no thumbnails).
4. Add a test for `parseThingItems` against the new batch fixture to confirm thumbnail extraction from the minimal response.

**Client tests** (in `bgg-client.test.ts`):

1. Update the `searchGames` test to mock two fetch calls: one for the search endpoint, one for the thing batch endpoint.
2. Verify that results include `thumbnailUrl` values from the thing response.
3. Test the graceful degradation case: mock the thing batch call to fail, verify search results still return with `thumbnailUrl: null`.

### Step 6: Render Thumbnails in Web UI

**Files**: `packages/web/app/search/page.tsx`

1. Update the local `BggSearchResult` interface (line 11) to include `thumbnailUrl: string | null`. This maintains the existing duplication with the shared type, which is tracked separately under `.lore/issues/duplicated-web-daemon-types.md`.

2. Add a thumbnail element to each search result row. Inside `.search-result-row` (line 292), add a thumbnail before `.search-result-info`:

```tsx
<div className="search-result-row">
  <div className="search-result-thumb">
    {r.thumbnailUrl ? (
      <img src={r.thumbnailUrl} alt={r.name} />
    ) : (
      <span className="search-result-thumb-placeholder"></span>
    )}
  </div>
  <div className="search-result-info">...</div>
  ...
</div>
```

3. Add CSS in `packages/web/app/globals.css` for `.search-result-thumb`:

```css
.search-result-thumb {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 4px;
  background: var(--bg-secondary);
}

.search-result-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
```

The 48x48px size is small enough to not dominate the result row but large enough for visual recognition. BGG thumbnails are 200x150 so the image will be crisp at 2x density.

### Step 7: Validate

Launch a sub-agent that reviews the implementation against this plan's Goal section. Check:

- Thumbnails appear in search results when BGG provides them
- Results without thumbnails (beyond first 20, or when thing batch fails) degrade gracefully
- No regression in search functionality (adding, previewing still work)
- Latency of search is acceptable (one additional API call)
- Type changes propagate correctly across shared, daemon, and web packages

## Delegation Guide

No specialized expertise required. All steps are standard TypeScript changes across the three packages. The work follows established patterns (BGG client already does batch thing requests in `getGames`; web UI already renders game images on detail pages).

Steps requiring review:

- **Step 3** (BGG client enrichment): Verify error handling is consistent with existing patterns in `getGames()`. The graceful degradation (return results without thumbnails on failure) should log at warn level, not silently swallow.
- **Step 6** (Web UI): Verify thumbnail sizing works with the existing search result layout. The `.search-result-row` currently uses flexbox, so adding a fixed-width thumbnail before the info section should flow naturally.

## Open Questions

None. The implementation is straightforward given the existing patterns. The latency trade-off (additional ~5s for thumbnail enrichment) is noted in Codebase Context and accepted as reasonable for the current stage.

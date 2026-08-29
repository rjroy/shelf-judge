---
title: Profile evidence explorer
date: 2026-08-29
status: draft
tags: [profile, evidence, navigation, progressive-disclosure, responsive-layout]
modules: [web, collection-profile]
related:
  [.lore/work/specs/useful-collection-profile.md, .lore/work/plans/useful-collection-profile.md]
---

# Profile evidence explorer

Rendered responsive mockup: [interactive HTML](profile-evidence-explorer-mockup.html), [desktop screenshot](profile-evidence-explorer-desktop.png), [mobile detail screenshot](profile-evidence-explorer-mobile.png), and [dark-theme screenshot](profile-evidence-explorer-dark.png).

## Decision

Replace the all-expanded entity evidence document with a class-scoped master-detail explorer.

The page shows one entity class, a compact searchable index of that class, and one selected entity's complete evidence. Class-wide comparator, exclusion, readiness, and warning details remain available in a separate disclosure on the same page. On wide screens the index and detail appear side by side. On narrow screens they become an index followed by the selected detail, with an explicit return-to-results control.

This is progressive disclosure, not pagination. All evidence remains reachable, direct-linkable, and server-authoritative.

## Problem

`/profile/entities` currently renders three complete entity classes in sequence. Every entity expands five aggregate facts and all supporting games. Every class also expands its complete comparator cohort, exclusions, and refresh warnings. At current collection scale, roughly 168 games and nearly as many mechanics, the document has four failures:

1. Known-item lookup requires browser find or a precise anchor.
2. Comparison requires remembering values across distant cards.
3. Class-wide audit data interrupts the primary entity lookup task.
4. Mobile layout prevents overflow but turns the page into an extremely long single column.

The overview does not share this problem. Its capped identity cards should remain unchanged except for their destination URLs.

## User Jobs

The explorer prioritizes these jobs in order:

1. Find a mechanic, designer, or artist by name.
2. Compare the strongest or most-supported associations within one class.
3. Inspect the games and calculations behind one association.
4. Find which entities have eligible evidence from a known supporting game.
5. Audit cohort membership, exclusions, metadata readiness, and refresh failures.

The fifth job remains possible but should not dominate every visit.

## Page Structure

```text
Collection Entity Evidence                         Back to profile

[ Mechanics 168 ] [ Designers 94 ] [ Artists 61 ]

Mechanics
Supported result · Complete for 160 of 168 games
5 refresh needed · 3 unrefreshable · 8 exclusions · 2 refresh warnings
                                                [Review class evidence]

Find an entity or supporting game [________________________]
[All evidence] [Supported] [Limited]        Order [Rating v]
168 results

┌──────────────────────────────────┬────────────────────────────────────────┐
│ Entity index                     │ Selected evidence                      │
│                                  │                                        │
│ Deck Building        8.7  +1.2   │ Deck Building                          │
│ 24 games · Supported             │ Supported association · 24 games       │
│                                  │                                        │
│ Hand Management      8.4  +0.9   │ Mean 8.7  Delta +1.2  Spread 1.3 ...   │
│ 38 games · Supported             │                                        │
│                                  │ Supporting games                       │
│ Worker Placement     8.1  +0.6   │ Dune: Imperium                    9.7  │
│ 19 games · Supported             │ Lost Ruins of Arnak                9.1  │
│ ...                              │ ...                                    │
└──────────────────────────────────┴────────────────────────────────────────┘
```

### Header and class switcher

The page title and back link remain. A three-item tab list switches among Mechanics, Designers, and Artists. Each tab includes the entity count, which sets expectations before navigation.

Only the active class is present in the result index. Classes remain separate because their evidence has different meaning and because mixing them produces a noisy ranking.

Immediately below the tabs, show the independent class result and metadata-readiness dimensions. Use factual daemon-provided values rather than a combined action count: result, complete and owned game counts, refresh-needed count, unrefreshable count, exclusion count, and refresh-warning count. These categories can overlap, so never add them into one `needs attention` total. Make nonzero counts easy to inspect without presenting the class as invalid.

The class result remains explicit and distinct from readiness:

- `Supported`: at least one entity has three eligible supporting games.
- `Limited`: associations exist, but none has three eligible supporting games.
- `No eligible ratings`: associations exist, but no associated game has eligible fitness.
- `Evaluated empty`: complete metadata contains no associations for this class.
- `Not evaluated`: no owned game has complete metadata for this class.

### Search, filters, and ordering

Search matches case-insensitively against:

- entity name;
- supporting game name.

Matching a game name returns every entity in the active class for which that game is eligible supporting evidence. A result matched only through a game shows `Matched supporting game: <name>` under its normal summary. Excluded games cannot be mapped back to specific entities from the current response contract. If the search text matches an excluded game and no entity result, the empty state says that the game is excluded from this class's entity evidence and links to the class evidence disclosure. It must not imply that the game has no metadata association.

The evidence filter has three values:

- `All evidence`;
- `Supported` (three or more eligible associated games);
- `Limited` (one or two eligible associated games).

Ordering retains the daemon-provided `rating`, `support`, and `name` sequences. Search and support filters select from those sequences but never recalculate ratings, support, or relative order. The initial state is Mechanics, All evidence, Rating.

Display a live result count. Empty presentation depends on the daemon result:

- When entities exist but search or support filtering removes all of them, show a filtered-empty state and `Clear search and filters`.
- For `no-eligible-ratings`, explain that associations exist but no associated game has eligible fitness, then point to exclusions.
- For `evaluated-empty`, explain that complete metadata contains no associations in this class.
- For `not-evaluated`, explain that no owned game has complete metadata for the class, then point to readiness and exclusions.

The latter three are intrinsic evidence states. They never suggest that clearing filters will create results.

### Compact entity index

Each result is a link-like row, not an expandable card. It contains only the values needed to identify and compare entities:

- entity name;
- mean current fitness;
- signed difference from the eligible collection mean;
- associated game count;
- Supported or Limited label.

The selected row has a persistent visual treatment in addition to `aria-current="true"`. Results keep the daemon order. The index scrolls independently on wide screens only when the viewport has enough height to preserve a useful detail pane.

Do not use infinite scroll or virtualized rows. A class of roughly 168 compact rows is reasonable DOM size, browser find continues to work, and assistive technology receives stable list semantics.

### Selected entity detail

Render complete evidence for one entity only:

- support status and explanation;
- mean current fitness;
- population standard deviation;
- range;
- eligible collection mean;
- difference from collection;
- every supporting game with current fitness and veto state;
- direct links to each game detail page.

Order supporting games by the existing daemon response. Do not silently impose a new ranking.

Selection is deterministic from URL state. A valid explicit `entity` in the active class always wins for the detail pane, even when it does not match current search or support filters. In that case, keep the filtered index unchanged and show `Selected entity is outside the current results` with a control that clears search and support filtering. Without an explicit valid entity, select the first filtered entity in daemon order. If there are no filtered entities, show no detail pane. An unknown entity ID or an ID belonging to another class is treated as absent and does not produce an error.

### Class evidence

`Review class evidence` opens a disclosure or modal-sized dialog containing:

- metadata readiness counts;
- eligible comparator count and mean;
- complete comparator game cohort;
- exclusions and correction destinations;
- refresh warnings.

Use a non-modal disclosure on desktop and mobile unless usability testing shows that the expanded material makes context unclear. Native `details` semantics are acceptable if styling and focus behavior are consistent. The control label changes to `Hide class evidence`, and the expanded section appears before the entity results so reading order remains logical.

The three long lists inside class evidence are separately collapsed by default and include counts in their headings, for example `Eligible games (160)`. Opening class evidence exposes the summary first, not another wall of rows.

## Responsive Behavior

### Wide screens, above 900px

Use a two-column master-detail layout. The index is approximately 36% of the available width with a minimum of 320px. The detail receives the remaining width. The control bar and class summary span both columns. This breakpoint follows the existing application shell, whose mobile treatment applies through 900px.

Keep the selected detail heading visible with a sticky position inside the existing page scroller only if it does not create nested scrolling. Prefer one page scroller plus an independently scrolling index over two independently scrolling panes.

### Narrow screens, 900px and below

Use two document modes within the same route rather than placing 168 results before selected evidence:

- With no explicit `entity` parameter, show the controls and complete compact result index first. The default first entity may appear after the index as a preview, but the page opens at the results.
- With an explicit valid `entity`, show the selected detail immediately after the class summary. Put `Back to Mechanics results` before the detail heading and remove the result index from the mobile layout and accessibility tree.

Both modes retain `Back to profile`, the three-class navigation, result, readiness, and nonzero exclusion or warning counts. A deep link therefore keeps the same page and class orientation as ordinary navigation.

The return link clears `entity` and targets the selected row fragment. When the selected entity is outside current filters, the return link also clears `q` and `support` so the target row exists; its label becomes `Clear filters and return to Mechanics results`. This makes results-first and detail-first modes deterministic from the URL and functional without JavaScript. Client enhancement restores focus to the detail heading after selection and to the selected row after returning.

The server renders one index and marks whether selection came from an explicit valid `entity` parameter. Above 900px, CSS always places that index beside the detail. At 900px and below, the existing shell media query uses `display: none` on the index when explicit selection is present; this removes it from layout and the accessibility tree without requiring viewport knowledge on the server or JavaScript. Clearing `entity` returns the same server-rendered index to mobile results mode.

In results mode, keep every compact result row present and reachable. Do not cap, virtualize, or clip the index. Search and support filtering are the tools for reducing it. Detail mode hides the index only at the mobile breakpoint so direct links and ordinary selections cannot recreate the original page length.

Controls stack without horizontal scrolling. Class tabs may wrap into a three-row or two-row segmented group; they must not become a swipe-only strip.

## URL and Navigation Contract

Use query parameters so every meaningful explorer state is reload-safe and shareable:

```text
/profile/entities?class=mechanic&entity=2664&order=rating&support=all&q=deck
```

- `class`: `mechanic`, `designer`, or `artist`;
- `entity`: stable entity ID;
- `order`: `rating`, `support`, or `name`;
- `support`: `all`, `supported`, or `limited`;
- `q`: optional trimmed search text.

Omit default values when generating links where convenient, but parsing must apply the defaults consistently. Invalid values fall back to defaults rather than producing an error.

Update overview entity links to target the matching `class` and `entity` state instead of a fragment in a fully expanded document. Class-level `See all` links target the class with no selected entity, allowing the first daemon-ordered result to become selected.

Every state transition has fixed parameter behavior:

- Class selection preserves `order`, then clears `entity`, `q`, and `support` because those values describe the previous class.
- Entity selection preserves `class`, `order`, `q`, and `support`, and replaces `entity`.
- Search submission and support-filter changes preserve `class` and `order`, set their own values, preserve each other, and clear `entity` so the first matching result becomes selected.
- Ordering changes preserve `class`, `entity`, `q`, and `support`; order changes membership position but not membership.
- `Clear search and filters` preserves `class`, `entity`, and `order`, then removes `q` and `support`.

These rules apply identically to reload, history navigation, shared URLs, enhanced navigation, and no-JavaScript GET navigation.

Use normal links for class and entity selection so opening in a new tab, history, and no-JavaScript navigation remain valid. A small client enhancement may update search and filters without a full reload, but the GET URL remains the source of truth.

## Data and Rendering Boundary

The first implementation can use the existing `GET /api/profile` response. The server already receives all entity and game evidence, and the main performance failure is expanded HTML and DOM volume rather than the response contract itself.

The web layer may:

- validate query state;
- select one active class;
- filter daemon-ordered entity IDs by support and normalized text match;
- choose one entity for detail rendering.

The web layer must not:

- recompute aggregate evidence;
- infer support from game count instead of using `entity.support`;
- reorder results independently of daemon-provided ordering IDs;
- omit class exclusions or warnings from the audit surface.

If profile payload size becomes material after the DOM reduction, introduce a class/entity projection endpoint as a separate measured optimization. Do not couple that API expansion to the first layout change.

## Accessibility

- Implement class selection as a tab list only if arrow-key tab behavior is provided. Otherwise use a clearly labeled navigation list of links, which is simpler and fully correct.
- Give search an explicit label and explain that it searches entity and supporting game names.
- Use native radios or a select for support filtering, not clickable visual chips without form semantics.
- Mark the selected entity with `aria-current="true"` and a non-color visual indicator.
- Preserve 44px minimum targets and visible focus rings.
- Announce result-count changes from client-enhanced filtering through a polite live region.
- When mobile navigation moves to detail, focus the detail heading. Returning to results restores focus to the selected row.
- Keep all supporting game links in document order and retain visible veto wording.
- Browser zoom at 200% must preserve controls and selected evidence without horizontal page overflow.

## Visual Direction

Continue the reworked profile's restrained evidence language: neutral surfaces, compact fact blocks, uppercase status labels, action-color links, and warning colors only for incomplete evidence, refresh problems, and vetoes. Limited evidence is neutral in the index and receives explanatory warning treatment only in its selected detail.

The index should feel closer to an annotated ledger than a card gallery. Use aligned numeric columns where space permits, a thin selected-edge marker, and quiet row separators. Reserve bordered cards for the selected evidence and class audit disclosure. This creates a clear density contrast between scanning and reading.

Do not add charts, badges for every value, sticky floating toolbars, or decorative icons. The improvement comes from hierarchy and state, not more visual elements.

### Visual exploration

Three layout directions were considered against a production-sized class.

#### Evidence ledger

A compact ranked ledger occupies the left column and a stable evidence sheet occupies the right. Mean and difference retain aligned columns while support status and game count sit beneath the entity name. This provides fast lookup, enough comparison context, and repeated inspection without leaving the workspace.

Strengths: best balance of lookup, comparison, and evidence reading; extends Shelf Judge's existing dense collection-row language; adapts cleanly to a detail-first mobile mode.

Cost: the index becomes one clearly bounded nested scroll region on sufficiently tall desktop viewports.

#### Ranked scorebook

A full-width table shows all entities, followed by one selected evidence chapter. This gives the strongest cross-entity comparison and the most explicit column relationships.

Strengths: maximum table density and excellent numeric scanning.

Cost: selecting an entity jumps beyond a potentially 168-row table, and repeated inspection requires long-distance return navigation. The problem is worst on mobile.

#### Catalog and dossier

An alphabetical directory leads to a wide editorial evidence dossier, with supporting games in a third desktop column.

Strengths: excellent known-name lookup and a spacious detail presentation.

Cost: alphabetical landmarks disappear under rating or support ordering, limited entities leave the third column sparse, and the responsive system becomes substantially more complex.

The evidence ledger is the chosen direction. Borrow explicit numeric column headings from the scorebook. Alphabetic landmarks may be tested later for name ordering, but they are not part of the first implementation.

### Desktop composition

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Collection Entity Evidence                              Back to profile     │
├─────────────────────────────────────────────────────────────────────────────┤
│ MECHANICS 168        DESIGNERS 94        ARTISTS 61                         │
│ Supported · 160/168 complete                       Review class evidence    │
│ 5 refresh needed · 3 unrefreshable · 8 excluded · 2 warnings               │
├─────────────────────────────────────────────────────────────────────────────┤
│ Search entity or supporting game [______________] [All evidence] [Rating]  │
│ 168 results                                                                 │
├───────────────────────────────┬─────────────────────────────────────────────┤
│ ENTITY             MEAN   Δ   │ DECK BUILDING                              │
│ ▌Deck Building      8.7 +1.2  │ SUPPORTED · 24 GAMES                       │
│   24 games · Supported        │                                             │
│  Hand Management    8.4 +0.9  │ 8.7       +1.2       1.3       6.0–9.7     │
│   38 games · Supported        │ Mean      vs collection Spread    Range     │
│  Worker Placement   8.1 +0.6  │                                             │
│   19 games · Supported        │ SUPPORTING GAMES                            │
│  ...                          │ Dune: Imperium                         9.7  │
│                               │ Lost Ruins of Arnak                    9.1  │
└───────────────────────────────┴─────────────────────────────────────────────┘
```

The explorer is centered at the existing profile maximum width of 1080px. The index uses `clamp(340px, 36%, 440px)`, and the detail fills the remaining width. A single outer border and one column divider define the workspace. Do not wrap each row in a card.

The index may use `max-height: calc(100dvh - 280px)` with a practical minimum of 360px when the viewport is tall enough. The page and detail keep the primary scrollbar. The bounded index is the only nested scroll region.

### Mobile composition

Results mode:

```text
┌──────────────────────────────┐
│ Entity Evidence              │
│ Back to profile              │
├──────────────────────────────┤
│ Mechanics 168                │
│ Designers 94                 │
│ Artists 61                   │
├──────────────────────────────┤
│ Supported · 160/168 complete │
│ Review class evidence        │
├──────────────────────────────┤
│ Search [___________________]  │
│ Evidence [All evidence ▾]     │
│ Order    [Rating ▾]          │
│ 168 results                  │
├──────────────────────────────┤
│ ▌Deck Building       8.7     │
│   24 games · +1.2 · Supported│
│                              │
│  Hand Management     8.4     │
│   38 games · +0.9 · Supported│
└──────────────────────────────┘
```

Selected-detail mode:

```text
┌──────────────────────────────┐
│ Entity Evidence              │
│ Mechanics · 160/168 complete │
├──────────────────────────────┤
│ Back to profile              │
│ Mechanics · Designers · Artists│
│ Supported · 160/168 complete │
│ 5 refresh · 3 unrefreshable  │
│ 8 excluded · 2 warnings      │
├──────────────────────────────┤
│ Back to Mechanics results    │
│                              │
│ DECK BUILDING                │
│ Supported · 24 games         │
│                              │
│ Mean 8.7          Δ +1.2     │
│ Spread 1.3        6.0–9.7    │
│                              │
│ SUPPORTING GAMES             │
│ Dune: Imperium          9.7  │
│ Lost Ruins of Arnak     9.1  │
└──────────────────────────────┘
```

### Visual specifications

| Element                | Specification                                                         |
| ---------------------- | --------------------------------------------------------------------- |
| Wide breakpoint        | Above 900px; narrow composition applies through 900px                 |
| Explorer maximum width | 1080px, matching existing profile sections                            |
| Index width            | `clamp(340px, 36%, 440px)`                                            |
| Workspace boundary     | 1px `var(--border)`, 8px radius                                       |
| Column divider         | 1px `var(--border-strong)`                                            |
| Index row              | 52px minimum desktop, 64px minimum mobile                             |
| Index row padding      | 10px 12px desktop, 10px 14px mobile                                   |
| Selected row           | 3px inset `var(--action)` edge plus `var(--action-subtle)` background |
| Hovered row            | `var(--row-hover)` without replacing the selected edge                |
| Entity name            | 15px/20px, weight 600                                                 |
| Mean fitness           | 15px/18px, weight 700, tabular numerals                               |
| Delta and game count   | 13px/18px, tabular numerals                                           |
| Status text            | 11px/15px, weight 700, uppercase, 0.06em tracking                     |
| Detail title           | 24px/29px desktop, 20px/25px mobile                                   |
| Primary fact value     | 20px/24px, weight 700, tabular numerals                               |
| Fact label             | 11px/15px, uppercase, 0.06em tracking                                 |
| Detail padding         | 24px desktop, 16px mobile                                             |
| Supporting-game row    | 40px minimum, name left and fitness right                             |
| Search                 | Flexible with 280px desktop minimum, full-width mobile                |
| Interactive targets    | 44px minimum with existing visible focus ring                         |

Supporting games use table-like rows rather than prose sentences. Omit `No veto applied` from normal rows. When veto is present, show visible `Vetoed; displayed as 0` text. This preserves evidence while removing the most repetitive phrase from the dominant state.

Use warning color only for incomplete evidence, refresh problems, and vetoes. Limited rows carry a neutral `Limited` status in the ledger; their selected detail contains the explanatory warning. Scores do not receive a color scale. Color identifies selection, action, or exceptional evidence, not rank.

Desktop headings label the numeric columns `Mean` and `vs collection`. Mobile rows retain equivalent visually hidden labels so `8.7` and `+1.2` are never communicated by position alone.

Enable the bounded desktop index only above 720px viewport height. Give the scroll region an accessible name, make it keyboard-focusable without adding application-style grid behavior, and show a quiet bottom-edge fade while additional rows remain. At shorter heights, let the entire page scroll normally instead of creating a cramped nested region.

### Interface states

- Loading preserves the control frame, eight fixed-height ledger placeholders, and one detail placeholder. Motion respects `prefers-reduced-motion`.
- Filtered empty appears inside the index while preserving an explicit selected detail when valid.
- Intrinsic empty replaces the split workspace with the result-specific explanation and class-audit action.
- Selected outside filters shows a compact action-colored notice above the detail, not a page-wide warning.
- Whole-profile failure remains a left-aligned retry surface beneath the title.
- At 200% zoom, the explorer switches to the mobile composition before either column narrows below 320px.

## Alternatives Rejected

### Paginate the current cards

Pagination shortens each page but preserves the wrong unit of presentation. Comparison remains difficult, search by supporting game remains absent, and class-wide evidence still interrupts entity evidence.

### Collapse every entity in place

Accordions reduce initial height but still produce a long undifferentiated list and weak direct-link behavior. Opening several records recreates the original page. Master-detail gives selection a durable URL and stable reading area.

### Virtualize the entity list

The entity count does not justify the accessibility, browser-find, print, and measurement complexity. Compact rows solve the DOM problem without virtualization.

### Create separate pages for every entity

Dedicated routes provide clean URLs but make comparison and sequential browsing expensive. The explorer preserves a stable index while still direct-linking the selected detail.

### Add a second game-centric evidence page

Searching supporting game names answers the immediate reverse-lookup need within the same mental model. A dedicated game-centric page would duplicate navigation and should wait for evidence that users need broader cross-class game analysis.

## Validation

The design succeeds when all of the following are true with production-shaped data:

1. A user can reach any named mechanic, designer, or artist from the page controls without browser find.
2. Searching an eligible supporting game name returns every entity containing that game in its evidence and explains the match; matching an excluded game never claims that no association exists.
3. At most one entity's complete supporting-game list is in the rendered document at a time.
4. All class comparator games, exclusions, correction links, and refresh warnings remain reachable.
5. Changing class, order, support filter, search, or selected entity produces a shareable URL and survives reload.
6. Ratings and result order remain traceable to daemon-provided evidence and ordering IDs.
7. Keyboard-only use covers class selection, filters, result selection, class evidence, game links, and return-to-results behavior.
8. Mobile, tablet, desktop, and 200% zoom layouts have no horizontal page overflow and do not require swipe-only discovery.
9. No-JavaScript GET navigation can select classes, filters, orderings, and entities.
10. With approximately 168 entities in a class, the initial document renders compact index rows plus one evidence record rather than hundreds of expanded evidence cards.
11. Supported, limited, no-eligible-ratings, evaluated-empty, and not-evaluated remain distinguishable from metadata readiness and from filtered-empty results.

## Implementation Boundary

Expected changes are limited to the entity drilldown route, entity evidence components, profile overview destinations, profile styles, and focused unit/E2E coverage. The profile engine and shared response contract should not change for the first implementation.

This design does not alter evidence calculations, support thresholds, identity claims, axis diagnostics, attention items, or correction behavior.

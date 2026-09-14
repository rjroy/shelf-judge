# Shelf Judge Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Board-game collection owners who want an intentional shelf. They are deciding what to keep, what to remove, what to consider adding, and what to play, using their own preferences and circumstances.

## Product Purpose

Help owners understand what their collection reveals about them and make informed curation decisions. Combine personal, multi-axis ratings with BoardGameGeek (BGG) context into inspectable fitness scores and collection-level evidence. Success means the owner can understand the evidence and make their own decision, including deciding that nothing needs action.

## Positioning

Fitness is personal and collection-aware, rather than a restatement of community popularity. Owners define and weight their own rating axes; transparent breakdowns distinguish personal judgments, factual source data, predictions, and adjustments. Shelf Judge is a personal curation tool, not a social collection platform, a replacement for BGG, or an automated purchasing authority.

## Operating Context

- The web app is the primary interface, supported by a local daemon and CLI. Next.js proxies requests to the daemon over a Unix socket; the daemon owns persisted data.
- Core collection use requires no hosted Shelf Judge service, cloud sync, or account. Manual entry and personal-only scoring work without a BGG token; BGG search, import, and metadata retrieval require configured access.
- Typical work includes browsing and filtering a collection, inspecting a game and its score, rating personal axes, recording owner notes, comparing games in tournaments, evaluating wishlist fitness, and checking shelf capacity.
- Collection Profile describes supported patterns and keeps explicit first-play or replay intentions visible. Intentions are not inferred from low play counts, purchase dates, or ownership.
- Optional AI workflows are explicitly invoked and can send relevant collection evidence, including owner notes, to the configured provider. Ordinary local note operations and profile computation do not automatically invoke a model.
- Development starts from the repository root with `bun run dev`, which runs the daemon and web app together; the documented web entry is `http://localhost:3000`.

## Capabilities and Constraints

- Personal weighted axes, derived BGG axes, utility curves, tournament ranking, redundancy adjustments, wishlist predictions, and inspectable score contributions support judgment. Detailed scoring semantics belong to the current feature contracts.
- Owned, wishlist, and previously owned games have distinct meanings. Owner notes preserve the owner's words and must not silently become factual metadata or numerical ratings.
- Collection identity represents supported associations within the owner's collection, not causal explanations or universal assessments of mechanics, designers, or artists. Sparse evidence must remain visibly limited.
- Attention is based on explicit owner-created play intentions. No invented urgency, overdue framing, or automatic sale conclusion should be added. An empty attention list is a successful state.
- Shelf configuration, physical box dimensions, and capacity/overflow inspection are implemented surfaces. Physical fit matters, not merely aggregate volume.
- Preserve honest unavailable, missing-data, insufficient-evidence, mutation-error, and conflict states. Do not substitute confident conclusions for absent evidence or discard a user's unsaved note draft.

## Brand Commitments

The product name is **Shelf Judge**. Its confirmed stance is that data serves the owner's judgment. Language should describe evidence and choices without pressure or unsupported certainty; play intentions must not imply failure or lateness.

## Evidence on Hand

Paths below are relative to the repository root, two directories above this file.

- `.lore/reference/vision.md`: product vision, principles, anti-goals, and tension resolution.
- `.lore/reference/specs/current/useful-collection-profile.md`: approved identity and attention contract, including honest abstention and accessible interaction.
- `.lore/reference/specs/current/owner-game-notes.md`: owner-note meaning, persistence, privacy, draft protection, and accessibility.
- `.lore/reference/specs/current/derived-bgg-axes.md`: current derived-axis decisions.
- `.lore/reference/specs/current/collection-purchase-utilization.md`: purchase and utilization context.
- `.lore/reference/specs/current/game-view-next-previous-navigation.md`: collection-context navigation and browser behavior.
- `.lore/reference/specs/features/shelf-capacity.md`: implemented physical-capacity requirements.
- Other feature contracts are grouped under `.lore/reference/specs/`; existing visual assets are under `packages/web/public/` and `.lore/reference/art/`.
- `packages/web/app/` and `packages/web/components/` provide implementation evidence. `README.md` documents architecture and setup but has known feature-status drift, including the shelf-capacity status.

This record summarizes product truth confirmed during init. `.lore/reference/` remains current authority for detailed requirements. Follow individual status and authority notices for mixed-era or draft work in `.lore/work/specs/`; do not treat it as a blanket contract. The owner flagged possible specification drift after substantial development. Init was not a full specification-to-code reconciliation.

## Product Principles

1. Ownership is personal and specific: user-defined preferences must have a place.
2. One number, honestly derived: a score must remain inspectable.
3. Collection identity needs evidence: reveal supported patterns and acknowledge limits.
4. Data serves judgment: the owner decides what stays, goes, or comes next.
5. The shelf has carrying capacity: understand games in collection and physical context.

## Accessibility & Inclusion

Current profile, owner-note, and game-navigation specifications establish keyboard operation, semantic structure, visible focus, descriptive accessible names, and non-color-only states. The profile explicitly requires WCAG 2.1 AA contrast. Mutations need accessible success/error announcements, associated field errors, and appropriate focus retention or recovery.

Preserve the specified browser acceptance coverage at 375×812, 768×1024, and 1440×900 CSS pixels and 200% desktop zoom, including usable 44px targets and no clipped content, horizontal page overflow, or hover-only essential behavior. These are documented requirements, not a claim that init audited conformance. Additional audience-specific accommodations and broader localization requirements remain unestablished.

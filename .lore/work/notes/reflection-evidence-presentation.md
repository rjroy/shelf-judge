# Reflection Evidence Presentation Investigation

**Issue:** `shelf-judge-5lm`
**Status:** investigation and recommendation only, 2026-09-13

## Scope and method

This investigation assessed the current source and its typed citation contract. It did not
independently reproduce the reported rendered count, so the report does not confirm the
observation that “Deterministic evidence” appears four linked and five unlinked times.

## Current behavior

`packages/web/components/profile/reflection-card.tsx` has one `CitationList` render path:

- It maps every entry in `result.citations` to one list item.
- It labels each entry as `Owner testimony` or `Deterministic evidence`, followed by its
  `canonicalSummary`.
- A current citation is a link only when `citationHref` recognizes its destination operation
  and has a `gameId`; otherwise it is an unlinked `span`.
- A stale citation is always an in-card anchor to its captured snapshot, rather than a link to
  the current source page.

Thus, the linked and unlinked elements are mutually exclusive outcomes for a _single_
citation. They are not duplicate render paths. Repetition can instead occur because there is
no presentation-level grouping or deduplication: every citation in the stored array receives
the same broad deterministic prefix.

## Citation representation and traceability constraints

The shared reflection contract represents a citation with `citationId`, `sourceId`,
`sourceVersion`, optional `observedAt`, `canonicalSummary`, `evidenceClass`, `testimony`, and
a typed destination (`operationId` plus parameters). The evidence class distinguishes owner
notes from deterministic categories such as game identity/ownership, current scoring,
imported metadata, plays/acquisition, collection structure/summary, and profile evidence.

The current card only exposes the testimony boolean, summary, and a destination inferred from
operation ID. It cannot safely manufacture a game name from `sourceId`; the current client
contract does not provide a display-name field. Citation IDs, source versions, and timestamps
must remain available in stale snapshots for auditability.

## Recommendation

Replace the flat, repeated-prefix citation list with a compact **Evidence used** section:

1. Group citations first by meaningful source context, using the destination game when it has
   a supplied display name, otherwise a defined collection/profile source label. Within a
   group, subgroup by evidence class. Do not use `sourceId` as UI text.
2. Give deterministic citations class-specific labels, for example **Current fitness score**,
   **Game identity and ownership**, **Imported game metadata**, **Play and acquisition
   history**, **Collection pattern**, or **Profile evidence**, rather than the generic
   “Deterministic evidence.” Keep **Owner note** for testimony.
3. Deduplicate entries within a group only when they identify the same immutable evidence:
   same `evidenceClass`, `sourceId`, `sourceVersion`, destination, and canonical summary.
   Preserve one accessible item with the complete canonical summary and its citation ID(s).
   Do not merge merely similar summaries or citations from different source versions.
4. Keep one destination link per current grouped item when a current-source route exists. For
   unsupported destinations, render an explicit non-link source label, not a visually
   indistinguishable fallback. For stale output, retain the in-card snapshot disclosure with
   canonical summary, source version, and observed time, and label it as captured evidence.
5. Extend the citation projection/contract with an optional, validated source display context
   (for example `gameTitle` for a game destination and a controlled label for profile or
   collection evidence). Populate it at evidence projection time. This makes meaningful labels
   stable and avoids client-side lookups or guesses based on opaque IDs.

This retains every citation's evidence identity and destination while making repeated evidence
classes scannable. It also intentionally leaves the reflection synthesis, evidence retrieval,
and stale-data semantics unchanged.

## Proposed implementation follow-up

Create a focused implementation task to add the display-context projection, grouped citation
view model, and component rendering. Its tests should cover current linked sources,
unsupported/unlinked sources, stale snapshots, exact-identity deduplication, distinct-version
non-deduplication, and accessible group and link labels. The reported count should be checked
against a real rendered fixture as part of that work, rather than treated as established here.

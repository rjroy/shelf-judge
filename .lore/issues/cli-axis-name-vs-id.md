---
title: CLI axis commands use names but daemon API expects UUIDs
date: 2026-04-06
status: declined
tags: [cli, integration, api-contract]
modules: [cli, daemon-routes]
---

# CLI axis name vs ID integration gap

The CLI design shows axis names in the `--axis` flag (e.g., `--axis "Theme"`), but the daemon API identifies axes by UUID. This creates an integration gap: CLI users think in terms of axis names, but the API expects IDs.

Possible approaches:

- CLI resolves name to ID by listing axes and matching (adds a round-trip per command)
- Daemon accepts name or ID with fallback resolution (adds ambiguity if names aren't unique)
- CLI always shows IDs alongside names so users can copy-paste (least work, worst UX)

Flagged during Phase 6 review, marked as "Phase 7 integration concern." Phase 7 integration tests may or may not cover this path. Needs verification.

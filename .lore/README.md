# Lore organization

Lore is organized by its present authority, not merely by completion status.

- `reference/` contains durable, active product truth: the current vision, active architecture and product contracts, and supporting assets they own.
- `work/` contains active work and historical working records that are not confirmed durable product truth, including plans, brainstorms, retrospectives, research, notes, validation evidence, and unresolved or unconfirmed specifications and designs.
- `archive/` contains material explicitly archived, superseded, declined, or demonstrably replaced by a current contract.

Completion or resolution alone does not make an artifact obsolete. Completed work remains in `work/` unless there is evidence that a newer authoritative artifact replaced it. Links use repository-root-relative `.lore/...` paths where practical so movement between buckets does not break navigation.

Six mixed-era specifications are reconciliation inputs rather than blanket
product authority: `work/specs/mvp.md`,
`work/specs/tournament/tournament-ranking.md`,
`work/specs/features/previously-owned.md`,
`work/specs/collection/game-links.md`, `work/specs/fitness/utility-curves.md`,
and `work/specs/infra/daemon-logger.md`. Their notices identify surviving
requirements, known uncertainty, and newer authoritative references. Keep links
to them so requirements remain discoverable, but consult the named current
contracts for decisions. Other `work/specs/` files can be new or draft work;
use their individual status and authority notices.

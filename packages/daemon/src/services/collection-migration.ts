// Pure migration functions for the Collection.axes shape.
// Ensures a singleton tournament-source axis exists. No I/O, no service dependencies.
// Cache invalidation for downstream consumers (profile, wishlist predictions) is handled
// by the caller in storage-service, since this module deals only with the Collection value.

import type { Axis, Collection } from "@shelf-judge/shared";

interface MigrationResult {
  data: Collection;
  migrated: boolean;
}

const TOURNAMENT_AXIS_NAME = "Tournament";
const TOURNAMENT_AXIS_DESCRIPTION =
  "Derived from head-to-head tournament comparisons. Each game's score is its normalized ELO display value.";
// Interim default weight per the plan: parity with BGG-axis tier. Tracked as an open
// question for a system-axis-wide default-weight policy.
const TOURNAMENT_AXIS_DEFAULT_WEIGHT = 30;

/**
 * Ensure the collection contains exactly one axis with source === "tournament".
 *
 * If absent, append a fresh tournament axis with fixed defaults (REQ-TAXIS-5) and
 * report `migrated: true`. If already present, return the input unchanged (idempotent).
 *
 * Existing personal and BGG axes are never modified or removed (REQ-TAXIS-10).
 *
 * The caller is responsible for persisting the returned collection and for invalidating
 * any downstream caches (profile, wishlist predictions) when `migrated === true` —
 * those caches were computed against an axis set that did not include the new
 * tournament axis and would otherwise leak stale results.
 */
export function ensureTournamentAxis(collection: Collection): MigrationResult {
  const hasTournamentAxis = collection.axes.some((a) => a.source === "tournament");
  if (hasTournamentAxis) {
    return { data: collection, migrated: false };
  }

  const now = new Date().toISOString();
  const tournamentAxis: Axis = {
    id: crypto.randomUUID(),
    name: TOURNAMENT_AXIS_NAME,
    description: TOURNAMENT_AXIS_DESCRIPTION,
    weight: TOURNAMENT_AXIS_DEFAULT_WEIGHT,
    source: "tournament",
    bggField: null,
    createdAt: now,
    updatedAt: now,
  };

  return {
    data: {
      ...collection,
      axes: [...collection.axes, tournamentAxis],
    },
    migrated: true,
  };
}

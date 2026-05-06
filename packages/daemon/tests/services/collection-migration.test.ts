import { describe, expect, test } from "bun:test";
import type { Axis, Collection } from "@shelf-judge/shared";
import { ensureTournamentAxis } from "../../src/services/collection-migration.js";

const NOW = "2026-01-01T00:00:00.000Z";

function makeAxis(overrides: Partial<Axis> & Pick<Axis, "source">): Axis {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? "Axis",
    description: overrides.description ?? null,
    weight: overrides.weight ?? 50,
    bggField: overrides.bggField ?? null,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
    ...overrides,
  };
}

function makeCollection(axes: Axis[]): Collection {
  return {
    id: "col-1",
    name: "Test",
    axes,
    games: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("ensureTournamentAxis", () => {
  test("appends a tournament axis when none exists and reports migrated", () => {
    const personal = makeAxis({ source: "personal", name: "Fun" });
    const bgg = makeAxis({ source: "bgg", name: "Community", bggField: "communityRating" });
    const collection = makeCollection([personal, bgg]);

    const { data, migrated } = ensureTournamentAxis(collection);

    expect(migrated).toBe(true);
    expect(data.axes).toHaveLength(3);

    const tournamentAxes = data.axes.filter((a) => a.source === "tournament");
    expect(tournamentAxes).toHaveLength(1);

    const tournament = tournamentAxes[0];
    expect(tournament.name).toBe("Tournament");
    expect(tournament.weight).toBe(30);
    expect(tournament.bggField).toBeNull();
    expect(tournament.description).toContain("head-to-head");
    expect(tournament.id).toBeString();
    expect(tournament.createdAt).toBeString();
    expect(tournament.updatedAt).toBeString();
  });

  test("is a no-op when a tournament axis already exists", () => {
    const existingTournament = makeAxis({
      source: "tournament",
      name: "Tournament",
      weight: 25, // a non-default weight, to prove the migration leaves it alone
    });
    const personal = makeAxis({ source: "personal", name: "Fun" });
    const collection = makeCollection([personal, existingTournament]);

    const { data, migrated } = ensureTournamentAxis(collection);

    expect(migrated).toBe(false);
    expect(data).toBe(collection); // identity preserved on idempotent path
    expect(data.axes).toHaveLength(2);
    expect(data.axes.find((a) => a.source === "tournament")!.weight).toBe(25);
  });

  test("does not modify existing personal or BGG axes (REQ-TAXIS-10)", () => {
    const personal = makeAxis({
      source: "personal",
      name: "Fun",
      weight: 75,
      description: "How fun",
    });
    const bgg = makeAxis({
      source: "bgg",
      name: "Complexity",
      weight: 40,
      bggField: "weight",
    });
    const collection = makeCollection([personal, bgg]);

    const { data, migrated } = ensureTournamentAxis(collection);

    expect(migrated).toBe(true);

    const personalAfter = data.axes.find((a) => a.id === personal.id);
    expect(personalAfter).toEqual(personal);

    const bggAfter = data.axes.find((a) => a.id === bgg.id);
    expect(bggAfter).toEqual(bgg);
  });

  test("a second pass on a migrated collection is a no-op", () => {
    const collection = makeCollection([makeAxis({ source: "personal" })]);
    const first = ensureTournamentAxis(collection);
    expect(first.migrated).toBe(true);

    const second = ensureTournamentAxis(first.data);
    expect(second.migrated).toBe(false);
    expect(second.data.axes).toHaveLength(2);
  });
});

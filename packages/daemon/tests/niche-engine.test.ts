import { describe, expect, test } from "bun:test";
import { computeNichePositions, computeNicheImpact } from "../src/services/niche-engine";
import type { Game, GameWithScore, FitnessResult, BggGameData } from "@shelf-judge/shared";

// --- Test fixture helpers ---

function makeBggData(
  overrides: Partial<BggGameData> & {
    mechanics?: { id: number; name: string }[];
    categories?: { id: number; name: string }[];
    families?: { id: number; name: string }[];
  } = {},
): BggGameData {
  return {
    communityRating: 7.0,
    bayesAverage: 6.5,
    weight: 3.0,
    numWeightVotes: 100,
    description: null,
    mechanics: [],
    categories: [],
    families: [],
    subdomains: [],
    suggestedPlayerCounts: [],
    fetchedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeGame(id: string, name: string, bggData: BggGameData | null): Game {
  return {
    id,
    bggId: bggData ? 1 : null,
    name,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    playingTime: 60,
    imageUrl: null,
    bggData,
    numPlays: null,
    ratings: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function makeScore(
  score: number,
  options: { vetoed?: boolean; predictedOnly?: boolean } = {},
): FitnessResult {
  return {
    score: options.vetoed ? 0 : score,
    ratedAxisCount: 3,
    totalAxisCount: 5,
    breakdown: [],
    vetoed: options.vetoed ?? false,
    vetoedBy: null,
    hypotheticalScore: null,
    predictionMeta: options.predictedOnly
      ? {
          readinessStage: 2,
          confidence: "moderate",
          predictedAxisCount: 3,
          actualAxisCount: 0,
          referenceGameCount: 5,
          coveragePercent: 60,
        }
      : null,
  };
}

function makeGws(game: Game, score: FitnessResult | null): GameWithScore {
  return { game, score };
}

// --- Test fixture: 8-10 games with known overlap ---
// Game A: mechanics [Deck Building, Hand Management], categories [Card Game], score 8.4
// Game B: mechanics [Deck Building], categories [Card Game, Strategy], score 8.4, predicted-only
// Game C: mechanics [Deck Building, Worker Placement], categories [Strategy], score 7.2
// Game D: mechanics [Worker Placement, Area Control], categories [Strategy], score 6.8
// Game E: mechanics [Hand Management, Area Control], categories [Wargame], score 9.0
// Game F: mechanics [Deck Building], score 0, vetoed
// Game G: no BGG data, score 7.5
// Game H: mechanics [Hand Management], categories [Card Game], score 8.4
// Game I: families [Kosmos Two-Player], mechanics [Hand Management], score 5.0

const mech = (name: string) => ({ id: Math.random(), name });
const cat = (name: string) => ({ id: Math.random(), name });
const fam = (name: string) => ({ id: Math.random(), name });

const gameA = makeGame(
  "a",
  "Alpha",
  makeBggData({
    mechanics: [mech("Deck Building"), mech("Hand Management")],
    categories: [cat("Card Game")],
  }),
);
const gameB = makeGame(
  "b",
  "Beta",
  makeBggData({
    mechanics: [mech("Deck Building")],
    categories: [cat("Card Game"), cat("Strategy")],
  }),
);
const gameC = makeGame(
  "c",
  "Charlie",
  makeBggData({
    mechanics: [mech("Deck Building"), mech("Worker Placement")],
    categories: [cat("Strategy")],
  }),
);
const gameD = makeGame(
  "d",
  "Delta",
  makeBggData({
    mechanics: [mech("Worker Placement"), mech("Area Control")],
    categories: [cat("Strategy")],
  }),
);
const gameE = makeGame(
  "e",
  "Echo",
  makeBggData({
    mechanics: [mech("Hand Management"), mech("Area Control")],
    categories: [cat("Wargame")],
  }),
);
const gameF = makeGame(
  "f",
  "Foxtrot",
  makeBggData({
    mechanics: [mech("Deck Building")],
  }),
);
const gameG = makeGame("g", "Golf", null);
const gameH = makeGame(
  "h",
  "Hotel",
  makeBggData({
    mechanics: [mech("Hand Management")],
    categories: [cat("Card Game")],
  }),
);
const gameI = makeGame(
  "i",
  "India",
  makeBggData({
    families: [fam("Kosmos Two-Player")],
    mechanics: [mech("Hand Management")],
  }),
);

const scoreA = makeScore(8.4);
const scoreB = makeScore(8.4, { predictedOnly: true });
const scoreC = makeScore(7.2);
const scoreD = makeScore(6.8);
const scoreE = makeScore(9.0);
const scoreF = makeScore(0, { vetoed: true });
const scoreG = makeScore(7.5);
const scoreH = makeScore(8.4);
const scoreI = makeScore(5.0);

const allGames: GameWithScore[] = [
  makeGws(gameA, scoreA),
  makeGws(gameB, scoreB),
  makeGws(gameC, scoreC),
  makeGws(gameD, scoreD),
  makeGws(gameE, scoreE),
  makeGws(gameF, scoreF),
  makeGws(gameG, scoreG),
  makeGws(gameH, scoreH),
  makeGws(gameI, scoreI),
];

// Expected niches:
// Deck Building: A(8.4 actual), B(8.4 predicted), C(7.2) -- F excluded (vetoed)
// Hand Management: E(9.0), A(8.4), H(8.4), I(5.0)
// Worker Placement: C(7.2), D(6.8)
// Area Control: E(9.0), D(6.8)
// Card Game: A(8.4 actual), B(8.4 predicted), H(8.4 actual)
// Strategy: B(8.4 predicted), C(7.2), D(6.8)
// Wargame: only E -- excluded (<2)
// Kosmos Two-Player: only I -- excluded (<2)

describe("computeNichePositions", () => {
  const result = computeNichePositions(allGames);

  test("groups games correctly by mechanics, categories, families", () => {
    // Game A should be in: Deck Building, Hand Management, Card Game
    const posA = result.get("a")!;
    const nicheNames = posA.niches.map((n) => n.name).sort();
    expect(nicheNames).toEqual(["Card Game", "Deck Building", "Hand Management"]);
  });

  test("niches with fewer than 2 members are excluded", () => {
    // Wargame has only E, Kosmos Two-Player has only I
    for (const [, pos] of result) {
      for (const niche of pos.niches) {
        expect(niche.name).not.toBe("Wargame");
        expect(niche.name).not.toBe("Kosmos Two-Player");
      }
    }
  });

  test("games without BGG data are excluded", () => {
    expect(result.has("g")).toBe(false);
  });

  test("vetoed games are excluded", () => {
    expect(result.has("f")).toBe(false);
  });

  test("champion is highest-fitness game in each niche", () => {
    // Deck Building champion: A (8.4 actual beats B 8.4 predicted)
    const posA = result.get("a")!;
    const deckBuilding = posA.niches.find((n) => n.name === "Deck Building")!;
    expect(deckBuilding.champion.gameId).toBe("a");
    expect(deckBuilding.champion.gameName).toBe("Alpha");

    // Hand Management champion: E (9.0)
    const posE = result.get("e")!;
    const handMgmt = posE.niches.find((n) => n.name === "Hand Management")!;
    expect(handMgmt.champion.gameId).toBe("e");
  });

  test("tied games share rank; next rank skips", () => {
    // Hand Management: E(9.0)=rank1, A(8.4)=rank2, H(8.4)=rank2, I(5.0)=rank4
    const posI = result.get("i")!;
    const handMgmt = posI.niches.find((n) => n.name === "Hand Management")!;
    expect(handMgmt.rank).toBe(4); // skipped rank 3

    const posA = result.get("a")!;
    const handMgmtA = posA.niches.find((n) => n.name === "Hand Management")!;
    expect(handMgmtA.rank).toBe(2);

    const posH = result.get("h")!;
    const handMgmtH = posH.niches.find((n) => n.name === "Hand Management")!;
    expect(handMgmtH.rank).toBe(2);
  });

  test("actual scores rank above predicted in ties", () => {
    // Deck Building: A(8.4 actual) rank 1, B(8.4 predicted) rank 1 but sorted after A
    // Both share rank 1 because roundedScore is equal.
    // But A sorts before B due to actual-beats-predicted tiebreaker.
    const posA = result.get("a")!;
    const deckA = posA.niches.find((n) => n.name === "Deck Building")!;
    expect(deckA.rank).toBe(1);
    expect(deckA.isChampion).toBe(true);

    const posB = result.get("b")!;
    const deckB = posB.niches.find((n) => n.name === "Deck Building")!;
    // B also shares rank 1 (tied score)
    expect(deckB.rank).toBe(1);
    // But B is predicted, so not champion when actual game A shares rank 1 (REQ-NICHE-8)
    expect(deckB.isChampion).toBe(false);
    expect(deckB.champion.gameId).toBe("a");
  });

  test("above has at most 2 neighbors; below has at most 2", () => {
    // Hand Management has 4 games. Middle game should have bounded neighbors.
    for (const [, pos] of result) {
      for (const niche of pos.niches) {
        expect(niche.above.length).toBeLessThanOrEqual(2);
        expect(niche.below.length).toBeLessThanOrEqual(2);
      }
    }
  });

  test("champion has empty above; last-ranked has empty below", () => {
    // E is champion of Hand Management
    const posE = result.get("e")!;
    const handMgmtE = posE.niches.find((n) => n.name === "Hand Management")!;
    expect(handMgmtE.above).toEqual([]);

    // I is last in Hand Management
    const posI = result.get("i")!;
    const handMgmtI = posI.niches.find((n) => n.name === "Hand Management")!;
    expect(handMgmtI.below).toEqual([]);
  });

  test("multi-niche game has entries for each qualifying niche", () => {
    // Game A: Deck Building, Hand Management, Card Game
    const posA = result.get("a")!;
    expect(posA.niches.length).toBe(3);
    const types = posA.niches.map((n) => `${n.type}:${n.name}`).sort();
    expect(types).toEqual([
      "category:Card Game",
      "mechanic:Deck Building",
      "mechanic:Hand Management",
    ]);
  });

  test("niche entries sorted by size descending, then alphabetically", () => {
    // Game A's niches:
    // Hand Management: size 4
    // Card Game: size 3
    // Deck Building: size 3
    const posA = result.get("a")!;
    const sizes = posA.niches.map((n) => ({ name: n.name, size: n.size }));
    expect(sizes[0].name).toBe("Hand Management");
    expect(sizes[0].size).toBe(4);
    // Card Game and Deck Building both size 3, alphabetical
    expect(sizes[1].name).toBe("Card Game");
    expect(sizes[2].name).toBe("Deck Building");
  });

  test("determinism: repeated calls produce identical results", () => {
    const result1 = computeNichePositions(allGames);
    const result2 = computeNichePositions(allGames);

    expect(result1.size).toBe(result2.size);
    for (const [gameId, pos1] of result1) {
      const pos2 = result2.get(gameId)!;
      expect(pos1.niches.length).toBe(pos2.niches.length);
      for (let i = 0; i < pos1.niches.length; i++) {
        expect(pos1.niches[i].name).toBe(pos2.niches[i].name);
        expect(pos1.niches[i].rank).toBe(pos2.niches[i].rank);
        expect(pos1.niches[i].size).toBe(pos2.niches[i].size);
        expect(pos1.niches[i].champion.gameId).toBe(pos2.niches[i].champion.gameId);
      }
    }
  });

  test("Card Game niche: three-way tie with actual-vs-predicted tiebreak", () => {
    // Card Game: A(8.4 actual), H(8.4 actual), B(8.4 predicted)
    // All share rank 1 (same rounded score).
    // Sort order: A (actual, "Alpha"), H (actual, "Hotel"), B (predicted, "Beta")
    const posA = result.get("a")!;
    const cardA = posA.niches.find((n) => n.name === "Card Game")!;
    expect(cardA.rank).toBe(1);
    expect(cardA.isChampion).toBe(true);
    // Champion should be A (first in sort order)
    expect(cardA.champion.gameId).toBe("a");

    const posH = result.get("h")!;
    const cardH = posH.niches.find((n) => n.name === "Card Game")!;
    expect(cardH.rank).toBe(1); // tied

    const posB = result.get("b")!;
    const cardB = posB.niches.find((n) => n.name === "Card Game")!;
    expect(cardB.rank).toBe(1); // tied
    // B is predicted, not champion when actual games A and H share rank 1 (REQ-NICHE-8)
    expect(cardB.isChampion).toBe(false);
    // B's above should include A and H (the two actual-scored games above it in sort order)
    expect(cardB.above.length).toBe(2);
    expect(cardB.above[0].gameId).toBe("h"); // immediately above B
    expect(cardB.above[1].gameId).toBe("a"); // two spots above B
  });

  test("Worker Placement niche: minimum 2 members", () => {
    // Worker Placement: C(7.2), D(6.8)
    const posC = result.get("c")!;
    const wp = posC.niches.find((n) => n.name === "Worker Placement")!;
    expect(wp.size).toBe(2);
    expect(wp.rank).toBe(1);
    expect(wp.isChampion).toBe(true);

    const posD = result.get("d")!;
    const wpD = posD.niches.find((n) => n.name === "Worker Placement")!;
    expect(wpD.rank).toBe(2);
    expect(wpD.below).toEqual([]);
  });

  test("niche size reflects eligible games only (excludes vetoed)", () => {
    // Deck Building has A, B, C (F excluded as vetoed)
    const posA = result.get("a")!;
    const db = posA.niches.find((n) => n.name === "Deck Building")!;
    expect(db.size).toBe(3);
  });
});

describe("computeNicheImpact", () => {
  test("computes projected rank correctly without mutating input", () => {
    // Candidate: score 8.0, mechanics [Deck Building]
    // Deck Building existing: A(8.4), B(8.4), C(7.2)
    // Candidate at 8.0 slots between B/A (rank 1 tied at 8.4) and C (7.2)
    // Projected rank: 3 (after the two 8.4 games at rank 1, skip to 3)
    const candidate = makeGame("x", "X-Ray", makeBggData({ mechanics: [mech("Deck Building")] }));
    const candidateScore = makeScore(8.0);

    const original = JSON.stringify(allGames);
    const impact = computeNicheImpact(allGames, candidate, candidateScore);

    // Input not mutated
    expect(JSON.stringify(allGames)).toBe(original);

    const db = impact.wouldJoin.find((e) => e.name === "Deck Building")!;
    expect(db.currentSize).toBe(3);
    expect(db.projectedRank).toBe(3);
    expect(db.currentChampion!.gameId).toBe("a");
  });

  test("niche that does not exist yet: currentSize 0, currentChampion null", () => {
    const candidate = makeGame("x", "X-Ray", makeBggData({ mechanics: [mech("Dice Rolling")] }));
    const candidateScore = makeScore(7.0);

    const impact = computeNicheImpact(allGames, candidate, candidateScore);
    const diceRolling = impact.wouldJoin.find((e) => e.name === "Dice Rolling")!;
    expect(diceRolling.currentSize).toBe(0);
    expect(diceRolling.projectedRank).toBe(1);
    expect(diceRolling.currentChampion).toBeNull();
  });

  test("candidate that would become champion of existing niche", () => {
    // Deck Building existing champion: A at 8.4
    // Candidate at 9.5 would be rank 1
    const candidate = makeGame("x", "X-Ray", makeBggData({ mechanics: [mech("Deck Building")] }));
    const candidateScore = makeScore(9.5);

    const impact = computeNicheImpact(allGames, candidate, candidateScore);
    const db = impact.wouldJoin.find((e) => e.name === "Deck Building")!;
    expect(db.projectedRank).toBe(1);
    expect(db.currentChampion!.gameId).toBe("a");
  });

  test("candidate with no BGG data returns empty impact", () => {
    const candidate = makeGame("x", "X-Ray", null);
    const candidateScore = makeScore(8.0);

    const impact = computeNicheImpact(allGames, candidate, candidateScore);
    expect(impact.wouldJoin).toEqual([]);
  });

  test("impact entries sorted by currentSize descending, then alphabetically", () => {
    // Candidate with mechanics [Deck Building, Hand Management] and categories [Card Game]
    // Hand Management: size 4, Card Game: size 3, Deck Building: size 3
    const candidate = makeGame(
      "x",
      "X-Ray",
      makeBggData({
        mechanics: [mech("Deck Building"), mech("Hand Management")],
        categories: [cat("Card Game")],
      }),
    );
    const candidateScore = makeScore(7.0);

    const impact = computeNicheImpact(allGames, candidate, candidateScore);
    const names = impact.wouldJoin.map((e) => e.name);
    expect(names).toEqual(["Hand Management", "Card Game", "Deck Building"]);
  });

  test("candidate tying with existing champion (actual) ranks below", () => {
    // Candidate: predicted-only, score 8.4, mechanic [Deck Building]
    // A is actual at 8.4 (rank 1). Candidate should tie at rank 1 but sort after A.
    const candidate = makeGame("x", "X-Ray", makeBggData({ mechanics: [mech("Deck Building")] }));
    const candidateScore = makeScore(8.4, { predictedOnly: true });

    const impact = computeNicheImpact(allGames, candidate, candidateScore);
    const db = impact.wouldJoin.find((e) => e.name === "Deck Building")!;
    // Tied score, so shares rank 1
    expect(db.projectedRank).toBe(1);
  });
});

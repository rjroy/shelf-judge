// Pure niche ranking functions. No I/O, no service dependencies.
// Implements REQ-NICHE-1 through REQ-NICHE-8, REQ-NICHE-11, REQ-NICHE-15 through REQ-NICHE-17, REQ-NICHE-20.

import type {
  Game,
  GameWithScore,
  FitnessResult,
  NicheEntry,
  NicheImpact,
  NicheImpactEntry,
  NicheNeighbor,
  NichePosition,
} from "@shelf-judge/shared";

type NicheTagType = "mechanic" | "category" | "family";

interface RankedGame {
  gameId: string;
  gameName: string;
  roundedScore: number;
  isPredicted: boolean;
  rank: number;
}

/**
 * Round a fitness score to one decimal place (display precision).
 * Two games are "tied" when their rounded scores are equal (REQ-NICHE-6).
 */
function roundedScore(score: number): number {
  return Math.round(score * 10) / 10;
}

function isPredictedOnly(score: FitnessResult): boolean {
  return score.predictionMeta !== null && score.predictionMeta.actualAxisCount === 0;
}

function toNeighbor(ranked: RankedGame): NicheNeighbor {
  return {
    gameId: ranked.gameId,
    gameName: ranked.gameName,
    fitnessScore: ranked.roundedScore,
    isPredicted: ranked.isPredicted,
  };
}

/**
 * Sort games within a niche by fitness score descending, with tiebreakers:
 * 1. Rounded score descending
 * 2. Actual scores rank above predicted-only scores (REQ-NICHE-8)
 * 3. Alphabetical by game name (REQ-NICHE-6)
 */
function sortAndRank(games: { gws: GameWithScore }[]): RankedGame[] {
  const sorted = games
    .map(({ gws }) => ({
      gameId: gws.game.id,
      gameName: gws.game.name,
      roundedScore: roundedScore(gws.score!.score),
      isPredicted: isPredictedOnly(gws.score!),
    }))
    .sort((a, b) => {
      // Descending score
      if (a.roundedScore !== b.roundedScore) return b.roundedScore - a.roundedScore;
      // Actual beats predicted
      if (a.isPredicted !== b.isPredicted) return a.isPredicted ? 1 : -1;
      // Alphabetical
      return a.gameName.localeCompare(b.gameName);
    });

  // Assign ranks with tie-sharing (REQ-NICHE-6)
  const ranked: RankedGame[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let rank: number;
    if (i === 0) {
      rank = 1;
    } else if (sorted[i].roundedScore === sorted[i - 1].roundedScore) {
      rank = ranked[i - 1].rank;
    } else {
      rank = i + 1;
    }
    ranked.push({ ...sorted[i], rank });
  }

  return ranked;
}

interface NicheGroup {
  type: NicheTagType;
  name: string;
  games: { gws: GameWithScore }[];
}

/**
 * Build an attribute index from eligible games.
 * Returns groups keyed by "type:name".
 */
function buildAttributeIndex(eligibleGames: GameWithScore[]): Map<string, NicheGroup> {
  const index = new Map<string, NicheGroup>();

  for (const gws of eligibleGames) {
    const bggData = gws.game.bggData!;
    const tagSets: [NicheTagType, { name: string }[]][] = [
      ["mechanic", bggData.mechanics],
      ["category", bggData.categories],
      ["family", bggData.families],
    ];

    for (const [type, tags] of tagSets) {
      for (const tag of tags) {
        const key = `${type}:${tag.name}`;
        let group = index.get(key);
        if (!group) {
          group = { type, name: tag.name, games: [] };
          index.set(key, group);
        }
        group.games.push({ gws });
      }
    }
  }

  return index;
}

/**
 * Filter input games: exclude null bggData, null score, and vetoed (REQ-NICHE-3, REQ-NICHE-7).
 */
function filterEligible(gamesWithScores: GameWithScore[]): GameWithScore[] {
  return gamesWithScores.filter(
    (gws) => gws.game.bggData !== null && gws.score !== null && !gws.score.vetoed,
  );
}

/**
 * Sort niche entries by size descending, then alphabetically (REQ-NICHE-20).
 */
function sortNicheEntries(entries: NicheEntry[]): NicheEntry[] {
  return entries.sort((a, b) => {
    if (a.size !== b.size) return b.size - a.size;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Compute niche positions for all games in the collection.
 * Returns a Map keyed by game ID containing the game's NichePosition.
 *
 * REQ-NICHE-15, REQ-NICHE-16: Pure function, no I/O, no service deps.
 */
export function computeNichePositions(
  gamesWithScores: GameWithScore[],
): Map<string, NichePosition> {
  const eligible = filterEligible(gamesWithScores);
  const index = buildAttributeIndex(eligible);

  // Remove groups with <2 members (REQ-NICHE-2)
  for (const [key, group] of index) {
    if (group.games.length < 2) {
      index.delete(key);
    }
  }

  // Rank each group and build niche entries per game
  const gameNiches = new Map<string, NicheEntry[]>();

  for (const group of index.values()) {
    const ranked = sortAndRank(group.games);
    const champion = toNeighbor(ranked[0]);

    for (let i = 0; i < ranked.length; i++) {
      const game = ranked[i];

      // Build above (up to 2 games immediately above = better fitness)
      const above: NicheNeighbor[] = [];
      for (let j = i - 1; j >= 0 && above.length < 2; j--) {
        above.push(toNeighbor(ranked[j]));
      }

      // Build below (up to 2 games immediately below = worse fitness)
      const below: NicheNeighbor[] = [];
      for (let j = i + 1; j < ranked.length && below.length < 2; j++) {
        below.push(toNeighbor(ranked[j]));
      }

      const entry: NicheEntry = {
        type: group.type,
        name: group.name,
        size: ranked.length,
        rank: game.rank,
        isChampion: game.rank === 1,
        champion,
        above,
        below,
      };

      const existing = gameNiches.get(game.gameId);
      if (existing) {
        existing.push(entry);
      } else {
        gameNiches.set(game.gameId, [entry]);
      }
    }
  }

  // Assemble final map with sorted niche entries
  const result = new Map<string, NichePosition>();
  for (const [gameId, niches] of gameNiches) {
    result.set(gameId, { niches: sortNicheEntries(niches) });
  }

  return result;
}

/**
 * Compute niche impact for a candidate game being considered for the collection.
 * Does not mutate existingGamesWithScores.
 *
 * REQ-NICHE-17: Pure function for search preview.
 */
export function computeNicheImpact(
  existingGamesWithScores: GameWithScore[],
  candidateGame: Game,
  candidateScore: FitnessResult,
): NicheImpact {
  if (candidateGame.bggData === null) {
    return { wouldJoin: [] };
  }

  const eligible = filterEligible(existingGamesWithScores);
  const index = buildAttributeIndex(eligible);

  const entries: NicheImpactEntry[] = [];

  const tagSets: [NicheTagType, { name: string }[]][] = [
    ["mechanic", candidateGame.bggData.mechanics],
    ["category", candidateGame.bggData.categories],
    ["family", candidateGame.bggData.families],
  ];

  for (const [type, tags] of tagSets) {
    for (const tag of tags) {
      const key = `${type}:${tag.name}`;
      const group = index.get(key);

      if (!group) {
        // Niche doesn't exist yet (currentSize 0)
        entries.push({
          type,
          name: tag.name,
          currentSize: 0,
          projectedRank: 1,
          currentChampion: null,
        });
        continue;
      }

      const currentSize = group.games.length;
      const ranked = sortAndRank(group.games);
      const currentChampion = toNeighbor(ranked[0]);

      // Create a temporary GameWithScore for the candidate so we can reuse sortAndRank
      const candidateGws: GameWithScore = {
        game: candidateGame,
        score: candidateScore,
      };
      const withCandidate = sortAndRank([...group.games, { gws: candidateGws }]);
      const candidateRanked = withCandidate.find((r) => r.gameId === candidateGame.id);
      const projectedRank = candidateRanked!.rank;

      entries.push({
        type,
        name: tag.name,
        currentSize,
        projectedRank,
        currentChampion,
      });
    }
  }

  // Sort by currentSize descending, then alphabetically (consistent with niche entry sorting)
  entries.sort((a, b) => {
    if (a.currentSize !== b.currentSize) return b.currentSize - a.currentSize;
    return a.name.localeCompare(b.name);
  });

  return { wouldJoin: entries };
}

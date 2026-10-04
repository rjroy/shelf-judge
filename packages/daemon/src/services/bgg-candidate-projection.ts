import type { DerivedAxisGameInput } from "@shelf-judge/shared";
import type { FactualScoringGame } from "./feature-vector.js";

/** Verified compact BGG facts used for scoring, vectors, and preview projections. */
export interface VerifiedBggCandidateFacts {
  readonly id: string;
  readonly name?: string;
  readonly communityRating: number | null;
  readonly weight: number | null;
  readonly mechanics: readonly (string | { readonly name: string })[];
  readonly categories: readonly (string | { readonly name: string })[];
  readonly families?: readonly (string | { readonly name: string })[];
  readonly minPlayers: number | null;
  readonly maxPlayers: number | null;
  readonly bestPlayers: number | null;
  readonly playingTime: number | null;
}

export interface BggCandidateProjection {
  readonly scoringInput: DerivedAxisGameInput & {
    readonly id: string;
    readonly ratings: Record<string, number>;
  };
  readonly factualGame: FactualScoringGame;
  readonly nicheTags: {
    readonly mechanics: readonly { readonly name: string }[];
    readonly categories: readonly { readonly name: string }[];
    readonly families: readonly { readonly name: string }[];
  };
}

/** Build private projections without widening the persisted/public Game contract. */
export function projectVerifiedBggCandidate(
  facts: VerifiedBggCandidateFacts,
): BggCandidateProjection {
  const asTag = (item: string | { readonly name: string }) => ({
    name: typeof item === "string" ? item : item.name,
  });
  const mechanics = facts.mechanics.map(asTag);
  const categories = facts.categories.map(asTag);
  const families = (facts.families ?? []).map(asTag);
  const bggData = {
    communityRating: facts.communityRating,
    weight: facts.weight,
  };
  return {
    scoringInput: {
      id: facts.id,
      ratings: {},
      manualValues: { playingTime: null, playerCount: null },
      bggData,
      minPlayers: facts.minPlayers,
      maxPlayers: facts.maxPlayers,
      bestPlayers: facts.bestPlayers,
      playingTime: facts.playingTime,
    },
    factualGame: {
      id: facts.id,
      minPlayers: facts.minPlayers,
      maxPlayers: facts.maxPlayers,
      bestPlayers: facts.bestPlayers,
      playingTime: facts.playingTime,
      bggData: { ...bggData, mechanics, categories },
    },
    nicheTags: { mechanics, categories, families },
  };
}

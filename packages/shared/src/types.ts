// Core data types for shelf-judge.
// Matches the approved data model design (.lore/designs/mvp-data-model.md)
// and fitness model design (.lore/designs/mvp-fitness-model.md).

export interface BggTag {
  id: number;
  name: string;
}

export interface SuggestedPlayerCount {
  playerCount: string; // "1", "2", ..., "4+"
  best: number; // Vote count
  recommended: number;
  notRecommended: number;
}

export interface BggGameData {
  communityRating: number; // BGG average (1-10)
  bayesAverage: number; // BGG Geek Rating (Bayesian)
  weight: number | null; // 1-5 scale, null if BGG returns 0
  numWeightVotes: number;
  mechanics: BggTag[];
  categories: BggTag[];
  subdomains: string[];
  suggestedPlayerCounts: SuggestedPlayerCount[];
  fetchedAt: string; // ISO 8601
}

export interface Game {
  id: string; // UUID
  bggId: number | null;
  name: string;
  yearPublished: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  playingTime: number | null; // Minutes
  imageUrl: string | null;
  bggData: BggGameData | null;
  ratings: Record<string, number>; // axisId -> rating (1-10)
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export type AxisSource = "personal" | "bgg";

export interface Axis {
  id: string; // UUID
  name: string;
  description: string | null;
  weight: number; // 1-100
  source: AxisSource;
  bggField: string | null; // For source="bgg": which BGG field maps here
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface Collection {
  id: string; // UUID
  name: string;
  axes: Axis[];
  games: Game[];
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

// Fitness score types from .lore/designs/mvp-fitness-model.md

export type FitnessBreakdownSource = "personal" | "bgg" | "override";

export interface FitnessBreakdownEntry {
  axisId: string;
  axisName: string;
  rating: number | null; // null if not rated
  weight: number;
  contribution: number | null; // null if not rated
  source: FitnessBreakdownSource;
  bggOriginal: number | null; // Original BGG value when source is "override"
}

export interface FitnessResult {
  score: number; // 1.0 - 10.0
  ratedAxisCount: number;
  totalAxisCount: number;
  breakdown: FitnessBreakdownEntry[];
}

// App config

export interface AppConfig {
  bggAuthToken: string | null;
  dataDir: string;
  socketPath: string;
}

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

// Tournament types

export interface TournamentSettings {
  kFactorThreshold: number; // Default 15. Games with fewer comparisons use K=32, rest use K=16.
  normalizationHalfWidth: number; // Default 400. Reference range is 1500 ± this value.
  provisionalThreshold: number; // Default 6. Games with fewer comparisons show "(provisional)".
}

export type SessionFilterType = "name" | "minFitness" | "bggTag" | "staleness";

export interface SessionFilter {
  type: SessionFilterType;
  value: string; // Interpretation depends on type
}

export type SessionStatus = "active" | "completed";

export interface TournamentSession {
  id: string;
  filters: SessionFilter[] | null; // null for unfiltered
  gameIds: string[];
  comparisonCount: number;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Comparison {
  id: string;
  gameAId: string;
  gameBId: string;
  winnerId: string;
  sessionId: string;
  createdAt: string;
}

export interface TournamentGameStats {
  eloRating: number; // Default 1500
  comparisonCount: number; // Default 0
}

export interface TournamentData {
  settings: TournamentSettings;
  sessions: TournamentSession[];
  comparisons: Comparison[];
  gameStats: Record<string, TournamentGameStats>;
}

// Display types (derived from TournamentData, used by API responses and clients)

export interface RecentComparison {
  opponentGameId: string;
  opponentGameName: string | null; // null when game has been deleted from collection
  won: boolean;
  createdAt: string;
}

export interface TournamentGameStatsDisplay {
  eloRating: number;
  comparisonCount: number;
  normalizedScore: number | null; // null when < 5 games ranked or game has 0 comparisons
  isProvisional: boolean; // comparisonCount < provisionalThreshold
  displayLabel: string; // "not yet ranked" | "8.3 (provisional)" | "8.3"
  wins: number;
  losses: number;
  recentComparisons: RecentComparison[]; // Last 5, derived from comparison history (never cached)
}

// API response types (shared between daemon, web, and CLI)

export interface GameWithScore {
  game: Game;
  score: FitnessResult | null;
  bggDataStale?: boolean;
}

export interface AddGameResult {
  game: Game;
  bggImported: boolean;
  warning?: string;
}

export interface BggSearchResult {
  bggId: number;
  name: string;
  yearPublished: number | null;
}

// SSE event types for BGG collection import (wire format between daemon and clients)

export interface ImportProgress {
  imported: number;
  total: number;
  current: string;
}

export interface ImportComplete {
  imported: number;
  skipped: number;
  errors: string[];
}

// App config

export interface AppConfig {
  bggAuthToken: string | null;
  dataDir: string;
  socketPath: string;
}

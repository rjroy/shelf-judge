// Core data types for shelf-judge.
// Matches the approved data model design (.lore/designs/mvp-data-model.md)
// and fitness model design (.lore/designs/mvp-fitness-model.md).

// Curve configuration types (utility-curves spec)

export type PreferenceShape = "higher-is-better" | "lower-is-better" | "sweet-spot";
export type ToleranceLevel = "flexible" | "moderate" | "strict";
export type LeanDirection = "lower" | "higher";

export interface VetoConfig {
  direction: "below" | "above";
  threshold: number; // native-scale value
}

export interface NativeScale {
  min: number;
  max: number;
}

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
  description: string | null;
  mechanics: BggTag[];
  categories: BggTag[];
  families: BggTag[];
  subdomains: BggTag[]; // BGG subdomains (Strategy Games, Family Games, etc.)
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
  numPlays: number | null;
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
  preferenceShape?: PreferenceShape;
  idealValue?: number | null;
  tolerance?: ToleranceLevel;
  leanDirection?: LeanDirection | null;
  veto?: VetoConfig | null;
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

export type FitnessBreakdownSource = "personal" | "bgg" | "override" | "predicted";

export interface FitnessBreakdownEntry {
  axisId: string;
  axisName: string;
  rating: number | null; // null if not rated
  weight: number;
  contribution: number | null; // null if not rated
  source: FitnessBreakdownSource;
  bggOriginal: number | null; // Original BGG value when source is "override"
  rawValue: number | null; // native-scale value
  effectiveRating: number | null; // post-curve 1-10 value (same as rating)
  preferenceShape: PreferenceShape; // which shape was applied
  curveAffected: boolean; // true when curve changed the rating by > 0.5
  predictionConfidence: PredictionConfidence | null; // null for non-predicted
  referenceGames: ReferenceGame[] | null; // null for non-predicted
}

export interface FitnessResult {
  score: number; // 1.0 - 10.0 (0 when vetoed)
  ratedAxisCount: number;
  totalAxisCount: number;
  breakdown: FitnessBreakdownEntry[];
  vetoed: boolean;
  vetoedBy: {
    axisId: string;
    axisName: string;
    threshold: number; // native-scale
    direction: "below" | "above";
    rawValue: number; // native-scale
  } | null;
  hypotheticalScore: number | null; // score without veto, null when not vetoed
  predictionMeta: PredictionMeta | null; // null for fully-actual results
  redundancyAdjustment: RedundancyAdjustment | null; // null when redundancy disabled or no neighbors
}

// Tournament types

export interface TournamentSettings {
  kFactorThreshold: number; // Default 15. Games with fewer comparisons use K=32, rest use K=16.
  normalizationHalfWidth: number; // Default 400. Reference range is 1500 ± this value.
  provisionalThreshold: number; // Default 6. Games with fewer comparisons show "(provisional)".
}

export type SessionFilterType = "name" | "minFitness" | "maxFitness" | "bggTag" | "staleness";

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
  comparisons: Comparison[]; // Active session only; cleared on completion
}

export interface Comparison {
  id: string;
  gameAId: string;
  gameBId: string;
  winnerId: string;
  sessionId: string;
  createdAt: string;
}

export interface CachedRecentComparison {
  opponentGameId: string;
  won: boolean;
  createdAt: string; // ISO 8601
}

export interface TournamentGameStats {
  eloRating: number; // Default 1500
  comparisonCount: number; // Default 0
  wins: number; // Default 0
  losses: number; // Default 0
  recentComparisons: CachedRecentComparison[]; // Capped at 10, most-recent-first
}

export interface TournamentData {
  settings: TournamentSettings;
  sessions: TournamentSession[];
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
  recentComparisons: RecentComparison[]; // Read from cached TournamentGameStats.recentComparisons, enriched with game names at read time
}

// API response types (shared between daemon, web, and CLI)

export interface GameWithScore {
  game: Game;
  score: FitnessResult | null;
  bggDataStale?: boolean;
  nichePosition?: NichePosition | null;
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
  thumbnailUrl: string | null;
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
  username: string | null;
}

// Profile types (collection-profiling spec)

export interface AxisDistribution {
  axisId: string;
  axisName: string;
  mean: number;
  median: number;
  standardDeviation: number;
  range: { min: number; max: number };
  ratedGameCount: number;
  histogram: number[]; // 10-element array: game counts per rating bucket (1-10)
}

export interface AxisWeightEntry {
  axisId: string;
  axisName: string;
  weight: number;
  percentage: number; // weight / totalWeight * 100
}

export interface AttributeCluster {
  name: string;
  count: number;
  percentage: number; // count / totalGames * 100
}

export interface WeightRangeCluster {
  range: string; // "Light", "Medium-Light", etc.
  min: number;
  max: number;
  count: number;
  percentage: number;
}

export interface UtilityCurveDeclaration {
  axisId: string;
  axisName: string;
  shape: PreferenceShape;
  idealValue: number | null;
  tolerance: ToleranceLevel | null;
  leanDirection: LeanDirection | null;
  vetoThreshold: VetoConfig | null;
  nativeScale: NativeScale;
}

export interface DivergentGame {
  gameId: string;
  gameName: string;
  fitnessScore: number;
  normalizedTournamentScore: number;
  gap: number; // absolute difference
  direction: "tournament-outlier" | "fitness-outlier";
}

export interface ComponentDistances {
  binary: number; // Jaccard distance [0,1]
  continuous: number; // normalized Manhattan [0,1]
  personalAxes: number | null; // normalized Manhattan [0,1], null when no shared axes
  composite: number; // weighted combination [0,1]
}

export type OutlierClassification = "lone-wolf" | "category-orphan" | "high-fitness-outlier";

export interface CollectionOutlier {
  gameId: string;
  gameName: string;
  distances: ComponentDistances;
  classifications: OutlierClassification[];
  fitnessScore: number | null;
}

export interface AxisSuggestion {
  source: "unexpressed-concentration" | "high-variance" | "divergence-repair";
  attribute: string; // mechanic name, category name, or BGG field
  reason: string; // human-readable explanation
  evidence: { gameCount?: number; percentage?: number; variance?: number };
}

// LLM narration types (collection-profiling spec, LLM Narration section)

export interface ProfileNarration {
  summary: string; // 2-4 paragraph overview of collection identity
  surprises: string[]; // Unexpected patterns
  tensions: string[]; // Disagreements between stated and revealed preferences
  blindSpots: string[]; // Absent or underrepresented attribute categories
  curveInsights: string[]; // Utility curve observations
}

export type NarrationCacheState = "fresh" | "stale" | "empty";

export interface CollectionProfile {
  axisDistributions: AxisDistribution[];
  axisWeights: AxisWeightEntry[];
  bggClustering: {
    mechanics: AttributeCluster[];
    categories: AttributeCluster[];
    families: AttributeCluster[];
    subdomains: AttributeCluster[];
    weightRanges: WeightRangeCluster[];
  };
  utilityCurves: UtilityCurveDeclaration[];
  divergence: DivergentGame[] | null; // null when no tournament data
  outliers: CollectionOutlier[];
  suggestions: AxisSuggestion[];
  narration: ProfileNarration | null;
  narrationState: NarrationCacheState;
  gameCount: number;
  ratedGameCount: number;
  computedAt: string; // ISO 8601
}

export interface ProfileData {
  profile: CollectionProfile;
  computedAt: string; // ISO 8601
  narration: ProfileNarration | null;
  narrationComputedAt: string | null; // ISO 8601
}

// Prediction types

export type PredictionConfidence = "actual" | "strong" | "moderate" | "weak" | "insufficient";

export interface ReferenceGame {
  gameId: string;
  gameName: string;
  similarity: number;
}

export interface PredictionMeta {
  readinessStage: 0 | 1 | 2 | 3;
  confidence: PredictionConfidence;
  predictedAxisCount: number;
  actualAxisCount: number;
  referenceGameCount: number;
  coveragePercent: number; // fraction of total axis weight covered by actual or strong-confidence data
}

export interface PredictionReadiness {
  stage: 0 | 1 | 2 | 3;
  ratedGameCount: number;
  nextStageAt: number;
  weakAxes: { axisId: string; axisName: string; ratedCount: number }[];
  suggestedActions: string[];
}

export interface RevealedPreferenceTension {
  predictedFitness: number;
  tournamentClusterAverage: number;
  note: string;
}

export interface PredictionSettings {
  stageThresholds: [number, number, number]; // [stage1, stage2, stage3] defaults [5, 15, 30]
  defaultK: number; // default 5
  minSimilarityThreshold: number; // default 0.2
  tournamentStabilityBoost: number; // default 0.2
}

export interface PredictionUnavailable {
  reason: "stage-0";
  ratedGameCount: number;
  gamesNeeded: number;
}

export interface PredictedGameResponse {
  game: Game;
  score: FitnessResult;
  tension: RevealedPreferenceTension | null;
  predictionUnavailable: PredictionUnavailable | null;
  nicheImpact?: NicheImpact;
  redundancyPreview: RedundancyAdjustment | null;
}

// Niche champion display types (niche-champion-display spec)

export interface NicheNeighbor {
  gameId: string;
  gameName: string;
  fitnessScore: number;
  isPredicted: boolean;
}

export interface NicheEntry {
  /** Attribute type that defines this niche */
  type: "mechanic" | "category" | "family";
  /** Attribute name (e.g., "Deck Building", "Card Game") */
  name: string;
  /** Total games in this niche (excluding vetoed) */
  size: number;
  /** This game's rank within the niche (1 = champion) */
  rank: number;
  /** Whether this game is the niche champion */
  isChampion: boolean;
  /** The niche champion game */
  champion: NicheNeighbor;
  /** Games ranked immediately above (better fitness), up to 2 */
  above: NicheNeighbor[];
  /** Games ranked immediately below (worse fitness), up to 2 */
  below: NicheNeighbor[];
}

export interface NichePosition {
  niches: NicheEntry[];
}

export interface NicheImpactEntry {
  type: "mechanic" | "category" | "family";
  name: string;
  /** Current niche size (before adding this game) */
  currentSize: number;
  /** What rank this game would hold in the niche */
  projectedRank: number;
  /** Current champion of this niche */
  currentChampion: NicheNeighbor | null;
}

export interface NicheImpact {
  /** Niches this game would join if added to the collection */
  wouldJoin: NicheImpactEntry[];
}

export interface NicheTagFilter {
  type: "mechanic" | "category" | "family";
  name: string;
}

export interface NicheSettings {
  ignoredTags: NicheTagFilter[];
}

// Redundancy scoring types (redundancy-scoring spec)

export interface ComponentWeights {
  binary: number;
  continuous: number;
  personalAxes: number;
}

export interface RedundancyNeighbor {
  gameId: string;
  gameName: string;
  similarity: number;
  fitnessScore: number;
  isPredicted: boolean;
}

export interface RedundancyAdjustment {
  penalty: number;
  originalScore: number;
  adjustedScore: number;
  nicheNeighbors: RedundancyNeighbor[];
  nicheRank: number;
  nicheSize: number;
}

export interface RedundancySettings {
  enabled: boolean;
  stage: "annotation" | "integrated";
  similarityThreshold: number;
  maxPenalty: number;
  componentWeights: ComponentWeights;
  minNeighbors: number;
  expectedNeighbors: number;
}

// Wishlist types (wishlist spec)

export interface WishlistBreakdownEntry {
  axisName: string;
  rating: number;
  confidence: PredictionConfidence;
}

export interface WishlistEntry {
  id: string; // UUID
  bggId: number;
  name: string;
  yearPublished: number | null;
  thumbnailUrl: string | null;
  predictedScore: number | null;
  predictionConfidence: PredictionConfidence | null;
  predictedBreakdown: WishlistBreakdownEntry[] | null;
  nicheImpact: NicheImpact | null;
  addedAt: string; // ISO 8601
}

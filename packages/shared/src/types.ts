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

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type InvalidEvidence = { presence: "missing" } | { presence: "present"; value: JsonValue };

export type FieldObservationSource =
  | "manual"
  | "bgg-collection"
  | "bgg-thing"
  | "bgg-suggested-player-poll"
  | "bgg-player-range"
  | "current-fitness"
  | "legacy-unknown";

export interface EvidenceObservation {
  source: FieldObservationSource;
  observedAt: string | null;
}

export type FieldEvidence<Value extends JsonValue> =
  | (EvidenceObservation & { status: "valid"; value: Value })
  | (EvidenceObservation & { status: "missing" })
  | (EvidenceObservation & { status: "invalid"; evidence: InvalidEvidence });

export interface PlayerRangeValue {
  minPlayers: number;
  maxPlayers: number;
}

export interface InvalidPlayerRangeEvidence {
  minPlayers: InvalidEvidence;
  maxPlayers: InvalidEvidence;
}

export type PlayerRangeEvidence =
  | (EvidenceObservation & { status: "valid"; value: PlayerRangeValue })
  | (EvidenceObservation & { status: "missing" })
  | (EvidenceObservation & {
      status: "invalid";
      evidence: InvalidPlayerRangeEvidence;
    });

export type SuggestedPlayerPollState =
  | "absent"
  | "empty"
  | "unusable"
  | "usable"
  | "legacy-unknown";

export type SuggestedPlayerPoll =
  | (EvidenceObservation & {
      status: "valid";
      state: "absent" | "empty" | "legacy-unknown";
      buckets: [];
    })
  | (EvidenceObservation & {
      status: "valid";
      state: "unusable" | "usable";
      buckets: [SuggestedPlayerCount, ...SuggestedPlayerCount[]];
    })
  | (EvidenceObservation & {
      status: "invalid";
      state: "unusable";
      buckets: [];
      evidence: InvalidEvidence;
    });

export interface PersistedAmount {
  hundredths: number;
  source: "manual";
  confirmedAt: string;
}

export type Acquisition =
  | { state: "unknown" }
  | { state: "gift" }
  | { state: "purchase"; amount: PersistedAmount }
  | { state: "invalid"; evidence: InvalidEvidence };

export type EntertainmentBenchmark =
  | { state: "configured"; amount: PersistedAmount }
  | { state: "invalid"; evidence: InvalidEvidence }
  | null;

export type BggResponseFieldState = "absent" | "partial" | "complete";
export type BggSourceRequest = "bgg-search" | "bgg-thing" | "bgg-collection";

export interface BggRequestObservation {
  sourceRequest: BggSourceRequest;
  observedAt: string;
  state: BggResponseFieldState;
  fieldsReturned: string[];
}

export type OwnershipStatus = "owned" | "previously-owned";

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
  bestPlayerCount: number | null;
  fetchedAt: string; // ISO 8601
}

export interface Game {
  id: string; // UUID
  bggId: number | null;
  name: string;
  yearPublished: number | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  bestPlayers: number | null;
  playingTime: number | null; // Minutes
  imageUrl: string | null;
  bggData: BggGameData | null;
  numPlays: number | null;
  acquisition: Acquisition;
  playCountEvidence: FieldEvidence<number>;
  durationEvidence: FieldEvidence<number>;
  playerRangeEvidence: PlayerRangeEvidence;
  suggestedPlayerPoll: SuggestedPlayerPoll;
  bestPlayersInvalidEvidence: InvalidEvidence | null;
  entityMetadata: EntityMetadataByClass;
  latestPlayCountCheck: LatestPlayCountCheck;
  ownership: OwnershipStatus;
  boxDimensions: BoxDimensions | null;
  manualShelfId: string | null;
  ratings: Record<string, number>; // axisId -> rating (1-10)
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export type DerivedFieldId = "communityRating" | "weight" | "playerCountFit" | "playingTime";

export type EmptyDerivedAxisConfiguration = Record<string, never>;

export interface PlayerCountFitConfiguration {
  targetPlayerCount: number;
}

export interface PlayingTimeConfiguration {
  maximumScoringTime: number;
}

export interface DerivedAxisConfigurationByField {
  communityRating: EmptyDerivedAxisConfiguration;
  weight: EmptyDerivedAxisConfiguration;
  playerCountFit: PlayerCountFitConfiguration;
  playingTime: PlayingTimeConfiguration;
}

export interface AxisBase {
  id: string;
  name: string;
  description: string | null;
  weight: number;
  enabled: true;
  preferenceShape?: PreferenceShape;
  idealValue?: number | null;
  tolerance?: ToleranceLevel;
  toleranceWidth?: number | null;
  leanDirection?: LeanDirection | null;
  veto?: VetoConfig | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalAxis extends AxisBase {
  source: "personal";
}

export interface TournamentAxis extends AxisBase {
  source: "tournament";
}

export type DerivedAxisByField = {
  [Field in DerivedFieldId]: AxisBase & {
    source: "derived";
    derivedField: Field;
    configuration: DerivedAxisConfigurationByField[Field];
  };
};

export type DerivedAxis<Field extends DerivedFieldId = DerivedFieldId> = DerivedAxisByField[Field];

export interface DisabledLegacyAxis extends Omit<AxisBase, "enabled"> {
  source: "legacy";
  enabled: false;
  reason: string;
  legacyField: string | null;
  legacyPayload: unknown;
}

export type Axis = PersonalAxis | TournamentAxis | DerivedAxis | DisabledLegacyAxis;
export type AxisSource = Axis["source"];
export type EnabledAxis = PersonalAxis | TournamentAxis | DerivedAxis;
export interface Collection {
  schemaVersion: 4;
  revision: number;
  id: string;
  name: string;
  axes: Axis[];
  games: Game[];
  intentions: PlayIntention[];
  commandReceipts: IntentionCommandReceipt[];
  entertainmentBenchmark: EntertainmentBenchmark;
  createdAt: string;
  updatedAt: string;
}

// Fitness score types from .lore/designs/mvp-fitness-model.md

export type FitnessBreakdownSource =
  | "personal"
  | "tournament"
  | "derived"
  | "override"
  | "predicted";

export interface FitnessBreakdownEntry {
  axisId: string;
  axisName: string;
  weight: number;
  contribution: number | null;
  source: FitnessBreakdownSource;
  derivedField: DerivedFieldId | null;
  sourceValue: number | null;
  scoringRawValue: number | null;
  effectiveRating: number | null;
  preferenceShape: PreferenceShape;
  curveAffected: boolean;
  unit: string | null;
  provenance: string | null;
  configurationSummary: string | null;
  overridden: boolean;
  overrideValue: number | null;
  predictionConfidence: PredictionConfidence | null;
  referenceGames: ReferenceGame[] | null;
}

export interface DerivedValueResolution {
  sourceValue: number;
  scoringRawValue: number;
}

export interface DerivedConfigurationPropertyDiscovery {
  name: string;
  type: "integer";
  required: boolean;
  minimum: number;
  maximum: number;
  default?: number;
}

export interface FixedNativeScaleDiscovery {
  type: "fixed";
  min: number;
  max: number;
}

export interface ConfigurationBoundNativeScaleDiscovery<
  ConfigurationProperty extends string = string,
> {
  type: "configuration-bound";
  min: number;
  maxConfigurationProperty: ConfigurationProperty;
}

export type NativeScaleDiscovery<ConfigurationProperty extends string = string> =
  | FixedNativeScaleDiscovery
  | ConfigurationBoundNativeScaleDiscovery<ConfigurationProperty>;

export interface DerivedAxisTemplateDiscovery {
  name: string;
  description: string;
  weight: number;
  preferenceShape: PreferenceShape;
  idealValue?: number;
  toleranceWidth?: number;
  configuration: {
    targetPlayerCount?: number;
    maximumScoringTime?: number;
  };
}

export interface DerivedFieldDiscovery {
  id: DerivedFieldId;
  label: string;
  description: string;
  provenance: string;
  unit: string;
  missingValuePolicy: string;
  nativeScaleDiscovery: NativeScaleDiscovery;
  nativeScale: NativeScale;
  configuration: DerivedConfigurationPropertyDiscovery[];
  template: DerivedAxisTemplateDiscovery;
}

export interface DerivedFieldDiscoveryResponse {
  version: 1;
  fields: DerivedFieldDiscovery[];
}

export interface FitnessResult {
  score: number;
  ratedAxisCount: number;
  totalAxisCount: number;
  breakdown: FitnessBreakdownEntry[];
  vetoed: boolean;
  vetoedBy: {
    axisId: string;
    axisName: string;
    threshold: number;
    direction: "below" | "above";
    rawValue: number;
  } | null;
  hypotheticalScore: number | null;
  predictionMeta: PredictionMeta | null;
  redundancyAdjustment: RedundancyAdjustment | null;
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

export interface GameWithPurchaseUtilization extends GameWithScore {
  displayScore: string | null;
  purchaseUtilization: PurchaseUtilizationResult;
}

export type PurchaseUtilizationReason =
  | "missing-acquisition"
  | "invalid-acquisition"
  | "no-owner-cost"
  | "missing-benchmark"
  | "invalid-benchmark"
  | "missing-play-count"
  | "invalid-play-count"
  | "missing-modeled-duration"
  | "invalid-modeled-duration"
  | "missing-modeled-player-count"
  | "invalid-modeled-player-count"
  | "missing-fitness"
  | "invalid-fitness"
  | "unreachable-at-current-fitness";

export type UtilizationOutcome = "calculated" | "unavailable" | "not-applicable" | "unreachable";

export interface UtilizationComponentBase {
  label: string;
  outcome: UtilizationOutcome;
  reasons: PurchaseUtilizationReason[];
}

export interface CalculatedUtilizationComponent<Value> extends UtilizationComponentBase {
  outcome: "calculated";
  value: Value;
  display: string;
  reasons: [];
}

export interface UnavailableUtilizationComponent extends UtilizationComponentBase {
  outcome: "unavailable";
  display: "Unavailable";
}

export interface NotApplicableUtilizationComponent extends UtilizationComponentBase {
  outcome: "not-applicable";
  display: string;
}

export interface UnreachableUtilizationComponent extends UtilizationComponentBase {
  outcome: "unreachable";
  display: "Unreachable at current fitness";
  reasons: ["unreachable-at-current-fitness"];
}

export type UtilizationComponent<Value> =
  | CalculatedUtilizationComponent<Value>
  | UnavailableUtilizationComponent
  | NotApplicableUtilizationComponent
  | UnreachableUtilizationComponent;

export interface ExactUtilizationValue {
  exact: { numerator: string; denominator: string };
}

export interface MultiplierUtilizationValue extends ExactUtilizationValue {
  status: "met" | "not-met";
}

export interface ModeledPlayerCountValue extends ExactUtilizationValue {
  source: FieldObservationSource;
  observedAt: string | null;
  resolution: "poll-winner" | "poll-tie-average" | "player-range-midpoint";
  winningBestVotes: number | null;
  winningPlayerCounts: string[];
}

export type PurchaseUtilizationFitnessInput =
  | (EvidenceObservation & { status: "valid"; value: string })
  | (EvidenceObservation & { status: "missing" })
  | (EvidenceObservation & { status: "invalid"; value: string });

export interface PurchaseUtilizationInput {
  acquisition: Acquisition;
  entertainmentBenchmark: EntertainmentBenchmark;
  playCount: FieldEvidence<number>;
  duration: FieldEvidence<number>;
  playerRange: PlayerRangeEvidence;
  suggestedPlayerPoll: SuggestedPlayerPoll;
  fitness: string | null;
}

export interface PurchaseUtilizationEvidence {
  acquisition: Acquisition;
  entertainmentBenchmark: EntertainmentBenchmark;
  playCount: FieldEvidence<number>;
  duration: FieldEvidence<number>;
  playerRange: PlayerRangeEvidence;
  suggestedPlayerPoll: SuggestedPlayerPoll;
  fitness: PurchaseUtilizationFitnessInput;
}

export interface PurchaseUtilizationSortProjection {
  valueRemainingHundredths: string | null;
  estimatedAdditionalPlays:
    | { category: "finite"; wholePlays: string }
    | { category: "unreachable"; wholePlays: null }
    | { category: "unavailable" | "not-applicable"; wholePlays: null };
}

export interface PurchaseUtilizationResult {
  outcome: "met" | "not-met" | "unavailable" | "not-applicable";
  outcomeLabel:
    | "Value threshold met"
    | "Value threshold not yet met"
    | "Purchase value unavailable"
    | "Purchase value not applicable";
  reasons: PurchaseUtilizationReason[];
  components: {
    costPerRecordedPlay: UtilizationComponent<ExactUtilizationValue>;
    modeledPlayerCount: UtilizationComponent<ModeledPlayerCountValue>;
    modeledPlayerHours: UtilizationComponent<ExactUtilizationValue>;
    costPerModeledPlayerHour: UtilizationComponent<ExactUtilizationValue>;
    fitnessAdjustedHourlyBenchmark: UtilizationComponent<ExactUtilizationValue>;
    valueMultiplier: UtilizationComponent<MultiplierUtilizationValue>;
    valueRemaining: UtilizationComponent<ExactUtilizationValue>;
    estimatedAdditionalPlays: UtilizationComponent<{ wholePlays: string }>;
  };
  evidence: PurchaseUtilizationEvidence;
  assumptions: {
    modeledSessions: "Models each recorded play at the shown duration and player count; actual sessions may differ.";
    futurePlays: "Estimated additional plays assumes future plays use the shown duration, player count, fitness, and entertainment benchmark.";
    fitnessAdjustment: "The fitness-adjusted hourly benchmark changes in direct proportion to current fitness; fitness 6 uses the collection benchmark.";
  };
  sort: PurchaseUtilizationSortProjection;
}

export type AcquisitionMutationRequest =
  | { state: "unknown" }
  | { state: "gift" }
  | { state: "purchase"; amount: string };

export interface EntertainmentBenchmarkMutationRequest {
  amount: string;
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
  searchObservation?: BggRequestObservation;
  thingObservation?: BggRequestObservation;
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
  derivedField: DerivedFieldId | null;
  shape: PreferenceShape;
  idealValue: number | null;
  tolerance: ToleranceLevel | null;
  toleranceWidth: number | null;
  leanDirection: LeanDirection | null;
  vetoThreshold: VetoConfig | null;
  nativeScale: NativeScale;
  unit: string | null;
  provenance: string | null;
  configurationSummary: string | null;
}

export type InsightStatus = "reported" | "insufficient" | "suppressed" | "retired";

export interface InsightMethod {
  id: string;
  version: number;
  description: string;
}

export interface InsightEvidenceMeasurement {
  key: string;
  label: string;
  value: string | number | boolean | null;
  unit: string | null;
  source: string;
}

export interface InsightEvidenceGame {
  gameId: string;
  gameName: string;
  role: "subject" | "supporting" | "comparator";
  measurements: InsightEvidenceMeasurement[];
}

export interface InsightCohort {
  description: string;
  eligibleGameCount: number;
  includedGameCount: number;
  excludedGameCount: number;
  coveragePercent: number; // percentage in [0,100]
}

export interface InsightSufficiencyRequirement {
  criterion: string;
  observed: number;
  required: number;
  met: boolean;
}

export interface InsightComparator {
  description: string;
  gameIds: string[];
}

export interface InsightNotability {
  metric: string;
  value: number;
  threshold: number | null;
  direction: "above" | "below" | "two-sided";
  explanation: string;
}

export interface InsightConfidence {
  level: "low" | "moderate" | "high";
  basis: string;
}

interface TrustedInsightBase {
  contractVersion: 1;
  id: string;
  method: InsightMethod;
  cohort: InsightCohort;
  sufficiency: InsightSufficiencyRequirement[];
  evidence: InsightEvidenceGame[];
  comparator: InsightComparator | null;
  limitations: string[];
}

type NonEmptyArray<T> = [T, ...T[]];

export interface ReportedInsightEvidenceGame extends Omit<InsightEvidenceGame, "measurements"> {
  measurements: NonEmptyArray<InsightEvidenceMeasurement>;
}

export interface SatisfiedInsightRequirement extends InsightSufficiencyRequirement {
  met: true;
}

export interface UnmetInsightRequirement extends InsightSufficiencyRequirement {
  met: false;
}

export interface ReportedInsight<TDetails> extends TrustedInsightBase {
  status: "reported";
  sufficiency: NonEmptyArray<SatisfiedInsightRequirement>;
  evidence: NonEmptyArray<ReportedInsightEvidenceGame>;
  observation: string;
  interpretation: string | null;
  details: TDetails;
  notability: InsightNotability;
  confidence: InsightConfidence | null;
}

export type InsightAbstentionReason =
  | "insufficient-sample"
  | "insufficient-coverage"
  | "missing-comparator"
  | "unsupported-method"
  | "superseded";

interface AbstainedInsightBase extends TrustedInsightBase {
  explanation: string;
}

export interface InsufficientSampleInsight extends AbstainedInsightBase {
  status: "insufficient";
  reason: "insufficient-sample";
  sufficiency: [UnmetInsightRequirement, ...InsightSufficiencyRequirement[]];
}

export interface InsufficientCoverageInsight extends AbstainedInsightBase {
  status: "insufficient";
  reason: "insufficient-coverage";
  sufficiency: [UnmetInsightRequirement, ...InsightSufficiencyRequirement[]];
}

export interface MissingComparatorInsight extends AbstainedInsightBase {
  status: "insufficient";
  reason: "missing-comparator";
  comparator: null;
}

export interface SuppressedInsight extends AbstainedInsightBase {
  status: "suppressed";
  reason: "unsupported-method";
}

export interface RetiredInsight extends AbstainedInsightBase {
  status: "retired";
  reason: "superseded";
}

export type InsufficientInsight =
  | InsufficientSampleInsight
  | InsufficientCoverageInsight
  | MissingComparatorInsight;

export type AbstainedInsight = InsufficientInsight | SuppressedInsight | RetiredInsight;

export type TrustedInsight<TDetails> = ReportedInsight<TDetails> | AbstainedInsight;

type AboveThresholdInsightNotability = Omit<InsightNotability, "threshold" | "direction"> & {
  threshold: number;
  direction: "above";
};

export interface TournamentDivergenceDetails {
  gameId: string;
  gameName: string;
  independentFitnessScore: number;
  normalizedTournamentScore: number;
  gap: number; // absolute difference
  direction: "tournament-outlier" | "fitness-outlier";
  comparisonCount: number;
  provisional: boolean;
}

export interface ReportedTournamentDivergence extends Omit<
  ReportedInsight<TournamentDivergenceDetails>,
  "confidence" | "notability"
> {
  confidence: null;
  notability: AboveThresholdInsightNotability;
}

export type TournamentDivergenceInsight = ReportedTournamentDivergence | InsufficientInsight;

export interface ComponentDistances {
  binary: number;
  continuous: number;
  personalAxes: number | null;
  composite: number;
}

export type CollectionOutlierDimension =
  | "mechanics"
  | "categories"
  | "complexity"
  | "player-count"
  | "playing-time";

export interface CollectionOutlierComparison {
  gameId: string;
  gameName: string;
  distance: number; // factual compositional distance [0,1]
}

export interface CollectionOutlierDriver {
  dimension: CollectionOutlierDimension;
  label: string;
  distance: number; // contribution distance [0,1]
  subjectValue: string | number;
  comparatorValues: { gameId: string; value: string | number }[];
  explanation: string;
}

export interface CollectionOutlierDetails {
  gameId: string;
  gameName: string;
  neighborhoodDistance: number;
  nearestComparisons: [CollectionOutlierComparison, CollectionOutlierComparison];
  drivers: [CollectionOutlierDriver, CollectionOutlierDriver, ...CollectionOutlierDriver[]];
  fitnessScore: number | null;
}

export interface ReportedCollectionOutlier extends Omit<
  ReportedInsight<CollectionOutlierDetails>,
  "confidence" | "notability"
> {
  confidence: null;
  notability: AboveThresholdInsightNotability;
}

export type CollectionOutlier = ReportedCollectionOutlier | InsufficientInsight;

export interface AxisSuggestionDetails {
  source: "divergence-repair";
  attribute: string;
  attributeType: "mechanic" | "category";
  direction: "tournament-outlier" | "fitness-outlier";
  supportingGameCount: number;
  comparatorGameCount: number;
  supportingMeanGap: number;
  comparatorMeanGap: number;
  effect: number;
}

export interface CurrentAxisSuggestionMethod extends InsightMethod {
  id: "directional-divergence-attribute-effect";
  version: 1;
}

export type RetiredAxisSuggestionMethod =
  | (InsightMethod & { id: "unexpressed-concentration"; version: 1 })
  | (InsightMethod & { id: "high-variance"; version: 1 });

type WithAxisSuggestionMethod<TInsight, TMethod extends InsightMethod> = TInsight extends {
  method: InsightMethod;
}
  ? Omit<TInsight, "method"> & { method: TMethod }
  : never;

export type ReportedAxisSuggestion = Omit<
  ReportedInsight<AxisSuggestionDetails>,
  "comparator" | "confidence" | "interpretation" | "method" | "notability"
> & {
  method: CurrentAxisSuggestionMethod;
  comparator: InsightComparator;
  confidence: null;
  interpretation: string;
  notability: AboveThresholdInsightNotability;
};

export type CurrentAxisSuggestionAbstention = WithAxisSuggestionMethod<
  InsufficientInsight | SuppressedInsight,
  CurrentAxisSuggestionMethod
>;

export type RetiredAxisSuggestion = WithAxisSuggestionMethod<
  RetiredInsight,
  RetiredAxisSuggestionMethod
>;

export type AxisSuggestion =
  | ReportedAxisSuggestion
  | CurrentAxisSuggestionAbstention
  | RetiredAxisSuggestion;

// LLM narration types (collection-profiling spec, LLM Narration section)

export interface NarrationEvidenceReference {
  insightId: string;
  gameIds: string[];
}

export interface NarratedClaim {
  observation: string;
  interpretation: string | null;
  evidenceReferences: [NarrationEvidenceReference, ...NarrationEvidenceReference[]];
}

export interface ProfileNarration {
  summary: NarratedClaim[];
  surprises: NarratedClaim[];
  tensions: NarratedClaim[];
  abstention: string | null;
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
  divergence: TournamentDivergenceInsight[] | null; // null when no tournament data
  outliers: CollectionOutlier[];
  suggestions: AxisSuggestion[];
  narration: ProfileNarration | null;
  narrationState: NarrationCacheState;
  gameCount: number;
  ratedGameCount: number;
  computedAt: string; // ISO 8601
}

// Useful-profile contracts are authoritative in the daemon. CollectionProfile
// remains the temporary consumer alias until the Step 9/10 CLI and web cutovers.

export type ProfileEntityClass = "mechanic" | "designer" | "artist";

export interface BggEntityLink {
  id: number;
  name: string;
}

export interface EntityMetadataRefreshFailure {
  attemptedAt: string;
  message: string;
}

export type EntityClassMetadata =
  | {
      state: "complete";
      entities: BggEntityLink[];
      observedAt: string;
      refreshFailure: EntityMetadataRefreshFailure | null;
      correctionDestination: null;
    }
  | {
      state: "refresh-needed";
      entities: [];
      observedAt: null;
      refreshFailure: EntityMetadataRefreshFailure | null;
      correctionDestination: { operationId: "shelf.game.bgg.refresh" };
    }
  | {
      state: "unrefreshable";
      entities: [];
      observedAt: null;
      refreshFailure: null;
      correctionDestination: null;
      explanation: "This game has no BGG ID, so Shelf Judge cannot refresh entity metadata.";
    };

export type EntityMetadataByClass = Record<ProfileEntityClass, EntityClassMetadata>;

export type LatestPlayCountCheck =
  | { status: "valid"; value: number; observedAt: string }
  | { status: "missing"; observedAt: string }
  | { status: "invalid"; observedAt: string; evidence: InvalidEvidence }
  | null;

export type PlayIntentionKind = "first-play" | "replay";
export type PlayIntentionResolutionSource =
  | "observed-play-increase"
  | "owner-confirmed"
  | "owner-retired";

export interface PlayIntentionBaseline {
  playCount: number;
  evidenceSource: FieldObservationSource;
  observedAt: string;
}

export type PlayIntentionResolution =
  | {
      outcome: "completed";
      source: "observed-play-increase" | "owner-confirmed";
      resolvedAt: string;
    }
  | { outcome: "retired"; source: "owner-retired"; resolvedAt: string };

export interface PlayIntention {
  intentionId: string;
  gameId: string;
  kind: PlayIntentionKind;
  baseline: PlayIntentionBaseline;
  createdAt: string;
  version: number;
  resolution: PlayIntentionResolution | null;
}

export interface PlayEvidenceMutationResult {
  game: Game;
  linkedIntentionTransition: PlayIntention | null;
}

export type ManualPlayCorrectionResult =
  | {
      ok: true;
      game: Game;
      linkedIntentionTransition: PlayIntention | null;
    }
  | {
      ok: false;
      error: {
        code: "non-monotonic-observation";
        gameId: string;
        attemptedObservedAt: string;
        latestAcceptedAt: string;
      };
    };

export type ManualPlayCorrectionResponse =
  | ManualPlayCorrectionResult
  | Extract<IntentionMutationError, { code: "validation" | "persistence-failure" }>
  | { code: "game_not_found"; error: string };

export interface OwnershipMutationResult {
  game: Game;
  linkedIntentionTransition: PlayIntention | null;
}

export type FutureUsefulProfileGameSource = Game;

export type FutureUsefulProfileCollectionSource = Collection;

export type CreateIntentionCommand = {
  type: "create";
  commandId: string;
  gameId: string;
  kind: PlayIntentionKind;
  expectedActiveIntention: "absent";
};

export type ResolveIntentionCommand = {
  type: "complete" | "retire";
  commandId: string;
  gameId: string;
  intentionId: string;
  expectedVersion: number;
};

export type IntentionCommand = CreateIntentionCommand | ResolveIntentionCommand;

export interface LinkedOwnershipTransition {
  gameId: string;
  from: "owned";
  to: "previously-owned";
}

export interface AcceptedIntentionMutation {
  ok: true;
  commandId: string;
  intention: PlayIntention;
  linkedOwnershipTransition: LinkedOwnershipTransition | null;
}

export type IntentionMutationError =
  | { code: "validation"; issues: { field: string; message: string }[] }
  | { code: "game-not-found"; gameId: string }
  | { code: "intention-not-found"; gameId: string; intentionId: string }
  | {
      code: "ineligible-game";
      gameId: string;
      reason:
        | "not-owned"
        | "missing-play-evidence"
        | "invalid-play-evidence"
        | "missing-observation-time"
        | "stale-play-evidence"
        | "kind-mismatch";
    }
  | { code: "active-intention-conflict"; gameId: string; current: PlayIntention }
  | {
      code: "stale-version";
      gameId: string;
      intentionId: string;
      expectedVersion: number;
      current: PlayIntention;
    }
  | { code: "command-reuse"; commandId: string }
  | { code: "history-conflict"; gameId: string; intentionIds: string[] }
  | { code: "persistence-failure"; operation: string; message: string };

export type IntentionMutationResult =
  | AcceptedIntentionMutation
  | { ok: false; commandId: string; error: IntentionMutationError };

export interface IntentionCommandReceipt {
  commandId: string;
  request: IntentionCommand;
  result: AcceptedIntentionMutation;
}

export type CollectionMutationResult<Value> =
  | { outcome: "accepted"; changed: true; value: Value }
  | { outcome: "no-op"; changed: false; value: Value }
  | { outcome: "rejected"; changed: false; error: IntentionMutationError };

export interface ProfileGameFitnessEvidence {
  gameId: string;
  gameName: string;
  currentFitness: number;
  vetoed: boolean;
}

export type ProfileClassExclusionReason =
  | "predicted-fitness"
  | "missing-or-invalid-fitness"
  | "refresh-needed-metadata"
  | "unrefreshable-metadata";

export interface ProfileClassExclusion {
  gameId: string;
  gameName: string;
  reason: ProfileClassExclusionReason;
  hasEntityAssociation: boolean;
  correctionDestination: { operationId: "shelf.game.bgg.refresh" | "shelf.game.rating.set" } | null;
}

export interface ProfileMetadataReadiness {
  state: "complete" | "partial" | "refresh-needed";
  ownedGameCount: number;
  completeGameCount: number;
  refreshNeededGameCount: number;
  unrefreshableGameCount: number;
}

export interface ProfileEntityEvidence {
  entityId: number;
  name: string;
  support: "limited" | "supported";
  associatedGameCount: number;
  meanCurrentFitness: number;
  populationStandardDeviation: number;
  range: { min: number; max: number };
  comparatorMeanCurrentFitness: number;
  differenceFromComparator: number;
  games: ProfileGameFitnessEvidence[];
}

export interface ProfileEntityOrderings {
  rating: number[];
  support: number[];
  name: number[];
}

export interface ProfileEntityClassResult {
  entityClass: ProfileEntityClass;
  result: "supported" | "limited" | "no-eligible-ratings" | "evaluated-empty" | "not-evaluated";
  metadataReadiness: ProfileMetadataReadiness;
  associatedGameCount: number;
  comparator: {
    gameCount: number;
    meanCurrentFitness: number | null;
    games: ProfileGameFitnessEvidence[];
  };
  exclusions: ProfileClassExclusion[];
  refreshWarnings: { gameId: string; gameName: string; attemptedAt: string; message: string }[];
  entities: ProfileEntityEvidence[];
  overviewEntityIds: number[];
  orderings: ProfileEntityOrderings;
}

export type AttentionPlayEvidence =
  | {
      status: "valid";
      playCount: number;
      source: FieldObservationSource;
      observedAt: string;
      stale: false;
    }
  | {
      status: "missing" | "invalid" | "stale";
      playCount: number | null;
      source: FieldObservationSource | null;
      observedAt: string | null;
      warning:
        | "Current play evidence is missing."
        | "Current play evidence is invalid."
        | "A newer BGG check did not provide a valid play count.";
    };

export interface PlayIntentionAttentionItem {
  id: string;
  decisionFamily: "play-intention";
  intention: PlayIntention;
  gameName: string;
  question: string;
  whyNow: "You asked Shelf Judge to keep this intention visible.";
  currentPlayEvidence: AttentionPlayEvidence;
  responses: ["leave-visible", "complete", "retire", "correct-or-refresh-evidence"];
  abstentionBasis: "Only an explicit active intention qualifies.";
  resolution: null;
  reopenCondition: "Create a new explicit intention after resolution.";
  destination: { gameId: string; operationId: "shelf.game.intention.manage" };
  evidenceDestination: {
    gameId: string;
    operationId: "shelf.game.plays.set" | "shelf.game.bgg.refresh";
  };
}

export interface ResolvedPlayIntentionHistoryItem {
  intentionId: string;
  gameId: string;
  gameName: string;
  kind: PlayIntentionKind;
  baseline: PlayIntentionBaseline;
  createdAt: string;
  version: number;
  resolution: PlayIntentionResolution;
}

export type ResolvedPlayIntentionHistory = ResolvedPlayIntentionHistoryItem[];

export interface FutureUsefulCollectionProfile {
  status: "available";
  identity: {
    collectionState: "populated" | "empty";
    classes: Record<ProfileEntityClass, ProfileEntityClassResult>;
    axisDistributions: AxisDistribution[];
  };
  attention: {
    state: "active" | "nothing-to-decide" | "empty-collection";
    items: PlayIntentionAttentionItem[];
  };
  computedAt: string;
}

export interface FutureUsefulCollectionProfileUnavailable {
  status: "unavailable";
  error: { kind: "transport" | "validation" | "recomputation"; message: string };
  retryDestination: { operationId: "shelf.profile.get" };
}

export type FutureUsefulProfileResult =
  | FutureUsefulCollectionProfile
  | FutureUsefulCollectionProfileUnavailable;

export interface ProfileSourceIdentity {
  collectionId: string;
  collectionSchemaVersion: 4;
  collectionRevision: number;
  tournamentHash: string;
  predictionSettingsHash: string;
  redundancySettingsHash: string;
}

export interface ProfileData {
  contractVersion: 7;
  algorithmVersion: 9;
  sourceIdentity: ProfileSourceIdentity;
  profile: FutureUsefulCollectionProfile;
  computedAt: string;
}

export interface FutureUsefulProfileSnapshot {
  source: FutureUsefulProfileCollectionSource;
  profile: FutureUsefulProfileResult;
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

// Shelf capacity types (shelf-capacity spec)

export interface BoxDimensions {
  width: number; // in
  height: number; // in
  depth: number; // in
}

export interface Shelf {
  id: string;
  name: string;
  dimensionless: boolean; // true = assignment-only bucket, skipped by capacity/packing
  width: number | null; // interior in, null when dimensionless
  height: number | null; // interior in, null = unconstrained or dimensionless
  depth: number | null; // interior in, null when dimensionless
}

export interface ShelfUnit {
  id: string;
  name: string;
  shelves: Shelf[]; // ordered top-to-bottom
}

export interface ShelfConfiguration {
  units: ShelfUnit[];
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface ShelfConfigMutationResult {
  config: ShelfConfiguration;
  clearedAssignmentCount: number;
}

export interface ShelfUnitMutationResult {
  unit: ShelfUnit;
  clearedAssignmentCount: number;
}

export interface ShelfUnitRemovalResult {
  removed: true;
  clearedAssignmentCount: number;
}

export interface AssignedGame {
  gameId: string;
  gameName: string;
  fitnessScore: number;
  volumeIn3: number;
  assignmentSource: "manual" | "automatic";
}

export interface ShelfAssignment {
  shelfId: string;
  shelfName: string;
  unitId: string;
  unitName: string;
  dimensionless: boolean; // true = assignment-only bucket, not part of capacity/packing
  capacityIn3: number | null; // null for unconstrained-height or dimensionless shelves
  usedIn3: number;
  utilization: number | null; // usedIn3 / capacityIn3, null if unconstrained or dimensionless
  games: AssignedGame[];
  grade: string; // S, A, B, C, D, F
}

export interface UnfittableEntry {
  gameId: string;
  gameName: string;
  fitnessScore: number;
  boxDimensions: BoxDimensions;
  reason: string;
}

export interface OverflowEntry {
  gameId: string;
  gameName: string;
  fitnessScore: number;
  volumeIn3: number;
}

export interface AssignmentConflict {
  gameId: string;
  gameName: string;
  shelfId: string;
  shelfName: string;
  unitId: string;
  unitName: string;
  boxDimensions: BoxDimensions;
  reason: string;
}

export interface ShelfCapacityResult {
  configured: boolean;
  totalShelfCount: number;
  gamesWithDimensions: number;
  gamesWithoutDimensions: number;
  overflowing: boolean;
  hasPlacementProblems: boolean;
  assignments: ShelfAssignment[];
  assignmentConflicts: AssignmentConflict[];
  unfittableGames: UnfittableEntry[];
  overflowGames: OverflowEntry[];
}

import {
  AttentionCandidateEvaluationSchema,
  ExactRational,
  type AttentionCandidateEvaluation,
  type Collection,
  type GameWithScore,
} from "@shelf-judge/shared";
import type { PurchaseUtilizationProjection } from "./purchase-utilization-projection.js";
import {
  ATTENTION_RULE_CATALOG_VERSION,
  ATTENTION_RULE_DEPENDENCY_VERSION,
  attentionRuleCatalog,
  isActiveAttentionDisposition,
  ruleFingerprint,
  validateAttentionRuleCatalog,
  type AttentionRuleDefinition,
} from "./attention-rule-catalog.js";
import { compareNormalizedCodePoints } from "./collection-profile-engine.js";

export const ATTENTION_CANDIDATE_CALCULATION_VERSION = 1;

export interface AttentionCandidateEngineInput {
  readonly collection: Collection;
  readonly evaluatedAt: string;
  readonly displayedFitness: readonly GameWithScore[];
  readonly purchaseUtilizationProjectionByGameId: ReadonlyMap<
    string,
    PurchaseUtilizationProjection
  >;
  readonly displayedFitnessSourceIdentity: {
    readonly tournamentHash: string;
    readonly predictionSettingsHash: string;
    readonly redundancySettingsHash: string;
  };
  readonly catalog?: readonly AttentionRuleDefinition[];
  /** Incremental maintenance may request exact IDs; omitted remains the complete oracle. */
  readonly targetGameIds?: readonly string[];
}

export interface AttentionCandidateMatch {
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly signalStrength: { readonly numerator: string; readonly denominator: string };
  readonly categoryWeight: { readonly numerator: string; readonly denominator: string };
  readonly attentionScore: { readonly numerator: string; readonly denominator: string };
  readonly fingerprint: string;
  readonly reason: string;
  readonly question: string;
  readonly actions: readonly string[];
  readonly correctionDestination: string | null;
}

export interface AttentionCandidateResult {
  readonly evaluations: readonly AttentionCandidateEvaluation[];
  readonly winners: readonly (AttentionCandidateEvaluation & {
    readonly winner: NonNullable<AttentionCandidateEvaluation["winner"]>;
    readonly presentation: AttentionCandidateMatch;
  })[];
  readonly calculationVersion: number;
}

export interface AttentionStoredRuleMatch {
  readonly gameId: string;
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly fingerprint: string;
}

function earliestBoundary(boundaries: readonly string[]): string | null {
  return (
    boundaries
      .map((boundary) => {
        const instant = Date.parse(boundary);
        if (Number.isNaN(instant))
          throw new Error(`Invalid attention evaluation boundary: ${boundary}`);
        return { boundary, instant };
      })
      .sort(
        (left, right) =>
          left.instant - right.instant ||
          compareNormalizedCodePoints(left.boundary, right.boundary),
      )[0]?.boundary ?? null
  );
}

const zero = new ExactRational(0n);
const one = new ExactRational(1n);

function ruleContext(
  input: AttentionCandidateEngineInput,
  game: Collection["games"][number],
  fitness: ReadonlyMap<string, GameWithScore>,
) {
  return {
    game,
    intentions: input.collection.intentions,
    bggPlaySessions: input.collection.bggPlaySessions ?? [],
    evaluatedAt: input.evaluatedAt,
    purchaseProjection: input.purchaseUtilizationProjectionByGameId.get(game.id) ?? null,
    displayedFitness: fitness.get(game.id),
    displayedFitnessSourceIdentity: input.displayedFitnessSourceIdentity,
  };
}

/**
 * Re-evaluates one stored rule without selecting a current winner. Durable
 * intentional state is compatible with a still-matching stored rule even when
 * another rule now ranks above it.
 */
export function evaluateAttentionStoredRule(
  input: AttentionCandidateEngineInput,
  gameId: string,
  ruleId: string,
): AttentionStoredRuleMatch | null {
  const catalog = input.catalog ?? attentionRuleCatalog;
  validateAttentionRuleCatalog(catalog, input.displayedFitnessSourceIdentity);
  const game = input.collection.games.find((candidate) => candidate.id === gameId);
  const rule = catalog.find((candidate) => candidate.id === ruleId);
  if (game === undefined || game.ownership !== "owned" || rule === undefined) return null;
  const fitness = new Map(input.displayedFitness.map((entry) => [entry.game.id, entry]));
  const context = ruleContext(input, game, fitness);
  const match = rule.evaluate(context);
  if (match === null) return null;
  return {
    gameId,
    ruleId: rule.id,
    ruleVersion: rule.version,
    fingerprint: ruleFingerprint(rule, context, match.fingerprint),
  };
}

function assertUnit(value: ExactRational, label: string): void {
  if (value.compare(zero) < 0 || value.compare(one) > 0) {
    throw new Error(`${label} must be within [0, 1]`);
  }
}

export function computeAttentionCandidates(
  input: AttentionCandidateEngineInput,
): AttentionCandidateResult {
  const catalog = input.catalog ?? attentionRuleCatalog;
  validateAttentionRuleCatalog(catalog, input.displayedFitnessSourceIdentity);
  const fitness = new Map(input.displayedFitness.map((entry) => [entry.game.id, entry]));
  const evaluations: AttentionCandidateEvaluation[] = [];
  const presentation = new Map<string, AttentionCandidateMatch>();
  const targetGameIds = input.targetGameIds === undefined ? null : new Set(input.targetGameIds);
  for (const game of input.collection.games) {
    if (game.ownership !== "owned") continue;
    if (targetGameIds !== null && !targetGameIds.has(game.id)) continue;
    const context = ruleContext(input, game, fitness);
    const disposition =
      input.collection.attentionDispositions.find((candidate) => candidate.gameId === game.id) ??
      null;
    const activeDisposition =
      disposition !== null && isActiveAttentionDisposition(disposition, context, catalog);
    const matches = catalog.flatMap((rule) => {
      const match = rule.evaluate(context);
      if (!match) return [];
      assertUnit(match.signalStrength, `${rule.id} signal strength`);
      assertUnit(rule.categoryWeight, `${rule.id} category weight`);
      const score = match.signalStrength.multiply(rule.categoryWeight);
      assertUnit(score, `${rule.id} attention score`);
      return [
        {
          rule,
          match: { ...match, fingerprint: ruleFingerprint(rule, context, match.fingerprint) },
          score,
        },
      ];
    });
    const superseded = new Set(matches.flatMap(({ rule }) => rule.supersedes));
    const remaining = matches.filter(({ rule }) => !superseded.has(rule.id));
    remaining.sort(
      (left, right) =>
        right.score.compare(left.score) || compareNormalizedCodePoints(left.rule.id, right.rule.id),
    );
    const selected = activeDisposition ? null : (remaining[0] ?? null);
    const evaluation: AttentionCandidateEvaluation = {
      gameId: game.id,
      winner:
        selected === null
          ? null
          : {
              ruleId: selected.rule.id,
              ruleVersion: selected.rule.version,
              signalStrength: selected.match.signalStrength.toJSON(),
              categoryWeight: selected.rule.categoryWeight.toJSON(),
              attentionScore: selected.score.toJSON(),
              fingerprint: selected.match.fingerprint,
            },
      disposition: activeDisposition ? disposition : null,
      nextEvaluationBoundary: earliestBoundary(
        [
          ...catalog
            .map((rule) => rule.nextEvaluationBoundary?.(context) ?? null)
            .concat(matches.map(({ match }) => match.nextEvaluationBoundary))
            .filter((value): value is string => value !== null),
          ...(activeDisposition && disposition?.kind === "snoozed" ? [disposition.expiresAt] : []),
        ].filter((value): value is string => value !== null),
      ),
      dependencyVersion: ATTENTION_RULE_DEPENDENCY_VERSION,
      ruleCatalogVersion: ATTENTION_RULE_CATALOG_VERSION,
    };
    const parsed = AttentionCandidateEvaluationSchema.parse(evaluation);
    evaluations.push(parsed);
    if (selected !== null && parsed.winner !== null)
      presentation.set(game.id, {
        ...parsed.winner,
        reason: selected.match.reason,
        question: selected.match.question,
        actions: selected.match.actions,
        correctionDestination: selected.match.correctionDestination,
      });
  }
  const winners = evaluations
    .filter(
      (
        evaluation,
      ): evaluation is AttentionCandidateEvaluation & {
        winner: NonNullable<AttentionCandidateEvaluation["winner"]>;
      } => evaluation.winner !== null,
    )
    .map((evaluation) => ({
      ...evaluation,
      presentation:
        presentation.get(evaluation.gameId) ??
        (() => {
          throw new Error("Missing winner presentation");
        })(),
    }))
    .sort((left, right) => {
      const score = new ExactRational(
        BigInt(right.winner.attentionScore.numerator),
        BigInt(right.winner.attentionScore.denominator),
      ).compare(
        new ExactRational(
          BigInt(left.winner.attentionScore.numerator),
          BigInt(left.winner.attentionScore.denominator),
        ),
      );
      if (score !== 0) return score;
      const leftGame = input.collection.games.find((game) => game.id === left.gameId);
      const rightGame = input.collection.games.find((game) => game.id === right.gameId);
      if (!leftGame || !rightGame) throw new Error("Candidate game missing from collection");
      return (
        compareNormalizedCodePoints(leftGame.name, rightGame.name) ||
        compareNormalizedCodePoints(left.gameId, right.gameId) ||
        compareNormalizedCodePoints(left.winner.ruleId, right.winner.ruleId)
      );
    });
  return { evaluations, winners, calculationVersion: ATTENTION_CANDIDATE_CALCULATION_VERSION };
}

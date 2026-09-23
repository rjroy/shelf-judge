import { canonicalSha256 } from "./profile-source-coordinator.js";
import {
  ExactRational,
  type AttentionDisposition,
  type BggPlaySession,
  type Game,
  type PlayIntention,
} from "@shelf-judge/shared";
import type { PurchaseUtilizationProjection } from "./purchase-utilization-projection.js";

export const ATTENTION_RULE_CATALOG_VERSION = 1;
export const ATTENTION_RULE_DEPENDENCY_VERSION = 1;
export const ATTENTION_RULE_SCORING_VERSION = 1;
/** Global identities that can change the score consumed by purchase utilization. */
export const PURCHASE_FITNESS_SOURCE_IDENTITY_KEYS = [
  "tournamentHash",
  "predictionSettingsHash",
  "redundancySettingsHash",
] as const;

export type AttentionAction =
  | "want-to-play"
  | "not-now"
  | "intentional"
  | "open-game"
  | "correct-play-data"
  | "correct-purchase-data"
  | "resolve-intention"
  | "retire-intention";

export interface AttentionRuleContext {
  readonly game: Game;
  readonly intentions: readonly PlayIntention[];
  readonly bggPlaySessions: readonly BggPlaySession[];
  readonly evaluatedAt: string;
  readonly purchaseProjection: PurchaseUtilizationProjection | null;
  readonly displayedFitnessSourceIdentity: Readonly<{
    tournamentHash: string;
    predictionSettingsHash: string;
    redundancySettingsHash: string;
  }>;
}

export interface AttentionRuleMatch {
  readonly signalStrength: ExactRational;
  readonly reason: string;
  readonly question: string;
  readonly actions: readonly AttentionAction[];
  readonly correctionDestination: "play-data" | "purchase-data" | "intention" | null;
  readonly fingerprint: string;
  readonly nextEvaluationBoundary: string | null;
}

export interface AttentionRuleDefinition {
  readonly id: string;
  readonly version: number;
  readonly dependencyVersion: number;
  readonly scoringVersion: number;
  readonly categoryWeight: ExactRational;
  readonly supersedes: readonly string[];
  readonly dependencies: readonly AttentionRuleDependency[];
  evaluate(context: AttentionRuleContext): AttentionRuleMatch | null;
  nextEvaluationBoundary?(context: AttentionRuleContext): string | null;
}

export type AttentionRuleDependency =
  | { readonly scope: "local"; readonly key: string }
  | {
      readonly scope: "source";
      readonly key: "tournamentHash" | "predictionSettingsHash" | "redundancySettingsHash";
    }
  | { readonly scope: "clock"; readonly key: "utc-date" };

const standardActions = ["want-to-play", "not-now", "intentional", "open-game"] as const;
const zero = new ExactRational(0n);
const one = new ExactRational(1n);

function dateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function evaluationDate(value: string): Date | null {
  const instant = new Date(value);
  return Number.isNaN(instant.valueOf()) ? null : dateOnly(instant.toISOString().slice(0, 10));
}

function canonicalExact(
  value: { numerator: string; denominator: string } | undefined,
): ExactRational | null {
  if (!value || !/^(?:0|[1-9]\d*)$/.test(value.numerator) || !/^[1-9]\d*$/.test(value.denominator))
    return null;
  try {
    const exact = new ExactRational(BigInt(value.numerator), BigInt(value.denominator));
    const json = exact.toJSON();
    return json.numerator === value.numerator && json.denominator === value.denominator
      ? exact
      : null;
  } catch {
    return null;
  }
}

function owned(context: AttentionRuleContext): boolean {
  return context.game.ownership === "owned";
}

export function isCurrentPlayEvidence(game: Game): boolean {
  const evidence = game.playCountEvidence;
  const latest = game.latestPlayCountCheck;
  if (evidence.status !== "valid" || evidence.observedAt === null) return false;
  return !(
    latest !== null &&
    latest.status !== "valid" &&
    Date.parse(latest.observedAt) > Date.parse(evidence.observedAt)
  );
}

export function ruleFingerprint(
  rule: AttentionRuleDefinition,
  context: AttentionRuleContext,
  sourceFingerprint: string,
): string {
  const sourceIdentity = Object.fromEntries(
    rule.dependencies
      .filter(
        (dependency): dependency is Extract<AttentionRuleDependency, { scope: "source" }> =>
          dependency.scope === "source",
      )
      .map((dependency) => [
        dependency.key,
        context.displayedFitnessSourceIdentity[dependency.key],
      ]),
  );
  return canonicalSha256({ sourceFingerprint, sourceIdentity });
}

export function validateAttentionRuleCatalog(
  catalog: readonly AttentionRuleDefinition[],
  displayedFitnessSourceIdentity: AttentionRuleContext["displayedFitnessSourceIdentity"],
): void {
  const ids = new Set<string>();
  for (const rule of catalog) {
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(rule.id) || ids.has(rule.id))
      throw new Error("Invalid attention rule ID");
    if (
      ![rule.version, rule.dependencyVersion, rule.scoringVersion].every(Number.isSafeInteger) ||
      rule.version < 1 ||
      rule.dependencyVersion < 1 ||
      rule.scoringVersion < 1
    )
      throw new Error(`Invalid attention rule version: ${rule.id}`);
    if (
      rule.dependencies.length === 0 ||
      rule.dependencies.some((dependency) => dependency.key.length === 0)
    )
      throw new Error(`Invalid attention rule dependencies: ${rule.id}`);
    for (const dependency of rule.dependencies) {
      if (dependency.scope === "source") {
        const hash = displayedFitnessSourceIdentity[dependency.key];
        if (!/^[a-f0-9]{64}$/.test(hash)) {
          throw new Error(
            `Missing or invalid displayed-fitness source identity: ${dependency.key}`,
          );
        }
      }
    }
    ids.add(rule.id);
  }
}

function playCountFingerprint(context: AttentionRuleContext): string {
  return canonicalSha256({
    gameId: context.game.id,
    ownership: context.game.ownership,
    playCountEvidence: context.game.playCountEvidence,
    latestPlayCountCheck: context.game.latestPlayCountCheck,
  });
}

function matchingBggIds(game: Game): Set<number> {
  return new Set(
    [game.bggId, ...(game.additionalBggIds ?? [])].filter((id): id is number => id !== null),
  );
}

function latestSession(context: AttentionRuleContext): string | null {
  const ids = matchingBggIds(context.game);
  const sessions = context.bggPlaySessions;
  const dates = sessions
    .filter(
      (session) =>
        ids.has(session.bggId) && Number.isSafeInteger(session.quantity) && session.quantity > 0,
    )
    .map((session) => session.playedOn)
    .filter((playedOn) => dateOnly(playedOn) !== null)
    .sort((left, right) => (left < right ? 1 : left > right ? -1 : 0));
  return dates[0] ?? null;
}

function activeIntention(context: AttentionRuleContext): PlayIntention | null {
  const active = context.intentions.filter(
    (intention) => intention.gameId === context.game.id && intention.resolution === null,
  );
  return active.length === 1 ? (active[0] ?? null) : null;
}

function dormantBoundary(context: AttentionRuleContext): string | null {
  const today = evaluationDate(context.evaluatedAt);
  const latest = latestSession(context);
  const lastPlayed = latest === null ? null : dateOnly(latest);
  if (!today || !lastPlayed || lastPlayed > today) return null;
  const days = Math.floor((today.valueOf() - lastPlayed.valueOf()) / 86_400_000);
  const nextDays = (Math.floor(days / 30) + 1) * 30;
  return new Date(lastPlayed.valueOf() + nextDays * 86_400_000).toISOString();
}

export const attentionRuleCatalog: readonly AttentionRuleDefinition[] = [
  {
    id: "never-played",
    version: 1,
    dependencyVersion: 1,
    scoringVersion: ATTENTION_RULE_SCORING_VERSION,
    categoryWeight: new ExactRational(3n, 5n),
    supersedes: [],
    dependencies: [
      { scope: "local", key: "ownership" },
      { scope: "local", key: "play-count-evidence" },
      { scope: "local", key: "latest-play-count-check" },
    ],
    evaluate(context) {
      const evidence = context.game.playCountEvidence;
      if (
        !owned(context) ||
        !isCurrentPlayEvidence(context.game) ||
        evidence.status !== "valid" ||
        evidence.value !== 0 ||
        !Number.isSafeInteger(evidence.value)
      )
        return null;
      return {
        signalStrength: one,
        reason: `You have not recorded a play of ${context.game.name}.`,
        question:
          "Do you want to make a plan to play it, intentionally keep it without a plan, or reconsider it?",
        actions: [...standardActions, "correct-play-data"],
        correctionDestination: "play-data",
        fingerprint: playCountFingerprint(context),
        nextEvaluationBoundary: null,
      };
    },
  },
  {
    id: "dormant",
    version: 1,
    dependencyVersion: 1,
    scoringVersion: ATTENTION_RULE_SCORING_VERSION,
    categoryWeight: new ExactRational(4n, 5n),
    supersedes: [],
    dependencies: [
      { scope: "local", key: "ownership" },
      { scope: "local", key: "play-count-evidence" },
      { scope: "local", key: "bgg-play-sessions" },
      { scope: "local", key: "latest-play-count-check" },
      { scope: "clock", key: "utc-date" },
    ],
    evaluate(context) {
      const evidence = context.game.playCountEvidence;
      const today = evaluationDate(context.evaluatedAt);
      const latest = latestSession(context);
      const lastPlayed = latest === null ? null : dateOnly(latest);
      if (
        !owned(context) ||
        !isCurrentPlayEvidence(context.game) ||
        evidence.status !== "valid" ||
        !Number.isSafeInteger(evidence.value) ||
        evidence.value <= 0 ||
        !today ||
        !lastPlayed ||
        lastPlayed > today
      )
        return null;
      const days = Math.floor((today.valueOf() - lastPlayed.valueOf()) / 86_400_000);
      const periods = Math.floor(days / 30);
      if (days < 180) return null;
      return {
        signalStrength: new ExactRational(BigInt(periods), BigInt(periods + 6)),
        reason: `You have not played ${context.game.name} since ${latest}.`,
        question: "Does this game still fit how you want to use your collection?",
        actions: [...standardActions, "correct-play-data"],
        correctionDestination: "play-data",
        fingerprint: canonicalSha256({
          gameId: context.game.id,
          ownership: context.game.ownership,
          evidence,
          latestPlayCountCheck: context.game.latestPlayCountCheck,
          bggPlaySessions: context.bggPlaySessions.filter((session) =>
            matchingBggIds(context.game).has(session.bggId),
          ),
          latest,
        }),
        nextEvaluationBoundary: dormantBoundary(context),
      };
    },
    nextEvaluationBoundary(context) {
      return dormantBoundary(context);
    },
  },
  {
    id: "underused-purchase",
    version: 1,
    dependencyVersion: 1,
    scoringVersion: ATTENTION_RULE_SCORING_VERSION,
    categoryWeight: one,
    supersedes: [],
    dependencies: [
      { scope: "local", key: "ownership" },
      { scope: "local", key: "purchase-utilization-projection" },
      ...PURCHASE_FITNESS_SOURCE_IDENTITY_KEYS.map((key) => ({ scope: "source" as const, key })),
    ],
    evaluate(context) {
      const component = context.purchaseProjection?.purchaseUtilization.components.valueMultiplier;
      if (
        !owned(context) ||
        context.purchaseProjection?.purchaseUtilization.outcome !== "not-met" ||
        component?.outcome !== "calculated"
      )
        return null;
      const multiplier = canonicalExact(component.value.exact);
      if (!multiplier || multiplier.compare(zero) < 0 || multiplier.compare(one) >= 0) return null;
      const percentage = multiplier.multiply(new ExactRational(100n)).formatFixed(0);
      return {
        signalStrength: one.subtract(multiplier),
        reason: `${context.game.name} has reached ${percentage}% of its purchase-value target.`,
        question:
          "Do you want to play it more, intentionally keep it as-is, or reconsider owning it?",
        actions: [...standardActions, "correct-purchase-data"],
        correctionDestination: "purchase-data",
        fingerprint: canonicalSha256({
          gameId: context.game.id,
          ownership: context.game.ownership,
          purchaseProjection: context.purchaseProjection,
        }),
        nextEvaluationBoundary: null,
      };
    },
  },
  {
    id: "explicit-intention",
    version: 1,
    dependencyVersion: 1,
    scoringVersion: ATTENTION_RULE_SCORING_VERSION,
    categoryWeight: new ExactRational(7n, 10n),
    supersedes: [],
    dependencies: [
      { scope: "local", key: "ownership" },
      { scope: "local", key: "intentions" },
    ],
    evaluate(context) {
      const intention = activeIntention(context);
      if (!owned(context) || !intention) return null;
      const wording =
        intention.kind === "want-to-play"
          ? "Want to play"
          : intention.kind === "first-play"
            ? "a first play"
            : "a replay";
      return {
        signalStrength: one,
        reason: `You marked ${context.game.name} as ${wording}.`,
        question: "Do you still want to make this happen?",
        actions: ["resolve-intention", "retire-intention", "not-now", "intentional", "open-game"],
        correctionDestination: "intention",
        fingerprint: canonicalSha256({
          gameId: context.game.id,
          ownership: context.game.ownership,
          intention,
        }),
        nextEvaluationBoundary: null,
      };
    },
  },
];

export function isActiveAttentionDisposition(
  disposition: AttentionDisposition,
  context: AttentionRuleContext,
  catalog: readonly AttentionRuleDefinition[],
): boolean {
  if (disposition.kind === "snoozed")
    return new Date(context.evaluatedAt) < new Date(disposition.expiresAt);
  const rule = catalog.find((candidate) => candidate.id === disposition.ruleId);
  const match = rule?.evaluate(context);
  return (
    rule?.version === disposition.ruleVersion &&
    match !== null &&
    match !== undefined &&
    ruleFingerprint(rule, context, match.fingerprint) === disposition.fingerprint
  );
}

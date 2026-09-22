import type { AttentionDisposition, Collection } from "@shelf-judge/shared";

export interface AttentionDispositionWinner {
  readonly gameId: string;
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly fingerprint: string;
}

/**
 * Applies the durable, non-clock disposition rules to a post-mutation source.
 * Callers must obtain the stored-rule matches from the pure oracle with
 * dispositions removed. A candidate artifact and the currently selected winner
 * are deliberately not authorities for this decision.
 */
export function clearIncompatibleAttentionDispositions(
  prior: Collection,
  accepted: Collection,
  storedRuleMatches: readonly AttentionDispositionWinner[],
  checkedGameIds: ReadonlySet<string>,
): readonly string[] {
  const priorOwnership = new Map(prior.games.map((game) => [game.id, game.ownership]));
  const matchByGameId = new Map(storedRuleMatches.map((match) => [match.gameId, match]));
  const retained: AttentionDisposition[] = [];
  const cleared: string[] = [];
  for (const disposition of accepted.attentionDispositions) {
    const game = accepted.games.find((candidate) => candidate.id === disposition.gameId);
    const ownershipLost =
      priorOwnership.get(disposition.gameId) === "owned" && game?.ownership !== "owned";
    const intentionalMismatch =
      disposition.kind === "intentional" &&
      checkedGameIds.has(disposition.gameId) &&
      (matchByGameId.get(disposition.gameId)?.ruleId !== disposition.ruleId ||
        matchByGameId.get(disposition.gameId)?.ruleVersion !== disposition.ruleVersion ||
        matchByGameId.get(disposition.gameId)?.fingerprint !== disposition.fingerprint);
    if (ownershipLost || intentionalMismatch) {
      cleared.push(disposition.gameId);
      continue;
    }
    retained.push(disposition);
  }
  accepted.attentionDispositions = retained;
  return cleared.sort();
}

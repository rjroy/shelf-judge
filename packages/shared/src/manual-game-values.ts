import type { FieldEvidence, Game, PersistedManualValue } from "./types";

export function manualValueEvidence(value: PersistedManualValue): FieldEvidence<number> {
  return {
    status: "valid",
    value: value.value,
    source: "manual",
    observedAt: value.confirmedAt,
  };
}

export function resolveManualOverSource<T>(manual: T | null, source: T): T {
  return manual ?? source;
}

export function resolveEffectivePlayingTime(game: Game): FieldEvidence<number> {
  return resolveManualOverSource(
    game.manualValues.playingTime === null
      ? null
      : manualValueEvidence(game.manualValues.playingTime),
    game.durationEvidence,
  );
}

export function resolveEffectivePlayerCount(
  game: Game,
  source: FieldEvidence<number> | null,
): FieldEvidence<number> | null {
  return resolveManualOverSource(
    game.manualValues.playerCount === null
      ? null
      : manualValueEvidence(game.manualValues.playerCount),
    source,
  );
}

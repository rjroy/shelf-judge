import type { ReflectionCitation } from "@shelf-judge/shared";

const EVIDENCE_CLASS_LABELS: Record<ReflectionCitation["evidenceClass"], string> = {
  "owner-game-note": "Note",
  "game-identity-ownership": "Game",
  "current-scoring": "Fitness Score",
  "imported-metadata": "Metadata",
  "play-acquisition": "Play History",
  "collection-structure": "Collection",
  "collection-summary": "Collection",
  "profile-evidence": "Profile",
};

export interface PresentedReflectionCitation {
  readonly citation: ReflectionCitation;
  readonly citationIds: readonly string[];
  readonly traces: readonly {
    readonly citationId: string;
    readonly sourceVersion: string;
    readonly observedAt?: string;
  }[];
  readonly label: string;
  readonly gameTitle?: string;
  readonly href?: string;
}

function gameId(citation: ReflectionCitation): string | undefined {
  const parameters: unknown = citation.destination.parameters;
  return typeof parameters === "object" &&
    parameters !== null &&
    "gameId" in parameters &&
    typeof parameters.gameId === "string"
    ? parameters.gameId
    : undefined;
}

function citationHref(citation: ReflectionCitation): string | undefined {
  const id = gameId(citation);
  if (citation.destination.operationId === "shelf.profile.get") return "/";
  if (
    id !== undefined &&
    [
      "shelf.game.get",
      "shelf.game.bgg.refresh",
      "shelf.game.plays.set",
      "shelf.game.rating.set",
    ].includes(citation.destination.operationId)
  )
    return `/games/${encodeURIComponent(id)}`;
  return undefined;
}

function titleFor(
  citation: ReflectionCitation,
  gameTitles: ReadonlyMap<string, string>,
): string | undefined {
  if (citation.sourceDisplayContext?.kind === "game")
    return citation.sourceDisplayContext.gameTitle;
  const id = gameId(citation);
  return id === undefined ? undefined : gameTitles.get(id);
}

function trace(citation: ReflectionCitation): PresentedReflectionCitation["traces"][number] {
  return {
    citationId: citation.citationId,
    sourceVersion: citation.sourceVersion,
    ...(citation.observedAt === undefined ? {} : { observedAt: citation.observedAt }),
  };
}

function identityKey(citation: ReflectionCitation): string {
  return JSON.stringify({
    evidenceClass: citation.evidenceClass,
    sourceId: citation.sourceId,
    sourceVersion: citation.sourceVersion,
    destination: citation.destination,
    canonicalSummary: citation.canonicalSummary,
  });
}

export function presentReflectionEvidence(
  citations: readonly ReflectionCitation[],
  stale: boolean,
  gameTitles: ReadonlyMap<string, string> = new Map(),
): readonly PresentedReflectionCitation[] {
  const presented = new Map<string, PresentedReflectionCitation>();
  for (const citation of citations) {
    const key = identityKey(citation);
    const existing = presented.get(key);
    if (existing === undefined) {
      presented.set(key, {
        citation,
        citationIds: [citation.citationId],
        traces: [trace(citation)],
        label: EVIDENCE_CLASS_LABELS[citation.evidenceClass],
        ...(titleFor(citation, gameTitles) === undefined
          ? {}
          : { gameTitle: titleFor(citation, gameTitles) }),
        ...(stale ? {} : { href: citationHref(citation) }),
      });
    } else {
      presented.set(key, {
        ...existing,
        citationIds: [...existing.citationIds, citation.citationId],
        traces: [...existing.traces, trace(citation)],
      });
    }
  }
  return [...presented.values()];
}

export function gameTitlesFromGamesPayload(payload: unknown): ReadonlyMap<string, string> {
  const candidates = Array.isArray(payload)
    ? payload
    : typeof payload === "object" &&
        payload !== null &&
        "games" in payload &&
        Array.isArray(payload.games)
      ? payload.games
      : [];
  return new Map(
    candidates.flatMap((candidate) => {
      if (typeof candidate !== "object" || candidate === null || !("game" in candidate)) return [];
      const game = candidate.game;
      if (
        typeof game !== "object" ||
        game === null ||
        !("id" in game) ||
        !("name" in game) ||
        typeof game.id !== "string" ||
        typeof game.name !== "string"
      )
        return [];
      return [[game.id, game.name] as const];
    }),
  );
}

import type {
  AttentionCandidateArtifact,
  CollectionProfile,
  CollectionProfileAttentionActionId,
  CollectionProfileAttentionOperationId,
  CollectionProfileResult,
  FitnessResult,
  ProfileData,
  ProfileSourceIdentity,
} from "@shelf-judge/shared";
import {
  CURRENT_PROFILE_ALGORITHM_VERSION,
  CURRENT_PROFILE_CONTRACT_VERSION,
  CollectionProfileResultSchema,
  ExactRational,
  createCollectionProfileSnapshotSchema,
} from "@shelf-judge/shared";
import { ZodError } from "zod";
import type { StorageService } from "./storage-service.js";
import type { DisplayedFitnessService } from "./displayed-fitness-service.js";
import { computeCollectionProfile } from "./collection-profile-engine.js";
import { projectProfileCollectionSource } from "./game-projection.js";
import {
  profileSourceCoordinatorFor,
  profileSourceIdentity,
  sameProfileSourceIdentity,
  canonicalJson,
  type ProfileSources,
} from "./profile-source-coordinator.js";
import type { AttentionCandidateReadFreshness } from "./attention-disposition-maintenance.js";

export interface ProfileService {
  getProfile(): Promise<CollectionProfileResult>;
}

export interface ProfileServiceDeps {
  storageService: StorageService;
  displayedFitnessService: DisplayedFitnessService;
  now?: () => string;
  /** Candidate freshness is a prerequisite for every Profile publication. */
  attentionCandidates?: AttentionCandidateReadFreshness;
}

function unavailable(
  kind: "transport" | "validation" | "recomputation",
  error: unknown,
): CollectionProfileResult {
  return CollectionProfileResultSchema.parse({
    status: "unavailable",
    error: {
      kind,
      message: error instanceof Error ? error.message : "Profile computation failed",
    },
    retryDestination: { operationId: "shelf.profile.get" },
  });
}

function failureKind(error: unknown): "transport" | "validation" {
  return error instanceof ZodError || error instanceof SyntaxError ? "validation" : "transport";
}

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left.normalize("NFC"), (value) => value.codePointAt(0) ?? 0);
  const b = Array.from(right.normalize("NFC"), (value) => value.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return a.length - b.length;
}

function sameCandidateSource(
  candidate: AttentionCandidateArtifact["identity"],
  source: ProfileSourceIdentity,
): boolean {
  return (
    candidate.collectionId === source.collectionId &&
    candidate.collectionSchemaVersion === source.collectionSchemaVersion &&
    candidate.collectionRevision === source.collectionRevision &&
    candidate.tournamentHash === source.tournamentHash &&
    candidate.predictionSettingsHash === source.predictionSettingsHash &&
    candidate.redundancySettingsHash === source.redundancySettingsHash
  );
}

function candidatePublicationIdentity(
  artifact: AttentionCandidateArtifact,
): ProfileData["publicationIdentity"]["attentionCandidates"] {
  return {
    schemaVersion: artifact.schemaVersion,
    indexVersion: artifact.indexVersion,
    evaluatedAt: artifact.evaluatedAt,
    identity: structuredClone(artifact.identity),
  } as ProfileData["publicationIdentity"]["attentionCandidates"];
}

function exact(value: { numerator: string; denominator: string }): ExactRational {
  return new ExactRational(BigInt(value.numerator), BigInt(value.denominator));
}

function latestPlayedOn(
  game: ProfileSources["collection"]["games"][number],
  sources: ProfileSources,
): string | null {
  const ids = new Set(
    [game.bggId, ...(game.additionalBggIds ?? [])].filter((id): id is number => id !== null),
  );
  return (
    (sources.collection.bggPlaySessions ?? [])
      .filter((session) => ids.has(session.bggId))
      .map((session) => session.playedOn)
      .sort((left, right) => (left < right ? 1 : left > right ? -1 : 0))[0] ?? null
  );
}

function cardEvidence(
  ruleId: string,
  game: ProfileSources["collection"]["games"][number],
  sources: ProfileSources,
  score: ExactRational,
  intention: CollectionProfile["attention"]["cards"][number]["intention"],
): CollectionProfile["attention"]["cards"][number]["evidence"] {
  if (ruleId === "never-played") {
    if (game.playCountEvidence.status !== "valid" || game.playCountEvidence.observedAt === null)
      throw new Error(`Candidate evidence is missing for ${game.id}`);
    return {
      kind: "play-count",
      value: 0,
      source: game.playCountEvidence.source,
      observedAt: game.playCountEvidence.observedAt,
    };
  }
  if (ruleId === "dormant") {
    const lastPlayedOn = latestPlayedOn(game, sources);
    if (
      lastPlayedOn === null ||
      game.playCountEvidence.status !== "valid" ||
      game.playCountEvidence.value <= 0
    )
      throw new Error(`Candidate dormant evidence is missing for ${game.id}`);
    return { kind: "dormant", lastPlayedOn, playCount: game.playCountEvidence.value };
  }
  if (ruleId === "underused-purchase") {
    const multiplier = new ExactRational(1n).subtract(score);
    const value = multiplier.toJSON();
    return {
      kind: "purchase-utilization",
      multiplier: value,
      achievedPercent: Number(multiplier.multiply(new ExactRational(100n)).formatFixed(0)),
    };
  }
  if (ruleId === "explicit-intention" && intention !== null) {
    return {
      kind: "intention",
      intentionId: intention.intentionId,
      intentionKind: intention.kind,
      createdAt: intention.createdAt,
      baseline: intention.baseline,
    };
  }
  throw new Error(`Candidate rule ${ruleId} has no valid public evidence for ${game.id}`);
}

const operationForAction: Record<
  CollectionProfileAttentionActionId,
  CollectionProfileAttentionOperationId
> = {
  "want-to-play": "shelf.game.intention.set",
  "not-now": "shelf.profile.attention.not-now",
  intentional: "shelf.profile.attention.intentional",
  "open-game": "shelf.game.get",
  "correct-play-data": "shelf.game.plays.set",
  "correct-purchase-data": "shelf.game.set-acquisition",
  "resolve-intention": "shelf.game.intention.complete",
  "retire-intention": "shelf.game.intention.retire",
};

function attentionCards(
  sources: ProfileSources,
  artifact: AttentionCandidateArtifact,
  cardLimit: number,
): CollectionProfile["attention"] {
  const games = new Map(sources.collection.games.map((game) => [game.id, game]));
  const ranked = artifact.rows
    .filter((row) => {
      const game = games.get(row.gameId);
      if (
        game === undefined ||
        game.ownership !== "owned" ||
        row.nameOrderingKey !== game.name.normalize("NFC")
      )
        throw new Error(`Candidate row does not match the captured game source: ${row.gameId}`);
      return row.evaluation.winner !== null;
    })
    .sort((left, right) => {
      const leftWinner = left.evaluation.winner!;
      const rightWinner = right.evaluation.winner!;
      return (
        exact(rightWinner.attentionScore).compare(exact(leftWinner.attentionScore)) ||
        compareCodePoints(left.nameOrderingKey, right.nameOrderingKey) ||
        compareCodePoints(left.gameId, right.gameId) ||
        compareCodePoints(leftWinner.ruleId, rightWinner.ruleId)
      );
    })
    .slice(0, cardLimit);

  const cards = ranked.map((row) => {
    const winner = row.evaluation.winner!;
    const game = games.get(row.gameId);
    const presentation = row.winnerPresentation;
    if (game === undefined || presentation === null)
      throw new Error(`Candidate presentation is missing for ${row.gameId}`);
    const intention =
      winner.ruleId === "explicit-intention"
        ? (sources.collection.intentions.find(
            (candidate) => candidate.gameId === game.id && candidate.resolution === null,
          ) ?? null)
        : null;
    if (winner.ruleId === "explicit-intention" && intention === null)
      throw new Error(`Candidate intention is missing for ${game.id}`);
    const expectedVersion = row.evaluation.disposition?.version ?? 0;
    const actionIds = presentation.actions as readonly CollectionProfileAttentionActionId[];
    const actions = actionIds.map((action) => {
      const operationId = operationForAction[action];
      if (operationId === undefined) throw new Error(`Unknown attention action: ${String(action)}`);
      const command =
        action === "not-now" || action === "intentional"
          ? {
              operation: action,
              gameId: game.id,
              ruleId: winner.ruleId,
              ruleVersion: winner.ruleVersion,
              fingerprint: winner.fingerprint,
              expectedVersion,
            }
          : null;
      return {
        action,
        operationId,
        destination: { gameId: game.id, operationId },
        command,
      };
    });
    const signalStrength = exact(winner.signalStrength);
    const categoryWeight = exact(winner.categoryWeight);
    const attentionScore = exact(winner.attentionScore);
    return {
      id: `attention:${game.id}:${winner.ruleId}`,
      gameId: game.id,
      gameName: game.name,
      ruleId: winner.ruleId,
      ruleVersion: winner.ruleVersion,
      dependencyVersion: row.evaluation.dependencyVersion,
      nonClockFingerprint: winner.fingerprint,
      reason: presentation.reason,
      question: presentation.question,
      scoreExplanation: `Attention score ${attentionScore.toJSON().numerator}/${attentionScore.toJSON().denominator} = signal ${signalStrength.toJSON().numerator}/${signalStrength.toJSON().denominator} × category ${categoryWeight.toJSON().numerator}/${categoryWeight.toJSON().denominator}.`,
      actions,
      evidence: cardEvidence(winner.ruleId, game, sources, attentionScore, intention),
      intention: structuredClone(intention),
      disposition: { state: "none" as const, expectedVersion },
      signalStrength: signalStrength.toJSON(),
      categoryWeight: categoryWeight.toJSON(),
      attentionScore: attentionScore.toJSON(),
    };
  });
  return {
    state:
      cardLimit === 0
        ? "disabled"
        : sources.collection.games.filter(({ ownership }) => ownership === "owned").length === 0
          ? "empty-collection"
          : cards.length > 0
            ? "ranked"
            : "no-winner",
    cardLimit,
    cards,
  };
}

function publicationIdentityMatches(
  stored: ProfileData,
  source: ReturnType<typeof profileSourceIdentity>,
  cardLimit: number,
  artifact: AttentionCandidateArtifact,
): boolean {
  return (
    sameProfileSourceIdentity(stored.publicationIdentity.source, source) &&
    stored.publicationIdentity.profileAttentionCardLimit === cardLimit &&
    canonicalJson(stored.publicationIdentity.attentionCandidates) ===
      canonicalJson(candidatePublicationIdentity(artifact))
  );
}

export function createProfileService(deps: ProfileServiceDeps): ProfileService {
  const { storageService, displayedFitnessService } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const coordinator = profileSourceCoordinatorFor(storageService);

  return {
    getProfile(): Promise<CollectionProfileResult> {
      return coordinator.runExclusive(async () => {
        if (deps.attentionCandidates === undefined)
          return unavailable("recomputation", new Error("Attention candidates are unavailable"));
        let sources: ProfileSources;
        let artifact: AttentionCandidateArtifact;
        let cardLimit: number;
        let entityPolicy: CollectionProfile["entityPolicy"];
        try {
          const [collection, config, tournament, predictionSettings, redundancySettings] =
            await Promise.all([
              storageService.loadCollection(),
              storageService.loadConfig(),
              storageService.loadTournament(),
              storageService.loadPredictionSettings(),
              storageService.loadRedundancySettings(),
            ]);
          sources = structuredClone({
            collection: projectProfileCollectionSource(collection),
            tournament,
            predictionSettings,
            redundancySettings,
          });
          if (
            !Number.isSafeInteger(config.profileAttentionCardLimit) ||
            config.profileAttentionCardLimit < 0 ||
            config.profileAttentionCardLimit > 24
          )
            throw new Error("Invalid profile attention card limit");
          cardLimit = config.profileAttentionCardLimit;
          entityPolicy = config.profileEntityPolicy;
          const freshness = await deps.attentionCandidates.ensureFresh();
          if (freshness.state === "unavailable")
            throw new Error("Attention candidates are unavailable");
          artifact = freshness.artifact;
          const sourceIdentity = profileSourceIdentity(sources);
          if (!sameCandidateSource(artifact.identity, sourceIdentity)) {
            await storageService.discardProfile?.();
            throw new Error("Attention candidate source identity does not match Profile source");
          }
        } catch (error) {
          return unavailable(failureKind(error), error);
        }

        const sourceIdentity = profileSourceIdentity(sources);
        let stored: ProfileData | null;
        try {
          stored = await storageService.loadProfile();
        } catch (error) {
          return unavailable(failureKind(error), error);
        }
        if (stored && publicationIdentityMatches(stored, sourceIdentity, cardLimit, artifact)) {
          const cachedSnapshot = createCollectionProfileSnapshotSchema(entityPolicy).safeParse({
            source: sources.collection,
            profile: stored.profile,
          });
          if (cachedSnapshot.success) return cachedSnapshot.data.profile;
          try {
            await storageService.discardProfile?.();
          } catch (error) {
            return unavailable(failureKind(error), error);
          }
        } else if (stored) {
          try {
            await storageService.discardProfile?.();
          } catch (error) {
            return unavailable(failureKind(error), error);
          }
        }

        let profile: CollectionProfile;
        try {
          if (!displayedFitnessService.listGamesFromSnapshot)
            throw new Error("Snapshot-backed displayed fitness is not configured");
          const games = await displayedFitnessService.listGamesFromSnapshot(sources, {
            includePredicted: true,
          });
          const fitnessResults = new Map<string, FitnessResult>();
          for (const entry of games) {
            if (entry.score !== null && entry.hasScoringContribution)
              fitnessResults.set(entry.game.id, entry.score);
          }
          const computedAt = now();
          const base = computeCollectionProfile({
            collection: sources.collection,
            fitnessResults,
            computedAt,
            entityPolicy,
          });
          profile = createCollectionProfileSnapshotSchema(entityPolicy).parse({
            source: sources.collection,
            profile: {
              ...base,
              attention: attentionCards(sources, artifact, cardLimit),
            },
          }).profile as CollectionProfile;
        } catch (error) {
          return unavailable(error instanceof ZodError ? "validation" : "recomputation", error);
        }

        try {
          // Re-read every identity-bearing input immediately before persistence.
          // Candidate freshness is intentionally bounded here; it can publish a
          // due artifact, but cap changes never enter candidate maintenance.
          const finalFreshness = await deps.attentionCandidates.ensureFresh();
          if (finalFreshness.state === "unavailable")
            throw new Error("Attention candidates are unavailable");
          const [
            finalCollection,
            finalConfig,
            finalTournament,
            finalPredictionSettings,
            finalRedundancySettings,
          ] = await Promise.all([
            storageService.loadCollection(),
            storageService.loadConfig(),
            storageService.loadTournament(),
            storageService.loadPredictionSettings(),
            storageService.loadRedundancySettings(),
          ]);
          const finalSources = {
            collection: projectProfileCollectionSource(finalCollection),
            tournament: finalTournament,
            predictionSettings: finalPredictionSettings,
            redundancySettings: finalRedundancySettings,
          } satisfies ProfileSources;
          const finalIdentity = profileSourceIdentity(finalSources);
          if (!sameProfileSourceIdentity(sourceIdentity, finalIdentity))
            throw new Error("Profile source snapshot changed during computation");
          if (finalConfig.profileAttentionCardLimit !== cardLimit)
            throw new Error("Profile configuration changed during computation");
          if (canonicalJson(finalConfig.profileEntityPolicy) !== canonicalJson(entityPolicy))
            throw new Error("Profile entity policy changed during computation");
          if (!sameCandidateSource(finalFreshness.artifact.identity, finalIdentity))
            throw new Error("Attention candidate source changed during computation");
          if (
            canonicalJson(candidatePublicationIdentity(finalFreshness.artifact)) !==
            canonicalJson(candidatePublicationIdentity(artifact))
          )
            throw new Error("Attention candidate publication changed during computation");
          const cache: ProfileData = {
            contractVersion: CURRENT_PROFILE_CONTRACT_VERSION,
            algorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
            publicationIdentity: {
              source: sourceIdentity,
              profileAttentionCardLimit: cardLimit,
              attentionCandidates: candidatePublicationIdentity(artifact),
            },
            profile,
            computedAt: profile.computedAt,
          };
          await storageService.saveProfile(cache);
          return cache.profile;
        } catch (error) {
          return unavailable(error instanceof ZodError ? "validation" : failureKind(error), error);
        }
      });
    },
  };
}

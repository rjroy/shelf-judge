import type {
  Collection,
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
  createProfileDataSchema,
  ExactRational,
  createCollectionProfileSnapshotSchema,
} from "@shelf-judge/shared";
import { ZodError } from "zod";
import type { StorageService } from "./storage-service.js";
import {
  semanticFallbackStatus,
  type DisplayedFitnessService,
} from "./displayed-fitness-service.js";
import { computeCollectionProfile } from "./collection-profile-engine.js";
import { projectProfileCollectionSource } from "./game-projection.js";
import {
  profileSourceCoordinatorFor,
  profileSourceIdentity,
  sameProfileSourceIdentity,
  canonicalJson,
  canonicalSha256,
  type ProfileSources,
} from "./profile-source-coordinator.js";
import type { AttentionCandidateReadFreshness } from "./attention-disposition-maintenance.js";
import type { SourceVector } from "./source-vector.js";
import type { PrivateDisplayedFitnessService } from "./displayed-fitness-service.js";

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
      gameImageUrl: game.imageUrl,
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
  entityPolicyFingerprint: string,
  scoringProof: unknown,
): boolean {
  return (
    sameProfileSourceIdentity(stored.publicationIdentity.source, source) &&
    stored.publicationIdentity.profileAttentionCardLimit === cardLimit &&
    stored.publicationIdentity.entityPolicyFingerprint === entityPolicyFingerprint &&
    canonicalJson(stored.publicationIdentity.attentionCandidates) ===
      canonicalJson(candidatePublicationIdentity(artifact)) &&
    canonicalJson(
      stored.publicationIdentity.attentionCandidates.identity.semanticScoringInputProof,
    ) === canonicalJson(scoringProof)
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
        let fitnessCollection: Collection;
        let fitnessSourceVector: SourceVector | undefined;
        let redundancySimilarityStatus: "disabled" | "factual" | "not-ready" | "stale" | "partial" =
          "disabled";
        try {
          const [collection, config, tournament, predictionSettings, redundancySettings] =
            await Promise.all([
              storageService.loadCollection(),
              storageService.loadConfig(),
              storageService.loadTournament(),
              storageService.loadPredictionSettings(),
              storageService.loadRedundancySettings(),
            ]);
          redundancySimilarityStatus = semanticFallbackStatus(
            collection,
            redundancySettings.enabled,
          );
          // Keep the private captured collection for snapshot-backed fitness and
          // semantic resolution. The Profile source itself remains projected.
          fitnessCollection = structuredClone(collection);
          // The coordinator holds source writers while the collection/settings and
          // vector are captured, so semantic publications can be checked against
          // one coherent private snapshot by displayed fitness.
          fitnessSourceVector = storageService.sourceVector?.();
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
        const privateFitness = displayedFitnessService as PrivateDisplayedFitnessService;
        const snapshot =
          fitnessSourceVector?.available === true
            ? {
                kind: "private-capture" as const,
                collection: fitnessCollection,
                sourceVector: fitnessSourceVector,
                tournament: sources.tournament,
                predictionSettings: sources.predictionSettings,
                redundancySettings: sources.redundancySettings,
              }
            : null;
        if (
          snapshot === null ||
          typeof privateFitness.getScoringInputFromSnapshot !== "function" ||
          typeof privateFitness.listGamesFromSnapshotWithProof !== "function"
        )
          return unavailable(
            "recomputation",
            new Error("Proof-bearing snapshot fitness is unavailable"),
          );
        const entityPolicyFingerprint = canonicalSha256(entityPolicy);
        let scoringCapture: Awaited<
          ReturnType<PrivateDisplayedFitnessService["getScoringInputFromSnapshot"]>
        >;
        try {
          scoringCapture = await privateFitness.getScoringInputFromSnapshot(snapshot);
          if (!scoringCapture.isCurrent()) throw new Error("Scoring input changed during capture");
          if (
            canonicalJson(artifact.identity.semanticScoringInputProof) !==
            canonicalJson(scoringCapture.semanticScoringInputProof)
          )
            throw new Error(
              "Attention candidate scoring proof does not match current scoring input",
            );
        } catch (error) {
          return unavailable(failureKind(error), error);
        }

        const checkFence = async (expectedArtifact: AttentionCandidateArtifact): Promise<void> => {
          const freshness = await deps.attentionCandidates!.ensureFresh();
          if (freshness.state === "unavailable")
            throw new Error("Attention candidates are unavailable");
          if (
            canonicalJson(candidatePublicationIdentity(freshness.artifact)) !==
            canonicalJson(candidatePublicationIdentity(expectedArtifact))
          )
            throw new Error("Attention candidate publication changed during Profile operation");
          const [collection, config, tournament, predictionSettings, redundancySettings] =
            await Promise.all([
              storageService.loadCollection(),
              storageService.loadConfig(),
              storageService.loadTournament(),
              storageService.loadPredictionSettings(),
              storageService.loadRedundancySettings(),
            ]);
          const latestSources = {
            collection: projectProfileCollectionSource(collection),
            tournament,
            predictionSettings,
            redundancySettings,
          } satisfies ProfileSources;
          if (!sameProfileSourceIdentity(sourceIdentity, profileSourceIdentity(latestSources)))
            throw new Error("Profile source snapshot changed during operation");
          if (
            config.profileAttentionCardLimit !== cardLimit ||
            canonicalJson(config.profileEntityPolicy) !== canonicalJson(entityPolicy)
          )
            throw new Error("Profile configuration changed during operation");
          if (canonicalSha256(config.profileEntityPolicy) !== entityPolicyFingerprint)
            throw new Error("Profile entity policy changed during operation");
          if (
            canonicalJson(expectedArtifact.identity.semanticScoringInputProof) !==
            canonicalJson(scoringCapture.semanticScoringInputProof)
          )
            throw new Error("Attention candidate scoring proof changed during operation");
          if (!sameCandidateSource(freshness.artifact.identity, sourceIdentity))
            throw new Error("Attention candidate source changed during operation");
          if (
            freshness.artifact.earliestBoundary !== null &&
            Date.parse(freshness.artifact.earliestBoundary) <= Date.parse(now())
          )
            throw new Error("Attention candidate publication became due during Profile operation");
          // This must remain the final fence operation: all awaits and all other
          // potentially stale reads above are complete before validating the
          // private SQLite/source-vector capture at the return boundary.
          if (!scoringCapture.isCurrent())
            throw new Error("Scoring input changed during Profile operation");
        };

        let stored: ProfileData | null;
        try {
          stored = await storageService.loadProfile();
        } catch (error) {
          return unavailable(failureKind(error), error);
        }
        if (stored) {
          const validated = createProfileDataSchema(entityPolicy).safeParse(stored);
          if (
            validated.success &&
            publicationIdentityMatches(
              validated.data,
              sourceIdentity,
              cardLimit,
              artifact,
              entityPolicyFingerprint,
              scoringCapture.semanticScoringInputProof,
            )
          ) {
            try {
              await checkFence(artifact);
              const cachedSnapshot = createCollectionProfileSnapshotSchema(entityPolicy).safeParse({
                source: sources.collection,
                profile: validated.data.profile,
              });
              if (cachedSnapshot.success) return cachedSnapshot.data.profile;
            } catch (error) {
              return unavailable(failureKind(error), error);
            }
          }
          try {
            await storageService.discardProfile?.();
          } catch (error) {
            return unavailable(failureKind(error), error);
          }
        }

        let profile: CollectionProfile;
        try {
          const result = await privateFitness.listGamesFromSnapshotWithProof(snapshot, {
            includePredicted: true,
            redundancySimilarityStatus,
          });
          if (
            !result.isCurrent() ||
            canonicalJson(result.semanticScoringInputProof) !==
              canonicalJson(scoringCapture.semanticScoringInputProof) ||
            canonicalJson(result.semanticScoringInputProof) !==
              canonicalJson(artifact.identity.semanticScoringInputProof)
          )
            throw new Error("Displayed fitness consumed a different scoring input");
          const fitnessResults = new Map<string, FitnessResult>();
          for (const entry of result.games) {
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
          await checkFence(artifact);
          const cache: ProfileData = {
            contractVersion: CURRENT_PROFILE_CONTRACT_VERSION,
            algorithmVersion: CURRENT_PROFILE_ALGORITHM_VERSION,
            publicationIdentity: {
              source: sourceIdentity,
              profileAttentionCardLimit: cardLimit,
              entityPolicyFingerprint,
              attentionCandidates: candidatePublicationIdentity(artifact),
            },
            profile,
            computedAt: profile.computedAt,
          };
          createProfileDataSchema(entityPolicy).parse(cache);
          await storageService.saveProfile(cache);
          // Do not attempt an unconditional delete after a race: another writer
          // may have replaced this staged value while the fence was awaited.
          // A stale cache is rejected by its captured proof on the next read.
          await checkFence(artifact);
          return cache.profile;
        } catch (error) {
          return unavailable(error instanceof ZodError ? "validation" : failureKind(error), error);
        }
      });
    },
  };
}

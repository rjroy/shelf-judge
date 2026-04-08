"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Game, TournamentGameStatsDisplay, TournamentSession } from "@shelf-judge/shared";

interface PairData {
  done?: boolean;
  gameA?: Game;
  gameB?: Game;
  gameAFitness?: number | null;
  gameBFitness?: number | null;
  gameAStats?: TournamentGameStatsDisplay;
  gameBStats?: TournamentGameStatsDisplay;
}

function ScoreDisplay({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="card-score">
      <div className={`card-score-value ${className ?? ""}`}>{value}</div>
      <div className="card-score-label">{label}</div>
    </div>
  );
}

function describeSession(session: TournamentSession): string {
  if (!session.filters || session.filters.length === 0) return "All games";
  return session.filters
    .map((f) => {
      switch (f.type) {
        case "name":
          return `"${f.value}"`;
        case "minFitness":
          return `Fitness >= ${f.value}`;
        case "maxFitness":
          return `Fitness <= ${f.value}`;
        case "bggTag":
          return `Tag: ${f.value}`;
        case "staleness":
          return `< ${f.value} comparisons`;
        default:
          return f.value;
      }
    })
    .join(", ");
}

export default function TournamentSessionPage() {
  return (
    <Suspense
      fallback={
        <>
          <div className="topbar">
            <div className="topbar-title">Tournament</div>
          </div>
          <div className="comparison-area">
            <div className="tournament-loading">Loading...</div>
          </div>
        </>
      }
    >
      <TournamentSessionPageInner />
    </Suspense>
  );
}

function TournamentSessionPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("id");

  const [session, setSession] = useState<TournamentSession | null>(null);
  const [pair, setPair] = useState<PairData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [comparisonCount, setComparisonCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      const activeRes = await fetch("/api/daemon/tournament/sessions/active");
      if (activeRes.ok) {
        const data = (await activeRes.json()) as { session: TournamentSession };
        setSession(data.session);
        setComparisonCount(data.session.comparisonCount);
      }
    } catch {
      // Session might not exist
    }
  }, [sessionId]);

  const loadNextPair = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/daemon/tournament/sessions/${sessionId}/next`);
      if (!res.ok) {
        setError("Failed to load next pair");
        return;
      }
      const data = (await res.json()) as PairData;
      setPair(data);
    } catch {
      setError("Failed to load next pair");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      router.push("/tournament");
      return;
    }
    void Promise.all([loadSession(), loadNextPair()]);
  }, [sessionId, loadSession, loadNextPair, router]);

  async function handlePick(winnerId: string) {
    if (!sessionId || !pair?.gameA || !pair?.gameB || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/daemon/tournament/sessions/${sessionId}/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameAId: pair.gameA.id,
          gameBId: pair.gameB.id,
          winnerId,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to submit comparison");
      }
      setComparisonCount((c) => c + 1);
      // Load next pair inline
      const nextRes = await fetch(`/api/daemon/tournament/sessions/${sessionId}/next`);
      if (nextRes.ok) {
        const nextData = (await nextRes.json()) as PairData;
        setPair(nextData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEndSession() {
    if (!sessionId) return;
    try {
      await fetch(`/api/daemon/tournament/sessions/${sessionId}/end`, { method: "POST" });
      router.push("/tournament");
    } catch {
      setError("Failed to end session");
    }
  }

  if (loading) {
    return (
      <>
        <div className="topbar">
          <div className="topbar-title">Tournament</div>
        </div>
        <div className="comparison-area">
          <div className="tournament-loading">Loading...</div>
        </div>
      </>
    );
  }

  const sessionDone = pair?.done === true;
  const sessionDesc = session ? describeSession(session) : "Tournament";
  const gameCountInScope = session?.gameIds.length ?? 0;

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Tournament — {sessionDesc}</div>
        <div className="topbar-session-meta">{gameCountInScope} games in scope</div>
        <button
          className="btn btn-danger-ghost"
          onClick={() => {
            void handleEndSession();
          }}
        >
          End session
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {sessionDone ? (
        <div className="comparison-area">
          <div className="session-complete">
            <h3>Session complete</h3>
            <p>
              All available pairs have been compared. You made <strong>{comparisonCount}</strong>{" "}
              comparisons this session.
            </p>
            <button className="btn btn-primary btn-lg" onClick={() => router.push("/tournament")}>
              Back to Tournament
            </button>
          </div>
        </div>
      ) : pair?.gameA && pair?.gameB ? (
        <>
          <div className="comparison-area"
          onKeyDown={(e) => {
            // 1, up, or left picks game A, 2, down, or right picks game B
            if (e.key === "1" || e.key === "ArrowLeft" || e.key === "ArrowUp") {
              void handlePick(pair.gameA!.id);
            } else if (e.key === "2" || e.key === "ArrowRight" || e.key === "ArrowDown") {
              void handlePick(pair.gameB!.id);
            }
          }}
          tabIndex={0}
          >
            <div className="comparison-prompt">Which would you keep?</div>

            <div className="comparison-cards">
              <div
                className={`game-card${submitting ? " disabled" : ""}`}
                onClick={() => {
                  void handlePick(pair.gameA!.id);
                }}
              >
                <div className="game-thumb-lg">
                  {pair.gameA.imageUrl ? (
                    <img src={pair.gameA.imageUrl} alt={pair.gameA.name} />
                  ) : (
                    <span>🎲</span>
                  )}
                </div>
                <div className="game-card-name">{pair.gameA.name}</div>
                <div className="game-card-scores">
                  <ScoreDisplay
                    label="Axis"
                    value={
                      pair.gameAFitness !== null && pair.gameAFitness !== undefined
                        ? pair.gameAFitness.toFixed(1)
                        : "-"
                    }
                    className="axis"
                  />
                  <ScoreDisplay
                    label="Tournament"
                    value={pair.gameAStats?.displayLabel ?? "not yet ranked"}
                    className={
                      pair.gameAStats?.isProvisional || !pair.gameAStats?.comparisonCount
                        ? "provisional"
                        : "tournament"
                    }
                  />
                </div>
                <div className="game-card-comparisons">
                  {pair.gameAStats?.comparisonCount ?? 0} comparisons
                  {pair.gameAStats?.isProvisional ? " · provisional" : ""}
                </div>
                <button className="pick-btn" disabled={submitting}>
                  Keep this one
                </button>
              </div>

              <div className="vs-divider">vs</div>

              <div
                className={`game-card${submitting ? " disabled" : ""}`}
                onClick={() => {
                  void handlePick(pair.gameB!.id);
                }}
              >
                <div className="game-thumb-lg">
                  {pair.gameB.imageUrl ? (
                    <img src={pair.gameB.imageUrl} alt={pair.gameB.name} />
                  ) : (
                    <span>🎲</span>
                  )}
                </div>
                <div className="game-card-name">{pair.gameB.name}</div>
                <div className="game-card-scores">
                  <ScoreDisplay
                    label="Axis"
                    value={
                      pair.gameBFitness !== null && pair.gameBFitness !== undefined
                        ? pair.gameBFitness.toFixed(1)
                        : "-"
                    }
                    className="axis"
                  />
                  <ScoreDisplay
                    label="Tournament"
                    value={pair.gameBStats?.displayLabel ?? "not yet ranked"}
                    className={
                      pair.gameBStats?.isProvisional || !pair.gameBStats?.comparisonCount
                        ? "provisional"
                        : "tournament"
                    }
                  />
                </div>
                <div className="game-card-comparisons">
                  {pair.gameBStats?.comparisonCount ?? 0} comparisons
                  {pair.gameBStats?.isProvisional ? " · provisional" : ""}
                </div>
                <button className="pick-btn" disabled={submitting}>
                  Keep this one
                </button>
              </div>
            </div>
          </div>

          <div className="session-footer">
            <div className="session-progress">
              <strong>{comparisonCount}</strong> comparisons this session
            </div>
            <div className="progress-bar-wrap">
              <div
                className="progress-bar-fill"
                style={{ width: `${Math.min(comparisonCount * 5, 100)}%` }}
              />
            </div>
            <div className="session-footer-note">Comparing games with fewer comparisons first</div>
            <div className="session-footer-right">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  void handleEndSession();
                }}
              >
                End session
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="comparison-area">
          <div className="tournament-loading">Loading pair...</div>
        </div>
      )}
    </>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import type {
  AxisSuggestion,
  CollectionOutlier,
  TournamentDivergenceInsight,
} from "@shelf-judge/shared";

export type ProfileInsight = TournamentDivergenceInsight | CollectionOutlier | AxisSuggestion;

type TrustedInsightSectionProps = {
  title: string;
  insights: ProfileInsight[] | null;
  emptyMessage: string;
  unavailableMessage?: string;
  questionFramed?: boolean;
  compact?: boolean;
  renderAction?: (insight: ProfileInsight) => ReactNode;
};

const statusLabels = {
  reported: "Reported pattern",
  insufficient: "Insufficient evidence",
  suppressed: "Suppressed",
  retired: "Retired method",
} as const;

function formatMeasurement(value: string | number | boolean | null, unit: string | null): string {
  const rendered = value === null ? "Unavailable" : String(value);
  return unit === null ? rendered : `${rendered} ${unit}`;
}

function evidenceName(insight: ProfileInsight, gameId: string): string {
  return insight.evidence.find((game) => game.gameId === gameId)?.gameName ?? gameId;
}

export function insightReferencesGame(insight: ProfileInsight, gameId: string): boolean {
  return (
    insight.id === `divergence:${gameId}` ||
    insight.id === `outlier:${gameId}` ||
    insight.evidence.some((game) => game.gameId === gameId) ||
    (insight.comparator?.gameIds.includes(gameId) ?? false)
  );
}

function InsightCard({
  insight,
  questionFramed,
  action,
}: {
  insight: ProfileInsight;
  questionFramed: boolean;
  action?: ReactNode;
}) {
  const subject = insight.evidence.find((game) => game.role === "subject");
  const headingId = `trusted-insight-${insight.id.replace(/[^A-Za-z0-9_-]/g, "-")}`;

  return (
    <article
      id={`insight-${insight.id}`}
      className={`trusted-insight-card status-${insight.status}`}
      data-insight-status={insight.status}
      aria-labelledby={headingId}
    >
      <header className="trusted-insight-card-header">
        <div>
          <span className={`trusted-insight-status status-${insight.status}`}>
            {statusLabels[insight.status]}
          </span>
          <h3 id={headingId} className="trusted-insight-heading">
            {subject ? (
              <Link href={`/games/${subject.gameId}`} className="game-link">
                {subject.gameName}
              </Link>
            ) : (
              insight.method.description
            )}
          </h3>
        </div>
        {action}
      </header>

      {insight.status === "reported" ? (
        <>
          <p className="trusted-insight-observation">{insight.observation}</p>
          {insight.interpretation && (
            <div
              className={
                questionFramed ? "trusted-insight-question" : "trusted-insight-interpretation"
              }
            >
              <span>{questionFramed ? "Question to consider" : "Interpretation"}</span>
              <p>{insight.interpretation}</p>
            </div>
          )}
          <div className="trusted-insight-assessment">
            <div>
              <strong>Why it is notable</strong>
              <span>{insight.notability.explanation}</span>
            </div>
            {insight.confidence && (
              <div>
                <strong>Confidence: {insight.confidence.level}</strong>
                <span>{insight.confidence.basis}</span>
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="trusted-insight-explanation">{insight.explanation}</p>
      )}

      <div className="trusted-insight-meta-grid">
        <section>
          <h4>Method</h4>
          <p>{insight.method.description}</p>
          <code>
            {insight.method.id} v{insight.method.version}
          </code>
        </section>
        <section>
          <h4>Cohort</h4>
          <p>{insight.cohort.description}</p>
          <span>
            {insight.cohort.includedGameCount} included, {insight.cohort.excludedGameCount} excluded
            of {insight.cohort.eligibleGameCount} eligible ({insight.cohort.coveragePercent}%
            coverage)
          </span>
        </section>
      </div>

      {insight.sufficiency.length > 0 && (
        <section className="trusted-insight-block">
          <h4>Sufficiency</h4>
          <ul className="trusted-insight-sufficiency">
            {insight.sufficiency.map((requirement) => (
              <li key={requirement.criterion} className={requirement.met ? "met" : "unmet"}>
                <span>{requirement.met ? "Met" : "Not met"}</span>
                {requirement.criterion}: {requirement.observed} observed, {requirement.required}{" "}
                required
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="trusted-insight-block">
        <h4>Game evidence</h4>
        {insight.evidence.length > 0 ? (
          <div className="trusted-insight-evidence-grid">
            {insight.evidence.map((game) => (
              <div key={`${game.role}:${game.gameId}`} className="trusted-insight-evidence-game">
                <div>
                  <Link href={`/games/${game.gameId}`} className="game-link">
                    {game.gameName}
                  </Link>
                  <span className="trusted-insight-role">{game.role}</span>
                </div>
                <dl>
                  {game.measurements.map((measurement) => (
                    <div key={measurement.key}>
                      <dt>{measurement.label}</dt>
                      <dd>
                        {formatMeasurement(measurement.value, measurement.unit)}
                        <small>{measurement.source}</small>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        ) : (
          <p className="trusted-insight-muted">No game-level evidence is attached to this state.</p>
        )}
      </section>

      {insight.comparator && (
        <section className="trusted-insight-block">
          <h4>Comparison</h4>
          <p>{insight.comparator.description}</p>
          <div className="trusted-insight-game-links">
            {insight.comparator.gameIds.map((gameId) => (
              <Link key={gameId} href={`/games/${gameId}`} className="game-link">
                {evidenceName(insight, gameId)}
              </Link>
            ))}
          </div>
        </section>
      )}

      {insight.limitations.length > 0 && (
        <section className="trusted-insight-block trusted-insight-limitations">
          <h4>Limitations</h4>
          <ul>
            {insight.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

export function TrustedInsightSection({
  title,
  insights,
  emptyMessage,
  unavailableMessage = "This analysis is not available for the current collection.",
  questionFramed = false,
  compact = false,
  renderAction,
}: TrustedInsightSectionProps) {
  const headingId = `trusted-insight-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section
      className={`section-card trusted-insight-section${compact ? " compact" : ""}`}
      data-insight-layout="responsive"
      aria-labelledby={headingId}
    >
      <div className="section-header">
        <h2 id={headingId} className="section-title-main">
          {title}
        </h2>
        <span className="section-count">
          {insights === null ? "Unavailable" : `${insights.length} records`}
        </span>
      </div>
      <div className="section-body trusted-insight-list">
        {insights === null ? (
          <div className="trusted-insight-state unavailable">
            <strong>Analysis unavailable</strong>
            <span>{unavailableMessage}</span>
          </div>
        ) : insights.length === 0 ? (
          <div className="trusted-insight-state empty">
            <strong>Evaluated, nothing notable</strong>
            <span>{emptyMessage}</span>
          </div>
        ) : (
          insights.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              questionFramed={questionFramed}
              action={renderAction?.(insight)}
            />
          ))
        )}
      </div>
    </section>
  );
}

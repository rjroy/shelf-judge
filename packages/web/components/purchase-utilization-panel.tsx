import Link from "next/link";
import type {
  FieldObservationSource,
  PurchaseUtilizationReason,
  PurchaseUtilizationResult,
  UtilizationComponent,
} from "@shelf-judge/shared";
import { formatStoredAmount } from "@shelf-judge/shared";

const REASON_LABELS: Record<PurchaseUtilizationReason, string> = {
  "missing-acquisition": "Enter whether this game was a gift or purchase.",
  "invalid-acquisition": "Correct the saved acquisition data.",
  "no-owner-cost": "There is no owner cost to evaluate.",
  "missing-benchmark": "Set an entertainment benchmark.",
  "invalid-benchmark": "Correct the entertainment benchmark.",
  "missing-play-count": "Recorded play count is unavailable.",
  "invalid-play-count": "Recorded play count is invalid.",
  "missing-modeled-duration": "Play duration is unavailable.",
  "invalid-modeled-duration": "Play duration is invalid.",
  "missing-modeled-player-count": "A modeled player count is unavailable.",
  "invalid-modeled-player-count": "Modeled player-count data is invalid.",
  "missing-fitness": "Current fitness is unavailable.",
  "invalid-fitness": "Current fitness is invalid.",
  "unreachable-at-current-fitness": "The threshold is unreachable at current fitness.",
};

const SOURCE_LABELS: Record<FieldObservationSource, string> = {
  manual: "Manual",
  "bgg-collection": "BGG collection",
  "bgg-thing": "BGG game data",
  "bgg-suggested-player-poll": "BGG suggested-player poll",
  "bgg-player-range": "BGG player range",
  "current-fitness": "Current fitness",
  "legacy-unknown": "Legacy data",
};

function Reason({ reason }: { reason: PurchaseUtilizationReason }) {
  if (reason === "missing-benchmark" || reason === "invalid-benchmark") {
    return <Link href="/settings#entertainment-benchmark">{REASON_LABELS[reason]}</Link>;
  }
  return <>{REASON_LABELS[reason]}</>;
}

function ComponentRow({ component }: { component: UtilizationComponent<unknown> }) {
  return (
    <div className={`utilization-row utilization-${component.outcome}`}>
      <dt>{component.label}</dt>
      <dd>
        <strong>{component.display}</strong>
        {component.reasons.length > 0 && (
          <span className="utilization-reasons">
            {component.reasons.map((reason, index) => (
              <span key={reason}>
                {index > 0 ? " " : ""}
                <Reason reason={reason} />
              </span>
            ))}
          </span>
        )}
      </dd>
    </div>
  );
}

function evidenceTime(observedAt: string | null): string {
  return observedAt === null ? "time unavailable" : new Date(observedAt).toLocaleString();
}

function EvidenceRow({
  label,
  source,
  observedAt,
  value,
}: {
  label: string;
  source: FieldObservationSource;
  observedAt: string | null;
  value: string;
}) {
  return (
    <li>
      <strong>{label}:</strong> {value}{" "}
      <span>
        {SOURCE_LABELS[source]}, {evidenceTime(observedAt)}
      </span>
    </li>
  );
}

export function PurchaseUtilizationPanel({
  result,
  isPreviouslyOwned = false,
}: {
  result: PurchaseUtilizationResult;
  isPreviouslyOwned?: boolean;
}) {
  const { evidence, components } = result;
  const evidenceRows: Array<{
    label: string;
    source: FieldObservationSource;
    observedAt: string | null;
    value: string;
  }> = [];

  if (evidence.acquisition.state === "purchase") {
    evidenceRows.push({
      label: "Lifetime landed cost",
      source: evidence.acquisition.amount.source,
      observedAt: evidence.acquisition.amount.confirmedAt,
      value: formatStoredAmount(evidence.acquisition.amount.hundredths),
    });
  }
  if (evidence.entertainmentBenchmark?.state === "configured") {
    evidenceRows.push({
      label: "Entertainment benchmark",
      source: evidence.entertainmentBenchmark.amount.source,
      observedAt: evidence.entertainmentBenchmark.amount.confirmedAt,
      value: formatStoredAmount(evidence.entertainmentBenchmark.amount.hundredths),
    });
  }
  if (evidence.playCount.status === "valid") {
    evidenceRows.push({
      label: "Recorded plays",
      source: evidence.playCount.source,
      observedAt: evidence.playCount.observedAt,
      value: String(evidence.playCount.value),
    });
  }
  if (evidence.duration.status === "valid") {
    evidenceRows.push({
      label: "Modeled duration",
      source: evidence.duration.source,
      observedAt: evidence.duration.observedAt,
      value: `${evidence.duration.value} minutes`,
    });
  }
  if (components.modeledPlayerCount.outcome === "calculated") {
    const modeledCount = components.modeledPlayerCount.value;
    const resolution =
      modeledCount.resolution === "poll-tie-average"
        ? `; tied Best-vote counts at ${modeledCount.winningPlayerCounts.join(" and ")} players were averaged`
        : modeledCount.resolution === "poll-winner"
          ? `; poll winner with ${modeledCount.winningBestVotes} Best votes`
          : "; midpoint of the published player range";
    evidenceRows.push({
      label: "Modeled player count",
      source: components.modeledPlayerCount.value.source,
      observedAt: components.modeledPlayerCount.value.observedAt,
      value: `${components.modeledPlayerCount.display}${resolution}`,
    });
  }
  if (evidence.fitness.status === "valid") {
    evidenceRows.push({
      label: "Current fitness",
      source: evidence.fitness.source,
      observedAt: evidence.fitness.observedAt,
      value: evidence.fitness.value,
    });
  }
  const isPaidPurchase =
    evidence.acquisition.state === "purchase" && evidence.acquisition.amount.hundredths > 0;
  const isZeroPlay = evidence.playCount.status === "valid" && evidence.playCount.value === 0;
  const isFitnessZero = evidence.fitness.status === "valid" && evidence.fitness.value === "0.0";

  return (
    <section className={`purchase-utilization-panel outcome-${result.outcome}`}>
      <header className="utilization-outcome">
        <span className="utilization-kicker">Purchase utilization</span>
        <h2>{result.outcomeLabel}</h2>
        {result.reasons.length > 0 && (
          <p>
            {result.reasons.map((reason, index) => (
              <span key={reason}>
                {index > 0 ? " " : ""}
                <Reason reason={reason} />
              </span>
            ))}
          </p>
        )}
      </header>

      <dl className="utilization-primary-values">
        <ComponentRow component={components.valueMultiplier} />
        <ComponentRow component={components.valueRemaining} />
        <ComponentRow component={components.estimatedAdditionalPlays} />
      </dl>
      <p className="utilization-special-explanation">
        Value remaining is the purchase cost not yet justified by modeled entertainment use; it is
        not cash value. Estimated additional plays assumes the shown inputs remain unchanged and
        rounds up to a whole play.
      </p>
      {isPaidPurchase && isFitnessZero && (
        <p className="utilization-special-explanation">
          Current fitness is 0. The $0.00 adjusted benchmark, 0.00x multiplier, and full value
          remaining do not need a collection entertainment benchmark or modeled-use inputs.
        </p>
      )}
      {isPaidPurchase && isZeroPlay && !isFitnessZero && (
        <p className="utilization-special-explanation">
          Recorded plays are exactly zero. The 0.00x multiplier and full value remaining do not need
          fitness, duration, player count, or an entertainment benchmark. Additional inputs may
          still support the hourly benchmark and future-play estimate shown below.
        </p>
      )}
      <dl className="utilization-supporting-values">
        <ComponentRow component={components.costPerRecordedPlay} />
        <ComponentRow component={components.modeledPlayerHours} />
        <ComponentRow component={components.costPerModeledPlayerHour} />
        <ComponentRow component={components.fitnessAdjustedHourlyBenchmark} />
        <ComponentRow component={components.modeledPlayerCount} />
      </dl>

      {evidenceRows.length > 0 && (
        <details className="utilization-evidence">
          <summary>Inputs and evidence</summary>
          <ul>
            {evidenceRows.map((row) => (
              <EvidenceRow key={row.label} {...row} />
            ))}
          </ul>
        </details>
      )}
      <div className="utilization-assumptions">
        <p>{result.assumptions.modeledSessions}</p>
        <p>{result.assumptions.futurePlays}</p>
        <p>{result.assumptions.fitnessAdjustment}</p>
        {isPreviouslyOwned && (
          <p>
            This previously owned game uses its historical cost and plays with your current fitness
            and current entertainment benchmark. This is not a historical-value estimate.
          </p>
        )}
      </div>
    </section>
  );
}

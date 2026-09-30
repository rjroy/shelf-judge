import type { RedundancySimilarityInfo } from "@shelf-judge/shared";

const labels: Record<RedundancySimilarityInfo["status"], string> = {
  disabled: "Redundancy off",
  factual: "Factual-only similarity",
  "not-ready": "Semantic similarity not ready; factual-only comparison",
  stale: "Similarity data stale; factual-only comparison",
  ready: "Semantic similarity ready",
};

export function RedundancyStatus({
  info,
  noNeighbor = false,
}: {
  info: RedundancySimilarityInfo;
  noNeighbor?: boolean;
}) {
  return (
    <div className="redundancy-status" role="status">
      <span>{labels[info.status]}</span>
      {noNeighbor && <span> · No qualifying neighbor for this game.</span>}
    </div>
  );
}

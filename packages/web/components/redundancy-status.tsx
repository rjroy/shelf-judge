import type { RedundancySimilarityInfo } from "@shelf-judge/shared";

const labels: Record<RedundancySimilarityInfo["status"], string> = {
  disabled: "Redundancy off",
  factual: "Factual-only similarity",
  "not-ready": "Semantic similarity is not ready",
  stale: "Similarity data stale; factual-only comparison",
  partial: "Partial semantic coverage; available results are used",
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

import Link from "next/link";
import type { CollectionOutlier } from "@shelf-judge/shared";

export function Outliers({ outliers }: { outliers: CollectionOutlier[] }) {
  const reported = outliers.filter((outlier) => outlier.status === "reported");
  if (reported.length === 0) return null;

  return (
    <div className="section-card">
      <div className="section-header">
        <span className="section-title-main">Collection Outliers</span>
        <span className="section-count">
          {reported.length} {reported.length === 1 ? "game" : "games"} &middot; factual neighborhood
        </span>
      </div>
      <div className="section-body">
        {reported.map((outlier) => (
          <div key={outlier.details.gameId} className="outlier-row">
            <div className="outlier-info">
              <div className="outlier-name">
                <Link href={`/games/${outlier.details.gameId}`} className="game-link">
                  {outlier.details.gameName}
                </Link>
              </div>
              <div className="outlier-reason">
                Neighborhood distance <span>{outlier.details.neighborhoodDistance.toFixed(2)}</span>
              </div>
              <div className="outlier-distance">
                {outlier.details.drivers.map((driver) => (
                  <span key={driver.dimension} className="dist-component high">
                    {driver.label}: {driver.distance.toFixed(2)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

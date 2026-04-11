import type { Metadata } from "next";
import Link from "next/link";
import { getProfile } from "@/lib/api";
import { NarrationEmpty } from "@/components/profile/narration-empty";
import { AxisDistributions } from "@/components/profile/axis-distributions";
import { AxisWeights } from "@/components/profile/axis-weights";
import { BggClustering } from "@/components/profile/bgg-clustering";
import { UtilityCurves } from "@/components/profile/utility-curves";
import { Divergence } from "@/components/profile/divergence";
import { Outliers } from "@/components/profile/outliers";
import { Suggestions } from "@/components/profile/suggestions";

export const metadata: Metadata = { title: "Shelf Judge" };
export const dynamic = "force-dynamic";

export default async function ProfileOverviewPage() {
  let profile;
  try {
    profile = await getProfile();
  } catch {
    return (
      <>
        <div className="topbar">
          <div className="topbar-title">Collection Profile</div>
        </div>
        <div className="main-scroll">
          <div className="empty-state">
            <h3>No profile available</h3>
            <p>
              Add games to your collection and rate them to generate a profile of your preferences.
            </p>
            <div className="empty-state-actions">
              <Link href="/collection" className="btn btn-secondary">
                View Collection
              </Link>
              <Link href="/search" className="btn btn-primary">
                Add Game
              </Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  // Exclude predicted-only scores from actual averages
  // (profile data comes from the daemon which already handles this, but defensive)

  const computedDate = new Date(profile.computedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Collection Profile</div>
        <div className="topbar-meta">
          <span>Computed {computedDate}</span>
          <span>
            {" "}
            &middot; {profile.gameCount} {profile.gameCount === 1 ? "game" : "games"} &middot;{" "}
            {profile.axisDistributions.length}{" "}
            {profile.axisDistributions.length === 1 ? "axis" : "axes"}
          </span>
        </div>
      </div>

      <div className="main-scroll">
        <NarrationEmpty />
        <AxisDistributions
          distributions={profile.axisDistributions}
          gameCount={profile.gameCount}
        />
        <AxisWeights weights={profile.axisWeights} />
        <BggClustering clustering={profile.bggClustering} gameCount={profile.gameCount} />
        <UtilityCurves curves={profile.utilityCurves} />
        {profile.divergence !== null && <Divergence games={profile.divergence} />}
        {profile.outliers.length > 0 && <Outliers outliers={profile.outliers} />}
        {profile.suggestions.length > 0 && <Suggestions suggestions={profile.suggestions} />}
      </div>
    </>
  );
}

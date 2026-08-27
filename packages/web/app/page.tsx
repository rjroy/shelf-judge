import type { Metadata } from "next";
import Link from "next/link";
import type { CollectionProfile } from "@shelf-judge/shared";
import { getProfile } from "@/lib/api";
import { NarrationSection } from "@/components/profile/narration-section";
import { AxisDistributions } from "@/components/profile/axis-distributions";
import { AxisWeights } from "@/components/profile/axis-weights";
import { BggClustering } from "@/components/profile/bgg-clustering";
import { UtilityCurves } from "@/components/profile/utility-curves";
import { Divergence } from "@/components/profile/divergence";
import { Outliers } from "@/components/profile/outliers";
import { Suggestions } from "@/components/profile/suggestions";

export const metadata: Metadata = { title: "Shelf Judge" };
export const dynamic = "force-dynamic";

export type ProfileOverviewState =
  | { status: "loaded"; profile: CollectionProfile }
  | { status: "unavailable" };

export async function loadProfileOverview(
  loadProfile: () => Promise<CollectionProfile> = getProfile,
): Promise<ProfileOverviewState> {
  try {
    return { status: "loaded", profile: await loadProfile() };
  } catch {
    return { status: "unavailable" };
  }
}

export default async function ProfileOverviewPage() {
  return <ProfileOverviewContent state={await loadProfileOverview()} />;
}

export function ProfileOverviewContent({ state }: { state: ProfileOverviewState }) {
  if (state.status === "unavailable") {
    return (
      <>
        <div className="topbar">
          <h1 className="topbar-title">Collection Profile</h1>
        </div>
        <div className="main-scroll">
          <div className="empty-state" data-profile-state="unavailable">
            <h2>Profile analysis unavailable</h2>
            <p>The collection profile could not be loaded or validated. Try again later.</p>
          </div>
        </div>
      </>
    );
  }

  const { profile } = state;
  if (profile.gameCount === 0) {
    return (
      <>
        <div className="topbar">
          <h1 className="topbar-title">Collection Profile</h1>
        </div>
        <div className="main-scroll">
          <div className="empty-state" data-profile-state="empty">
            <h2>No profile available</h2>
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
        <h1 className="topbar-title">Collection Profile</h1>
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
        <NarrationSection profile={profile} />
        <AxisDistributions
          distributions={profile.axisDistributions}
          gameCount={profile.gameCount}
        />
        <AxisWeights weights={profile.axisWeights} />
        <BggClustering clustering={profile.bggClustering} gameCount={profile.gameCount} />
        <UtilityCurves curves={profile.utilityCurves} />
        <ProfileInsightOverview profile={profile} />
      </div>
    </>
  );
}

export function ProfileInsightOverview({ profile }: { profile: CollectionProfile }) {
  return (
    <div data-profile-insight-surface="overview">
      <Divergence games={profile.divergence} />
      <Outliers outliers={profile.outliers} />
      <Suggestions suggestions={profile.suggestions} />
    </div>
  );
}

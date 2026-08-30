import type { Metadata } from "next";
import type { CollectionProfileResult } from "@shelf-judge/shared";
import { getProfile } from "@/lib/api";
import { IdentitySection } from "@/components/profile/identity-section";
import { AttentionSection } from "@/components/profile/attention-section";
import { ProfileRetry } from "@/components/profile/profile-unavailable";

export const metadata: Metadata = { title: "Shelf Judge" };
export const dynamic = "force-dynamic";

export type ProfileOverviewState =
  | { status: "loaded"; profile: CollectionProfileResult }
  | { status: "unavailable"; message: string };

export async function loadProfileOverview(
  loadProfile: () => Promise<CollectionProfileResult> = getProfile,
): Promise<ProfileOverviewState> {
  try {
    return { status: "loaded", profile: await loadProfile() };
  } catch (error) {
    return {
      status: "unavailable",
      message: error instanceof Error ? error.message : "The profile request failed.",
    };
  }
}

export default async function ProfileOverviewPage() {
  return <ProfileOverviewContent state={await loadProfileOverview()} />;
}

export function ProfileOverviewContent({ state }: { state: ProfileOverviewState }) {
  const unavailable =
    state.status === "unavailable"
      ? state.message
      : state.profile.status === "unavailable"
        ? state.profile.error.message
        : null;

  return (
    <>
      <div className="topbar">
        <h1 className="topbar-title">Collection Profile</h1>
      </div>
      <main className="main-scroll profile-page">
        {unavailable !== null ? (
          <>
            <section className="profile-question" aria-labelledby="identity-question">
              <h2 id="identity-question">What does my collection reveal about me?</h2>
              <div className="profile-unavailable" data-profile-state="unavailable">
                <p className="profile-status-label">Identity unavailable</p>
                <p>The collection identity could not be loaded or validated.</p>
              </div>
            </section>
            <section className="profile-question" aria-labelledby="attention-question">
              <h2 id="attention-question">What deserves my attention or a decision now?</h2>
              <ProfileRetry message={unavailable} />
            </section>
          </>
        ) : state.status === "loaded" && state.profile.status === "available" ? (
          <>
            <IdentitySection
              identity={state.profile.identity}
              entityPolicy={state.profile.entityPolicy}
            />
            <AttentionSection
              attention={state.profile.attention}
              collectionState={state.profile.identity.collectionState}
            />
          </>
        ) : null}
      </main>
    </>
  );
}

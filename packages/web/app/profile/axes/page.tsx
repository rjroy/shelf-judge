import type { Metadata } from "next";
import Link from "next/link";
import type { CollectionProfile } from "@shelf-judge/shared";
import { getProfile } from "@/lib/api";
import { CollectionProfileAxisDistributions } from "@/components/profile/axis-distributions";
import { ProfileRetry } from "@/components/profile/profile-unavailable";

export const metadata: Metadata = { title: "Axis Diagnostics" };
export const dynamic = "force-dynamic";

export function AxisDiagnosticsContent({ identity }: { identity: CollectionProfile["identity"] }) {
  return (
    <>
      <div className="topbar">
        <h1 className="topbar-title">Axis Diagnostics</h1>
      </div>
      <main className="main-scroll profile-page profile-drilldown">
        <nav aria-label="Profile navigation">
          <Link href="/">Back to collection identity</Link>
        </nav>
        <p>
          These distributions help verify configured-axis coverage, range, clustering, and effective
          values. They are diagnostics beneath collection identity, not identity claims or attention
          items.
        </p>
        <CollectionProfileAxisDistributions distributions={identity.axisDistributions} />
      </main>
    </>
  );
}

export default async function AxisDiagnosticsPage() {
  try {
    const profile = await getProfile();
    if (profile.status === "unavailable") {
      return (
        <>
          <div className="topbar">
            <h1 className="topbar-title">Axis Diagnostics</h1>
          </div>
          <main className="main-scroll profile-page">
            <ProfileRetry message={profile.error.message} />
          </main>
        </>
      );
    }
    return <AxisDiagnosticsContent identity={profile.identity} />;
  } catch (error) {
    return (
      <>
        <div className="topbar">
          <h1 className="topbar-title">Axis Diagnostics</h1>
        </div>
        <main className="main-scroll profile-page">
          <ProfileRetry
            message={error instanceof Error ? error.message : "The profile request failed."}
          />
        </main>
      </>
    );
  }
}

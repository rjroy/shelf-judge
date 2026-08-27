import { EntertainmentBenchmarkForm } from "@/components/entertainment-benchmark-form";
import { getEntertainmentBenchmark } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  try {
    const { entertainmentBenchmark } = await getEntertainmentBenchmark();
    return (
      <>
        <div className="topbar">
          <div className="topbar-title">Settings</div>
        </div>
        <div className="main-scroll">
          <main className="settings-content">
            <EntertainmentBenchmarkForm benchmark={entertainmentBenchmark} />
          </main>
        </div>
      </>
    );
  } catch (error) {
    return (
      <div className="error-banner">
        {error instanceof Error ? error.message : "Could not load settings."}
      </div>
    );
  }
}

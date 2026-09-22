import { EntertainmentBenchmarkForm } from "@/components/entertainment-benchmark-form";
import { getEntertainmentBenchmark } from "@/lib/api";
import { getProfileAttentionCardLimit } from "@/lib/api";
import { AttentionLimitControl } from "@/components/attention-limit-control";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  try {
    const [{ entertainmentBenchmark }, attentionLimit] = await Promise.all([
      getEntertainmentBenchmark(),
      getProfileAttentionCardLimit(),
    ]);
    return (
      <>
        <div className="topbar">
          <div className="topbar-title">Settings</div>
        </div>
        <div className="main-scroll">
          <main className="settings-content">
            <EntertainmentBenchmarkForm benchmark={entertainmentBenchmark} />
            <AttentionLimitControl initialLimit={attentionLimit} />
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

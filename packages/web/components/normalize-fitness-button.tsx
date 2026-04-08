"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NormalizeFitnessButton() {
  const router = useRouter();
  const [normalizing, setNormalizing] = useState(false);
  const [result, setResult] = useState<{ message: string; isError: boolean } | null>(null);

  async function handleNormalize() {
    if (!confirm("Normalize fitness for all games in your collection?")) return;

    setNormalizing(true);
    setResult(null);
    try {
      const res = await fetch("/api/daemon/tournament/normalize-fitness", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
          error?: string;
        };
        throw new Error(data.error ?? `Failed: ${res.status}`);
      }
      const data = (await res.json()) as { normalized: number; errors?: string[] };
      const message = `Normalized fitness for ${data.normalized} game(s)${data.errors?.length ? `, ${data.errors.length} error(s)` : ""}`;
      setResult({ message, isError: false });
      router.refresh();
    } catch (err) {
      setResult({
        message: err instanceof Error ? err.message : "Failed to normalize fitness",
        isError: true,
      });
    } finally {
      setNormalizing(false);
    }
  }

  return (
    <div className="normalize-fitness-wrapper">
      <button
        className="btn btn-secondary"
        onClick={() => {
          void handleNormalize();
        }}
        disabled={normalizing}
      >
        {normalizing ? "Normalizing..." : "Normalize Fitness"}
      </button>
      {result && (
        <span className={`normalize-fitness-result ${result.isError ? "error" : "success"}`}>
          {result.message}
        </span>
      )}
    </div>
  );
}

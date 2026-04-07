"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function CollectionSortToggle({ hasTournamentData }: { hasTournamentData: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sortBy = searchParams.get("sort") ?? "fitness";

  if (!hasTournamentData) return null;

  function handleToggle(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "fitness") {
      params.delete("sort");
    } else {
      params.set("sort", value);
    }
    router.push(`/?${params.toString()}`);
  }

  return (
    <div className="sort-toggle">
      <button
        className={`sort-toggle-btn${sortBy === "fitness" ? " active" : ""}`}
        onClick={() => handleToggle("fitness")}
      >
        Fitness
      </button>
      <button
        className={`sort-toggle-btn${sortBy === "tournament" ? " active" : ""}`}
        onClick={() => handleToggle("tournament")}
      >
        Tournament
      </button>
    </div>
  );
}

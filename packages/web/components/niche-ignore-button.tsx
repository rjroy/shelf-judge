"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NicheIgnoreButton({
  type,
  name,
}: {
  type: "mechanic" | "category" | "family";
  name: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleIgnore() {
    setBusy(true);
    try {
      const res = await fetch("/api/daemon/niches/settings/ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, name }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
          error?: string;
        };
        console.error("Failed to ignore niche tag:", data.error);
        return;
      }
      router.refresh();
    } catch (err) {
      console.error("Failed to ignore niche tag:", err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className="niche-ignore-btn"
      onClick={handleIgnore}
      disabled={busy}
      title={`Hide "${name}" niche`}
      aria-label={`Hide ${name} niche`}
    >
      {busy ? "..." : "\u00D7"}
    </button>
  );
}

export function NicheRestoreButton({
  type,
  name,
}: {
  type: "mechanic" | "category" | "family";
  name: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleRestore() {
    setBusy(true);
    try {
      const res = await fetch("/api/daemon/niches/settings/ignore", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, name }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
          error?: string;
        };
        console.error("Failed to restore niche tag:", data.error);
        return;
      }
      router.refresh();
    } catch (err) {
      console.error("Failed to restore niche tag:", err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className="niche-restore-btn"
      onClick={handleRestore}
      disabled={busy}
      title={`Restore "${name}" niche`}
      aria-label={`Restore ${name} niche`}
    >
      {busy ? "..." : "Restore"}
    </button>
  );
}

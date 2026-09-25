// Wishlist commands: list, add, remove, clear, refresh
import type { RedundancyAdjustment, WishlistEntry } from "@shelf-judge/shared";
import type { DaemonClient } from "../client.js";
import type { OutputOptions } from "../output.js";
import { formatTable, formatScore, printOutput } from "../output.js";

// Keep this boundary tolerant while older daemons omit the optional preview.
type WishlistEntryWithPreview = WishlistEntry & {
  redundancyPreview?: RedundancyAdjustment | null;
};

export async function wishlistList(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const { ok, data } = await client.get<WishlistEntryWithPreview[]>("/api/wishlist");

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to load wishlist");
  }

  if (opts.json) return printOutput(data, opts);

  if (data.length === 0) {
    return "Wishlist is empty.";
  }

  return formatTable(
    ["Name", "Year", "Score", "Confidence", "Redundancy", "Added"],
    data.map((e) => [
      e.name,
      e.yearPublished != null ? String(e.yearPublished) : "---",
      formatScore(e.predictedScore),
      e.predictionConfidence ?? "---",
      formatWishlistRedundancy(e.redundancyPreview),
      new Date(e.addedAt).toLocaleDateString(),
    ]),
  );
}

export async function wishlistAdd(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const bggIdStr = args[0];
  if (!bggIdStr) {
    throw new Error("Usage: shelf-judge wishlist add <bgg-id>");
  }

  const bggId = Number(bggIdStr);
  if (!Number.isFinite(bggId) || bggId <= 0) {
    throw new Error(`Invalid BGG ID: "${bggIdStr}"`);
  }

  const { ok, data } = await client.post<{ entry: WishlistEntryWithPreview }>("/api/wishlist", {
    bggId,
  });

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to add to wishlist");
  }

  if (opts.json) return printOutput(data.entry, opts);

  const score =
    data.entry.predictedScore != null
      ? `predicted: ${data.entry.predictedScore.toFixed(1)}`
      : "no prediction";

  const preview = formatWishlistRedundancyDetail(data.entry.redundancyPreview);
  return [`Added ${data.entry.name} (${score})`, preview].filter(Boolean).join("\n");
}

export async function wishlistRemove(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const id = args[0];
  if (!id) {
    throw new Error("Usage: shelf-judge wishlist remove <id>");
  }

  const { ok, data } = await client.del<{ removed: boolean }>(`/api/wishlist/${id}`);

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to remove from wishlist");
  }

  if (opts.json) return printOutput(data, opts);

  return "Removed.";
}

export async function wishlistClear(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  // Fetch current count for confirmation message
  const listRes = await client.get<WishlistEntry[]>("/api/wishlist");
  if (!listRes.ok) {
    const err = listRes.data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to load wishlist");
  }

  if (listRes.data.length === 0) {
    return "Wishlist is already empty.";
  }

  // Confirmation prompt
  const count = listRes.data.length;
  process.stdout.write(`Remove all ${count} wishlisted game${count === 1 ? "" : "s"}? (y/N) `);
  const confirmed = await readLine();
  if (confirmed.trim().toLowerCase() !== "y") {
    return "Cancelled.";
  }

  const { ok, data } = await client.del<{ removed: number }>("/api/wishlist");

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to clear wishlist");
  }

  if (opts.json) return printOutput(data, opts);

  return `Removed ${data.removed} ${data.removed === 1 ? "entry" : "entries"}.`;
}

export async function wishlistRefresh(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  const id = args[0];

  if (id) {
    // Refresh single entry
    const { ok, data } = await client.post<{ entry: WishlistEntryWithPreview }>(
      `/api/wishlist/${id}/refresh`,
    );

    if (!ok) {
      const err = data as unknown as { error: string };
      throw new Error(err.error ?? "Failed to refresh wishlist entry");
    }

    if (opts.json) return printOutput(data.entry, opts);

    const score =
      data.entry.predictedScore != null ? data.entry.predictedScore.toFixed(1) : "no prediction";

    const preview = formatWishlistRedundancyDetail(data.entry.redundancyPreview);
    return [`Refreshed ${data.entry.name}: ${score}`, preview].filter(Boolean).join("\n");
  }

  // Refresh all
  const { ok, data } = await client.post<{ refreshed: number; errors: string[] }>(
    "/api/wishlist/refresh",
  );

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to refresh wishlist");
  }

  if (opts.json) return printOutput(data, opts);

  let msg = `Refreshed ${data.refreshed} ${data.refreshed === 1 ? "entry" : "entries"}`;
  if (data.errors.length > 0) {
    msg += ` (${data.errors.length} ${data.errors.length === 1 ? "error" : "errors"})`;
  }
  return msg;
}

function formatWishlistRedundancy(adj: RedundancyAdjustment | null | undefined): string {
  if (!adj) return "---";
  const neighbors = adj.nicheNeighbors.slice(0, 3).map((neighbor) => neighbor.gameName);
  const similar =
    neighbors.length > 0 ? `; similar: ${neighbors.join(", ")}` : "; no similar games";
  return `${formatScore(adj.adjustedScore)} (-${adj.penalty.toFixed(1)})${similar}`;
}

function formatWishlistRedundancyDetail(adj: RedundancyAdjustment | null | undefined): string {
  if (!adj) return "";
  const lines = [
    `  Adjusted score: ${formatScore(adj.adjustedScore)} (redundancy penalty: -${adj.penalty.toFixed(1)})`,
  ];
  const neighbors = adj.nicheNeighbors.slice(0, 3);
  lines.push(
    neighbors.length > 0
      ? `  Top similar collection games: ${neighbors.map((neighbor) => neighbor.gameName).join(", ")}`
      : "  No similar collection games.",
  );
  return lines.join("\n");
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode?.(false);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.once("data", (data: string) => {
      stdin.pause();
      resolve(data);
    });
  });
}

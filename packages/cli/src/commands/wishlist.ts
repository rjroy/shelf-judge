// Wishlist commands: list, add, remove, clear, refresh
import type { WishlistEntry } from "@shelf-judge/shared";
import type { WishlistEntryReadResultV2 } from "../../../shared/src/wishlist-current-projection-v2.js";
import type { DaemonClient } from "../client.js";
import type { OutputOptions } from "../output.js";
import { formatScore, printOutput } from "../output.js";
import { formatWishlistCurrentProjectionList } from "./wishlist-current-projection.js";

export async function wishlistList(
  client: DaemonClient,
  _args: string[],
  opts: OutputOptions,
): Promise<string> {
  const { ok, data } = await client.get<WishlistEntryReadResultV2[]>("/api/wishlist/redundancy");

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to load wishlist redundancy projection");
  }

  return formatWishlistCurrentProjectionList(data, opts);
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

  const { ok, data } = await client.post<{ entry: WishlistEntry }>("/api/wishlist", {
    bggId,
  });

  if (!ok) {
    const err = data as unknown as { error: string };
    throw new Error(err.error ?? "Failed to add to wishlist");
  }

  if (opts.json) return printOutput(data.entry, opts);
  const score = data.entry.predictedScore;
  return `Added ${data.entry.name}.\nCurrent prediction ${score == null ? "unavailable" : `available: ${formatScore(score)}`}.`;
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
    const { ok, data } = await client.post<{ entry: WishlistEntry }>(`/api/wishlist/${id}/refresh`);

    if (!ok) {
      const err = data as unknown as { error: string };
      throw new Error(err.error ?? "Failed to refresh wishlist entry");
    }

    if (opts.json) return printOutput(data.entry, opts);
    const score = data.entry.predictedScore;
    return `Refreshed ${data.entry.name}.\nCurrent prediction ${score == null ? "unavailable" : `available: ${formatScore(score)}`}.`;
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

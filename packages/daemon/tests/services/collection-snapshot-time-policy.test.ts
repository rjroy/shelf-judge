import { describe, expect, test } from "bun:test";
import { createCollectionSnapshotTimePolicy } from "../../src/services/collection-snapshot-time-policy.js";

const fetchedAt = Date.UTC(2026, 0, 1);
const firstStaleMs = fetchedAt + 7 * 24 * 60 * 60 * 1000 + 1;

describe("collection snapshot time policy", () => {
  test("schedules the first stale millisecond and expires exactly at that boundary without writes", () => {
    let now = firstStaleMs - 1;
    const writes = 0;
    const policy = createCollectionSnapshotTimePolicy({ now: () => now });
    const games = [{ bggData: { fetchedAt: new Date(fetchedAt).toISOString() } }];

    expect(policy.nextBggDataStaleTransition(games)).toBe(firstStaleMs);
    expect(writes).toBe(0);

    now = firstStaleMs;
    expect(policy.nextBggDataStaleTransition(games)).toBeNull();
    expect(writes).toBe(0);
  });

  test("ignores missing and malformed fetch times", () => {
    const policy = createCollectionSnapshotTimePolicy({ now: () => fetchedAt });
    expect(
      policy.nextBggDataStaleTransition([
        { bggData: null },
        { bggData: { fetchedAt: "not-a-time" } },
      ]),
    ).toBeNull();
  });

  test("recomputes from a backward-moving clock instead of keeping a monotonic deadline", () => {
    let now = firstStaleMs;
    const policy = createCollectionSnapshotTimePolicy({ now: () => now });
    const games = [{ bggData: { fetchedAt: new Date(fetchedAt).toISOString() } }];

    expect(policy.nextBggDataStaleTransition(games)).toBeNull();
    now = fetchedAt;
    expect(policy.nextBggDataStaleTransition(games)).toBe(firstStaleMs);
  });
});

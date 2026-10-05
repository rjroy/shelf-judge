import { describe, expect, test } from "bun:test";
import {
  loadWishlistSortField,
  saveWishlistSortField,
  SORT_OPTIONS,
  validateWishlistRunBudget,
} from "@/app/wishlist/page";

describe("wishlist redundancy sorting", () => {
  test("offers the current With Redundancy sort option", () => {
    expect(SORT_OPTIONS).toContainEqual({ value: "redundancy", label: "With Redundancy" });
  });
});

describe("wishlist sort preference", () => {
  const storageKey = "shelf-judge:wishlist-sort";

  test("loads and saves a valid sort field using the wishlist-specific key", () => {
    const values = new Map<string, string>([[storageKey, "name"]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(loadWishlistSortField(storage)).toBe("name");
    saveWishlistSortField(storage, "redundancy");
    expect(values.get(storageKey)).toBe("redundancy");
  });

  test("defaults when the preference is missing, obsolete, or corrupt", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null };

    expect(loadWishlistSortField(storage)).toBe("addedAt");
    values.set(storageKey, "old-sort-mode");
    expect(loadWishlistSortField(storage)).toBe("addedAt");
    values.set(storageKey, "{broken-json");
    expect(loadWishlistSortField(storage)).toBe("addedAt");
    expect(loadWishlistSortField(null)).toBe("addedAt");
  });

  test("ignores storage methods that are unavailable or throw", () => {
    expect(
      loadWishlistSortField({
        getItem: () => {
          throw new Error("storage blocked");
        },
      }),
    ).toBe("addedAt");
    expect(() =>
      saveWishlistSortField(
        {
          setItem: () => {
            throw new Error("storage blocked");
          },
        },
        "name",
      ),
    ).not.toThrow();
    expect(() => saveWishlistSortField(null, "name")).not.toThrow();
  });
});

describe("wishlist run budget validation", () => {
  test("converts valid per-run values and enforces whole-number limits", () => {
    expect(validateWishlistRunBudget("1000", "2000000", "30")).toEqual({
      budget: {
        maxProviderAttempts: 1000,
        reportedTokenStopThreshold: 2_000_000,
        maxRunDurationMs: 1_800_000,
      },
      error: null,
    });
    expect(validateWishlistRunBudget("75001", "2000000", "30").error).toContain(
      "cannot exceed 75,000",
    );
    expect(validateWishlistRunBudget("10", "0", "30").error).toContain("positive, safe");
    expect(validateWishlistRunBudget("10", "1000", "721").error).toContain("12 hours");
  });
});

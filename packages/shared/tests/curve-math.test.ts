import { describe, expect, test } from "bun:test";
import { getNativeScale } from "../src/curve-math";

describe("getNativeScale", () => {
  test("personal source returns 1-10 scale", () => {
    expect(getNativeScale("personal", null)).toEqual({ min: 1, max: 10 });
  });

  test("tournament source returns 1-10 scale", () => {
    expect(getNativeScale("tournament", null)).toEqual({ min: 1, max: 10 });
  });

  test("bgg communityRating returns 1-10 scale", () => {
    expect(getNativeScale("bgg", "communityRating")).toEqual({ min: 1, max: 10 });
  });

  test("bgg weight returns 1-5 scale", () => {
    expect(getNativeScale("bgg", "weight")).toEqual({ min: 1, max: 5 });
  });

  test("bgg with unknown field throws", () => {
    expect(() => getNativeScale("bgg", "nonsense")).toThrow();
  });
});

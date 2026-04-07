import { test, expect } from "bun:test";
import { matchesBggTag, normalizeBggTagTokens } from "../src/bgg-tag-match.js";

test("matches multi-token query against punctuated tag", () => {
  expect(matchesBggTag("deck building", ["Deck, Bag, and Pool Building"])).toBe(true);
});

test("case-insensitive single token", () => {
  expect(matchesBggTag("WORKER", ["Worker Placement"])).toBe(true);
});

test("ignores extra whitespace and punctuation in query", () => {
  expect(matchesBggTag("  deck,  building  ", ["Deck, Bag, and Pool Building"])).toBe(true);
});

test("matches when one of several tags satisfies the query", () => {
  expect(
    matchesBggTag("deck building", ["Worker Placement", "Deck, Bag, and Pool Building", "Dice"]),
  ).toBe(true);
});

test("typo does not match (substring direction matters)", () => {
  expect(matchesBggTag("decks building", ["Deck, Bag, and Pool Building"])).toBe(false);
});

test("query token longer than tag token does not match", () => {
  expect(matchesBggTag("building", ["Build"])).toBe(false);
});

test("tokens cannot be combined across two different tags on the same game", () => {
  expect(matchesBggTag("worker deck", ["Worker Placement", "Deck Building"])).toBe(false);
});

test("empty query matches nothing", () => {
  expect(matchesBggTag("", ["Worker Placement"])).toBe(false);
});

test("whitespace-only query matches nothing", () => {
  expect(matchesBggTag("   ", ["Worker Placement"])).toBe(false);
});

test("punctuation-only query matches nothing", () => {
  expect(matchesBggTag(",,,", ["Worker Placement"])).toBe(false);
});

test("empty tag list returns false", () => {
  expect(matchesBggTag("worker", [])).toBe(false);
});

test("apostrophes and colons in tag names are handled", () => {
  expect(matchesBggTag("cross roads", ["Dead of Winter: A Cross Roads Game"])).toBe(true);
});

test("normalizeBggTagTokens preserves non-ASCII letters", () => {
  expect(normalizeBggTagTokens("Café")).toEqual(["café"]);
});

test("ASCII query 'cafe' does not match accented tag (known limitation)", () => {
  expect(matchesBggTag("cafe", ["Café"])).toBe(false);
});

test("accented query 'café' matches accented tag", () => {
  expect(matchesBggTag("café", ["Café"])).toBe(true);
});

test("normalizeBggTagTokens splits on punctuation", () => {
  expect(normalizeBggTagTokens("Deck, Bag, and Pool Building")).toEqual([
    "deck",
    "bag",
    "and",
    "pool",
    "building",
  ]);
});

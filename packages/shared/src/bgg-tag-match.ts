/**
 * BGG tag fuzzy match helper.
 *
 * See `.lore/specs/bgg-tag-fuzzy-filter.md` (REQ-BGG-TAG-1..5) for the
 * authoritative rules. Summary:
 *  - Normalize by lowercasing, replacing ASCII punctuation with spaces, and
 *    splitting on whitespace.
 *  - A query matches a tag list if any single tag's tokens satisfy: every
 *    query token is a substring of some tag token. Per-tag, one-directional.
 *  - A query that normalizes to zero tokens matches nothing.
 */

// ASCII punctuation only: !"#$%&'()*+,-./:;<=>?@[\]^_`{|}~
// Non-ASCII letters (e.g. "é") are intentionally left intact per REQ-BGG-TAG-2.
const PUNCTUATION_RE = /[!-/:-@[-`{-~]/g;

export function normalizeBggTagTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(PUNCTUATION_RE, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

export function matchesBggTag(query: string, tagNames: readonly string[]): boolean {
  const queryTokens = normalizeBggTagTokens(query);
  if (queryTokens.length === 0) return false;

  for (const tag of tagNames) {
    const tagTokens = normalizeBggTagTokens(tag);
    if (tagTokens.length === 0) continue;
    const allMatched = queryTokens.every((qt) => tagTokens.some((tt) => tt.includes(qt)));
    if (allMatched) return true;
  }
  return false;
}

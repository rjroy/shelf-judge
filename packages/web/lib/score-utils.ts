/** Returns the CSS class suffix for a score's spectrum range. */
export function scoreRangeClass(score: number): string {
  if (score >= 7.5) return "high";
  if (score >= 5.0) return "mid";
  return "low";
}

export const RATING_LABELS: Record<number, string> = {
  1: "Offensive",
  2: "Inexplicable",
  3: "Just Bad",
  4: "Not Good",
  5: "Fine",
  6: "Good",
  7: "Very Good",
  8: "Recommended",
  9: "Definitive",
  10: "Essential",
};

/**
 * Returns the interpretation label for a numeric rating.
 * Rounds to the nearest integer before lookup.
 * Returns null for null input or values outside 1–10 after rounding.
 */
export function getRatingLabel(rating: number | null): string | null {
  if (rating === null) return null;
  const rounded = Math.round(rating);
  return RATING_LABELS[rounded] ?? null;
}

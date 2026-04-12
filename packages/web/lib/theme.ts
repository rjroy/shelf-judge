export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "shelf-judge-theme";
const VALID_THEMES: Theme[] = ["light", "dark", "system"];

export function loadTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && VALID_THEMES.includes(raw as Theme)) {
      return raw as Theme;
    }
  } catch {
    // Storage unavailable
  }
  return "system";
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage full or unavailable
  }
}

export function resolveTheme(
  theme: Theme,
  matchMediaFn: (query: string) => MediaQueryList = window.matchMedia.bind(window),
): ResolvedTheme {
  if (theme === "light") return "light";
  if (theme === "dark") return "dark";
  return matchMediaFn("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

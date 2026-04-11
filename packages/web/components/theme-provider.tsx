"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { loadTheme, saveTheme, resolveTheme } from "@/lib/theme";
import type { Theme, ResolvedTheme } from "@/lib/theme";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  resolvedTheme: "light",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedThemeValue, setResolvedTheme] = useState<ResolvedTheme>("light");

  // Load saved theme after mount (avoids hydration mismatch)
  useEffect(() => {
    const saved = loadTheme();
    setThemeState(saved);
    const resolved = resolveTheme(saved);
    setResolvedTheme(resolved);
    document.documentElement.dataset.theme = resolved;
  }, []);

  // Listen for OS preference changes when theme is "system"
  useEffect(() => {
    if (theme !== "system") return;

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      const resolved: ResolvedTheme = e.matches ? "dark" : "light";
      setResolvedTheme(resolved);
      document.documentElement.dataset.theme = resolved;
    };

    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    saveTheme(t);
    const resolved = resolveTheme(t);
    setResolvedTheme(resolved);
    document.documentElement.dataset.theme = resolved;
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme: resolvedThemeValue, setTheme }),
    [theme, resolvedThemeValue, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

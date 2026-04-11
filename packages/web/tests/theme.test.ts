import { describe, test, expect, beforeEach } from "bun:test";
import { loadTheme, saveTheme, resolveTheme } from "../lib/theme";

// Ensure window exists in test env (loadTheme's SSR guard checks typeof window)
if (typeof globalThis.window === "undefined") {
  // @ts-expect-error -- minimal window stub for SSR guard
  globalThis.window = globalThis;
}

// Stub localStorage for tests
function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
}

function createMockMatchMedia(darkMode: boolean) {
  return (query: string): MediaQueryList =>
    ({
      matches: darkMode && query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

describe("loadTheme", () => {
  let mockStorage: Storage;

  beforeEach(() => {
    mockStorage = createMockStorage();
    Object.defineProperty(globalThis, "localStorage", { value: mockStorage, writable: true });
  });

  test("returns 'system' when localStorage is empty", () => {
    expect(loadTheme()).toBe("system");
  });

  test("returns the stored value when valid", () => {
    mockStorage.setItem("shelf-judge-theme", "dark");
    expect(loadTheme()).toBe("dark");

    mockStorage.setItem("shelf-judge-theme", "light");
    expect(loadTheme()).toBe("light");

    mockStorage.setItem("shelf-judge-theme", "system");
    expect(loadTheme()).toBe("system");
  });

  test("returns 'system' for invalid stored values", () => {
    mockStorage.setItem("shelf-judge-theme", "invalid");
    expect(loadTheme()).toBe("system");

    mockStorage.setItem("shelf-judge-theme", "");
    expect(loadTheme()).toBe("system");
  });
});

describe("saveTheme", () => {
  let mockStorage: Storage;

  beforeEach(() => {
    mockStorage = createMockStorage();
    Object.defineProperty(globalThis, "localStorage", { value: mockStorage, writable: true });
  });

  test("persists to localStorage", () => {
    saveTheme("dark");
    expect(mockStorage.getItem("shelf-judge-theme")).toBe("dark");

    saveTheme("light");
    expect(mockStorage.getItem("shelf-judge-theme")).toBe("light");

    saveTheme("system");
    expect(mockStorage.getItem("shelf-judge-theme")).toBe("system");
  });
});

describe("resolveTheme", () => {
  test("returns 'light' regardless of system preference", () => {
    expect(resolveTheme("light", createMockMatchMedia(true))).toBe("light");
    expect(resolveTheme("light", createMockMatchMedia(false))).toBe("light");
  });

  test("returns 'dark' regardless of system preference", () => {
    expect(resolveTheme("dark", createMockMatchMedia(true))).toBe("dark");
    expect(resolveTheme("dark", createMockMatchMedia(false))).toBe("dark");
  });

  test("returns 'dark' when system prefers dark", () => {
    expect(resolveTheme("system", createMockMatchMedia(true))).toBe("dark");
  });

  test("returns 'light' when system prefers light", () => {
    expect(resolveTheme("system", createMockMatchMedia(false))).toBe("light");
  });
});

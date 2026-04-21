"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";

type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
};

const STORAGE_KEY = "construction-dashboard-theme";
const CHANGE_EVENT = "construction-dashboard-theme-change";
const DEFAULT_THEME: Theme = "dark";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyThemeClass(theme: Theme) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.classList.remove("light", "dark");
  html.classList.add(theme);
  // Drive the native browser color scheme too — affects scrollbars, default form
  // controls, etc., so they don't end up white-on-black or vice versa.
  html.style.colorScheme = theme;
}

// ── External store wiring (React 19 useSyncExternalStore pattern) ─────────

function subscribe(callback: () => void) {
  // Listen for our own change event (same-tab updates) and the standard
  // storage event (cross-tab updates).
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getSnapshot(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // ignore (private mode, etc.)
  }
  return DEFAULT_THEME;
}

function getServerSnapshot(): Theme {
  // SSR / pre-hydration value. The inline bootstrap script in layout.tsx
  // applies the actual class on first paint to avoid a flash.
  return DEFAULT_THEME;
}

// ── Provider ───────────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Sync the <html> class whenever the active theme changes (including the
  // initial hydration). This is a pure DOM side effect — no setState — so it
  // doesn't trigger the set-state-in-effect rule.
  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
    // Apply immediately so the user doesn't wait for the next render tick
    // before seeing the change.
    applyThemeClass(next);
    // Notify the store so all subscribers re-read the snapshot.
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return ctx;
}

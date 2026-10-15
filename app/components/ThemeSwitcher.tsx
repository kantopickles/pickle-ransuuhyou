"use client";

import { useEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { isTheme, resolveTheme, THEME_COLORS, THEME_STORAGE_KEY, type Theme } from "../lib/theme";

export default function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>("light");
  const preference = useRef<Theme | null>(null);

  function applyTheme(next: Theme) {
    document.documentElement.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[next]);
    setTheme(next);
  }

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(THEME_STORAGE_KEY); } catch {}
    preference.current = isTheme(saved) ? saved : null;
    applyTheme(resolveTheme(preference.current, media.matches));

    const onSystemChange = () => {
      if (preference.current === null) applyTheme(resolveTheme(null, media.matches));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      preference.current = isTheme(event.newValue) ? event.newValue : null;
      applyTheme(resolveTheme(preference.current, media.matches));
    };

    media.addEventListener("change", onSystemChange);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function selectTheme(next: Theme) {
    preference.current = next;
    applyTheme(next);
    try { window.localStorage.setItem(THEME_STORAGE_KEY, next); } catch {}
  }

  return (
    <div className="theme-toolbar">
      <div className="theme-switcher" role="group" aria-label="表示モード">
        <button
          type="button"
          aria-label="ライトモード"
          title="ライトモード"
          data-theme-option="light"
          aria-pressed={theme === "light"}
          onClick={() => selectTheme("light")}
        >
          <Sun size={22} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="ダークモード"
          title="ダークモード"
          data-theme-option="dark"
          aria-pressed={theme === "dark"}
          onClick={() => selectTheme("dark")}
        >
          <Moon size={22} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

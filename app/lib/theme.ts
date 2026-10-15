export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "pickleball-theme";
export const THEME_COLORS: Record<Theme, string> = {
  light: "#f7faf8",
  dark: "#121615"
};

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

export function resolveTheme(preference: unknown, prefersDark: boolean): Theme {
  return isTheme(preference) ? preference : prefersDark ? "dark" : "light";
}

// Reactの起動を待たずに配色を決め、ダーク設定で白い画面が一瞬出るのを防ぎます。
// 保存領域が使えないブラウザでも、端末の設定から表示を続けられます。
export const THEME_BOOTSTRAP_SCRIPT = `(() => {
  let preference;
  try { preference = window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}); } catch {}
  const theme = preference === "light" || preference === "dark"
    ? preference
    : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? ${JSON.stringify(THEME_COLORS.dark)} : ${JSON.stringify(THEME_COLORS.light)});
})();`;

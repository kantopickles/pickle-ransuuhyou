import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { isTheme, resolveTheme, THEME_BOOTSTRAP_SCRIPT, THEME_COLORS, THEME_STORAGE_KEY } from "../app/lib/theme.ts";

test("明示したライト・ダーク設定を端末設定より優先する", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(isTheme("light"), true);
  assert.equal(isTheme("dark"), true);
});

test("保存設定がない・不正な場合は端末の配色を使う", () => {
  for (const preference of [null, undefined, "", "system", "unexpected", 1, {}]) {
    assert.equal(isTheme(preference), false);
    assert.equal(resolveTheme(preference, true), "dark");
    assert.equal(resolveTheme(preference, false), "light");
  }
});

function bootstrap(options: { saved?: unknown; prefersDark?: boolean; storageBlocked?: boolean; missingMeta?: boolean }) {
  const dataset: Record<string, string> = {};
  let themeColor = "";
  runInNewContext(THEME_BOOTSTRAP_SCRIPT, {
    window: {
      localStorage: {
        getItem(key: string) {
          assert.equal(key, THEME_STORAGE_KEY);
          if (options.storageBlocked) throw new Error("Storage is blocked");
          return options.saved ?? null;
        }
      },
      matchMedia(query: string) {
        assert.equal(query, "(prefers-color-scheme: dark)");
        return { matches: Boolean(options.prefersDark) };
      }
    },
    document: {
      documentElement: { dataset },
      querySelector(selector: string) {
        assert.equal(selector, 'meta[name="theme-color"]');
        return options.missingMeta ? null : {
          setAttribute(name: string, value: string) {
            assert.equal(name, "content");
            themeColor = value;
          }
        };
      }
    }
  });
  return { theme: dataset.theme, themeColor };
}

test("初期表示前に保存された配色とブラウザの表示色を復元する", () => {
  for (const theme of ["light", "dark"] as const) {
    assert.deepEqual(bootstrap({ saved: theme, prefersDark: theme !== "dark" }), {
      theme,
      themeColor: THEME_COLORS[theme]
    });
  }
});

test("保存領域が使えない場合も初期表示を中断しない", () => {
  assert.deepEqual(bootstrap({ storageBlocked: true, prefersDark: true }), {
    theme: "dark",
    themeColor: THEME_COLORS.dark
  });
  assert.equal(bootstrap({ storageBlocked: true, prefersDark: false }).theme, "light");
});

test("初回は端末設定に従い、不正な保存値やメタタグ欠落も許容する", () => {
  assert.equal(bootstrap({ prefersDark: true }).theme, "dark");
  assert.equal(bootstrap({ prefersDark: false }).theme, "light");
  assert.equal(bootstrap({ saved: "unexpected", prefersDark: true }).theme, "dark");
  assert.equal(bootstrap({ saved: "dark", missingMeta: true }).theme, "dark");
});

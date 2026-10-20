import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { APP_ICONS } from "../app/lib/app-icons.ts";

function pngInfo(path: string) {
  const buffer = readFileSync(new URL(path, import.meta.url));
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), colorType: buffer[25] };
}

test("アプリアイコンは各端末向けの寸法を持つ不透明PNGで用意する", () => {
  for (const [path, size] of [[APP_ICONS.master, 1024], [APP_ICONS.small, 192], [APP_ICONS.large, 512], [APP_ICONS.maskable, 512], [APP_ICONS.apple, 180]] as const) {
    const info = pngInfo(`../public${path}`);
    assert.deepEqual(info, { width: size, height: size, colorType: 2 });
  }
  assert.equal(pngInfo("../app/icon.png").width, 1024);
  assert.equal(pngInfo("../app/apple-icon.png").width, 180);
});

test("マニフェスト・ブラウザ・ログイン画面とPWAキャッシュは同じ新アイコンを参照する", () => {
  for (const file of ["../app/layout.tsx", "../app/manifest.ts", "../app/components/LineAccessGate.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(source.includes("APP_ICONS"));
    assert.ok(!source.includes('"/icon-192x192.png"'));
  }
  const worker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  for (const path of Object.values(APP_ICONS)) assert.ok(worker.includes(path));
  assert.ok(worker.includes("pickleball-pwa-v5"));
});

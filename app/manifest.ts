import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ピックルボール乱数表",
    short_name: "乱数表",
    description: "ピックルボール練習会用の公平なダブルス乱数表作成アプリ",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7faf8",
    theme_color: "#0f766e",
    categories: ["sports", "utilities"],
    icons: [
      {
        src: "/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/maskable-icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}

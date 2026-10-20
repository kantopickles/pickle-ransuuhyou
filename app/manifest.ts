import type { MetadataRoute } from "next";
import { APP_ICONS } from "./lib/app-icons";

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
        src: APP_ICONS.small,
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: APP_ICONS.large,
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: APP_ICONS.maskable,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}

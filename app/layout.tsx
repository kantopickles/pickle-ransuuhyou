import type { Metadata, Viewport } from "next";
import ServiceWorkerRegistration from "./components/ServiceWorkerRegistration";
import ThemeSwitcher from "./components/ThemeSwitcher";
import { THEME_BOOTSTRAP_SCRIPT, THEME_COLORS } from "./lib/theme";
import { APP_ICONS } from "./lib/app-icons";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "ピックルボール乱数表",
  title: "ピックルボール乱数表",
  description: "ピックルボール練習会用の公平なダブルス乱数表作成アプリ",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ピックル乱数表"
  },
  formatDetection: {
    telephone: false
  },
  icons: {
    icon: [
      { url: APP_ICONS.master, sizes: "1024x1024", type: "image/png" },
      { url: APP_ICONS.small, sizes: "192x192", type: "image/png" },
      { url: APP_ICONS.large, sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: APP_ICONS.apple, sizes: "180x180", type: "image/png" }],
    shortcut: APP_ICONS.master
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: THEME_COLORS.light,
  colorScheme: "light dark"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <ThemeSwitcher />
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}

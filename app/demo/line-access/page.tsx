import type { Metadata } from "next";
import LineAccessDemo from "./LineAccessDemo";

export const metadata: Metadata = {
  title: "LINE閲覧制限の体験デモ | ピックルボール乱数表",
  robots: { index: false, follow: false }
};

export default function LineAccessDemoPage() {
  return <LineAccessDemo />;
}

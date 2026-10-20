import LineAccessGate from "../components/LineAccessGate";

export const metadata = { title: "LINE接続確認 | ピックルボール乱数表", robots: { index: false, follow: false } };

export default function LineAccessPage() {
  return <main className="page"><LineAccessGate returnTo="/line-access" preview /></main>;
}

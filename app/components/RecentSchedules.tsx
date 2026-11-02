"use client";

import { useEffect, useState } from "react";
import { ArrowRight, History, RefreshCw, Trash2 } from "lucide-react";
import LineAccessGate from "./LineAccessGate";
import { useLineMiniApp } from "./LineMiniAppProvider";
import styles from "./recent-schedules.module.css";

type Item = { id: string; title: string; viewedAt: string; createdAt: string };

export default function RecentSchedules({ openLatest = false }: { openLatest?: boolean }) {
  const mini = Boolean(useLineMiniApp());
  const [items, setItems] = useState<Item[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [clearing, setClearing] = useState(false);
  const endpoint = `/api/line/recent${mini ? "?line_context=mini" : ""}`;
  useEffect(() => {
    let stopped = false;
    setError("");
    void fetch(endpoint, { cache: "no-store", credentials: "same-origin" }).then(async response => {
      const result = await response.json() as { items?: Item[]; access?: string };
      if (stopped) return;
      if (result.access) { setDenied(true); return; }
      if (!response.ok || !Array.isArray(result.items)) throw new Error("history");
      setItems(result.items.filter(item => /^[A-Za-z0-9]{6,20}$/.test(item.id)));
      setDenied(false);
      const latest = result.items[0];
      if (openLatest && latest && /^[A-Za-z0-9]{6,20}$/.test(latest.id)) window.location.replace(`${mini ? "/mini" : ""}/s/${latest.id}`);
    }).catch(() => { if (!stopped) setError("履歴を読み込めませんでした。もう一度お試しください。"); });
    return () => { stopped = true; };
  }, [endpoint, attempt, openLatest, mini]);

  async function clearHistory() {
    if (clearing || !window.confirm("自分の閲覧履歴を消しますか？\n対戦表そのものや、他の人の履歴は消えません。")) return;
    setClearing(true);
    try {
      const response = await fetch(endpoint, { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("delete");
      setItems([]); setError("");
    } catch { setError("履歴を消せませんでした。時間をおいてお試しください。"); }
    finally { setClearing(false); }
  }

  if (denied) return <main className="page share-page"><LineAccessGate returnTo={openLatest ? "/resume" : "/recent"} onAllowed={() => { setDenied(false); setAttempt(value => value + 1); }} /></main>;
  return <main className="page share-page">
    <header className="top"><h1>最近見た対戦表</h1></header>
    {error ? <div className="error" role="alert">{error}<button className={styles.retry} type="button" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={18} />もう一度確認</button></div> : null}
    {!items && !error ? <p role="status">履歴を読み込んでいます…</p> : null}
    {items?.length ? <>
      <a className={styles.latest} href={`${mini ? "/mini" : ""}/s/${items[0].id}`}><History size={22} aria-hidden="true" /><span><small>直近の対戦表</small><strong>{items[0].title || "乱数表"}</strong></span><ArrowRight size={22} aria-hidden="true" /></a>
      <ul className={styles.list}>{items.slice(1).map(item => <li key={item.id}><a href={`${mini ? "/mini" : ""}/s/${item.id}`}><span><strong>{item.title || "乱数表"}</strong><time dateTime={item.viewedAt}>{new Date(item.viewedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}に閲覧</time></span><ArrowRight size={20} aria-hidden="true" /></a></li>)}</ul>
      <button className={styles.clear} type="button" disabled={clearing} onClick={() => void clearHistory()}><Trash2 size={18} aria-hidden="true" />{clearing ? "削除中…" : "自分の閲覧履歴を消す"}</button>
    </> : items ? <p className={styles.empty}>まだ閲覧履歴はありません。主催者から届いた共有リンクかQRコードで対戦表を開いてください。</p> : null}
    <footer className={styles.footer}><a href="/privacy">プライバシーポリシー</a><a href="/terms">利用規約</a></footer>
  </main>;
}

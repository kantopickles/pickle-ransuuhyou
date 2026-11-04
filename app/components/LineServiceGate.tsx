"use client";

import { useEffect, useState } from "react";
import { ArrowRight, RefreshCw, Send } from "lucide-react";
import { APP_ICONS } from "../lib/app-icons";
import type { ServiceNotice } from "../lib/line-service-delivery";
import LineAccessGate from "./LineAccessGate";
import { useLineMiniApp } from "./LineMiniAppProvider";
import styles from "./line-access.module.css";

export type NoticeScreen = ServiceNotice | "loading" | "sending";

export function LineServicePanel({ notice, onRetry, miniUrl }: { notice: NoticeScreen; onRetry: () => void; miniUrl?: string }) {
  const busy = notice === "loading" || notice === "sending";
  const heading = notice === "sending" ? "対戦表のリンクを送っています"
    : notice === "loading" ? "対戦表を準備しています" : notice === "mini_required" ? "LINEミニアプリで開きます"
      : notice === "not_configured" ? "通知の準備ができていません" : "通知を確認できませんでした";
  const description = notice === "sending" ? "LINEミニアプリのお知らせにリンクを送信しています。送信を確認後、対戦表を表示します。"
    : notice === "loading" ? "しばらくお待ちください。"
      : notice === "uncertain" ? "送信結果が不明なため、重複送信を止めています。LINEのお知らせを確認してください。再送する場合は、このミニアプリを閉じて開き直してからお試しください。重複して届く場合があります。"
        : notice === "session_limit" ? "このLINE接続で送信できる回数に達しました。ミニアプリを閉じて開き直してください。"
          : notice === "mini_required" ? "LINEでログインして、対戦表のリンクを受け取ってから開いてください。"
            : notice === "not_configured" ? "主催者にお問い合わせください。"
              : "通知の送信を確認できなかったため、対戦表はまだ表示していません。時間をおいてもう一度お試しください。";
  return <main className="page share-page"><section className={styles.gate} aria-labelledby="line-service-title">
    <img className={styles.avatar} src={APP_ICONS.small} width={80} height={80} alt="ピックルボール乱数表" />
    <p className={styles.brand}>関東ピックルズ</p>
    <h1 id="line-service-title">{heading}</h1>
    <p className={styles.description} role={busy ? "status" : "alert"}>{description}</p>
    {notice === "sending" ? <Send size={28} aria-hidden="true" /> : null}
    {notice === "mini_required" && miniUrl ? <a className={styles.lineButton} href={miniUrl}>ミニアプリで開く<ArrowRight size={20} /></a> : null}
    {!busy && notice !== "mini_required" && notice !== "not_configured" ? <button type="button" className={styles.secondary} onClick={onRetry}><RefreshCw size={18} />{notice === "uncertain" ? "再送を試す" : "もう一度確認"}</button> : null}
    <p className={styles.privacy}><a href="/privacy">プライバシーポリシー</a> ・ <a href="/terms">利用規約</a></p>
  </section></main>;
}

export default function LineServiceGate({ shareId, children }: { shareId: string; children: React.ReactNode }) {
  const mini = useLineMiniApp();
  const [notice, setNotice] = useState<NoticeScreen>("loading");
  const [miniUrl, setMiniUrl] = useState<string>();
  const [needsLine, setNeedsLine] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = () => setAttempt(value => value + 1);
  const isMini = Boolean(mini);
  useEffect(() => {
    let stopped = false;
    setNotice("loading");
    setNeedsLine(false);
    const url = `/api/line/service/${encodeURIComponent(shareId)}${isMini ? "?line_context=mini" : ""}`;
    async function request(method: "GET" | "POST") {
      const response = await fetch(url, { method, cache: "no-store", credentials: "same-origin",
        ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(attempt ? { retry: true } : {}) } : {}) });
      const data = await response.json() as { notice?: ServiceNotice; access?: string; miniUrl?: string };
      if (stopped) return null;
      if (data.access) { setNeedsLine(true); return null; }
      if (data.miniUrl && /^https:\/\/miniapp\.line\.me\/\d+-[A-Za-z0-9]+\/s\/[A-Za-z0-9]{6,20}$/.test(data.miniUrl)) setMiniUrl(data.miniUrl);
      setNotice(data.notice ?? "failed");
      return data.notice;
    }
    void (async () => {
      try {
        const status = await request("GET");
        if (stopped || (status !== "required" && !(attempt && status === "uncertain"))) return;
        setNotice("sending");
        await request("POST");
      } catch { if (!stopped) setNotice("failed"); }
    })();
    return () => { stopped = true; };
  }, [shareId, isMini, attempt]);
  // The viewer (including polling, sockets, copying and image export) does not
  // mount until the server confirms delivery or the feature is explicitly off.
  if (notice === "disabled" || notice === "accepted") return children;
  if (needsLine) return <main className="page share-page"><LineAccessGate returnTo={`/s/${shareId}`} onAllowed={retry} /></main>;
  return <LineServicePanel notice={notice} onRetry={retry} miniUrl={miniUrl} />;
}

"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, LockKeyhole, MessageCircle, RefreshCw } from "lucide-react";
import type { LineAccessState } from "../lib/line-access";
import { APP_ICONS } from "../lib/app-icons";
import styles from "./line-access.module.css";

type Status = { access: LineAccessState; accountId?: string | null; friendUrl?: string | null };

export default function LineAccessGate({ returnTo, preview = false, onAllowed }: {
  returnTo: string;
  preview?: boolean;
  onAllowed?: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function check(force = false) {
    setBusy(true);
    if (force) setError("");
    try {
      const response = await fetch(`/api/line/status${preview ? "?preview=1" : ""}`, { method: force ? "POST" : "GET", cache: "no-store" });
      if (!response.ok) throw new Error("status failed");
      const result = await response.json() as Status;
      setStatus(result);
      if (result.access === "allowed") onAllowed?.();
    } catch { setError("確認できませんでした。通信状況を確認して、もう一度お試しください。"); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    const reason = new URL(window.location.href).searchParams.get("line_error");
    if (reason) {
      setError(reason === "cancelled" ? "ログインがキャンセルされました。対戦表を見るにはLINEでログインしてください。" : reason === "session" ? "ログインの有効時間が切れました。もう一度ログインしてください。" : "LINEとの接続に失敗しました。もう一度ログインしてください。");
      const clean = new URL(window.location.href);
      clean.searchParams.delete("line_error");
      window.history.replaceState(null, "", clean);
    }
    // Read status once on entry; actual schedule APIs independently authorize.
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status?.access !== "friend_required") return;
    const onVisible = () => { if (document.visibilityState === "visible") void check(true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.access]);

  const state = status?.access;
  const login = `/api/line/start?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <section className={styles.gate} aria-labelledby="line-access-heading">
      <img className={styles.avatar} src={APP_ICONS.small} alt="ピックルボール乱数表" width={80} height={80} />
      <p className={styles.brand}>関東ピックルズ</p>
      {status?.accountId ? <p className={styles.account}>友だち登録先：{status.accountId}</p> : null}
      <ol className={styles.steps} aria-label="対戦表を開く手順">
        {["LINEログイン", "友だち確認", "対戦表"].map((label, index) => <li key={label} className={(state === "allowed" || (index === 0 && state === "friend_required")) ? styles.done : ""}><span>{state === "allowed" || (index === 0 && state === "friend_required") ? <Check size={16} /> : index + 1}</span>{label}</li>)}
      </ol>
      <div className={styles.icon}>{state === "allowed" ? <Check size={28} /> : <LockKeyhole size={28} />}</div>
      <h1 id="line-access-heading">{state === "allowed" ? "友だち確認ができました" : state === "friend_required" ? "友だち追加で対戦表へ" : state === "not_configured" ? "LINE連携を準備しています" : "本日の対戦表はこちら"}</h1>
      <p className={styles.description}>{state === "allowed" ? preview ? "LINEログインと公式LINEの友だち確認が完了しました。" : "対戦表を開いています…" : state === "friend_required" ? "公式LINEを友だち追加してから「追加したので確認する」を押してください。ブロック中の場合は解除が必要です。" : state === "not_configured" ? "主催者の設定が完了すると利用できます。時間をおいてお試しください。" : state === "unavailable" ? "LINEの友だち状態を確認できませんでした。時間をおいて、もう一度お試しください。" : "対戦表の閲覧には、LINEログインと公式LINEの友だち登録が必要です。"}</p>
      <div className={styles.controls}>
        {state === "login_required" ? <a className={styles.loginLink} href={login}>LINEでログイン<ArrowRight size={20} aria-hidden="true" /></a> : null}
        {state === "friend_required" && status?.friendUrl ? <>
          <a className={styles.lineButton} href={status.friendUrl} target="_blank" rel="noopener noreferrer"><MessageCircle size={24} aria-hidden="true" />友だち追加・ブロック解除<ArrowRight size={20} aria-hidden="true" /></a>
          <button className={styles.secondary} type="button" onClick={() => void check(true)} disabled={busy}><RefreshCw size={18} aria-hidden="true" />{busy ? "確認中…" : "追加したので確認する"}</button>
          <a className={styles.textLink} href={`${login}&switch=1`}>別のLINEアカウントでログイン</a>
        </> : null}
        {(state === "unavailable" || state === "not_configured" || (!status && !busy)) ? <button className={styles.secondary} type="button" onClick={() => void check(true)} disabled={busy}><RefreshCw size={18} />もう一度確認</button> : null}
        {(!status && busy) ? <p role="status">接続を確認しています…</p> : null}
        {state === "allowed" && preview ? <p className={styles.success} role="status">接続テストに成功しました</p> : null}
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <p className={styles.privacy}>LINEのパスワードをこのサイトで入力することはありません。ログインは同じブラウザで最大30日間保持されます。</p>
      {preview ? <p className={styles.privacy}>接続テスト画面です。ここで成功しても、共有リンク全体の閲覧制限は自動では有効になりません。</p> : null}
    </section>
  );
}

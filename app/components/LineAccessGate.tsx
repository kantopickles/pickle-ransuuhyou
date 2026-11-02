"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, LockKeyhole, MessageCircle, RefreshCw } from "lucide-react";
import type { LineAccessState } from "../lib/line-access";
import { APP_ICONS } from "../lib/app-icons";
import { lineCallbackMessage, lineRecoveryReturnTo, PENDING_LINE_SHARE } from "../lib/line-access-ui";
import { MiniAccessRetry, useLineMiniApp } from "./LineMiniAppProvider";
import styles from "./line-access.module.css";

type Status = { access: LineAccessState; accountId?: string | null; friendUrl?: string | null };

type GateProps = {
  returnTo: string;
  preview?: boolean;
  onAllowed?: () => void;
};

export default function LineAccessGate(props: GateProps) {
  const mini = useLineMiniApp();
  return mini ? <MiniAccessRetry /> : <WebLineAccessGate {...props} />;
}

function WebLineAccessGate({ returnTo, preview = false, onAllowed }: GateProps) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [callbackReason, setCallbackReason] = useState<string | null>(null);
  const [effectiveReturnTo, setEffectiveReturnTo] = useState(returnTo);
  const requestNumber = useRef(0);

  async function check(force = false, reason = callbackReason) {
    const currentRequest = ++requestNumber.current;
    setBusy(true);
    if (force) setError("");
    try {
      const response = await fetch(`/api/line/status${preview ? "?preview=1" : ""}`, { method: force ? "POST" : "GET", cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error("status failed");
      const result = await response.json() as Status;
      if (currentRequest !== requestNumber.current) return;
      setStatus(result);
      setError(lineCallbackMessage(reason, result.access));
      if (result.access === "allowed") onAllowed?.();
    } catch { if (currentRequest === requestNumber.current) setError("確認できませんでした。通信状況を確認して、もう一度お試しください。"); }
    finally { if (currentRequest === requestNumber.current) setBusy(false); }
  }

  useEffect(() => {
    const reason = new URL(window.location.href).searchParams.get("line_error");
    setCallbackReason(reason);
    try {
      if (/^\/s\/[A-Za-z0-9]{6,20}$/.test(returnTo)) localStorage.setItem(PENDING_LINE_SHARE, returnTo);
      setEffectiveReturnTo(lineRecoveryReturnTo(returnTo, localStorage.getItem(PENDING_LINE_SHARE)));
    } catch { /* Cookies handle authentication; this optional hint only restores navigation. */ }
    if (reason) {
      const clean = new URL(window.location.href);
      clean.searchParams.delete("line_error");
      window.history.replaceState(null, "", clean);
    }
    // Read status once on entry; actual schedule APIs independently authorize.
    void check(false, reason);
    return () => { requestNumber.current++; };
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
  const recovering = callbackReason === "browser" || callbackReason === "session";
  const login = `/api/line/start?returnTo=${encodeURIComponent(effectiveReturnTo)}${recovering ? "&browser=1" : ""}`;

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
        {state === "login_required" ? <a className={styles.loginLink} href={login}>{recovering ? "このブラウザでログインし直す" : "LINEでログイン"}<ArrowRight size={20} aria-hidden="true" /></a> : null}
        {state === "friend_required" && status?.friendUrl ? <>
          <a className={styles.lineButton} href={status.friendUrl} target="_blank" rel="noopener noreferrer"><MessageCircle size={24} aria-hidden="true" />友だち追加・ブロック解除<ArrowRight size={20} aria-hidden="true" /></a>
          <button className={styles.secondary} type="button" onClick={() => void check(true)} disabled={busy}><RefreshCw size={18} aria-hidden="true" />{busy ? "確認中…" : "追加したので確認する"}</button>
          <a className={styles.textLink} href={`${login}&switch=1`}>別のLINEアカウントでログイン</a>
        </> : null}
        {(state === "unavailable" || state === "not_configured" || (!status && !busy)) ? <button className={styles.secondary} type="button" onClick={() => void check(true)} disabled={busy}><RefreshCw size={18} />もう一度確認</button> : null}
        {(!status && busy) ? <p role="status">接続を確認しています…</p> : null}
        {state === "allowed" && preview && effectiveReturnTo.startsWith("/s/") ? <a className={styles.lineButton} href={effectiveReturnTo}>対戦表を開く<ArrowRight size={20} aria-hidden="true" /></a> : null}
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <p className={styles.privacy}>LINEのパスワードをこのサイトで入力することはありません。ログインは同じブラウザで最大30日間保持されます。</p>
      {preview ? <p className={styles.privacy}>{effectiveReturnTo.startsWith("/s/") ? "上のボタンから、開こうとしていた対戦表に戻れます。" : "対戦表は、主催者から届いた共有リンクかQRコードから開いてください。"}</p> : null}
    </section>
  );
}

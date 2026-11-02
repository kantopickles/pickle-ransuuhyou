"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ArrowRight, MessageCircle, RefreshCw } from "lucide-react";
import type { LineAccessState } from "../lib/line-access";
import { APP_ICONS } from "../lib/app-icons";
import styles from "./line-access.module.css";

type MiniContext = { ready: boolean; retry: () => void };
const Context = createContext<MiniContext | null>(null);
export const useLineMiniApp = () => useContext(Context);

export function MiniAccessRetry() {
  const mini = useLineMiniApp();
  return <section className={styles.gate}><h1>LINEの接続を確認します</h1><button className={styles.secondary} type="button" onClick={mini?.retry}><RefreshCw size={18} />もう一度確認</button></section>;
}

export default function LineMiniAppProvider({ children }: { children: React.ReactNode }) {
  const [access, setAccess] = useState<LineAccessState | "loading">("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [addingFriend, setAddingFriend] = useState(false);
  const sdk = useRef<typeof import("@line/liff").default | null>(null);
  const liffId = useRef<string | null>(null);
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    let stopped = false;
    setAccess("loading");
    setError("");
    async function initialize() {
      try {
        const response = await fetch("/api/line/mini/config", { cache: "no-store" });
        if (!response.ok) throw new Error("configuration");
        const config = await response.json() as { enabled: boolean; liffId: string | null };
        if (stopped) return;
        if (!config.enabled || !config.liffId) { setAccess("not_configured"); return; }
        liffId.current = config.liffId;
        const liff = (await import("@line/liff")).default;
        sdk.current = liff;
        // Let LIFF consume liff.state and finish its redirects before modifying
        // the URL or invoking the old web OAuth flow. Never duplicate SDK tokens
        // in app-managed storage; the LINE SDK manages its own credentials.
        await liff.init({ liffId: config.liffId, withLoginOnExternalBrowser: true });
        if (stopped) return;
        if (!liff.isLoggedIn()) { setAccess("login_required"); return; }
        if (liff.isInClient()) {
          const permission = await liff.permission.query("profile");
          if (permission.state === "prompt") await liff.permission.requestAll();
        }
        const accessToken = liff.getAccessToken();
        if (!accessToken) { setAccess("login_required"); return; }
        const session = await fetch("/api/line/mini/session", {
          method: "POST", cache: "no-store", credentials: "same-origin",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken })
        });
        const result = await session.json() as { access?: LineAccessState };
        if (stopped) return;
        setAccess(result.access ?? "unavailable");
        if (!session.ok && !result.access) throw new Error("session");
      } catch {
        if (!stopped) { setAccess("unavailable"); setError("LINEとの接続を確認できませんでした。時間をおいてもう一度お試しください。"); }
      }
    }
    void initialize();
    // LIFF tokens can be invalidated when its browser closes. Always establish
    // a new mini session on a fresh launch, without touching the web session.
    return () => { stopped = true; };
  }, [attempt]);

  useEffect(() => {
    if (access !== "friend_required") return;
    const onVisible = () => { if (document.visibilityState === "visible") retry(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [access, retry]);

  async function addFriend() {
    if (addingFriend) return;
    setAddingFriend(true);
    try {
      if (sdk.current?.isInClient()) await sdk.current.requestFriendship();
      else window.open("https://line.me/R/ti/p/%40892ixgpm", "_blank", "noopener,noreferrer");
      retry();
    } catch { setError("友だち追加後に「追加したので確認する」を押してください。"); }
    finally { setAddingFriend(false); }
  }

  function reconnect() {
    const liff = sdk.current;
    if (!liff) { retry(); return; }
    if (liff.isInClient()) {
      // logout/login is for external browsers. Re-enter through the LINE URL
      // to establish a fresh in-client LIFF context instead of retrying a revoked token.
      const path = window.location.pathname.replace(/^\/mini(?=\/|$)/, "");
      if (liffId.current && /^(?:\/s\/[A-Za-z0-9]{6,20}|\/recent)?$/.test(path)) window.location.replace(`https://miniapp.line.me/${liffId.current}${path}`);
      else retry();
    } else {
      liff.logout();
      liff.login({ redirectUri: window.location.href });
    }
  }

  return <Context.Provider value={{ ready: access === "allowed", retry }}>
    {access === "allowed" ? children : <main className="page share-page"><section className={styles.gate} aria-labelledby="mini-access-title">
      <img className={styles.avatar} src={APP_ICONS.small} alt="ピックルボール乱数表" width={80} height={80} />
      <p className={styles.brand}>関東ピックルズ</p>
      <h1 id="mini-access-title">{access === "loading" ? "LINEに接続しています" : access === "friend_required" ? "友だち追加で対戦表へ" : access === "not_configured" ? "ミニアプリを準備しています" : "LINEの接続を確認します"}</h1>
      <p className={styles.description}>{access === "friend_required" ? "公式LINE「@892ixgpm」を友だち追加してください。ブロック中の場合は解除が必要です。" : access === "not_configured" ? "LINE側の設定が完了するまで、これまでの共有リンクをご利用ください。" : access === "loading" ? "しばらくお待ちください。" : "対戦表を見るにはLINEログインと公式LINEの友だち登録が必要です。"}</p>
      <div className={styles.controls}>
        {access === "friend_required" ? <><button type="button" className={styles.lineButton} disabled={addingFriend} onClick={() => void addFriend()}><MessageCircle size={22} />友だち追加・ブロック解除<ArrowRight size={18} /></button><button type="button" className={styles.secondary} onClick={retry}>追加したので確認する</button></> : null}
        {access === "login_required" ? <button className={styles.lineButton} type="button" onClick={reconnect}>LINEでログイン<ArrowRight size={18} /></button> : null}
        {access === "unavailable" ? <button type="button" className={styles.secondary} onClick={retry}><RefreshCw size={18} />もう一度確認</button> : null}
        {access === "not_configured" ? <a href="/recent" className={styles.secondary}>通常版で対戦表を開く</a> : null}
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <p className={styles.privacy}><a href="/privacy">プライバシーポリシー</a> ・ <a href="/terms">利用規約</a></p>
    </section></main>}
  </Context.Provider>;
}

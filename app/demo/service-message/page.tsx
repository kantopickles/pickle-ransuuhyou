"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, RotateCcw, Send, X } from "lucide-react";
import { LineServicePanel, type NoticeScreen } from "../../components/LineServiceGate";

export default function ServiceMessageDemo() {
  const [notice, setNotice] = useState<NoticeScreen>("required");
  const [fail, setFail] = useState(false);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (notice !== "sending") return;
    const timer = window.setTimeout(() => setNotice(fail ? "failed" : "accepted"), 1800);
    return () => window.clearTimeout(timer);
  }, [notice, fail]);
  return <>
    <header className="page" style={{ minHeight: 0, paddingBottom: 0 }}><h1 style={{ fontSize: 24 }}>サービスメッセージの動作確認</h1><p>デモ画面です。LINEへの実際の通知は送信しません。</p></header>
    {notice === "required" ? <main className="page"><section className="section">
      <h2>対戦表を開く</h2><p>LINEログイン・友だち登録の確認が終わった状態です。</p>
      <label><input type="checkbox" checked={fail} onChange={event => setFail(event.target.checked)} /> 通信エラーを試す</label>
      <button className="primary" type="button" onClick={() => setNotice("sending")} style={{ marginTop: 20, width: "100%" }}><Send size={18} aria-hidden="true" />通知送信から確認する</button>
    </section></main> : notice === "accepted" ? <main className="page">
      {!closed ? <section className="section"><p><Check size={20} aria-hidden="true" /> 通知の送信受付を確認しました（デモ）</p><h2>本日の対戦表</h2>
        <article className="match"><h3>第1試合</h3><div className="court"><strong>コート1</strong><p>1番・2番 vs 3番・4番</p></div><p>休み：5番、6番、7番、8番</p></article>
        <button className="secondary" type="button" onClick={() => setClosed(true)}><X size={18} />対戦表を閉じる</button>
      </section> : null}
      <section className="section"><h2>LINEミニアプリ お知らせ（デモ）</h2><p>受け取ったリンクから、この対戦表へ戻れます。</p><button className="secondary" type="button" onClick={() => setClosed(false)}>対戦表を開く<ArrowRight size={18} /></button></section>
      <button className="secondary" type="button" onClick={() => { setNotice("required"); setClosed(false); setFail(false); }}><RotateCcw size={18} />やり直す</button>
    </main> : <LineServicePanel notice={notice} onRetry={() => { setFail(false); setNotice("sending"); }} />}
  </>;
}

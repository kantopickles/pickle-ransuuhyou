"use client";

import { useEffect, useReducer, useRef } from "react";
import { ArrowRight, Check, CircleCheck, Info, LockKeyhole, RotateCcw, ShieldCheck, UserCheck } from "lucide-react";
import { demoReducer, INITIAL_DEMO_STATE, type DemoScenario } from "./flow";
import styles from "./demo.module.css";

const SAMPLE_MATCHES = [
  [["1番・2番", "3番・4番"], ["5番・6番", "7番・8番"]],
  [["1番・3番", "5番・7番"], ["2番・4番", "6番・8番"]],
  [["1番・5番", "2番・6番"], ["3番・7番", "4番・8番"]]
];

export default function LineAccessDemo() {
  const [state, dispatch] = useReducer(demoReducer, INITIAL_DEMO_STATE);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousStage = useRef(state.stage);
  const blocked = state.scenario === "blocked";
  const permitted = state.stage === "schedule";
  const activeStep = state.stage === "sign-in" ? 0 : permitted ? 2 : 1;

  useEffect(() => {
    if (previousStage.current !== state.stage) headingRef.current?.focus({ preventScroll: true });
    previousStage.current = state.stage;
  }, [state.stage]);

  return (
    <main className={styles.page}>
      <div className={styles.demoNotice}>
        <Info size={18} aria-hidden="true" />
        <span><strong>体験用デモ</strong> LINEへの接続・友だち追加は行いません</span>
      </div>

      <header className={styles.header}>
        <span className={styles.eyebrow}>関東ピックルズ / 共有された対戦表</span>
        <h1>サンプル練習会</h1>
        <p>8人<span aria-hidden="true"> / </span>2コート<span aria-hidden="true"> / </span>3試合</p>
      </header>

      <ol className={styles.steps} aria-label="対戦表を開くまでの手順">
        {["LINEログイン", "友だち確認", "対戦表"].map((label, index) => (
          <li key={label} data-active={index <= activeStep} aria-current={index === activeStep ? "step" : undefined}>
            <span className={styles.stepNumber} aria-hidden="true">
              {index < activeStep || permitted ? <Check size={15} /> : index + 1}
            </span>
            <span>{label}</span>
          </li>
        ))}
      </ol>

      {state.stage === "sign-in" ? (
        <section className={styles.gate} aria-labelledby="demo-stage-heading">
          <div className={styles.headingRow}>
            <LockKeyhole size={27} aria-hidden="true" />
            <h2 id="demo-stage-heading" ref={headingRef} tabIndex={-1}>本日の対戦表を見る</h2>
          </div>
          <p className={styles.description}>LINEでログインし、公式アカウントの友だち追加を確認すると、対戦表をご覧いただけます。</p>
          <AccountIdentity />
          <button className={styles.lineButton} type="button" onClick={() => dispatch({ type: "sign-in" })}>
            <span className={styles.lineMark} aria-hidden="true">LINE</span>
            <span>LINEでログイン</span>
            <ArrowRight size={20} aria-hidden="true" />
          </button>
          <p className={styles.privacy}><ShieldCheck size={16} aria-hidden="true" />このデモではアカウント情報を取得しません。</p>
        </section>
      ) : state.stage === "friend" ? (
        <section className={styles.gate} aria-labelledby="demo-stage-heading">
          <div className={styles.loginStatus}><UserCheck size={17} aria-hidden="true" />LINEログイン済み（デモ）</div>
          <h2 id="demo-stage-heading" ref={headingRef} tabIndex={-1}>
            {blocked ? "ブロックを解除して対戦表へ" : "友だち追加して対戦表へ"}
          </h2>
          <p className={styles.description}>
            {blocked ? "公式アカウントのブロック解除を確認すると、対戦表をご覧いただけます。" : "関東ピックルズの公式LINEを友だち追加してください。追加を確認すると、対戦表が開きます。"}
          </p>
          <AccountIdentity />
          <p className={styles.accountBenefit}>練習会・大会のお知らせや、個別のお問い合わせに。</p>
          <button className={styles.lineButton} type="button" onClick={() => dispatch({ type: "confirm-friend" })}>
            <span className={styles.lineMark} aria-hidden="true">LINE</span>
            <span>{blocked ? "ブロックを解除して見る" : "友だち追加して見る"}</span>
            <ArrowRight size={20} aria-hidden="true" />
          </button>
          <button className={styles.textButton} type="button" onClick={() => dispatch({ type: "skip-friend" })}>
            {blocked ? "解除せずに進む" : "追加せずに進む"}
          </button>
        </section>
      ) : state.stage === "denied" ? (
        <section className={styles.gate} aria-labelledby="demo-stage-heading">
          <div className={styles.headingRow}>
            <LockKeyhole size={27} aria-hidden="true" />
            <h2 id="demo-stage-heading" ref={headingRef} tabIndex={-1}>対戦表はまだ開けません</h2>
          </div>
          <p className={styles.deniedMessage} role="status">
            {blocked ? "公式LINEのブロック解除が確認できません。" : "公式LINEの友だち追加が確認できません。"}
          </p>
          <p className={styles.description}>対戦表は、公式アカウントを友だち追加し、ブロックしていない方に公開されます。</p>
          <button className={styles.lineButton} type="button" onClick={() => dispatch({ type: "retry" })}>
            <span>{blocked ? "ブロック解除へ戻る" : "友だち追加へ戻る"}</span>
            <ArrowRight size={20} aria-hidden="true" />
          </button>
          <button className={styles.textButton} type="button" onClick={() => dispatch({ type: "reset" })}>ログインからやり直す</button>
        </section>
      ) : (
        <section className={styles.schedule} aria-labelledby="demo-stage-heading">
          <div className={styles.accessGranted} role="status"><CircleCheck size={20} aria-hidden="true" />友だち確認済み・閲覧できます（デモ）</div>
          <div className={styles.scheduleHeading}>
            <h2 id="demo-stage-heading" ref={headingRef} tabIndex={-1}>本日の対戦表</h2>
            <span>サンプルデータ</span>
          </div>
          {SAMPLE_MATCHES.map((courts, matchIndex) => (
            <article className={styles.match} key={matchIndex}>
              <h3>第{matchIndex + 1}試合</h3>
              {courts.map(([teamA, teamB], courtIndex) => (
                <div className={styles.courtRow} key={courtIndex}>
                  <span className={styles.courtLabel}>コート{courtIndex + 1}</span>
                  <div className={styles.versus}><span>{teamA}</span><span className={styles.vs}>VS</span><span>{teamB}</span></div>
                </div>
              ))}
              <p className={styles.rest}>休み：なし</p>
            </article>
          ))}
        </section>
      )}

      <aside className={styles.demoControls} aria-label="デモの条件">
        <div className={styles.scenarioField}>
          <label htmlFor="line-demo-scenario">参加者の状態</label>
          <select
            id="line-demo-scenario"
            className="select"
            value={state.scenario}
            onChange={(event) => dispatch({ type: "scenario", scenario: event.target.value as DemoScenario })}
          >
            <option value="new">はじめて（未登録）</option>
            <option value="friend">すでに友だち追加済み</option>
            <option value="blocked">ブロック中</option>
          </select>
        </div>
        <button className={styles.resetButton} type="button" onClick={() => dispatch({ type: "reset" })} title="デモを最初から" aria-label="デモを最初から">
          <RotateCcw size={20} aria-hidden="true" />
        </button>
      </aside>
    </main>
  );
}

function AccountIdentity() {
  return (
    <div className={styles.identity}>
      <img src="/icon-192x192.png" alt="関東ピックルズのアイコン" width={52} height={52} />
      <div><strong>関東ピックルズ</strong><span>公式LINEアカウント</span></div>
      <ShieldCheck size={22} aria-hidden="true" />
    </div>
  );
}

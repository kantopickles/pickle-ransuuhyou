"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { LocateFixed, UserRound, X } from "lucide-react";
import ScheduleImageButton from "../../components/ScheduleImageButton";
import ShareCommunityPanel from "../../components/ShareCommunityPanel";
import LineAccessGate from "../../components/LineAccessGate";
import { useLineMiniApp } from "../../components/LineMiniAppProvider";
import RecentVisit from "../../components/RecentVisit";
import {
  currentMatch, initialJumpTarget, normalizeCheckedMatches, normalizePayload, playerStatus,
  readViewerPreference, rememberParticipant, resolveParticipant, saveViewerPreference,
  type SharePayload, type Team, type ViewerPreference
} from "./viewer-helpers";
import styles from "./viewer.module.css";

type SharedStats = {
  played: number;
  rested: number;
  partners: Map<number, number>;
  opponents: Map<number, number>;
};

function addCount(map: Map<number, number>, key: number) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function createStats(payload: SharePayload): SharedStats[] {
  const stats = payload.names.map(() => ({
    played: 0,
    rested: 0,
    partners: new Map<number, number>(),
    opponents: new Map<number, number>()
  }));

  for (const match of payload.matches) {
    const playing = new Set<number>();

    for (const court of match.courts) {
      const [a1, a2] = court.teamA;
      const [b1, b2] = court.teamB;

      for (const player of [a1, a2, b1, b2]) playing.add(player);

      addCount(stats[a1].partners, a2);
      addCount(stats[a2].partners, a1);
      addCount(stats[b1].partners, b2);
      addCount(stats[b2].partners, b1);

      for (const player of court.teamA) {
        for (const opponent of court.teamB) {
          addCount(stats[player].opponents, opponent);
          addCount(stats[opponent].opponents, player);
        }
      }
    }

    const eligible = new Set(match.participants ?? payload.names.map((_, index) => index));
    stats.forEach((stat, index) => {
      if (!eligible.has(index)) return;
      if (playing.has(index)) {
        stat.played += 1;
      } else {
        stat.rested += 1;
      }
    });
  }

  return stats;
}

function formatTeam(team: Team, names: string[]) {
  return `${names[team[0]] ?? `${team[0] + 1}番`}・${names[team[1]] ?? `${team[1] + 1}番`}`;
}

function mapNames(entries: Map<number, number>, names: string[]) {
  const sorted = Array.from(entries.entries()).sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return (names[left[0]] ?? "").localeCompare(names[right[0]] ?? "", "ja");
  });

  return sorted.length
    ? sorted.map(([index, count]) => `${names[index] ?? `${index + 1}番`}(${count})`).join("、")
    : "-";
}

function formatSharedSchedule(payload: SharePayload) {
  const lines: string[] = [];
  const stats = createStats(payload);

  for (const match of payload.matches) {
    lines.push(`第${match.match}試合`);
    for (const court of match.courts) {
      lines.push(`コート${court.court}`);
      lines.push(`${formatTeam(court.teamA, payload.names)} vs ${formatTeam(court.teamB, payload.names)}`);
    }
    lines.push(`休み：${match.resting.length ? match.resting.map((player) => payload.names[player]).join("、") : "なし"}`);
    lines.push("");
  }

  lines.push("集計");
  stats.forEach((stat, index) => {
    lines.push(`${payload.names[index]}：出場${stat.played}回／休み${stat.rested}回`);
    lines.push(`ペア：${mapNames(stat.partners, payload.names)}`);
    lines.push(`対戦：${mapNames(stat.opponents, payload.names)}`);
  });

  return lines.join("\n");
}

export default function ShortSharePage() {
  const params = useParams<{ id: string }>();
  return <SharedScheduleViewer key={params.id} shareId={params.id} />;
}

function SharedScheduleViewer({ shareId }: { shareId: string }) {
  const mini = useLineMiniApp();
  const isMini = Boolean(mini);
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [checkedMatches, setCheckedMatches] = useState<Set<number>>(() => new Set());
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [needsLine, setNeedsLine] = useState(false);
  const [accessAttempt, setAccessAttempt] = useState(0);
  const [preference, setPreference] = useState<ViewerPreference>({ participant: null, dismissed: false });
  const [preferenceReady, setPreferenceReady] = useState(false);
  const initialJumpDone = useRef(false);
  const controlsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const measure = () => controls.parentElement?.style.setProperty("--viewer-controls-height", `${controls.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(controls);
    return () => observer.disconnect();
  }, [Boolean(payload)]);

  useEffect(() => {
    try { setPreference(readViewerPreference(window.localStorage, shareId)); } catch { /* Storage may be disabled. */ }
    setPreferenceReady(true);
    // Do not override navigation performed while the initial request is pending.
    const cancelJump = () => { initialJumpDone.current = true; };
    const onKey = (event: KeyboardEvent) => {
      if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " ", "Tab"].includes(event.key)) cancelJump();
    };
    window.addEventListener("wheel", cancelJump, { passive: true });
    window.addEventListener("touchstart", cancelJump, { passive: true });
    window.addEventListener("pointerdown", cancelJump);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", cancelJump);
      window.removeEventListener("touchstart", cancelJump);
      window.removeEventListener("pointerdown", cancelJump);
      window.removeEventListener("keydown", onKey);
    };
  }, [shareId]);

  useEffect(() => {
    if (!payload || !preferenceReady || initialJumpDone.current) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (initialJumpDone.current) return;
        initialJumpDone.current = true;
        const id = initialJumpTarget(payload.matches, checkedMatches, window.location.hash);
        if (id) document.getElementById(id)?.scrollIntoView({ behavior: "instant", block: "start" });
      });
    });
    return () => { window.cancelAnimationFrame(firstFrame); window.cancelAnimationFrame(secondFrame); };
  }, [payload, checkedMatches, preferenceReady]);

  function updatePreference(next: ViewerPreference) {
    setPreference(next);
    try { saveViewerPreference(window.localStorage, shareId, next); } catch { /* Keep the in-memory choice. */ }
    // MINI app tracking can observe this explicit choice separately from schedule progress.
  }

  useEffect(() => {
    const lineContext = isMini ? "?line_context=mini" : "";
    let stopped = false;
    let denied = false;
    let loading = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;

    async function refreshPayload(initial = false) {
      if (stopped || denied || loading) return false;
      loading = true;
      try {
        const response = await fetch(`/api/share/${encodeURIComponent(shareId)}${lineContext}`, { cache: "no-store" });
        if (stopped) return false;
        if (!response.ok) {
          const result = await response.json().catch(() => ({})) as { access?: string };
          if (stopped) return false;
          if (result.access) {
            denied = true;
            setPayload(null);
            setNeedsLine(true);
            socket?.close();
          } else {
            denied = true;
            setPayload(null);
            setError("共有リンクを読み込めませんでした。リンクが間違っているか、削除された可能性があります。");
            socket?.close();
          }
          return false;
        }
        const result = (await response.json()) as {
          checkedMatches?: unknown;
          payload?: unknown;
        };
        if (stopped || denied) return false;
        const normalized = normalizePayload(result?.payload);
        if (!normalized) throw new Error("Invalid shared schedule");
        setCheckedMatches(normalizeCheckedMatches(result.checkedMatches, normalized.matches));
        setPayload(normalized);
        setNeedsLine(false);
        setError("");
        return true;
      } catch {
        // Keep the last successfully loaded schedule during a brief reconnect.
        if (initial && !stopped) setError("通信に失敗しました。接続を確認してページを再読み込みしてください。");
        return false;
      } finally { loading = false; }
    }

    function connect() {
      if (stopped || denied) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/api/realtime/${encodeURIComponent(shareId)}${lineContext}`);
      socket.addEventListener("message", () => void refreshPayload());
      socket.addEventListener("close", () => {
        scheduleReconnect();
      });
    }

    function scheduleReconnect() {
      if (stopped || denied) return;
      reconnectTimer = window.setTimeout(async () => {
        if (await refreshPayload()) connect();
        else scheduleReconnect();
      }, 3000);
    }

    void refreshPayload(true).then((loaded) => {
      if (loaded) connect();
      else scheduleReconnect();
    });
    // Recheck authorization and progress even when a socket stays connected.
    const timer = window.setInterval(() => {
      if (!denied && document.visibilityState === "visible") void refreshPayload();
    }, 60000);
    const onVisible = () => { if (!denied && document.visibilityState === "visible") void refreshPayload(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [shareId, accessAttempt, isMini]);

  async function handleCopy() {
    if (!payload) return;
    const text = formatSharedSchedule(payload);

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const stats = payload ? createStats(payload) : [];
  const completedMatchCount = payload
    ? payload.matches.filter((match) => checkedMatches.has(match.match)).length
    : 0;
  const nextMatch = payload ? currentMatch(payload.matches, checkedMatches) : null;
  const nextMatchNumber = nextMatch?.match ?? null;
  const jumpMatch = nextMatch ?? payload?.matches.at(-1) ?? null;
  const selectedPlayer = payload ? resolveParticipant(preference.participant, payload.names) : null;
  const currentPlayerStatus = playerStatus(nextMatch, selectedPlayer);

  function renderName(player: number) {
    const name = payload?.names[player] || `${player + 1}番`;
    return player === selectedPlayer ? <mark className={styles.ownName}>{name}</mark> : name;
  }

  function renderTeam(team: Team) {
    return <>{renderName(team[0])}・{renderName(team[1])}</>;
  }

  function jumpToCurrent() {
    initialJumpDone.current = true;
    if (!jumpMatch) return;
    const target = document.getElementById(`match-${jumpMatch.match}`);
    target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    target?.focus({ preventScroll: true });
  }

  if (needsLine) {
    return <main className="page share-page"><LineAccessGate returnTo={`/s/${shareId}`} onAllowed={() => {
      initialJumpDone.current = false;
      setNeedsLine(false);
      setAccessAttempt((attempt) => attempt + 1);
    }} /></main>;
  }

  return (
    <main className="page share-page">
      <header className="top">
        <h1>{payload?.title || "乱数表"}</h1>
        <p>共有されたピックルボール練習会の結果です。</p>
      </header>

      {payload ? (
        <nav ref={controlsRef} className={styles.controls} aria-label="対戦表の表示">
          <div className={styles.controlRow}>
            <div className={styles.status} aria-live="polite">
              <strong>{nextMatch ? `現在：第${nextMatch.match}試合` : payload.matches.length ? "全試合終了" : "試合なし"}</strong>
              {selectedPlayer !== null ? <> · {renderName(selectedPlayer)}{currentPlayerStatus ? `：${currentPlayerStatus}` : ""}</> : null}
            </div>
            {preference.dismissed ? <button className={styles.iconButton} type="button" aria-label="参加者を選ぶ" title="参加者を選ぶ" onClick={() => updatePreference({ ...preference, dismissed: false })}><UserRound size={20} aria-hidden="true" /></button> : null}
            <button className={styles.iconButton} type="button" disabled={!jumpMatch} onClick={jumpToCurrent} aria-label={nextMatch ? "現在の試合へ移動" : "最後の試合へ移動"} title={nextMatch ? "現在の試合へ移動" : "最後の試合へ移動"} aria-controls={jumpMatch ? `match-${jumpMatch.match}` : undefined}><LocateFixed size={20} aria-hidden="true" /></button>
          </div>
          {!preference.dismissed ? <div className={styles.controlRow}>
            <label className={styles.playerLabel} htmlFor="viewer-participant">自分の名前</label>
            <select id="viewer-participant" className={styles.select} value={selectedPlayer ?? ""} onChange={(event) => updatePreference({ participant: rememberParticipant(payload.names, event.target.value === "" ? null : Number(event.target.value)), dismissed: false })}>
              <option value="">選択なし</option>
              {payload.names.map((name, index) => <option key={index} value={index}>{name || `${index + 1}番`}{payload.names.filter((entry) => entry === name).length > 1 ? ` (${index + 1}番)` : ""}</option>)}
            </select>
            <button className={styles.iconButton} type="button" aria-label="名前の選択を閉じる" title="名前の選択を閉じる" onClick={() => updatePreference({ ...preference, dismissed: true })}><X size={20} aria-hidden="true" /></button>
          </div> : null}
        </nav>
      ) : null}

      <ShareCommunityPanel scheduleReady={Boolean(payload)} />

      {!payload && !error ? <div className="section loading" role="status">乱数表を読み込んでいます...</div> : null}
      {error ? <div className="error" role="alert">{error}</div> : null}

      {payload ? (
        <>
          <RecentVisit shareId={shareId} />
          <section className={`section ${styles.schedule}`} id="today-match-cards" tabIndex={-1} aria-labelledby="today-match-cards-heading">
            <h2 id="today-match-cards-heading">{payload.title || "生成結果"}</h2>
            <div className="progress-panel" aria-live="polite">
              <div className="progress-copy">
                <span className="progress-label">進行状況</span>
                <strong>{completedMatchCount} / {payload.matches.length}試合 終了</strong>
                <span>{nextMatchNumber === null ? "すべての試合が終了しました" : `次は第${nextMatchNumber}試合です`}</span>
              </div>
              <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={payload.matches.length} aria-valuenow={completedMatchCount}>
                <span style={{ width: `${payload.matches.length ? (completedMatchCount / payload.matches.length) * 100 : 0}%` }} />
              </div>
            </div>
            {payload.matches.map((match) => (
              <article id={`match-${match.match}`} tabIndex={-1} aria-current={nextMatchNumber === match.match ? "step" : undefined} className={`match ${styles.match} ${checkedMatches.has(match.match) ? "match-done" : ""} ${nextMatchNumber === match.match ? "match-current" : ""}`} key={match.match}>
                <h3>
                  第{match.match}試合
                  {checkedMatches.has(match.match) ? <span className="done-badge">終了</span> : null}
                </h3>
                {match.courts.map((court) => (
                  <div className={`court ${selectedPlayer !== null && [...court.teamA, ...court.teamB].includes(selectedPlayer) ? styles.ownCourt : ""}`} key={`${match.match}-${court.court}`}>
                    <div className="court-title">コート{court.court}</div>
                    <div className="versus">
                      <span className="team-name">{renderTeam(court.teamA)}</span>
                      <span className="vs-mark">VS</span>
                      <span className="team-name">{renderTeam(court.teamB)}</span>
                    </div>
                  </div>
                ))}
                <div className="rest">
                  休み：{match.resting.length ? match.resting.map((player, index) => <span key={player}>{index ? "、" : ""}{renderName(player)}</span>) : "なし"}
                </div>
                {selectedPlayer !== null ? <p className={styles.playerStatus}>{renderName(selectedPlayer)}：{playerStatus(match, selectedPlayer)}</p> : null}
              </article>
            ))}
          </section>

          <section className={`section ${styles.summary}`} id="schedule-summary">
            <h2>集計</h2>
            <div className="summary-wrap">
              <table className="summary">
                <thead>
                  <tr>
                    <th>名前</th>
                    <th>出場</th>
                    <th>休み</th>
                    <th>ペアになった相手</th>
                    <th>対戦した相手</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((stat, index) => (
                    <tr key={index}>
                      <td data-label="名前">{renderName(index)}</td>
                      <td data-label="出場">{stat.played}回</td>
                      <td data-label="休み">{stat.rested}回</td>
                      <td data-label="ペア">{mapNames(stat.partners, payload.names)}</td>
                      <td data-label="対戦相手">{mapNames(stat.opponents, payload.names)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {copied ? <div className="success" role="status">コピーしました</div> : null}
          </section>

          <div className="actions read-only-actions">
            <ScheduleImageButton payload={payload} />
            <button className="copy" type="button" onClick={handleCopy}>
              コピー
            </button>
          </div>
        </>
      ) : null}
    </main>
  );
}

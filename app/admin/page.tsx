"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import QRCode from "qrcode";

type Team = [number, number];

type CourtPlan = {
  court: number;
  teamA: Team;
  teamB: Team;
};

type MatchPlan = {
  match: number;
  courts: CourtPlan[];
  resting: number[];
  participants?: number[];
};

type SharedStats = {
  played: number;
  rested: number;
  partners: Map<number, number>;
  opponents: Map<number, number>;
};

type SharePayload = {
  title?: string;
  names: string[];
  matches: MatchPlan[];
};

type CompactSharePayload = {
  n: string[];
  m: [number, number, number, number][][];
  t?: string;
};

type ApiSchedule = {
  checkedMatches: number[];
  createdAt: string;
  id: string;
  payload: SharePayload | CompactSharePayload;
  updatedAt: string;
};

type ManagedSchedule = Omit<ApiSchedule, "payload"> & {
  payload: SharePayload;
};

const HISTORY_IMPORT_KEY = "pickleball-randomizer-history-import-v1";

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

function mapNames(entries: Map<number, number>, names: string[]) {
  const sorted = Array.from(entries.entries()).sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return (names[left[0]] ?? "").localeCompare(names[right[0]] ?? "", "ja");
  });

  return sorted.length
    ? sorted.map(([index, count]) => `${names[index] ?? `${index + 1}番`}(${count})`).join("、")
    : "-";
}

function normalizePayload(payload: SharePayload | CompactSharePayload): SharePayload {
  if ("n" in payload && "m" in payload) {
    return {
      title: payload.t,
      names: payload.n,
      matches: payload.m.map((game, gameIndex) => {
        const playing = new Set<number>();
        const courts = game.map(([a1, a2, b1, b2], courtIndex) => {
          for (const player of [a1, a2, b1, b2]) playing.add(player);
          return {
            court: courtIndex + 1,
            teamA: [a1, a2] as Team,
            teamB: [b1, b2] as Team
          };
        });

        return {
          match: gameIndex + 1,
          courts,
          resting: payload.n.map((_, index) => index).filter((player) => !playing.has(player))
        };
      })
    };
  }

  return payload;
}

function formatTeam(team: Team, names: string[]) {
  return `${names[team[0]] ?? `${team[0] + 1}番`}・${names[team[1]] ?? `${team[1] + 1}番`}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function withUpdatedResting(payload: SharePayload): SharePayload {
  return {
    ...payload,
    matches: payload.matches.map((match) => {
      const playing = new Set(match.courts.flatMap((court) => [...court.teamA, ...court.teamB]));
      const eligible = new Set(match.participants ?? payload.names.map((_, index) => index));
      playing.forEach((player) => eligible.add(player));
      return {
        ...match,
        resting: Array.from(eligible).filter((player) => !playing.has(player)),
        ...(match.participants ? { participants: Array.from(eligible) } : {})
      };
    })
  };
}

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [schedules, setSchedules] = useState<ManagedSchedule[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [shareQrCode, setShareQrCode] = useState("");
  const [shareCopied, setShareCopied] = useState(false);

  const selected = useMemo(
    () => schedules.find((schedule) => schedule.id === selectedId) ?? null,
    [schedules, selectedId]
  );
  const selectedStats = useMemo(
    () => selected ? createStats(selected.payload) : [],
    [selected]
  );

  useEffect(() => {
    void loadSchedules();
  }, []);

  async function loadSchedules() {
    setLoading(true);
    setError("");
    setStatus("");

    try {
      const response = await fetch("/api/admin/schedules", {
        cache: "no-store"
      });
      const result = (await response.json()) as { error?: string; schedules?: ApiSchedule[] };

      if (!response.ok) {
        if (response.status === 401) {
          setAuthenticated(false);
          return;
        }
        throw new Error(result.error || "履歴を読み込めませんでした。");
      }

      const normalized = (result.schedules ?? []).map((schedule) => ({
        ...schedule,
        payload: normalizePayload(schedule.payload)
      }));
      setAuthenticated(true);
      setSchedules(normalized);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "履歴を読み込めませんでした。");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "x-admin-password": passwordInput }
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "パスワードが違います。");
      setPasswordInput("");
      await loadSchedules();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "管理画面を開けませんでした。");
    } finally {
      setLoading(false);
    }
  }

  async function toggleMatch(matchNumber: number) {
    if (!selected || saving) return;

    const previous = selected.checkedMatches;
    const next = previous.includes(matchNumber)
      ? previous.filter((number) => number !== matchNumber)
      : [...previous, matchNumber].sort((left, right) => left - right);

    setSchedules((current) => current.map((schedule) => (
      schedule.id === selected.id ? { ...schedule, checkedMatches: next } : schedule
    )));
    setSaving(true);
    setError("");
    setStatus("");

    try {
      const response = await fetch(`/api/admin/schedules/${encodeURIComponent(selected.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ checkedMatches: next })
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "更新できませんでした。");
      setStatus("共有先へ反映しました。");
    } catch (caught) {
      setSchedules((current) => current.map((schedule) => (
        schedule.id === selected.id ? { ...schedule, checkedMatches: previous } : schedule
      )));
      setError(caught instanceof Error ? caught.message : "更新できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  async function replacePlayer(
    matchNumber: number,
    courtIndex: number,
    team: "teamA" | "teamB",
    playerIndex: 0 | 1,
    nextPlayer: number
  ) {
    if (!selected || saving) return;

    const previousPayload = selected.payload;
    const nextPayload = withUpdatedResting({
      ...previousPayload,
      matches: previousPayload.matches.map((match) => {
        if (match.match !== matchNumber) return match;

        const currentPlayer = match.courts[courtIndex][team][playerIndex];
        const nextCourts = match.courts.map((court) => ({
          ...court,
          teamA: [...court.teamA] as Team,
          teamB: [...court.teamB] as Team
        }));

        // 選んだ人がすでに出場中なら、現在の人とその出場枠を交換する。
        // 休みの人を選んだ場合は該当する出場枠がないため、現在の枠だけを変更する。
        nextCourts.forEach((court, nextCourtIndex) => {
          (["teamA", "teamB"] as const).forEach((nextTeam) => {
            court[nextTeam].forEach((player, nextPlayerIndex) => {
              const isCurrentSlot = nextCourtIndex === courtIndex
                && nextTeam === team
                && nextPlayerIndex === playerIndex;
              if (!isCurrentSlot && player === nextPlayer) {
                court[nextTeam][nextPlayerIndex] = currentPlayer;
              }
            });
          });
        });

        nextCourts[courtIndex][team][playerIndex] = nextPlayer;
        return {
          ...match,
          courts: nextCourts
        };
      })
    });

    setSchedules((current) => current.map((schedule) => (
      schedule.id === selected.id ? { ...schedule, payload: nextPayload } : schedule
    )));
    setSaving(true);
    setError("");
    setStatus("");

    try {
      const response = await fetch(`/api/admin/schedules/${encodeURIComponent(selected.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: nextPayload })
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "参加者を変更できませんでした。");
      setStatus("参加者の変更を共有先へ反映しました。");
    } catch (caught) {
      setSchedules((current) => current.map((schedule) => (
        schedule.id === selected.id ? { ...schedule, payload: previousPayload } : schedule
      )));
      setError(caught instanceof Error ? caught.message : "参加者を変更できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSchedule() {
    if (!selected || saving) return;
    const confirmed = window.confirm("この乱数表を削除しますか？共有リンクも開けなくなります。");
    if (!confirmed) return;

    setSaving(true);
    setError("");
    setStatus("");

    try {
      const response = await fetch(`/api/admin/schedules/${encodeURIComponent(selected.id)}`, {
        method: "DELETE",
        headers: {}
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "削除できませんでした。");

      setSchedules((current) => current.filter((schedule) => schedule.id !== selected.id));
      setSelectedId("");
      setStatus("乱数表を削除しました。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "削除できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  function logout() {
    void fetch("/api/admin/logout", { method: "POST" });
    setAuthenticated(false);
    setPasswordInput("");
    setSchedules([]);
    setSelectedId("");
    setError("");
    setStatus("");
  }

  function startNewScheduleFromHistory() {
    if (!selected) return;

    const courtCount = Math.max(1, ...selected.payload.matches.map((match) => match.courts.length));
    window.sessionStorage.setItem(HISTORY_IMPORT_KEY, JSON.stringify({
      participantCount: selected.payload.names.length,
      courtCount,
      matchCount: selected.payload.matches.length,
      names: selected.payload.names,
      title: selected.payload.title ?? ""
    }));
    window.location.assign("/");
  }

  function continueScheduleWithSameLink() {
    if (!selected) return;

    const referenceMatch = selected.payload.matches.find((match) => !selected.checkedMatches.includes(match.match))
      ?? selected.payload.matches.at(-1);
    const activePlayers = referenceMatch?.participants
      ?? selected.payload.names.map((_, index) => index);
    const activeNames = activePlayers.map((player) => selected.payload.names[player]).filter(Boolean);
    window.sessionStorage.setItem(HISTORY_IMPORT_KEY, JSON.stringify({
      participantCount: activeNames.length,
      courtCount: referenceMatch?.courts.length ?? 1,
      matchCount: selected.payload.matches.length,
      names: activeNames,
      title: selected.payload.title ?? "",
      continuation: {
        checkedMatches: selected.checkedMatches,
        originalMatches: selected.payload.matches,
        originalNames: selected.payload.names,
        shareId: selected.id
      }
    }));
    window.location.assign("/");
  }

  async function openHistoryShareModal() {
    if (!selected) return;

    const url = `${window.location.origin}/s/${selected.id}`;
    setShareUrl(url);
    setShareQrCode("");
    setShareCopied(false);
    setShareModalOpen(true);

    try {
      const qrCode = await QRCode.toDataURL(url, {
        errorCorrectionLevel: "L",
        margin: 2,
        width: 280
      });
      setShareQrCode(qrCode);
    } catch {
      setShareQrCode("");
    }
  }

  async function copyHistoryShareUrl() {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = shareUrl;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }

    setShareCopied(true);
    window.setTimeout(() => setShareCopied(false), 1800);
  }

  if (authenticated === null) {
    return (
      <main className="page admin-page">
        <section className="section loading" role="status">管理画面を確認しています...</section>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="page admin-page">
        <header className="admin-header">
          <a className="back-link" href="/">乱数表作成へ戻る</a>
          <h1>過去の乱数表</h1>
          <p>管理パスワードを入力してください。</p>
        </header>
        <section className="section admin-login">
          <form onSubmit={handleLogin}>
            <label className="label" htmlFor="admin-password">管理パスワード</label>
            <input
              className="input"
              id="admin-password"
              type="text"
              autoComplete="current-password"
              value={passwordInput}
              onChange={(event) => setPasswordInput(event.target.value)}
              autoFocus
            />
            <button className="primary" type="submit" disabled={loading || !passwordInput}>
              {loading ? "確認中..." : "管理画面を開く"}
            </button>
          </form>
          {error ? <div className="error" role="alert">{error}</div> : null}
        </section>
      </main>
    );
  }

  if (selected) {
    const completed = selected.checkedMatches.length;
    const total = selected.payload.matches.length;
    const nextMatch = selected.payload.matches.find((match) => !selected.checkedMatches.includes(match.match))?.match ?? null;

    return (
      <main className="page admin-page admin-detail-page">
        <header className="admin-header admin-detail-header">
          <button className="back-button" type="button" onClick={() => {
            setSelectedId("");
            setError("");
            setStatus("");
          }}>
            一覧へ戻る
          </button>
          <h1>{selected.payload.title || formatDate(selected.createdAt)}</h1>
          <p>{selected.payload.title ? `${formatDate(selected.createdAt)} / ` : ""}{selected.payload.names.length}人 / {total}試合</p>
        </header>

        {error ? <div className="error" role="alert">{error}</div> : null}
        {status ? <div className="success" role="status">{status}</div> : null}

        <section className="section">
          <div className="admin-detail-actions">
            <button className="primary admin-continue-button" type="button" onClick={continueScheduleWithSameLink}>
              このリンクのまま未終了分を再作成
            </button>
            <button className="secondary admin-reuse-button" type="button" onClick={startNewScheduleFromHistory}>
              この情報で新規作成
            </button>
            <button className="share admin-share-button" type="button" onClick={() => void openHistoryShareModal()}>
              共有リンク・QR
            </button>
            <a className="share admin-action-link" href={`/s/${selected.id}`} target="_blank" rel="noreferrer">
              共有画面を開く
            </a>
            <button className="danger-button" type="button" onClick={deleteSchedule} disabled={saving}>
              削除
            </button>
          </div>

          <div className="progress-panel" aria-live="polite">
            <div className="progress-copy">
              <span className="progress-label">進行状況</span>
              <strong>{completed} / {total}試合 終了</strong>
              <span>{nextMatch === null ? "すべての試合が終了しました" : `次は第${nextMatch}試合です`}</span>
            </div>
            <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}>
              <span style={{ width: `${total ? (completed / total) * 100 : 0}%` }} />
            </div>
          </div>

          {selected.payload.matches.map((match) => {
            const isChecked = selected.checkedMatches.includes(match.match);
            const eligiblePlayers = match.participants
              ?? selected.payload.names.map((_, index) => index);
            return (
              <article className={`match ${isChecked ? "match-done" : ""} ${nextMatch === match.match ? "match-current" : ""}`} key={match.match}>
                <label className="match-check">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={saving}
                    onChange={() => void toggleMatch(match.match)}
                  />
                  <span>第{match.match}試合</span>
                </label>
                {match.courts.map((court, courtIndex) => (
                  <div className="court" key={`${match.match}-${court.court}`}>
                    <div className="court-title">コート{court.court}</div>
                    <div className="versus">
                      <div className="admin-team-editor">
                        {court.teamA.map((player, playerIndex) => (
                          <select
                            aria-label={`第${match.match}試合 コート${court.court} Aチーム ${playerIndex + 1}人目`}
                            className="admin-player-select"
                            disabled={saving}
                            key={`a-${playerIndex}`}
                            onChange={(event) => void replacePlayer(match.match, courtIndex, "teamA", playerIndex as 0 | 1, Number(event.target.value))}
                            value={player}
                          >
                            {eligiblePlayers.map((eligiblePlayer) => (
                              <option key={eligiblePlayer} value={eligiblePlayer}>{selected.payload.names[eligiblePlayer]}</option>
                            ))}
                          </select>
                        ))}
                      </div>
                      <span className="vs-mark">VS</span>
                      <div className="admin-team-editor">
                        {court.teamB.map((player, playerIndex) => (
                          <select
                            aria-label={`第${match.match}試合 コート${court.court} Bチーム ${playerIndex + 1}人目`}
                            className="admin-player-select"
                            disabled={saving}
                            key={`b-${playerIndex}`}
                            onChange={(event) => void replacePlayer(match.match, courtIndex, "teamB", playerIndex as 0 | 1, Number(event.target.value))}
                            value={player}
                          >
                            {eligiblePlayers.map((eligiblePlayer) => (
                              <option key={eligiblePlayer} value={eligiblePlayer}>{selected.payload.names[eligiblePlayer]}</option>
                            ))}
                          </select>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
                <div className="rest">
                  休み：{match.resting.length ? match.resting.map((player) => selected.payload.names[player]).join("、") : "なし"}
                </div>
              </article>
            );
          })}
        </section>

        <section className="section">
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
                {selectedStats.map((stat, index) => (
                  <tr key={index}>
                    <td data-label="名前">{selected.payload.names[index]}</td>
                    <td data-label="出場">{stat.played}回</td>
                    <td data-label="休み">{stat.rested}回</td>
                    <td data-label="ペア">{mapNames(stat.partners, selected.payload.names)}</td>
                    <td data-label="対戦相手">{mapNames(stat.opponents, selected.payload.names)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {shareModalOpen ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="admin-share-title" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShareModalOpen(false);
          }}>
            <div className="modal share-modal">
              <button className="modal-close" type="button" aria-label="閉じる" onClick={() => setShareModalOpen(false)}>×</button>
              <h2 id="admin-share-title">共有リンク</h2>
              <p>このQRコードかリンクを共有すると、過去の乱数表を見られます。</p>
              {shareQrCode ? (
                <div className="qr-box">
                  <img src={shareQrCode} alt="過去の乱数表の共有QRコード" />
                </div>
              ) : (
                <div className="section loading" role="status">QRコードを作成しています...</div>
              )}
              <div className="share-url-box">{shareUrl}</div>
              {shareCopied ? <div className="success password-message" role="status">共有リンクをコピーしました</div> : null}
              <div className="modal-actions">
                <button className="secondary" type="button" onClick={() => setShareModalOpen(false)}>
                  閉じる
                </button>
                <button className="primary" type="button" onClick={() => void copyHistoryShareUrl()}>
                  リンクをコピー
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    );
  }

  return (
    <main className="page admin-page">
      <header className="admin-header">
        <a className="back-link" href="/">乱数表作成へ戻る</a>
        <div className="admin-title-row">
          <div>
            <h1>過去の乱数表</h1>
            <p>{schedules.length}件保存されています。</p>
          </div>
          <button className="text-button" type="button" onClick={logout}>終了</button>
        </div>
      </header>

      {error ? <div className="error" role="alert">{error}</div> : null}
      {status ? <div className="success" role="status">{status}</div> : null}

      <section className="admin-list" aria-busy={loading}>
        {loading ? <div className="section loading">履歴を読み込んでいます...</div> : null}
        {!loading && schedules.length === 0 ? (
          <div className="section empty">保存された乱数表はまだありません。</div>
        ) : null}
        {schedules.map((schedule) => (
          <button className="schedule-card" type="button" key={schedule.id} onClick={() => {
            setSelectedId(schedule.id);
            setError("");
            setStatus("");
          }}>
            <span className="schedule-card-date">{formatDate(schedule.createdAt)}</span>
            <strong>{schedule.payload.title || `${schedule.payload.names.length}人 / ${schedule.payload.matches.length}試合`}</strong>
            <span className="schedule-card-progress">
              {schedule.checkedMatches.length}試合終了
            </span>
            <span className="schedule-card-arrow" aria-hidden="true">›</span>
          </button>
        ))}
      </section>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

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
};

type SharePayload = {
  names: string[];
  matches: MatchPlan[];
};

type CompactSharePayload = {
  n: string[];
  m: [number, number, number, number][][];
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

const PASSWORD_STORAGE_KEY = "pickleball-admin-password";

function normalizePayload(payload: SharePayload | CompactSharePayload): SharePayload {
  if ("n" in payload && "m" in payload) {
    return {
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

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [schedules, setSchedules] = useState<ManagedSchedule[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const selected = useMemo(
    () => schedules.find((schedule) => schedule.id === selectedId) ?? null,
    [schedules, selectedId]
  );

  useEffect(() => {
    const savedPassword = window.sessionStorage.getItem(PASSWORD_STORAGE_KEY);
    if (!savedPassword) return;
    setPassword(savedPassword);
    setPasswordInput(savedPassword);
    void loadSchedules(savedPassword);
  }, []);

  async function loadSchedules(nextPassword = password) {
    setLoading(true);
    setError("");
    setStatus("");

    try {
      const response = await fetch("/api/admin/schedules", {
        cache: "no-store",
        headers: { "x-admin-password": nextPassword }
      });
      const result = (await response.json()) as { error?: string; schedules?: ApiSchedule[] };

      if (!response.ok) {
        if (response.status === 401) {
          window.sessionStorage.removeItem(PASSWORD_STORAGE_KEY);
          setPassword("");
        }
        throw new Error(result.error || "履歴を読み込めませんでした。");
      }

      const normalized = (result.schedules ?? []).map((schedule) => ({
        ...schedule,
        payload: normalizePayload(schedule.payload)
      }));
      setPassword(nextPassword);
      setSchedules(normalized);
      window.sessionStorage.setItem(PASSWORD_STORAGE_KEY, nextPassword);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "履歴を読み込めませんでした。");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadSchedules(passwordInput);
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
          "Content-Type": "application/json",
          "x-admin-password": password
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
        headers: { "x-admin-password": password }
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
    window.sessionStorage.removeItem(PASSWORD_STORAGE_KEY);
    setPassword("");
    setPasswordInput("");
    setSchedules([]);
    setSelectedId("");
    setError("");
    setStatus("");
  }

  if (!password) {
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
          <h1>{formatDate(selected.createdAt)}</h1>
          <p>{selected.payload.names.length}人 / {total}試合</p>
        </header>

        {error ? <div className="error" role="alert">{error}</div> : null}
        {status ? <div className="success" role="status">{status}</div> : null}

        <section className="section">
          <div className="admin-detail-actions">
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
                {match.courts.map((court) => (
                  <div className="court" key={`${match.match}-${court.court}`}>
                    <div className="court-title">コート{court.court}</div>
                    <div className="versus">
                      <span className="team-name">{formatTeam(court.teamA, selected.payload.names)}</span>
                      <span className="vs-mark">VS</span>
                      <span className="team-name">{formatTeam(court.teamB, selected.payload.names)}</span>
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
            <strong>{schedule.payload.names.length}人 / {schedule.payload.matches.length}試合</strong>
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

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

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

type SharedStats = {
  played: number;
  rested: number;
  partners: Map<number, number>;
  opponents: Map<number, number>;
};

type SharePayload = {
  names: string[];
  matches: MatchPlan[];
};

type CompactSharePayload = {
  n: string[];
  m: [number, number, number, number][][];
};

function addCount(map: Map<number, number>, key: number) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

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

    stats.forEach((stat, index) => {
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
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [checkedMatches, setCheckedMatches] = useState<Set<number>>(() => new Set());
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadPayload() {
      try {
        const response = await fetch(`/api/share/${encodeURIComponent(params.id)}`);
        if (!response.ok) throw new Error("not found");
        const result = (await response.json()) as {
          checkedMatches?: number[];
          payload: SharePayload | CompactSharePayload;
        };
        if (active) {
          setCheckedMatches(new Set(result.checkedMatches ?? []));
          setPayload(normalizePayload(result.payload));
        }
      } catch {
        if (active) setError("共有リンクを読み込めませんでした。リンクが間違っているか、削除された可能性があります。");
      }
    }

    loadPayload();

    return () => {
      active = false;
    };
  }, [params.id]);

  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) return;

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const channel = supabase
      .channel(`pickleball-share-${params.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          filter: `id=eq.${params.id}`,
          schema: "public",
          table: "pickleball_shared_schedules"
        },
        (event) => {
          const nextCheckedMatches = event.new.checked_matches;
          if (Array.isArray(nextCheckedMatches)) {
            setCheckedMatches(new Set(nextCheckedMatches as number[]));
          }
          if (event.new.payload) {
            try {
              setPayload(normalizePayload(event.new.payload as SharePayload | CompactSharePayload));
            } catch {
              // Ignore malformed realtime data and retain the previously loaded schedule.
            }
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [params.id]);

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
  const nextMatchNumber = payload?.matches.find((match) => !checkedMatches.has(match.match))?.match ?? null;

  return (
    <main className="page share-page">
      <header className="top">
        <h1>乱数表</h1>
        <p>共有されたピックルボール練習会の結果です。</p>
      </header>

      {!payload && !error ? <div className="section loading" role="status">乱数表を読み込んでいます...</div> : null}
      {error ? <div className="error" role="alert">{error}</div> : null}

      {payload ? (
        <>
          <section className="section">
            <h2>生成結果</h2>
            <div className="progress-panel" aria-live="polite">
              <div className="progress-copy">
                <span className="progress-label">進行状況</span>
                <strong>{completedMatchCount} / {payload.matches.length}試合 終了</strong>
                <span>{nextMatchNumber === null ? "すべての試合が終了しました" : `次は第${nextMatchNumber}試合です`}</span>
              </div>
              <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={payload.matches.length} aria-valuenow={completedMatchCount}>
                <span style={{ width: `${(completedMatchCount / payload.matches.length) * 100}%` }} />
              </div>
            </div>
            {payload.matches.map((match) => (
              <article className={`match ${checkedMatches.has(match.match) ? "match-done" : ""} ${nextMatchNumber === match.match ? "match-current" : ""}`} key={match.match}>
                <h3>
                  第{match.match}試合
                  {checkedMatches.has(match.match) ? <span className="done-badge">終了</span> : null}
                </h3>
                {match.courts.map((court) => (
                  <div className="court" key={`${match.match}-${court.court}`}>
                    <div className="court-title">コート{court.court}</div>
                    <div className="versus">
                      <span className="team-name">{formatTeam(court.teamA, payload.names)}</span>
                      <span className="vs-mark">VS</span>
                      <span className="team-name">{formatTeam(court.teamB, payload.names)}</span>
                    </div>
                  </div>
                ))}
                <div className="rest">
                  休み：{match.resting.length ? match.resting.map((player) => payload.names[player]).join("、") : "なし"}
                </div>
              </article>
            ))}
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
                  {stats.map((stat, index) => (
                    <tr key={index}>
                      <td data-label="名前">{payload.names[index]}</td>
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
            <button className="copy" type="button" onClick={handleCopy}>
              コピー
            </button>
          </div>
        </>
      ) : null}
    </main>
  );
}

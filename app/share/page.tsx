"use client";

import { useEffect, useState } from "react";

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
  m: [number, [number, Team, Team][], number[]][] | [number, number, number, number][][];
};

function buildMatchesFromCompact(names: string[], games: [number, number, number, number][][]): MatchPlan[] {
  return games.map((game, gameIndex) => {
    const playing = new Set<number>();
    const courts = game.map(([a1, a2, b1, b2], courtIndex) => {
      for (const player of [a1, a2, b1, b2]) playing.add(player);

      return {
        court: courtIndex + 1,
        teamA: [a1, a2] as Team,
        teamB: [b1, b2] as Team
      };
    });

    const resting = names
      .map((_, index) => index)
      .filter((player) => !playing.has(player));

    return {
      match: gameIndex + 1,
      courts,
      resting
    };
  });
}

function base64UrlToBytes(encoded: string) {
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function normalizePayload(parsed: SharePayload | CompactSharePayload): SharePayload {
  if ("n" in parsed && "m" in parsed && Array.isArray(parsed.n) && Array.isArray(parsed.m)) {
    if (Array.isArray(parsed.m[0]) && Array.isArray(parsed.m[0][0])) {
      const firstCourt = parsed.m[0][0];
      if (Array.isArray(firstCourt) && firstCourt.length === 4 && typeof firstCourt[0] === "number") {
        return {
          names: parsed.n,
          matches: buildMatchesFromCompact(parsed.n, parsed.m as [number, number, number, number][][])
        };
      }
    }

    return {
      names: parsed.n,
      matches: (parsed.m as [number, [number, Team, Team][], number[]][]).map(([match, courts, resting]) => ({
        match,
        courts: courts.map(([court, teamA, teamB]) => ({
          court,
          teamA,
          teamB
        })),
        resting
      }))
    };
  }

  if (!("names" in parsed) || !("matches" in parsed) || !Array.isArray(parsed.names) || !Array.isArray(parsed.matches)) {
    throw new Error("invalid payload");
  }

  return parsed;
}

async function decodeSharePayload(encoded: string): Promise<SharePayload> {
  if (encoded.startsWith("z.")) {
    const bytes = base64UrlToBytes(encoded.slice(2));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const json = new TextDecoder().decode(await new Response(stream).arrayBuffer());
    return normalizePayload(JSON.parse(json) as SharePayload | CompactSharePayload);
  }

  if (encoded.startsWith("j.")) {
    const bytes = base64UrlToBytes(encoded.slice(2));
    const json = new TextDecoder().decode(bytes);
    return normalizePayload(JSON.parse(json) as SharePayload | CompactSharePayload);
  }

  const bytes = base64UrlToBytes(encoded);
  const json = decodeURIComponent(
    Array.from(bytes)
      .map((byte) => `%${byte.toString(16).padStart(2, "0")}`)
      .join("")
  );
  return normalizePayload(JSON.parse(json) as SharePayload | CompactSharePayload);
}

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

export default function SharePage() {
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadPayload() {
      try {
        const encoded = window.location.hash.replace(/^#/, "");
        if (!encoded) throw new Error("missing payload");
        const nextPayload = await decodeSharePayload(encoded);
        if (active) setPayload(nextPayload);
      } catch {
        if (active) setError("共有リンクを読み込めませんでした。リンクが途中で切れている可能性があります。");
      }
    }

    loadPayload();

    return () => {
      active = false;
    };
  }, []);

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

  return (
    <main className="page share-page">
      <header className="top">
        <h1>乱数表</h1>
        <p>共有されたピックルボール練習会の結果です。</p>
      </header>

      {error ? <div className="error">{error}</div> : null}

      {payload ? (
        <>
          <section className="section">
            <h2>生成結果</h2>
            {payload.matches.map((match) => (
              <article className="match" key={match.match}>
                <h3>第{match.match}試合</h3>
                {match.courts.map((court) => (
                  <div className="court" key={`${match.match}-${court.court}`}>
                    <div className="court-title">コート{court.court}</div>
                    <div className="versus">
                      {formatTeam(court.teamA, payload.names)} vs {formatTeam(court.teamB, payload.names)}
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
                      <td>{payload.names[index]}</td>
                      <td>{stat.played}回</td>
                      <td>{stat.rested}回</td>
                      <td>{mapNames(stat.partners, payload.names)}</td>
                      <td>{mapNames(stat.opponents, payload.names)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {copied ? <div className="success">コピーしました</div> : null}
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

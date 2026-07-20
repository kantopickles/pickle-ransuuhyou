"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

type PairSetting = {
  id: string;
  a: number | "";
  b: number | "";
};

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

type PlayerStats = {
  played: number;
  rested: number;
  partners: Map<number, number>;
  opponents: Map<number, number>;
};

type GeneratedSchedule = {
  matches: MatchPlan[];
  stats: PlayerStats[];
  activeCourts: number;
};

type SharePayload = {
  n: string[];
  m: [number, number, number, number][][];
};

type ShareRecord = {
  editToken: string;
  id: string;
};

type StoredSchedule = {
  activeCourts: number;
  courtCount?: number;
  matchCount?: number;
  matches: MatchPlan[];
  names?: string[];
  participantCount?: number;
};

type GeneratedMeta = {
  courtCount: number;
  matchCount: number;
  names: string[];
  participantCount: number;
};

type Unit = {
  id: string;
  members: number[];
  fixed: boolean;
};

const PARTICIPANT_OPTIONS = Array.from({ length: 17 }, (_, index) => index + 4);
const COURT_OPTIONS = [1, 2, 3, 4, 5];
const MATCH_OPTIONS = [5, 10, 15, 20];
const STORAGE_KEY = "pickleball-randomizer-state-v1";

function createInitialNames(count: number) {
  return Array.from({ length: count }, (_, index) => `${index + 1}番`);
}

function pairKey(a: number, b: number) {
  return [Math.min(a, b), Math.max(a, b)].join("-");
}

function addCount(map: Map<number, number>, key: number, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function mapNames(map: Map<number, number>, names: string[]) {
  const entries = Array.from(map.entries()).sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return names[left[0]].localeCompare(names[right[0]], "ja");
  });

  return entries.length
    ? entries.map(([index, count]) => `${names[index]}(${count})`).join("、")
    : "-";
}

function shuffle<T>(items: T[]) {
  const copied = [...items];
  for (let index = copied.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copied[index], copied[swapIndex]] = [copied[swapIndex], copied[index]];
  }
  return copied;
}

function spread(values: number[]) {
  return Math.max(...values) - Math.min(...values);
}

function createStats(count: number): PlayerStats[] {
  return Array.from({ length: count }, () => ({
    played: 0,
    rested: 0,
    partners: new Map<number, number>(),
    opponents: new Map<number, number>()
  }));
}

function normalizePairs(pairs: PairSetting[], participantCount: number) {
  const used = new Set<number>();
  const normalized: Team[] = [];

  for (const pair of pairs) {
    if (
      pair.a === "" ||
      pair.b === "" ||
      pair.a === pair.b ||
      pair.a < 0 ||
      pair.b < 0 ||
      pair.a >= participantCount ||
      pair.b >= participantCount
    ) {
      continue;
    }

    if (used.has(pair.a) || used.has(pair.b)) continue;
    used.add(pair.a);
    used.add(pair.b);
    normalized.push([pair.a, pair.b]);
  }

  return normalized;
}

function buildUnits(participantCount: number, fixedPairs: Team[]) {
  const fixedMembers = new Set(fixedPairs.flat());
  const units: Unit[] = fixedPairs.map((pair) => ({
    id: `fixed-${pairKey(pair[0], pair[1])}`,
    members: pair,
    fixed: true
  }));

  for (let player = 0; player < participantCount; player += 1) {
    if (!fixedMembers.has(player)) {
      units.push({ id: `single-${player}`, members: [player], fixed: false });
    }
  }

  return units;
}

function chooseCandidateUnits(
  units: Unit[],
  targetPlayers: number,
  stats: PlayerStats[],
  restedLastMatch: Set<number>
) {
  const selected: Unit[] = [];
  let selectedPlayers = 0;

  // 出場者選びは、固定ペアを1つの単位として扱います。
  // ただし優先順位の一番上は個人の出場回数なので、出場回数が少ない人や
  // 直前に休んだ人を少し選ばれやすくしてから、候補全体を後段で厳密に採点します。
  const weighted = shuffle(units).sort((left, right) => {
    const leftPlayed = left.members.reduce((sum, member) => sum + stats[member].played, 0) / left.members.length;
    const rightPlayed = right.members.reduce((sum, member) => sum + stats[member].played, 0) / right.members.length;
    const leftRestBonus = left.members.some((member) => restedLastMatch.has(member)) ? -0.35 : 0;
    const rightRestBonus = right.members.some((member) => restedLastMatch.has(member)) ? -0.35 : 0;
    return leftPlayed + leftRestBonus - (rightPlayed + rightRestBonus);
  });

  for (const unit of weighted) {
    if (selectedPlayers + unit.members.length <= targetPlayers) {
      selected.push(unit);
      selectedPlayers += unit.members.length;
    }
    if (selectedPlayers === targetPlayers) break;
  }

  if (selectedPlayers !== targetPlayers) return null;
  return selected;
}

function buildTeamsFromUnits(selectedUnits: Unit[]) {
  const teams: Team[] = [];
  const singles: number[] = [];

  for (const unit of selectedUnits) {
    if (unit.fixed) {
      teams.push([unit.members[0], unit.members[1]]);
    } else {
      singles.push(unit.members[0]);
    }
  }

  const shuffledSingles = shuffle(singles);
  if (shuffledSingles.length % 2 !== 0) return null;

  for (let index = 0; index < shuffledSingles.length; index += 2) {
    teams.push([shuffledSingles[index], shuffledSingles[index + 1]]);
  }

  return shuffle(teams);
}

function buildCourts(teams: Team[], courtCount: number) {
  const shuffledTeams = shuffle(teams);
  const courts: CourtPlan[] = [];

  if (shuffledTeams.length !== courtCount * 2) return null;

  for (let index = 0; index < courtCount; index += 1) {
    courts.push({
      court: index + 1,
      teamA: shuffledTeams[index * 2],
      teamB: shuffledTeams[index * 2 + 1]
    });
  }

  return courts;
}

function scoreCandidate(
  courts: CourtPlan[],
  participantCount: number,
  stats: PlayerStats[],
  restedLastMatch: Set<number>
) {
  const playing = new Set<number>();
  const partnerRepeats: number[] = [];
  const opponentRepeats: number[] = [];

  for (const court of courts) {
    for (const player of [...court.teamA, ...court.teamB]) {
      playing.add(player);
    }

    partnerRepeats.push(stats[court.teamA[0]].partners.get(court.teamA[1]) ?? 0);
    partnerRepeats.push(stats[court.teamB[0]].partners.get(court.teamB[1]) ?? 0);

    for (const player of court.teamA) {
      for (const opponent of court.teamB) {
        opponentRepeats.push(stats[player].opponents.get(opponent) ?? 0);
      }
    }
  }

  const playedAfter = stats.map((stat, index) => stat.played + (playing.has(index) ? 1 : 0));
  const restedAfter = stats.map((stat, index) => stat.rested + (playing.has(index) ? 0 : 1));
  const consecutiveRestCount = Array.from(restedLastMatch).filter((player) => !playing.has(player)).length;

  // スコアは小さいほど良いです。
  // 重みは仕様の優先順位どおりに大きな段差を付けています。
  // 1. 出場回数の平等: 最重要なので最大/最小差を圧倒的に重くします。
  // 2. 休み回数の平等: 出場回数の次に重くします。
  // 3. 直前に休んだ人の連続休み: なるべく避けます。
  // 4. ペア重複、5. 対戦重複: 回数の偏りを壊さない範囲で避けます。
  return (
    spread(playedAfter) * 1_000_000 +
    spread(restedAfter) * 120_000 +
    consecutiveRestCount * 30_000 +
    partnerRepeats.reduce((sum, count) => sum + count * count, 0) * 900 +
    opponentRepeats.reduce((sum, count) => sum + count * count, 0) * 180 +
    Math.random()
  );
}

function applyMatchStats(courts: CourtPlan[], stats: PlayerStats[], participantCount: number) {
  const playing = new Set<number>();

  for (const court of courts) {
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

  for (let player = 0; player < participantCount; player += 1) {
    if (playing.has(player)) {
      stats[player].played += 1;
    } else {
      stats[player].rested += 1;
    }
  }

  return Array.from({ length: participantCount }, (_, index) => index).filter((player) => !playing.has(player));
}

function generateSchedule(
  participantCount: number,
  requestedCourtCount: number,
  matchCount: number,
  pairs: PairSetting[]
): GeneratedSchedule {
  const activeCourts = Math.min(requestedCourtCount, Math.floor(participantCount / 4));

  if (activeCourts < 1) {
    throw new Error("4人以上で作成してください。");
  }

  const fixedPairs = normalizePairs(pairs, participantCount);
  const fixedMembers = fixedPairs.flat();
  if (new Set(fixedMembers).size !== fixedMembers.length) {
    throw new Error("同じ参加者が複数の固定ペアに入っています。固定ペアを見直してください。");
  }

  const units = buildUnits(participantCount, fixedPairs);
  const targetPlayers = activeCourts * 4;
  const stats = createStats(participantCount);
  const matches: MatchPlan[] = [];
  let restedLastMatch = new Set<number>();

  for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) {
    let bestCourts: CourtPlan[] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    // 各試合ごとに複数候補を作り、スコアが最も低いものを採用します。
    // 完全探索ではなく候補探索にしているため、スマホでも重くなりにくく、
    // それでも公平性の主要条件はスコア重みで強く守る設計です。
    for (let attempt = 0; attempt < 900; attempt += 1) {
      const selectedUnits = chooseCandidateUnits(units, targetPlayers, stats, restedLastMatch);
      if (!selectedUnits) continue;

      const teams = buildTeamsFromUnits(selectedUnits);
      if (!teams) continue;

      const courts = buildCourts(teams, activeCourts);
      if (!courts) continue;

      const score = scoreCandidate(courts, participantCount, stats, restedLastMatch);
      if (score < bestScore) {
        bestCourts = courts;
        bestScore = score;
      }
    }

    if (!bestCourts) {
      throw new Error("現在の参加人数・コート数・固定ペア数では、組み合わせを作成できません。固定ペアを減らすか、コート数を変更してください。");
    }

    const resting = applyMatchStats(bestCourts, stats, participantCount);
    restedLastMatch = new Set(resting);

    matches.push({
      match: matchIndex + 1,
      courts: bestCourts,
      resting
    });
  }

  return { matches, stats, activeCourts };
}

function rebuildSchedule(storedSchedule: StoredSchedule, fallbackParticipantCount: number): GeneratedSchedule {
  const participantCount = storedSchedule.participantCount ?? storedSchedule.names?.length ?? fallbackParticipantCount;
  const stats = createStats(participantCount);

  for (const match of storedSchedule.matches) {
    applyMatchStats(match.courts, stats, participantCount);
  }

  return {
    activeCourts: storedSchedule.activeCourts,
    matches: storedSchedule.matches,
    stats
  };
}

function formatTeam(team: Team, names: string[]) {
  return `${names[team[0]]}・${names[team[1]]}`;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createSharePayload(schedule: GeneratedSchedule, names: string[]): SharePayload {
  return {
    n: names,
    m: schedule.matches.map((match) =>
      match.courts.map((court) => [court.teamA[0], court.teamA[1], court.teamB[0], court.teamB[1]])
    )
  };
}

async function encodeSharePayload(schedule: GeneratedSchedule, names: string[]) {
  const payload = createSharePayload(schedule, names);
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);

  if ("CompressionStream" in window) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    return `z.${bytesToBase64Url(compressed)}`;
  }

  return `j.${bytesToBase64Url(bytes)}`;
}

export default function Home() {
  const [participantCount, setParticipantCount] = useState(10);
  const [courtCount, setCourtCount] = useState(2);
  const [matchCount, setMatchCount] = useState(20);
  const [names, setNames] = useState<string[]>(() => createInitialNames(10));
  const [pairs, setPairs] = useState<PairSetting[]>([]);
  const [schedule, setSchedule] = useState<GeneratedSchedule | null>(null);
  const [generatedMeta, setGeneratedMeta] = useState<GeneratedMeta | null>(null);
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [error, setError] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const [checkedMatches, setCheckedMatches] = useState<Set<number>>(() => new Set());
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [namesOpen, setNamesOpen] = useState(false);
  const [pairsOpen, setPairsOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordChecking, setPasswordChecking] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [currentShareId, setCurrentShareId] = useState("");
  const [currentShareEditToken, setCurrentShareEditToken] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [shareQrCode, setShareQrCode] = useState("");
  const [storageLoaded, setStorageLoaded] = useState(false);
  const pendingShareSave = useRef<Promise<ShareRecord | null> | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      setStorageLoaded(true);
      return;
    }

    try {
      const parsed = JSON.parse(saved) as {
        participantCount?: number;
        courtCount?: number;
        matchCount?: number;
        names?: string[];
        pairs?: PairSetting[];
        schedule?: StoredSchedule | null;
        scheduleDirty?: boolean;
        shareEditToken?: string;
        shareId?: string;
        checkedMatches?: number[];
      };
      const savedCount = parsed.participantCount && PARTICIPANT_OPTIONS.includes(parsed.participantCount)
        ? parsed.participantCount
        : 10;
      setParticipantCount(savedCount);
      setCourtCount(parsed.courtCount && COURT_OPTIONS.includes(parsed.courtCount) ? parsed.courtCount : 2);
      setMatchCount(parsed.matchCount && MATCH_OPTIONS.includes(parsed.matchCount) ? parsed.matchCount : 20);
      setNames(Array.from({ length: savedCount }, (_, index) => parsed.names?.[index] || `${index + 1}番`));
      setPairs(parsed.pairs ?? []);
      setCurrentShareId(parsed.shareId ?? "");
      setCurrentShareEditToken(parsed.shareEditToken ?? "");
      setCheckedMatches(new Set(parsed.checkedMatches ?? []));
      if (parsed.schedule) {
        setSchedule(rebuildSchedule(parsed.schedule, savedCount));
        setSettingsOpen(false);
        setGeneratedMeta({
          courtCount: parsed.schedule.courtCount ?? parsed.courtCount ?? 2,
          matchCount: parsed.schedule.matchCount ?? parsed.matchCount ?? 20,
          names: parsed.schedule.names ?? Array.from({ length: savedCount }, (_, index) => parsed.names?.[index] || `${index + 1}番`),
          participantCount: parsed.schedule.participantCount ?? savedCount
        });
        setScheduleDirty(parsed.scheduleDirty ?? false);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setStorageLoaded(true);
    }
  }, []);

  useLayoutEffect(() => {
    if (!storageLoaded) return;

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        checkedMatches: Array.from(checkedMatches),
        courtCount,
        matchCount,
        names,
        pairs,
        participantCount,
        schedule: schedule
          ? {
              activeCourts: schedule.activeCourts,
              courtCount: generatedMeta?.courtCount,
              matchCount: generatedMeta?.matchCount,
              matches: schedule.matches,
              names: generatedMeta?.names,
              participantCount: generatedMeta?.participantCount
            }
          : null,
        scheduleDirty,
        shareEditToken: currentShareEditToken,
        shareId: currentShareId
      })
    );
  }, [participantCount, courtCount, matchCount, names, pairs, checkedMatches, schedule, generatedMeta, scheduleDirty, currentShareEditToken, currentShareId, storageLoaded]);

  const displayNames = useMemo(
    () => names.map((name, index) => name.trim() || `${index + 1}番`),
    [names]
  );
  const scheduleNames = generatedMeta?.names ?? displayNames;
  const generatedCourtCount = generatedMeta?.courtCount ?? courtCount;
  const completedMatchCount = schedule
    ? schedule.matches.filter((match) => checkedMatches.has(match.match)).length
    : 0;
  const nextMatchNumber = schedule?.matches.find((match) => !checkedMatches.has(match.match))?.match ?? null;

  function markScheduleDirty() {
    if (schedule) {
      setScheduleDirty(true);
    }
  }

  const usedPairMembers = useMemo(() => {
    const used = new Set<number>();
    for (const pair of pairs) {
      if (pair.a !== "") used.add(pair.a);
      if (pair.b !== "") used.add(pair.b);
    }
    return used;
  }, [pairs]);

  function updateParticipantCount(nextCount: number) {
    markScheduleDirty();
    setParticipantCount(nextCount);
    setNames((current) => Array.from({ length: nextCount }, (_, index) => current[index] || `${index + 1}番`));
    setPairs((current) =>
      current.filter(
        (pair) =>
          pair.a !== "" &&
          pair.b !== "" &&
          pair.a < nextCount &&
          pair.b < nextCount &&
          pair.a !== pair.b
      )
    );
  }

  function updateName(index: number, value: string) {
    markScheduleDirty();
    setNames((current) => current.map((name, nameIndex) => (nameIndex === index ? value : name)));
  }

  function updatePair(id: string, side: "a" | "b", value: string) {
    markScheduleDirty();
    setPairs((current) =>
      current.map((pair) =>
        pair.id === id
          ? {
              ...pair,
              [side]: value === "" ? "" : Number(value)
            }
          : pair
      )
    );
  }

  function addPair() {
    markScheduleDirty();
    setPairs((current) => [...current, { id: crypto.randomUUID(), a: "", b: "" }]);
    setPairsOpen(true);
  }

  function removePair(id: string) {
    markScheduleDirty();
    setPairs((current) => current.filter((pair) => pair.id !== id));
  }

  async function requestShareRecord(
    nextSchedule: GeneratedSchedule,
    nextNames: string[],
    nextCheckedMatches: number[]
  ): Promise<ShareRecord | null> {
    try {
      const response = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkedMatches: nextCheckedMatches,
          payload: createSharePayload(nextSchedule, nextNames)
        })
      });

      if (!response.ok) return null;
      const result = (await response.json()) as { editToken?: string; id?: string };
      if (!result.id || !result.editToken) return null;
      return { editToken: result.editToken, id: result.id };
    } catch {
      return null;
    }
  }

  function saveScheduleToHistory(nextSchedule: GeneratedSchedule, nextNames: string[]) {
    const savePromise = requestShareRecord(nextSchedule, nextNames, []);
    pendingShareSave.current = savePromise;

    void savePromise.then((record) => {
      if (pendingShareSave.current !== savePromise) return;
      pendingShareSave.current = null;
      if (!record) return;
      setCurrentShareId(record.id);
      setCurrentShareEditToken(record.editToken);
    });
  }

  function createSchedule() {
    setShareCopied(false);
    setError("");

    try {
      const nextSchedule = generateSchedule(participantCount, courtCount, matchCount, pairs);
      setSchedule(nextSchedule);
      setGeneratedMeta({
        courtCount,
        matchCount,
        names: displayNames,
        participantCount
      });
      setScheduleDirty(false);
      setCheckedMatches(new Set());
      setSettingsOpen(false);
      setNamesOpen(false);
      setPairsOpen(false);
      setCurrentShareId("");
      setCurrentShareEditToken("");
      saveScheduleToHistory(nextSchedule, displayNames);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "組み合わせを作成できませんでした。");
    }
  }

  function requestGenerate() {
    setPasswordInput("");
    setPasswordError("");
    setPasswordOpen(true);
  }

  async function confirmGenerate() {
    setPasswordChecking(true);
    setPasswordError("");

    try {
      const response = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "x-admin-password": passwordInput }
      });

      if (!response.ok) {
        setPasswordError("パスワードが違います。");
        return;
      }

      setPasswordOpen(false);
      setPasswordInput("");
      createSchedule();
    } catch {
      setPasswordError("パスワードを確認できませんでした。通信状態を確認してください。");
    } finally {
      setPasswordChecking(false);
    }
  }

  async function copyText(text: string) {
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
  }

  async function openShareModal() {
    if (!schedule) return;
    let nextShareId = currentShareId;
    let nextShareEditToken = currentShareEditToken;
    let nextShareUrl = currentShareId ? `${window.location.origin}/s/${currentShareId}` : "";
    let nextQrCode = "";

    if (!nextShareUrl) {
      const record = pendingShareSave.current
        ? await pendingShareSave.current
        : await requestShareRecord(schedule, scheduleNames, Array.from(checkedMatches));

      pendingShareSave.current = null;
      if (record) {
        nextShareId = record.id;
        nextShareEditToken = record.editToken;
        nextShareUrl = `${window.location.origin}/s/${record.id}`;
      }
    }

    if (!nextShareUrl) {
      const encoded = await encodeSharePayload(schedule, scheduleNames);
      nextShareUrl = `${window.location.origin}/share#${encoded}`;
    }

    try {
      nextQrCode = await QRCode.toDataURL(nextShareUrl, {
        errorCorrectionLevel: "L",
        margin: 2,
        width: 280
      });
    } catch {
      nextQrCode = "";
    }

    setShareCopied(false);
    setCurrentShareId(nextShareId);
    setCurrentShareEditToken(nextShareEditToken);
    setShareUrl(nextShareUrl);
    setShareQrCode(nextQrCode);
    setShareModalOpen(true);
  }

  async function handleShareCopy() {
    if (!shareUrl) return;

    await copyText(shareUrl);

    setShareCopied(true);
    window.setTimeout(() => setShareCopied(false), 2200);
  }

  function toggleMatchChecked(matchNumber: number) {
    setCheckedMatches((current) => {
      const next = new Set(current);
      if (next.has(matchNumber)) {
        next.delete(matchNumber);
      } else {
        next.add(matchNumber);
      }
      if (currentShareId && currentShareEditToken) {
        void updateSharedChecks(Array.from(next).sort((left, right) => left - right));
      }
      return next;
    });
  }

  function scrollToNextMatch() {
    if (nextMatchNumber === null) return;
    document.getElementById(`match-${nextMatchNumber}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  async function updateSharedChecks(nextCheckedMatches: number[]) {
    try {
      await fetch(`/api/share/${encodeURIComponent(currentShareId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          checkedMatches: nextCheckedMatches,
          editToken: currentShareEditToken
        })
      });
    } catch {
      // ローカルのチェック状態は残します。通信が戻ったら次回の操作で再同期されます。
    }
  }

  return (
    <main className="page">
      <header className="top">
        <h1 className="sr-only">ピックルボール乱数表</h1>
        <img
          className="hero-image"
          src="/pickleball-random-table-hero.png"
          alt="Pickleball Random Table ピックルボール乱数表"
        />
      </header>

      <nav className="utility-nav" aria-label="管理">
        <a className="admin-link" href="/admin">過去の乱数表</a>
      </nav>

      <section className="section collapsible">
        <button
          className="section-toggle"
          type="button"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <span>
            <span className="section-title">基本設定</span>
            <span className="section-note">
              {participantCount}人 / {courtCount}コート / {matchCount}試合
              {scheduleDirty ? <span className="unsaved-badge">乱数表へ未反映</span> : null}
            </span>
          </span>
          <span className="chevron" aria-hidden="true">
            {settingsOpen ? "▲" : "▼"}
          </span>
        </button>
        {settingsOpen ? <div className="grid settings-grid">
          <div className="field">
            <label htmlFor="participantCount">参加人数</label>
            <select
              className="select"
              id="participantCount"
              value={participantCount}
              onChange={(event) => updateParticipantCount(Number(event.target.value))}
            >
              {PARTICIPANT_OPTIONS.map((count) => (
                <option key={count} value={count}>
                  {count}人
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="courtCount">コート数</label>
            <select
              className="select"
              id="courtCount"
              value={courtCount}
              onChange={(event) => {
                markScheduleDirty();
                setCourtCount(Number(event.target.value));
              }}
            >
              {COURT_OPTIONS.map((count) => (
                <option key={count} value={count}>
                  {count}コート
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="matchCount">試合数</label>
            <select
              className="select"
              id="matchCount"
              value={matchCount}
              onChange={(event) => {
                markScheduleDirty();
                setMatchCount(Number(event.target.value));
              }}
            >
              {MATCH_OPTIONS.map((count) => (
                <option key={count} value={count}>
                  {count}試合
                </option>
              ))}
            </select>
          </div>
        </div> : null}
      </section>

      <section className="section collapsible">
        <button
          className="section-toggle"
          type="button"
          aria-expanded={namesOpen}
          onClick={() => setNamesOpen((open) => !open)}
        >
          <span>
            <span className="section-title">参加者名</span>
            <span className="section-note">{participantCount}人分</span>
          </span>
          <span className="chevron" aria-hidden="true">
            {namesOpen ? "▲" : "▼"}
          </span>
        </button>
        {namesOpen ? (
          <div className="names">
            {names.map((name, index) => (
              <div className="field" key={index}>
                <label htmlFor={`name-${index}`}>{index + 1}人目</label>
                <input
                  className="input"
                  id={`name-${index}`}
                  inputMode="text"
                  value={name}
                  onChange={(event) => updateName(index, event.target.value)}
                />
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="section collapsible">
        <button
          className="section-toggle"
          type="button"
          aria-expanded={pairsOpen}
          onClick={() => setPairsOpen((open) => !open)}
        >
          <span>
            <span className="section-title">固定ペア</span>
            <span className="section-note">{pairs.length}組</span>
          </span>
          <span className="chevron" aria-hidden="true">
            {pairsOpen ? "▲" : "▼"}
          </span>
        </button>
        {pairsOpen ? (
          <div className="pairs">
            {pairs.length === 0 ? <p className="empty">固定したいペアがある場合だけ追加してください。</p> : null}
            {pairs.map((pair) => (
              <div className="pair-row" key={pair.id}>
                <div className="field">
                  <label htmlFor={`pair-a-${pair.id}`}>参加者A</label>
                  <select
                    className="select"
                    id={`pair-a-${pair.id}`}
                    value={pair.a}
                    onChange={(event) => updatePair(pair.id, "a", event.target.value)}
                  >
                    <option value="">選択</option>
                    {displayNames.map((name, index) => (
                      <option
                        key={index}
                        value={index}
                        disabled={index !== pair.a && usedPairMembers.has(index)}
                      >
                        {name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor={`pair-b-${pair.id}`}>参加者B</label>
                  <select
                    className="select"
                    id={`pair-b-${pair.id}`}
                    value={pair.b}
                    onChange={(event) => updatePair(pair.id, "b", event.target.value)}
                  >
                    <option value="">選択</option>
                    {displayNames.map((name, index) => (
                      <option
                        key={index}
                        value={index}
                        disabled={index !== pair.b && (usedPairMembers.has(index) || index === pair.a)}
                      >
                        {name}
                      </option>
                    ))}
                  </select>
                </div>

                <button className="icon-button" type="button" onClick={() => removePair(pair.id)} aria-label="固定ペアを削除">
                  x
                </button>
              </div>
            ))}
            <button className="secondary" type="button" onClick={addPair}>
              固定ペアを追加
            </button>
          </div>
        ) : null}
      </section>

      {error ? <div className="error" role="alert">{error}</div> : null}

      <section className="section">
        <h2>生成結果</h2>
        {!schedule ? <p className="empty">設定を入力して「乱数表を作成」を押してください。</p> : null}
        {schedule && generatedMeta ? (
          <p className="schedule-meta">
            表示中：{generatedMeta.participantCount}人 / {generatedMeta.courtCount}コート / {generatedMeta.matchCount}試合
          </p>
        ) : null}
        {schedule ? (
          <div className="progress-panel" aria-live="polite">
            <div className="progress-copy">
              <span className="progress-label">進行状況</span>
              <strong>{completedMatchCount} / {schedule.matches.length}試合 終了</strong>
              <span>{nextMatchNumber === null ? "すべての試合が終了しました" : `次は第${nextMatchNumber}試合です`}</span>
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={schedule.matches.length}
              aria-valuenow={completedMatchCount}
            >
              <span style={{ width: `${(completedMatchCount / schedule.matches.length) * 100}%` }} />
            </div>
          </div>
        ) : null}
        {schedule && scheduleDirty ? (
          <div className="notice">
            設定が変更されています。表示中の乱数表は前回作成時の条件です。新しい条件にする場合は「再生成」を押してください。
          </div>
        ) : null}
        {schedule && schedule.activeCourts < generatedCourtCount ? (
          <div className="error">
            参加人数に合わせて、この表では{schedule.activeCourts}コート分を作成しています。
          </div>
        ) : null}
        {schedule?.matches.map((match) => (
          <article
            className={`match ${checkedMatches.has(match.match) ? "match-done" : ""} ${nextMatchNumber === match.match ? "match-current" : ""}`}
            id={`match-${match.match}`}
            key={match.match}
          >
            <label className="match-check">
              <input
                type="checkbox"
                checked={checkedMatches.has(match.match)}
                onChange={() => toggleMatchChecked(match.match)}
              />
              <span>第{match.match}試合</span>
            </label>
            {match.courts.map((court) => (
              <div className="court" key={`${match.match}-${court.court}`}>
                <div className="court-title">コート{court.court}</div>
                <div className="versus">
                  <span className="team-name">{formatTeam(court.teamA, scheduleNames)}</span>
                  <span className="vs-mark">VS</span>
                  <span className="team-name">{formatTeam(court.teamB, scheduleNames)}</span>
                </div>
              </div>
            ))}
            <div className="rest">
              休み：{match.resting.length ? match.resting.map((player) => scheduleNames[player]).join("、") : "なし"}
            </div>
          </article>
        ))}
      </section>

      {schedule ? (
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
                {schedule.stats.map((stat, index) => (
                  <tr key={index}>
                    <td data-label="名前">{scheduleNames[index]}</td>
                    <td data-label="出場">{stat.played}回</td>
                    <td data-label="休み">{stat.rested}回</td>
                    <td data-label="ペア">{mapNames(stat.partners, scheduleNames)}</td>
                    <td data-label="対戦相手">{mapNames(stat.opponents, scheduleNames)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <div className="actions">
        {!schedule ? (
          <button className="primary action-create" type="button" onClick={requestGenerate}>
            乱数表を作成
          </button>
        ) : (
          <>
            <button className="primary action-next" type="button" onClick={scrollToNextMatch} disabled={nextMatchNumber === null}>
              {nextMatchNumber === null ? "全試合終了" : `次の試合へ（第${nextMatchNumber}試合）`}
            </button>
            <button className="share" type="button" onClick={openShareModal}>
              共有リンク
            </button>
            <button className="secondary" type="button" onClick={requestGenerate}>
              {scheduleDirty ? "変更内容で再生成" : "再生成"}
            </button>
          </>
        )}
      </div>

      {passwordOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="password-title" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPasswordOpen(false);
        }}>
          <div className="modal">
            <button className="modal-close" type="button" aria-label="閉じる" onClick={() => setPasswordOpen(false)}>×</button>
            <h2 id="password-title">パスワード</h2>
            <p>乱数表を作成するにはパスワードを入力してください。</p>
            <input
              className="input"
              type="text"
              value={passwordInput}
              autoFocus
              onChange={(event) => {
                setPasswordInput(event.target.value);
                setPasswordError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") confirmGenerate();
                if (event.key === "Escape") setPasswordOpen(false);
              }}
            />
            {passwordError ? <div className="error password-message" role="alert">{passwordError}</div> : null}
            <div className="modal-actions">
              <button className="secondary" type="button" onClick={() => setPasswordOpen(false)}>
                キャンセル
              </button>
              <button className="primary" type="button" onClick={() => void confirmGenerate()} disabled={passwordChecking}>
                {passwordChecking ? "確認中..." : "作成する"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {shareModalOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="share-title" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShareModalOpen(false);
        }}>
          <div className="modal share-modal">
            <button className="modal-close" type="button" aria-label="閉じる" onClick={() => setShareModalOpen(false)}>×</button>
            <h2 id="share-title">共有リンク</h2>
            <p>このQRコードかリンクを共有すると、結果だけ見られます。</p>
            {shareQrCode ? (
              <div className="qr-box">
                <img src={shareQrCode} alt="共有リンクのQRコード" />
              </div>
            ) : (
              <div className="error password-message">
                リンクが長いためQRコードを作成できませんでした。リンクコピーを使ってください。
              </div>
            )}
            <div className="share-url-box">{shareUrl}</div>
            {shareCopied ? <div className="success password-message" role="status">共有リンクをコピーしました</div> : null}
            <div className="modal-actions">
              <button className="secondary" type="button" onClick={() => setShareModalOpen(false)}>
                閉じる
              </button>
              <button className="primary" type="button" onClick={handleShareCopy}>
                リンクをコピー
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

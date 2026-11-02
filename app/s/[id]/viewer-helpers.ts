export type Team = [number, number];
export type MatchPlan = {
  match: number;
  courts: { court: number; teamA: Team; teamB: Team }[];
  resting: number[];
  participants?: number[];
};
export type SharePayload = { title?: string; names: string[]; matches: MatchPlan[] };
export type ParticipantMemory = { name: string; index: number; roster: string[] };
export type ViewerPreference = { participant: ParticipantMemory | null; dismissed: boolean };
type StorageAccess = Pick<Storage, "getItem" | "setItem">;

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object";
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export function normalizePayload(value: unknown): SharePayload | null {
  if (!object(value)) return null;
  const compact = "n" in value && "m" in value;
  const names = compact ? value.n : value.names;
  const rawMatches = compact ? value.m : value.matches;
  if (!Array.isArray(names) || !names.every((name): name is string => typeof name === "string") || !Array.isArray(rawMatches)) return null;
  const player = (id: unknown): id is number => typeof id === "number" && Number.isSafeInteger(id) && id >= 0 && id < names.length;
  const matches: MatchPlan[] = [];
  const ids = new Set<number>();
  for (const [index, raw] of rawMatches.entries()) {
    if (compact ? !Array.isArray(raw) : !object(raw)) return null;
    const match = compact ? index + 1 : raw.match;
    const rawCourts = compact ? raw : raw.courts;
    if (!positive(match) || ids.has(match) || !Array.isArray(rawCourts) || !rawCourts.length) return null;
    ids.add(match);
    const playing = new Set<number>();
    const courts: MatchPlan["courts"] = [];
    const courtIds = new Set<number>();
    for (const [courtIndex, rawCourt] of rawCourts.entries()) {
      if (compact ? !Array.isArray(rawCourt) || rawCourt.length !== 4 : !object(rawCourt)) return null;
      const teamA = compact ? rawCourt.slice(0, 2) : rawCourt.teamA;
      const teamB = compact ? rawCourt.slice(2, 4) : rawCourt.teamB;
      const court = compact ? courtIndex + 1 : rawCourt.court;
      if (!positive(court) || courtIds.has(court) || !Array.isArray(teamA) || teamA.length !== 2 || !Array.isArray(teamB) || teamB.length !== 2) return null;
      courtIds.add(court);
      for (const id of [...teamA, ...teamB]) {
        if (!player(id) || playing.has(id)) return null;
        playing.add(id);
      }
      courts.push({ court, teamA: teamA as Team, teamB: teamB as Team });
    }
    const participants = !compact && raw.participants !== undefined ? raw.participants : names.map((_, id) => id);
    if (!Array.isArray(participants) || !participants.every(player) || [...playing].some((id) => !participants.includes(id))) return null;
    const eligible = [...new Set<number>(participants)];
    matches.push({ match, courts, participants: eligible, resting: eligible.filter((id) => !playing.has(id)) });
  }
  const title = compact ? value.t : value.title;
  return { names, matches, ...(typeof title === "string" ? { title } : {}) };
}

export function normalizeCheckedMatches(value: unknown, matches: MatchPlan[]): Set<number> {
  const valid = new Set(matches.map((match) => match.match));
  return new Set(Array.isArray(value) ? value.filter((id): id is number => positive(id) && valid.has(id)) : []);
}

export function currentMatch(matches: MatchPlan[], checked: ReadonlySet<number>): MatchPlan | null {
  return matches.find((match) => !checked.has(match.match)) ?? null;
}

export function initialJumpTarget(matches: MatchPlan[], checked: ReadonlySet<number>, hash: string): string | null {
  if (hash) {
    try { return decodeURIComponent(hash.replace(/^#/, "")) || null; } catch { return null; }
  }
  const target = currentMatch(matches, checked) ?? matches.at(-1);
  return target ? `match-${target.match}` : null;
}

export function rememberParticipant(names: string[], index: number | null): ParticipantMemory | null {
  return index !== null && Number.isInteger(index) && index >= 0 && index < names.length
    ? { name: names[index], index, roster: [...names] } : null;
}

export function resolveParticipant(memory: ParticipantMemory | null, names: string[]): number | null {
  if (!memory) return null;
  const candidates = names.flatMap((name, index) => name === memory.name ? [index] : []);
  const oldCount = memory.roster.filter((name) => name === memory.name).length;
  if (candidates.length === 1 && oldCount === 1) return candidates[0];
  if (candidates.length && names.length === memory.roster.length && names.every((name, index) => name === memory.roster[index])) return memory.index;
  return null;
}

export function playerStatus(match: MatchPlan | null, player: number | null): string {
  if (!match || player === null) return "";
  const court = match.courts.find((court) => [...court.teamA, ...court.teamB].includes(player));
  if (court) return `コート${court.court}`;
  if (match.resting.includes(player)) return "休み";
  return "不参加";
}

export function readViewerPreference(storage: StorageAccess, shareId: string): ViewerPreference {
  const fallback = { participant: null, dismissed: false };
  try {
    const value: unknown = JSON.parse(storage.getItem(`pickleball-shared-viewer-v1:${encodeURIComponent(shareId)}`) ?? "null");
    if (!object(value) || value.version !== 1) return fallback;
    let participant: ParticipantMemory | null = null;
    const saved = value.participant;
    if (object(saved) && typeof saved.name === "string" && typeof saved.index === "number" && Number.isInteger(saved.index)
      && Array.isArray(saved.roster) && saved.roster.every((name): name is string => typeof name === "string")
      && saved.index >= 0 && saved.index < saved.roster.length && saved.roster[saved.index] === saved.name) {
      participant = { name: saved.name, index: saved.index, roster: saved.roster };
    }
    return { participant, dismissed: value.dismissed === true };
  } catch { return fallback; }
}

export function saveViewerPreference(storage: StorageAccess, shareId: string, preference: ViewerPreference): void {
  try { storage.setItem(`pickleball-shared-viewer-v1:${encodeURIComponent(shareId)}`, JSON.stringify({ version: 1, ...preference })); } catch { /* Viewing also works without persistent storage. */ }
}

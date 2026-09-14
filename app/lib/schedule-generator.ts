export type PairSetting = {
  id: string;
  a: number | "";
  b: number | "";
};

export type Team = [number, number];

export type CourtPlan = {
  court: number;
  teamA: Team;
  teamB: Team;
};

export type MatchPlan = {
  match: number;
  courts: CourtPlan[];
  resting: number[];
  participants?: number[];
};

export type PlayerStats = {
  played: number;
  rested: number;
  partners: Map<number, number>;
  opponents: Map<number, number>;
};

export type GeneratedSchedule = {
  matches: MatchPlan[];
  stats: PlayerStats[];
  activeCourts: number;
};

export type ScheduleConstraintAnalysis = {
  activeCourts: number;
  forcedPlayers: number[];
  possible: boolean;
};

type Unit = {
  members: number[];
  fixed: boolean;
};

type RandomSource = () => number;

function pairKey(a: number, b: number) {
  return [Math.min(a, b), Math.max(a, b)].join("-");
}

export function addCount(map: Map<number, number>, key: number, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function shuffle<T>(items: T[], random: RandomSource) {
  const copied = [...items];
  for (let index = copied.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copied[index], copied[swapIndex]] = [copied[swapIndex], copied[index]];
  }
  return copied;
}

function spread(values: number[]) {
  return Math.max(...values) - Math.min(...values);
}

function varianceNumerator(values: number[]) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.reduce((sum, value) => {
    const distance = value * values.length - total;
    return sum + distance * distance;
  }, 0);
}

export function createStats(count: number): PlayerStats[] {
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
  const units: Unit[] = fixedPairs.map((pair) => ({ members: pair, fixed: true }));

  for (let player = 0; player < participantCount; player += 1) {
    if (!fixedMembers.has(player)) units.push({ members: [player], fixed: false });
  }

  return units;
}

function canFillPlayerCount(units: Unit[], targetPlayers: number) {
  const reachable = new Set<number>([0]);
  for (const unit of units) {
    for (const count of Array.from(reachable).sort((left, right) => right - left)) {
      const next = count + unit.members.length;
      if (next <= targetPlayers) reachable.add(next);
    }
  }
  return reachable.has(targetPlayers);
}

export function analyzeScheduleConstraints(
  participantCount: number,
  requestedCourtCount: number,
  pairs: PairSetting[]
): ScheduleConstraintAnalysis {
  const activeCourts = Math.min(requestedCourtCount, Math.floor(participantCount / 4));
  if (activeCourts < 1) return { activeCourts: 0, forcedPlayers: [], possible: false };

  const units = buildUnits(participantCount, normalizePairs(pairs, participantCount));
  const targetPlayers = activeCourts * 4;
  const possible = canFillPlayerCount(units, targetPlayers);
  if (!possible || targetPlayers === participantCount) {
    return { activeCourts, forcedPlayers: [], possible };
  }

  // そのユニットを除くと必要人数を満たせない場合、その参加者は毎試合出場必須です。
  // 固定ペアによって完全な回数平等が不可能な条件を、生成前に画面で説明するために使います。
  const forcedPlayers = units.flatMap((unit, unitIndex) => (
    canFillPlayerCount(units.filter((_, index) => index !== unitIndex), targetPlayers)
      ? []
      : unit.members
  ));

  return { activeCourts, forcedPlayers, possible };
}

function enumerateUnitSelections(units: Unit[], targetPlayers: number) {
  const selections: Unit[][] = [];

  function visit(index: number, selected: Unit[], selectedPlayers: number) {
    if (selectedPlayers === targetPlayers) {
      selections.push([...selected]);
      return;
    }
    if (index >= units.length || selectedPlayers > targetPlayers) return;

    const unit = units[index];
    selected.push(unit);
    visit(index + 1, selected, selectedPlayers + unit.members.length);
    selected.pop();
    visit(index + 1, selected, selectedPlayers);
  }

  visit(0, [], 0);
  return selections;
}

function chooseCandidateUnits(
  units: Unit[],
  targetPlayers: number,
  stats: PlayerStats[],
  restStreaks: number[],
  random: RandomSource
) {
  // 固定ペアは2人で1枠として選びます。大人数時は全組み合わせを調べると
  // スマホで重くなるため、出場の少ない人を軸にした候補を繰り返し作ります。
  // 並び順どおりの選択で必要人数に届かない場合は一つ前まで戻って別候補を試すため、
  // 固定ペアが毎試合必須になる13人・3コート等でも、作成可能な候補を取り逃しません。
  const weighted = units
    .map((unit) => {
      const averagePlayed = unit.members.reduce((sum, member) => sum + stats[member].played, 0) / unit.members.length;
      const longestRest = Math.max(...unit.members.map((member) => restStreaks[member]));
      return { unit, priority: averagePlayed * 100 - longestRest * 5 + random() * 0.75 };
    })
    .sort((left, right) => left.priority - right.priority);

  const ordered = weighted.map(({ unit }) => unit);
  const remainingPlayers = Array.from({ length: ordered.length + 1 }, () => 0);
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    remainingPlayers[index] = remainingPlayers[index + 1] + ordered[index].members.length;
  }

  function visit(index: number, selected: Unit[], selectedPlayers: number): Unit[] | null {
    if (selectedPlayers === targetPlayers) return [...selected];
    if (
      index >= ordered.length ||
      selectedPlayers > targetPlayers ||
      selectedPlayers + remainingPlayers[index] < targetPlayers
    ) return null;

    const unit = ordered[index];
    if (selectedPlayers + unit.members.length <= targetPlayers) {
      selected.push(unit);
      const included = visit(index + 1, selected, selectedPlayers + unit.members.length);
      selected.pop();
      if (included) return included;
    }

    return visit(index + 1, selected, selectedPlayers);
  }

  return visit(0, [], 0);
}

function buildTeamsFromUnits(selectedUnits: Unit[], random: RandomSource) {
  const teams: Team[] = [];
  const singles: number[] = [];

  for (const unit of selectedUnits) {
    if (unit.fixed) teams.push([unit.members[0], unit.members[1]]);
    else singles.push(unit.members[0]);
  }

  const shuffledSingles = shuffle(singles, random);
  if (shuffledSingles.length % 2 !== 0) return null;

  for (let index = 0; index < shuffledSingles.length; index += 2) {
    teams.push([shuffledSingles[index], shuffledSingles[index + 1]]);
  }

  return shuffle(teams, random);
}

function buildCourts(teams: Team[], courtCount: number, random: RandomSource) {
  const shuffledTeams = shuffle(teams, random);
  if (shuffledTeams.length !== courtCount * 2) return null;

  return Array.from({ length: courtCount }, (_, index) => ({
    court: index + 1,
    teamA: shuffledTeams[index * 2],
    teamB: shuffledTeams[index * 2 + 1]
  }));
}

function scoreCandidate(
  courts: CourtPlan[],
  participantCount: number,
  stats: PlayerStats[],
  restStreaks: number[],
  fixedPairKeys: Set<string>,
  random: RandomSource
) {
  const playing = new Set<number>();
  const partnerRepeats: number[] = [];
  const opponentRepeats: number[] = [];

  for (const court of courts) {
    for (const player of [...court.teamA, ...court.teamB]) playing.add(player);

    // 固定ペアの重複は避けられないため、ペア重複の罰点から除外します。
    // ここを数えると、試合後半ほど固定ペアを休ませる方向へ不自然に偏ります。
    if (!fixedPairKeys.has(pairKey(...court.teamA))) {
      partnerRepeats.push(stats[court.teamA[0]].partners.get(court.teamA[1]) ?? 0);
    }
    if (!fixedPairKeys.has(pairKey(...court.teamB))) {
      partnerRepeats.push(stats[court.teamB[0]].partners.get(court.teamB[1]) ?? 0);
    }

    for (const player of court.teamA) {
      for (const opponent of court.teamB) {
        opponentRepeats.push(stats[player].opponents.get(opponent) ?? 0);
      }
    }
  }

  const playedAfter = stats.map((stat, index) => stat.played + (playing.has(index) ? 1 : 0));
  const restedAfter = stats.map((stat, index) => stat.rested + (playing.has(index) ? 0 : 1));
  const restStreaksAfter = restStreaks.map((streak, index) => (playing.has(index) ? 0 : streak + 1));
  const longRestPenalty = restStreaksAfter.reduce((sum, streak) => sum + (streak >= 3 ? (streak - 2) ** 2 : 0), 0);
  const repeatedRestPenalty = restStreaksAfter.filter((streak) => streak === 2).length;
  const partnerPenalty = partnerRepeats.reduce((sum, count) => sum + count * count, 0);
  const opponentPenalty = opponentRepeats.reduce((sum, count) => sum + count * count, 0);

  // スコアは小さいほど良い候補です。
  // 出場回数の差は最優先のまま、3連続以上の休みには非常に大きな罰点を付けます。
  // 一方、8人・1コートで全員を完全に交互出場させると同じ4人組が固定されるため、
  // 2連続休みの罰点は抑え、ペアの入れ替わりが起きる余地を残しています。
  return (
    spread(playedAfter) * 1_000_000_000 +
    varianceNumerator(playedAfter) * 1_000_000 +
    spread(restedAfter) * 200_000 +
    varianceNumerator(restedAfter) * 2_000 +
    longRestPenalty * 5_000_000 +
    repeatedRestPenalty * 500 +
    Math.max(0, ...partnerRepeats) * 8_000 +
    partnerPenalty * 3_000 +
    Math.max(0, ...opponentRepeats) * 500 +
    opponentPenalty * 120 +
    random()
  );
}

export function applyMatchStats(
  courts: CourtPlan[],
  stats: PlayerStats[],
  participantCount: number,
  eligiblePlayers?: number[]
) {
  const playing = new Set<number>();
  const eligible = new Set(eligiblePlayers ?? Array.from({ length: participantCount }, (_, index) => index));

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

  for (const player of eligible) {
    if (playing.has(player)) stats[player].played += 1;
    else stats[player].rested += 1;
  }

  return Array.from(eligible).filter((player) => !playing.has(player));
}

function cloneStats(stats: PlayerStats[]) {
  return stats.map((stat) => ({
    played: stat.played,
    rested: stat.rested,
    partners: new Map(stat.partners),
    opponents: new Map(stat.opponents)
  }));
}

export function generateSchedule(
  participantCount: number,
  requestedCourtCount: number,
  matchCount: number,
  pairs: PairSetting[],
  initialStats?: PlayerStats[],
  initiallyRestedLastMatch?: Set<number>,
  random: RandomSource = Math.random
): GeneratedSchedule {
  const activeCourts = Math.min(requestedCourtCount, Math.floor(participantCount / 4));
  if (activeCourts < 1) throw new Error("4人以上で作成してください。");

  const fixedPairs = normalizePairs(pairs, participantCount);
  const fixedPairKeys = new Set(fixedPairs.map((pair) => pairKey(...pair)));
  const units = buildUnits(participantCount, fixedPairs);
  const targetPlayers = activeCourts * 4;
  const stats = initialStats ? cloneStats(initialStats) : createStats(participantCount);
  const matches: MatchPlan[] = [];
  let restStreaks: number[] = Array.from(
    { length: participantCount },
    (_, player) => (initiallyRestedLastMatch?.has(player) ? 1 : 0)
  );

  // 10ユニット以下なら出場者の全組み合わせを調べます。今回の8人条件では
  // 可能な30通りを漏れなく比較でき、ランダム抽選の取り逃しを防げます。
  const exactSelections = units.length <= 10 ? enumerateUnitSelections(units, targetPlayers) : null;
  if (exactSelections && exactSelections.length === 0) {
    throw new Error("現在の参加人数・コート数・固定ペア数では、組み合わせを作成できません。固定ペアを減らすか、コート数を変更してください。");
  }

  for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) {
    let bestCourts: CourtPlan[] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const attemptCount = exactSelections ? Math.max(900, exactSelections.length * 24) : 1_400;

    for (let attempt = 0; attempt < attemptCount; attempt += 1) {
      const selectedUnits = exactSelections
        ? exactSelections[attempt % exactSelections.length]
        : chooseCandidateUnits(units, targetPlayers, stats, restStreaks, random);
      if (!selectedUnits) continue;

      const teams = buildTeamsFromUnits(selectedUnits, random);
      if (!teams) continue;
      const courts = buildCourts(teams, activeCourts, random);
      if (!courts) continue;

      const score = scoreCandidate(courts, participantCount, stats, restStreaks, fixedPairKeys, random);
      if (score < bestScore) {
        bestCourts = courts;
        bestScore = score;
      }
    }

    if (!bestCourts) {
      throw new Error("現在の参加人数・コート数・固定ペア数では、組み合わせを作成できません。固定ペアを減らすか、コート数を変更してください。");
    }

    const resting = applyMatchStats(bestCourts, stats, participantCount);
    const restingSet = new Set(resting);
    restStreaks = restStreaks.map((streak, player) => (restingSet.has(player) ? streak + 1 : 0));
    matches.push({ match: matchIndex + 1, courts: bestCourts, resting });
  }

  return { matches, stats, activeCourts };
}

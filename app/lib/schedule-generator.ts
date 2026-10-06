export type PairSetting = {
  id: string;
  a: number | "";
  b: number | "";
};

export type Team = [number, number];

export type AlwaysPlayingCourts = Record<number, number>;

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
  alwaysPlayingPlayers: number[];
  alwaysPlayingCourts: AlwaysPlayingCourts;
  forcedPlayers: number[];
  possible: boolean;
  error?: string;
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
  return values.length ? Math.max(...values) - Math.min(...values) : 0;
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

export function getParticipantUnits(participantCount: number, pairs: PairSetting[]): number[][] {
  return buildUnits(participantCount, normalizePairs(pairs, participantCount)).map((unit) => unit.members);
}

function splitAttendanceUnits(units: Unit[], alwaysPlayingPlayers: number[]) {
  const selected = new Set(alwaysPlayingPlayers.filter((player) => Number.isInteger(player)));
  // 固定ペアの片方が指定されている場合は、ユニット全体を必須出場にします。
  // これにより「休みなし」と「ペア固定」を両立し、片方だけが休む候補を作りません。
  const required = units.filter((unit) => unit.members.some((player) => selected.has(player)));
  const optional = units.filter((unit) => !unit.members.some((player) => selected.has(player)));
  return { required, optional };
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

function feasibleOptionalPairCounts(
  required: Unit[],
  optional: Unit[],
  courtCount: number,
  assignedCourts: AlwaysPlayingCourts
) {
  const capacities = Array.from({ length: courtCount }, () => 4);
  const flexibleRequired = required.filter((unit) => {
    const court = assignedCourts[unit.members[0]];
    if (court === undefined) return true;
    capacities[court - 1] -= unit.members.length;
    return false;
  });
  if (capacities.some((capacity) => capacity < 0)) return [];

  // 固定ペアは2枠、個人は1枠を使います。コートごとの残り枠が奇数なら、
  // 最低1人の個人参加者が必要です。総人数だけでなく、この内訳も厳密に判定します。
  const availableSlots = capacities.reduce((sum, capacity) => sum + capacity, 0);
  const pairCapacity = capacities.reduce((sum, capacity) => sum + Math.floor(capacity / 2), 0);
  const requiredPairs = flexibleRequired.filter((unit) => unit.fixed).length;
  const requiredSingles = flexibleRequired.length - requiredPairs;
  const optionalPairs = optional.filter((unit) => unit.fixed).length;
  const optionalSingles = optional.length - optionalPairs;
  const counts: number[] = [];
  for (let pairCount = 0; pairCount <= optionalPairs; pairCount += 1) {
    const totalPairs = requiredPairs + pairCount;
    const singlesNeeded = availableSlots - totalPairs * 2 - requiredSingles;
    if (totalPairs <= pairCapacity && singlesNeeded >= 0 && singlesNeeded <= optionalSingles) {
      counts.push(pairCount);
    }
  }
  return counts;
}

export function analyzeScheduleConstraints(
  participantCount: number,
  requestedCourtCount: number,
  pairs: PairSetting[],
  alwaysPlayingPlayers: number[] = [],
  alwaysPlayingCourts: AlwaysPlayingCourts = {}
): ScheduleConstraintAnalysis {
  const activeCourts = Math.min(requestedCourtCount, Math.floor(participantCount / 4));
  if (activeCourts < 1) return { activeCourts: 0, alwaysPlayingPlayers: [], alwaysPlayingCourts: {}, forcedPlayers: [], possible: false, error: "4人以上で作成してください。" };

  const units = buildUnits(participantCount, normalizePairs(pairs, participantCount));
  const { required, optional } = splitAttendanceUnits(units, alwaysPlayingPlayers);
  const requiredPlayers = required.flatMap((unit) => unit.members).sort((left, right) => left - right);
  const assignedCourts: AlwaysPlayingCourts = {};
  const result = { activeCourts, alwaysPlayingPlayers: requiredPlayers, alwaysPlayingCourts: assignedCourts, forcedPlayers: [] as number[] };
  const targetPlayers = activeCourts * 4;
  const remainingPlayers = targetPlayers - requiredPlayers.length;
  const possible = remainingPlayers >= 0 && canFillPlayerCount(optional, remainingPlayers);
  if (!possible) {
    const error = remainingPlayers < 0
      ? `休みなしの対象は固定ペアの相手を含めて${requiredPlayers.length}人ですが、${activeCourts}コートの出場枠は${targetPlayers}人です。対象を減らすか、コート数を増やしてください。`
      : `休みなしの${requiredPlayers.length}人を入れると残りの出場枠は${remainingPlayers}人ですが、固定ペアを崩さずにこの人数を選べません。休みなしの対象・固定ペア・コート数を変更してください。`;
    return { ...result, possible, error };
  }
  for (const unit of required) {
    const specified = [...new Set(unit.members.map((player) => alwaysPlayingCourts[player])
      .filter((court) => court !== undefined))];
    if (specified.length > 1) {
      return { ...result, possible: false, error: `固定ペアの${unit.members.map((player) => `${player + 1}人目`).join("・")}に異なるコートが指定されています。このペアの出場コートを1つにそろえてください。` };
    }
    if (!specified.length) continue;
    const court = specified[0];
    if (!Number.isInteger(court) || court < 1 || court > activeCourts) {
      return { ...result, possible: false, error: `指定したコート${court}は使用できません。現在の参加人数・コート数で使えるのはコート1〜${activeCourts}です。出場コートの指定か基本設定を変更してください。` };
    }
    for (const player of unit.members) assignedCourts[player] = court;
  }
  for (let court = 1; court <= activeCourts; court += 1) {
    const assignedCount = Object.values(assignedCourts).filter((value) => value === court).length;
    if (assignedCount > 4) {
      return { ...result, possible: false, error: `コート${court}の休みなしの対象は${assignedCount}人ですが、1コートの出場枠は4人です。このコートの対象を減らすか、ほかのコートに変更してください。` };
    }
  }
  if (!feasibleOptionalPairCounts(required, optional, activeCourts, assignedCourts).length) {
    return { ...result, possible: false, error: "指定コートの残り枠を、固定ペアを崩さずに埋められません。固定ペアは2人まとめて入るため、残り1人や3人の枠には個人参加者も必要です。出場コートの指定・休みなしの対象・固定ペアを変更してください。" };
  }
  if (targetPlayers === participantCount) {
    return { ...result, possible };
  }

  // そのユニットを除くと必要人数を満たせない場合、その参加者は毎試合出場必須です。
  // 固定ペアによって完全な回数平等が不可能な条件を、生成前に画面で説明するために使います。
  const forcedPlayers = optional.flatMap((unit, unitIndex) => (
    feasibleOptionalPairCounts(required, optional.filter((_, index) => index !== unitIndex), activeCourts, assignedCourts).length
      ? []
      : unit.members
  ));

  return { ...result, forcedPlayers, possible };
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
  random: RandomSource,
  optionalPairCounts?: number[]
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
  if (optionalPairCounts) {
    // 指定コートに収まるペア数だけを候補にします。総人数は合っていても、
    // 個人の不足で各コートの奇数枠を埋められない候補は、最初から選びません。
    const pairCount = optionalPairCounts[Math.floor(random() * optionalPairCounts.length)];
    return [
      ...ordered.filter((unit) => unit.fixed).slice(0, pairCount),
      ...ordered.filter((unit) => !unit.fixed).slice(0, targetPlayers - pairCount * 2)
    ];
  }
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

function buildAssignedCourts(
  units: Unit[],
  courtCount: number,
  assignedCourts: AlwaysPlayingCourts,
  random: RandomSource
): CourtPlan[] | null {
  const courtUnits: Unit[][] = Array.from({ length: courtCount }, () => []);
  const capacities = Array.from({ length: courtCount }, () => 4);
  const flexible = units.filter((unit) => {
    const court = assignedCourts[unit.members[0]];
    if (court === undefined) return true;
    courtUnits[court - 1].push(unit);
    capacities[court - 1] -= unit.members.length;
    return false;
  });
  if (capacities.some((capacity) => capacity < 0)) return null;

  // 指定者を先に配置し、動かせる固定ペアを2枠ずつ、その後に個人を入れます。
  // ペアから先に埋めると1枠しか残らない場所へペアを入れようとする失敗を防げます。
  // 各コート内でチームを作るため、個人同士をランダムに組ませてから指定コートが
  // 食い違うチームを捨てる方法より、成立する配置を確実に生成できます。
  const ordered = [
    ...shuffle(flexible.filter((unit) => unit.fixed), random),
    ...shuffle(flexible.filter((unit) => !unit.fixed), random)
  ];
  for (const unit of ordered) {
    const availableCourts = capacities.flatMap((capacity, index) => capacity >= unit.members.length ? [index] : []);
    if (!availableCourts.length) return null;
    const court = availableCourts[Math.floor(random() * availableCourts.length)];
    courtUnits[court].push(unit);
    capacities[court] -= unit.members.length;
  }
  if (capacities.some((capacity) => capacity !== 0)) return null;
  const courts: CourtPlan[] = [];
  for (let index = 0; index < courtCount; index += 1) {
    const teams = buildTeamsFromUnits(courtUnits[index], random);
    if (!teams || teams.length !== 2) return null;
    courts.push({ court: index + 1, teamA: teams[0], teamB: teams[1] });
  }
  return courts;
}

function scoreCandidate(
  courts: CourtPlan[],
  participantCount: number,
  stats: PlayerStats[],
  restStreaks: number[],
  fixedPairKeys: Set<string>,
  alwaysPlayingPlayers: Set<number>,
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

  // 休みなしの対象は必ず出場するため、公平性の比較から外します。
  // 対象者との回数差を埋めようとすると、残りの参加者間の配分が偏るためです。
  // 集計そのものには全員を含め、ペア・対戦の重複も全員分を評価します。
  const playedAfter = stats.flatMap((stat, index) => alwaysPlayingPlayers.has(index)
    ? [] : [stat.played + (playing.has(index) ? 1 : 0)]);
  const restedAfter = stats.flatMap((stat, index) => alwaysPlayingPlayers.has(index)
    ? [] : [stat.rested + (playing.has(index) ? 0 : 1)]);
  const restStreaksAfter = restStreaks.map((streak, index) => (playing.has(index) ? 0 : streak + 1));
  const rotatingSlots = playing.size - alwaysPlayingPlayers.size;
  // 必須者が増えると、ほかの人に回せる枠が減ります。たとえば6人に2枠を回す場合、
  // 常に2連続休みまでに制限すると同じ2人組の交互出場が固定されてしまいます。
  // 休みなし設定時は人数と残り枠から休みの目安を計算し、1試合分の入れ替え余地を設けます。
  const restLimit = alwaysPlayingPlayers.size && rotatingSlots > 0
    ? Math.max(2, Math.ceil(playedAfter.length / rotatingSlots))
    : 2;
  const longRestPenalty = restStreaksAfter.reduce((sum, streak) => sum + Math.max(0, streak - restLimit) ** 2, 0);
  const repeatedRestPenalty = restStreaksAfter.reduce((sum, streak) => sum + (streak >= 2 && streak <= restLimit ? streak - 1 : 0), 0);
  const partnerPenalty = partnerRepeats.reduce((sum, count) => sum + count * count, 0);
  const opponentPenalty = opponentRepeats.reduce((sum, count) => sum + count * count, 0);

  // スコアは小さいほど良い候補です。
  // 出場回数の差は最優先のまま、休みの目安を超える連続休みには大きな罰点を付けます。
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
  random: RandomSource = Math.random,
  alwaysPlayingPlayers: number[] = [],
  alwaysPlayingCourts: AlwaysPlayingCourts = {}
): GeneratedSchedule {
  const analysis = analyzeScheduleConstraints(participantCount, requestedCourtCount, pairs, alwaysPlayingPlayers, alwaysPlayingCourts);
  if (!analysis.possible) throw new Error(analysis.error);
  const activeCourts = analysis.activeCourts;

  const fixedPairs = normalizePairs(pairs, participantCount);
  const fixedPairKeys = new Set(fixedPairs.map((pair) => pairKey(...pair)));
  const units = buildUnits(participantCount, fixedPairs);
  const { required, optional } = splitAttendanceUnits(units, analysis.alwaysPlayingPlayers);
  const requiredPlayers = new Set(analysis.alwaysPlayingPlayers);
  const targetPlayers = activeCourts * 4;
  const remainingPlayers = targetPlayers - requiredPlayers.size;
  const hasAssignedCourts = Object.keys(analysis.alwaysPlayingCourts).length > 0;
  const optionalPairCounts = hasAssignedCourts
    ? feasibleOptionalPairCounts(required, optional, activeCourts, analysis.alwaysPlayingCourts)
    : undefined;
  const stats = initialStats ? cloneStats(initialStats) : createStats(participantCount);
  const matches: MatchPlan[] = [];
  let restStreaks: number[] = Array.from(
    { length: participantCount },
    (_, player) => (initiallyRestedLastMatch?.has(player) ? 1 : 0)
  );

  // 10ユニット以下なら出場者の全組み合わせを調べます。今回の8人条件では
  // 可能な30通りを漏れなく比較でき、ランダム抽選の取り逃しを防げます。
  // 必須出場のユニットは先に確保し、残りの枠だけを公平性スコアで比較します。
  // 必須者を「出やすくする」罰点方式ではなく候補の前提とするので、休みは発生しません。
  const exactSelections = optional.length <= 10
    ? enumerateUnitSelections(optional, remainingPlayers).filter((selection) => !optionalPairCounts
      || optionalPairCounts.includes(selection.filter((unit) => unit.fixed).length))
    : null;
  if (exactSelections && exactSelections.length === 0) {
    throw new Error("現在の参加人数・コート数・固定ペア数では、組み合わせを作成できません。固定ペアを減らすか、コート数を変更してください。");
  }

  for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) {
    let bestCourts: CourtPlan[] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const attemptCount = exactSelections ? Math.max(900, exactSelections.length * 24) : 1_400;

    for (let attempt = 0; attempt < attemptCount; attempt += 1) {
      const selectedOptionalUnits = exactSelections
        ? exactSelections[attempt % exactSelections.length]
        : chooseCandidateUnits(optional, remainingPlayers, stats, restStreaks, random, optionalPairCounts);
      if (!selectedOptionalUnits) continue;

      const selectedUnits = [...required, ...selectedOptionalUnits];
      const teams = hasAssignedCourts ? null : buildTeamsFromUnits(selectedUnits, random);
      const courts = hasAssignedCourts
        ? buildAssignedCourts(selectedUnits, activeCourts, analysis.alwaysPlayingCourts, random)
        : teams && buildCourts(teams, activeCourts, random);
      if (!courts) continue;

      const score = scoreCandidate(courts, participantCount, stats, restStreaks, fixedPairKeys, requiredPlayers, random);
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

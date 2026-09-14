import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeScheduleConstraints,
  generateSchedule,
  type GeneratedSchedule,
  type PairSetting
} from "../app/lib/schedule-generator.ts";

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function longestRestStreak(schedule: GeneratedSchedule, player: number) {
  let longest = 0;
  let current = 0;
  for (const match of schedule.matches) {
    if (match.resting.includes(player)) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

test("8人・1コート・固定1組でも休みと通常ペアが偏りすぎない", () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const schedule = generateSchedule(
      8,
      1,
      20,
      [{ id: "fixed", a: 0, b: 1 }],
      undefined,
      undefined,
      seededRandom(seed)
    );

    const playedCounts = schedule.stats.map((stat) => stat.played);
    assert.ok(Math.max(...playedCounts) - Math.min(...playedCounts) <= 1, `seed ${seed}: 出場回数に差がある`);

    for (let player = 0; player < 8; player += 1) {
      assert.ok(longestRestStreak(schedule, player) <= 2, `seed ${seed}: ${player + 1}番が3連続休み`);
    }

    for (const match of schedule.matches) {
      const fixedPlaying = !match.resting.includes(0);
      assert.equal(fixedPlaying, !match.resting.includes(1), `seed ${seed}: 固定ペアが別々に出場`);
      if (fixedPlaying) {
        const teams = match.courts.flatMap((court) => [court.teamA, court.teamB]);
        assert.ok(teams.some((team) => team.includes(0) && team.includes(1)), `seed ${seed}: 固定ペアが分断`);
      }
    }

    let largestNormalPairCount = 0;
    for (let player = 0; player < 8; player += 1) {
      for (const [partner, count] of schedule.stats[player].partners) {
        if ((player === 0 && partner === 1) || (player === 1 && partner === 0)) continue;
        largestNormalPairCount = Math.max(largestNormalPairCount, count);
      }
    }
    assert.ok(largestNormalPairCount <= 4, `seed ${seed}: 通常ペアが${largestNormalPairCount}回重複`);
  }
});

function assertScheduleIntegrity(
  schedule: GeneratedSchedule,
  participantCount: number,
  requestedCourtCount: number,
  fixedPairs: PairSetting[]
) {
  const activeCourts = Math.min(requestedCourtCount, Math.floor(participantCount / 4));
  assert.equal(schedule.activeCourts, activeCourts);
  assert.equal(schedule.matches.length, 20);

  for (const match of schedule.matches) {
    assert.equal(match.courts.length, activeCourts);
    const playing = match.courts.flatMap((court) => [...court.teamA, ...court.teamB]);
    assert.equal(new Set(playing).size, activeCourts * 4, "同じ試合に同一参加者が重複している");

    const expectedResting = Array.from({ length: participantCount }, (_, player) => player)
      .filter((player) => !playing.includes(player));
    assert.deepEqual([...match.resting].sort((a, b) => a - b), expectedResting);

    for (const pair of fixedPairs) {
      if (pair.a === "" || pair.b === "") continue;
      const pairPlaying = playing.includes(pair.a) || playing.includes(pair.b);
      if (!pairPlaying) continue;
      assert.ok(playing.includes(pair.a) && playing.includes(pair.b), "固定ペアの片方だけが出場している");
      assert.ok(
        match.courts.flatMap((court) => [court.teamA, court.teamB])
          .some((team) => team.includes(pair.a as number) && team.includes(pair.b as number)),
        "固定ペアが別チームになっている"
      );
    }
  }

  for (let player = 0; player < participantCount; player += 1) {
    const actualPlayed = schedule.matches.filter((match) => !match.resting.includes(player)).length;
    assert.equal(schedule.stats[player].played, actualPlayed);
    assert.equal(schedule.stats[player].rested, 20 - actualPlayed);
  }
}

test("4〜20人・1〜5コート・固定ペア0〜複数組で必ず正しい表を作る", () => {
  let seed = 100;
  for (let participantCount = 4; participantCount <= 20; participantCount += 1) {
    for (let courtCount = 1; courtCount <= 5; courtCount += 1) {
      const pairPatterns: PairSetting[][] = [
        [],
        [{ id: "fixed-1", a: 0, b: 1 }],
        [
          { id: "fixed-1", a: 0, b: 1 },
          { id: "fixed-2", a: 2, b: 3 }
        ]
      ];

      for (const fixedPairs of pairPatterns) {
        const analysis = analyzeScheduleConstraints(participantCount, courtCount, fixedPairs);
        assert.equal(analysis.possible, true);
        const schedule = generateSchedule(
          participantCount,
          courtCount,
          20,
          fixedPairs,
          undefined,
          undefined,
          seededRandom(seed)
        );
        assertScheduleIntegrity(schedule, participantCount, courtCount, fixedPairs);
        seed += 1;
      }
    }
  }
});

test("固定ペアが毎試合必須になる条件を生成前に検出する", () => {
  for (const [participantCount, courtCount] of [[5, 1], [9, 2], [13, 3], [17, 4]]) {
    const pairs: PairSetting[] = [{ id: "fixed", a: 0, b: 1 }];
    const analysis = analyzeScheduleConstraints(participantCount, courtCount, pairs);
    assert.equal(analysis.possible, true);
    assert.deepEqual(analysis.forcedPlayers, [0, 1]);
    assert.doesNotThrow(() => generateSchedule(
      participantCount,
      courtCount,
      20,
      pairs,
      undefined,
      undefined,
      seededRandom(participantCount)
    ));
  }
});

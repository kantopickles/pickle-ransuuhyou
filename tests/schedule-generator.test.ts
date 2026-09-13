import assert from "node:assert/strict";
import test from "node:test";
import { generateSchedule, type GeneratedSchedule } from "../app/lib/schedule-generator.ts";

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

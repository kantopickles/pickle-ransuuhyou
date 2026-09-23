import assert from "node:assert/strict";
import test from "node:test";
import {
  addEstimatedParticipantCounts,
  normalizeTennisBearEvents,
  normalizeTennisBearTournamentEvents,
  readTennisBearCapacity
} from "../app/lib/tennisbear-events.ts";

test("テニスベアの予定を共有画面用に変換する", () => {
  const events = normalizeTennisBearEvents([
    {
      id: 123,
      eventTitle: "ピックル練習会",
      datetimeForDisplay: "10/3(土) 9:00-12:00",
      dateForDisplay: "10/3(土)",
      startDatetimeString: "2026-10-03T09:00:00.000+09:00",
      place: { name: "市民体育館" },
      isFull: false,
      callOff: false,
      wanted: true,
      pickleballFlg: true,
      nowParticipantsNumberAndMaxParticipantsNumberForDisplay: "8人/12人"
    }
  ]);

  assert.deepEqual(events, [{
    date: "10/3",
    day: "土",
    title: "ピックル練習会",
    location: "市民体育館 / 9:00-12:00",
    status: "募集中 8人/12人",
    url: "https://www.tennisbear.net/pickleball/event/123/info"
  }]);
});

test("中止・テニスイベントを除外し、日時順で最大10件にする", () => {
  const source = Array.from({ length: 13 }, (_, index) => ({
    id: index + 1,
    eventTitle: `予定${index + 1}`,
    datetimeForDisplay: `10/${index + 1}(土) 9:00-12:00`,
    dateForDisplay: `10/${index + 1}(土)`,
    startDatetimeString: `2026-10-${String(index + 1).padStart(2, "0")}T09:00:00.000+09:00`,
    place: { name: "体育館" },
    isFull: index === 1,
    callOff: index === 11,
    wanted: true,
    pickleballFlg: index !== 12
  })).reverse();

  const events = normalizeTennisBearEvents(source);
  assert.equal(events.length, 10);
  assert.equal(events[0].title, "予定1");
  assert.equal(events[1].status, "満員");
  assert.equal(events[9].title, "予定10");
});

test("大会一覧ではTOURNAMENTだけを抽出して通常練習会を除外する", () => {
  const shared = {
    datetimeForDisplay: "10/25(日) 9:00-13:30",
    dateForDisplay: "10/25(日)",
    startDatetimeString: "2026-10-25T09:00:00.000+09:00",
    place: { name: "毎日興業アリーナ 第二体育館" },
    callOff: false,
    wanted: true,
    pickleballFlg: true
  };
  const events = normalizeTennisBearTournamentEvents([
    { ...shared, id: 1, eventType: "NORMAL", eventTitle: "ピックルボール練習会", isFull: false },
    { ...shared, id: 2, eventType: "TOURNAMENT", eventTitle: "関東Pickle's杯", isFull: true }
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "関東Pickle's杯");
  assert.equal(events[0].status, "満員");
  assert.equal(events[0].url, "https://www.tennisbear.net/pickleball/event/2/info");
});

test("詳細ページから人・ペア・チームの実定員を読み取る", () => {
  assert.deepEqual(readTennisBearCapacity("<div>定員：7人</div>"), { maximum: 7, unit: "人" });
  assert.deepEqual(readTennisBearCapacity("<div>募集ペア数：10組</div>"), { maximum: 10, unit: "ペア" });
  assert.deepEqual(readTennisBearCapacity("<div>募集チーム数：12</div>"), { maximum: 12, unit: "チーム" });
});

test("人数非公開の募集中イベントだけ半数または半数+1で補完する", async () => {
  const events = await addEstimatedParticipantCounts(
    [
      {
        date: "9/26",
        day: "土",
        title: "人数非公開",
        location: "体育館",
        status: "募集中",
        url: "https://www.tennisbear.net/pickleball/event/101/info"
      },
      {
        date: "10/25",
        day: "日",
        title: "公式人数あり",
        location: "体育館",
        status: "募集中 8ペア/10ペア",
        url: "https://www.tennisbear.net/pickleball/event/102/info"
      }
    ],
    async () => new Response("<div>定員：12人</div>")
  );

  assert.equal(events[0].status, "募集中 7人/12人");
  assert.equal(events[1].status, "募集中 8ペア/10ペア");
});

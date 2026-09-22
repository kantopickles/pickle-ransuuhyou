import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTennisBearEvents } from "../app/lib/tennisbear-events.ts";

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

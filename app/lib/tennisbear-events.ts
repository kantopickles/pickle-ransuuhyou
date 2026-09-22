import type { CommunityEvent } from "./community-content";

type TennisBearEvent = {
  id?: unknown;
  eventTitle?: unknown;
  datetimeForDisplay?: unknown;
  dateForDisplay?: unknown;
  startDatetimeString?: unknown;
  place?: { name?: unknown } | null;
  isFull?: unknown;
  callOff?: unknown;
  wanted?: unknown;
  pickleballFlg?: unknown;
  nowParticipantsNumberAndMaxParticipantsNumberForDisplay?: unknown;
};

function readDate(value: string) {
  const match = value.match(/^(\d{1,2}\/\d{1,2})\((.)\)$/);
  return match ? { date: match[1], day: match[2] } : { date: value, day: "" };
}

function readStatus(event: TennisBearEvent) {
  if (event.callOff === true) return "中止";
  if (event.isFull === true) return "満員";
  if (event.wanted === false) return "受付終了";

  const participants = typeof event.nowParticipantsNumberAndMaxParticipantsNumberForDisplay === "string"
    ? event.nowParticipantsNumberAndMaxParticipantsNumberForDisplay
    : "";
  return participants ? `募集中 ${participants}` : "募集中";
}

export function normalizeTennisBearEvents(value: unknown): CommunityEvent[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((event): event is TennisBearEvent => Boolean(event) && typeof event === "object")
    .filter((event) => event.pickleballFlg === true && event.callOff !== true)
    .filter((event) => typeof event.id === "number" && typeof event.eventTitle === "string")
    .filter((event) => typeof event.dateForDisplay === "string" && typeof event.startDatetimeString === "string")
    .sort((left, right) => String(left.startDatetimeString).localeCompare(String(right.startDatetimeString)))
    .slice(0, 10)
    .map((event) => {
      const { date, day } = readDate(String(event.dateForDisplay));
      const dateLabel = String(event.dateForDisplay);
      const time = typeof event.datetimeForDisplay === "string"
        ? event.datetimeForDisplay.replace(dateLabel, "").trim()
        : "";
      const place = typeof event.place?.name === "string" ? event.place.name : "会場は詳細ページで確認";

      return {
        date,
        day,
        title: String(event.eventTitle),
        location: time ? `${place} / ${time}` : place,
        status: readStatus(event),
        url: `https://www.tennisbear.net/pickleball/event/${event.id}/info`
      };
    });
}

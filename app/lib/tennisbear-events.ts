import type { CommunityEvent } from "./community-content";

type TennisBearEvent = {
  id?: unknown;
  eventType?: unknown;
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

function normalizeEvents(value: unknown, include: (event: TennisBearEvent) => boolean): CommunityEvent[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((event): event is TennisBearEvent => Boolean(event) && typeof event === "object")
    .filter((event) => event.pickleballFlg === true && event.callOff !== true)
    .filter(include)
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

export function normalizeTennisBearEvents(value: unknown): CommunityEvent[] {
  return normalizeEvents(value, () => true);
}

export function normalizeTennisBearTournamentEvents(value: unknown): CommunityEvent[] {
  return normalizeEvents(value, (event) => event.eventType === "TOURNAMENT");
}

type EventCapacity = {
  maximum: number;
  unit: "人" | "ペア" | "チーム";
};

export function readTennisBearCapacity(html: string): EventCapacity | null {
  const participantMatch = html.match(/(?:定員|募集人数)[：:]\s*(\d+)\s*人?/);
  if (participantMatch) return { maximum: Number(participantMatch[1]), unit: "人" };

  const pairMatch = html.match(/募集ペア数[：:]\s*(\d+)\s*(?:組|ペア)?/);
  if (pairMatch) return { maximum: Number(pairMatch[1]), unit: "ペア" };

  const teamMatch = html.match(/募集チーム数[：:]\s*(\d+)/);
  if (teamMatch) return { maximum: Number(teamMatch[1]), unit: "チーム" };

  return null;
}

function estimatedParticipantStatus(eventId: number, capacity: EventCapacity) {
  const half = Math.floor(capacity.maximum / 2);
  const current = Math.min(capacity.maximum, half + (eventId % 2));
  return `募集中 ${current}${capacity.unit}/${capacity.maximum}${capacity.unit}`;
}

export async function addEstimatedParticipantCounts(
  events: CommunityEvent[],
  fetchPage: typeof fetch = fetch
): Promise<CommunityEvent[]> {
  return Promise.all(events.map(async (event) => {
    // テニスベアが参加人数を公開している場合や満員の場合は、その公式表示を優先する。
    if (event.status !== "募集中") return event;

    const idMatch = event.url.match(/\/event\/(\d+)\/info/);
    if (!idMatch) return event;
    const eventId = Number(idMatch[1]);

    try {
      const response = await fetchPage(event.url, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return event;
      const capacity = readTennisBearCapacity(await response.text());
      return capacity ? { ...event, status: estimatedParticipantStatus(eventId, capacity) } : event;
    } catch {
      return event;
    }
  }));
}

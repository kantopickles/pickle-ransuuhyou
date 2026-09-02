import { env } from "cloudflare:workers";

export const MAX_SAVED_SCHEDULES = 10;

export type ScheduleRow = {
  checked_matches: string;
  created_at: string;
  id: string;
  payload: string;
  updated_at: string;
};

export function database() {
  return env.DB;
}

export function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function removeSchedulesBeyondLimit() {
  const oldRows = await database()
    .prepare(`SELECT id FROM pickleball_shared_schedules ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?`)
    .bind(MAX_SAVED_SCHEDULES)
    .all<{ id: string }>();

  for (const row of oldRows.results) {
    await database().batch([
      database().prepare("DELETE FROM pickleball_share_edit_tokens WHERE share_id = ?").bind(row.id),
      database().prepare("DELETE FROM pickleball_shared_schedules WHERE id = ?").bind(row.id)
    ]);
  }
}

export async function notifyScheduleUpdated(id: string) {
  const room = env.SCHEDULE_ROOMS.getByName(id);
  await room.fetch("https://schedule-room.internal/notify", {
    method: "POST",
    body: JSON.stringify({ id, updatedAt: new Date().toISOString() })
  });
}

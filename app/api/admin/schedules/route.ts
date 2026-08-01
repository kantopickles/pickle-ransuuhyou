import { getSupabaseAdminConfig, isAdminRequest, SCHEDULE_TABLE, unauthorizedResponse } from "../_utils";

const MAX_SAVED_SCHEDULES = 10;

type ScheduleRow = {
  checked_matches: number[] | null;
  created_at: string;
  id: string;
  payload: unknown;
  updated_at: string;
};

async function removeSchedulesBeyondLimit(url: string, key: string) {
  const oldSchedulesResponse = await fetch(
    `${url}/rest/v1/${SCHEDULE_TABLE}?select=id&order=created_at.desc,id.desc&offset=${MAX_SAVED_SCHEDULES}`,
    {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    }
  );
  if (!oldSchedulesResponse.ok) return;

  const oldSchedules = (await oldSchedulesResponse.json()) as { id: string }[];
  const ids = oldSchedules.map((schedule) => schedule.id).filter((id) => /^[A-Za-z0-9]+$/.test(id));
  if (ids.length === 0) return;

  // The associated edit tokens are deleted by the database's ON DELETE CASCADE rule.
  await fetch(`${url}/rest/v1/${SCHEDULE_TABLE}?id=in.(${ids.join(",")})`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=minimal" }
  });
}

export async function GET(request: Request) {
  if (!await isAdminRequest(request)) return unauthorizedResponse();

  try {
    const { key, url } = getSupabaseAdminConfig();
    await removeSchedulesBeyondLimit(url, key);
    const response = await fetch(
      `${url}/rest/v1/${SCHEDULE_TABLE}?select=id,payload,checked_matches,created_at,updated_at&order=created_at.desc&limit=100`,
      {
        cache: "no-store",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`
        }
      }
    );

    if (!response.ok) {
      const message = await response.text();
      return Response.json({ error: message || "履歴を読み込めませんでした。" }, { status: 500 });
    }

    const rows = (await response.json()) as ScheduleRow[];
    return Response.json({
      schedules: rows.map((row) => ({
        checkedMatches: row.checked_matches ?? [],
        createdAt: row.created_at,
        id: row.id,
        payload: row.payload,
        updatedAt: row.updated_at
      }))
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "履歴を読み込めませんでした。" },
      { status: 500 }
    );
  }
}

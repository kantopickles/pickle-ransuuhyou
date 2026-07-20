import { getSupabaseAdminConfig, isAdminRequest, SCHEDULE_TABLE, unauthorizedResponse } from "../_utils";

type ScheduleRow = {
  checked_matches: number[] | null;
  created_at: string;
  id: string;
  payload: unknown;
  updated_at: string;
};

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return unauthorizedResponse();

  try {
    const { key, url } = getSupabaseAdminConfig();
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

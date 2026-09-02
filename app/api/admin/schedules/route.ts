import { database, parseJson, removeSchedulesBeyondLimit, type ScheduleRow } from "../../../lib/cloudflare-data";
import { isAdminRequest, unauthorizedResponse } from "../_utils";

export async function GET(request: Request) {
  if (!await isAdminRequest(request)) return unauthorizedResponse();

  try {
    await removeSchedulesBeyondLimit();
    const rows = await database().prepare(
      `SELECT id, payload, checked_matches, created_at, updated_at
       FROM pickleball_shared_schedules
       ORDER BY created_at DESC, id DESC
       LIMIT 100`
    ).all<ScheduleRow>();

    return Response.json(
      {
        schedules: rows.results.map((row) => ({
          checkedMatches: parseJson<number[]>(row.checked_matches, []),
          createdAt: row.created_at,
          id: row.id,
          payload: parseJson<unknown>(row.payload, null),
          updatedAt: row.updated_at
        }))
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "履歴を読み込めませんでした。" },
      { status: 500 }
    );
  }
}

import { normalizeTennisBearTournamentEvents } from "../../../lib/tennisbear-events";

const TENNIS_BEAR_API =
  "https://www.tennisbear.net/api/v3/users/36614/detail-page/organized-events/future?limitFlg=false&name=";

export async function GET() {
  try {
    const response = await fetch(TENNIS_BEAR_API, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) throw new Error(`TennisBear returned ${response.status}`);

    const events = normalizeTennisBearTournamentEvents(await response.json());
    return Response.json(
      { events },
      {
        headers: {
          "Cache-Control": "public, max-age=300",
          "CDN-Cache-Control": "public, max-age=900, stale-while-revalidate=3600"
        }
      }
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "大会情報を取得できませんでした。", events: [] },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}

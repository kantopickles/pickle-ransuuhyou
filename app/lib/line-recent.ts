import {
  attachLineCookie, lineAccessResponse, readLineViewer,
  type LineAccess, type LineEnvironment
} from "./line-access.ts";
import { InvalidJsonBody, readBoundedJson } from "./request-json.ts";

export type LineRecentEnvironment = LineEnvironment & { DB: D1Database };

const MAX_ITEMS = 10;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 1024;
const DEFAULT_TITLE = "\u4e71\u6570\u8868";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function cleanupLineHistory(db: D1Database): Promise<void> {
  const result = await db.prepare("DELETE FROM pickleball_line_view_history WHERE viewed_at <= ?")
    .bind(new Date(Date.now() - RETENTION_MS).toISOString()).run();
  if (!result.success) throw new Error("History cleanup unavailable");
}

export async function handleLineRecentRequest(request: Request, env: LineRecentEnvironment): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/line/recent" || !["GET", "POST", "DELETE"].includes(request.method)) return null;

  let access: LineAccess = { state: "unavailable" };
  const respond = (status: number, body?: unknown) => attachLineCookie(
    body === undefined ? new Response(null, { status }) : Response.json(body, { status }), access
  );

  try {
    const viewer = await readLineViewer(request, env);
    access = viewer.access;
    if (access.state !== "allowed") return lineAccessResponse(access);
    if (!viewer.viewerKey) return lineAccessResponse({ ...access, state: "login_required" });
    const viewerKey = viewer.viewerKey;

    if (request.method !== "GET") {
      if (request.headers.get("origin") !== url.origin) return respond(403);
      if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return respond(415);
      const body = await readBoundedJson(request, MAX_BODY_BYTES);
      if (request.method === "DELETE") {
        if (body !== null && (!object(body) || Object.keys(body).length !== 0)) return respond(400);
        const result = await env.DB.prepare("DELETE FROM pickleball_line_view_history WHERE viewer_key = ?").bind(viewerKey).run();
        if (!result.success) throw new Error("History deletion unavailable");
        return respond(204);
      }

      if (!object(body) || Object.keys(body).length !== 1 || typeof body.id !== "string" || !/^[A-Za-z0-9]{6,20}$/.test(body.id)) return respond(400);
      const now = new Date().toISOString();
      const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
      // D1 batches are transactional: insertion and both pruning rules commit together.
      const results = await env.DB.batch([
        env.DB.prepare(`INSERT INTO pickleball_line_view_history (viewer_key, share_id, viewed_at)
          SELECT ?, id, ? FROM pickleball_shared_schedules WHERE id = ?
          ON CONFLICT (viewer_key, share_id) DO UPDATE SET viewed_at = excluded.viewed_at`)
          .bind(viewerKey, now, body.id),
        env.DB.prepare(`DELETE FROM pickleball_line_view_history WHERE viewer_key = ?
          AND (viewed_at <= ? OR share_id IN (
            SELECT share_id FROM pickleball_line_view_history WHERE viewer_key = ?
            ORDER BY viewed_at DESC, share_id DESC LIMIT -1 OFFSET ?
          ))`).bind(viewerKey, cutoff, viewerKey, MAX_ITEMS)
      ]);
      if (results.some(result => !result.success)) throw new Error("History update unavailable");
      return respond(results[0].meta.changes === 0 ? 404 : 204);
    }

    const result = await env.DB.prepare(`WITH recent AS (
      SELECT h.share_id AS id, h.viewed_at AS viewedAt, s.created_at AS createdAt,
        CASE WHEN json_valid(s.payload) THEN s.payload ELSE '{}' END AS payload
      FROM pickleball_line_view_history h
      INNER JOIN pickleball_shared_schedules s ON s.id = h.share_id
      WHERE h.viewer_key = ? AND h.viewed_at > ?
      ORDER BY h.viewed_at DESC, h.share_id DESC LIMIT ?
    ) SELECT id, viewedAt, createdAt, COALESCE(
      CASE WHEN json_type(payload, '$.t') = 'text' THEN NULLIF(trim(substr(json_extract(payload, '$.t'), 1, 60)), '') END,
      CASE WHEN json_type(payload, '$.title') = 'text' THEN NULLIF(trim(substr(json_extract(payload, '$.title'), 1, 60)), '') END,
      ?
    ) AS title FROM recent ORDER BY viewedAt DESC, id DESC`)
      .bind(viewerKey, new Date(Date.now() - RETENTION_MS).toISOString(), MAX_ITEMS, DEFAULT_TITLE)
      .all<{ id: string; title: string; viewedAt: string; createdAt: string }>();
    if (!result.success) throw new Error("History read unavailable");
    const items = result.results.map(({ id, title, viewedAt, createdAt }) => ({
      id, title: title.replace(/[\u0000-\u001f\u007f]/g, "").trim() || DEFAULT_TITLE, viewedAt, createdAt
    }));
    return respond(200, { items });
  } catch (error) {
    if (error instanceof InvalidJsonBody) return respond(error.status);
    return respond(503, { error: "Recent history unavailable" });
  }
}

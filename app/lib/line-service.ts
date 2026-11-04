import { attachLineCookie, lineAccessResponse, lineMiniConfig, readLineMiniCredentials, type LineAccess, type LineEnvironment } from "./line-access.ts";
import { serviceConfig, serviceRequired, type ServiceNotice } from "./line-service-delivery.ts";
import { InvalidJsonBody, readBoundedJson } from "./request-json.ts";

type ServiceEnvironment = LineEnvironment & Pick<Env, "DB" | "SCHEDULE_ROOMS">;
type Viewer = NonNullable<Awaited<ReturnType<typeof readLineMiniCredentials>>>;

function reply(notice: ServiceNotice, access: LineAccess, status = 200, miniUrl?: string) {
  return attachLineCookie(Response.json({ notice, ...(miniUrl ? { miniUrl } : {}) }, { status }), access);
}

function room(env: ServiceEnvironment, viewer: Viewer) {
  return env.SCHEDULE_ROOMS.getByName(`line-service:${env.LINE_MINIAPP_CHANNEL_ID}:${viewer.viewerKey}`);
}

async function noticeState(env: ServiceEnvironment, viewer: Viewer, shareId: string) {
  const result = await room(env, viewer).fetch("https://line-service.internal/delivery", {
    method: "POST", body: JSON.stringify({ shareId }), headers: { "Content-Type": "application/json" }
  });
  if (!result.ok) throw new Error("Notice status unavailable");
  const data = await result.json() as { notice: ServiceNotice };
  return data.notice;
}

async function verifiedMini(request: Request, env: ServiceEnvironment, shareId: string, force = false) {
  const mini = lineMiniConfig(env);
  if (new URL(request.url).searchParams.get("line_context") !== "mini") {
    return { response: reply("mini_required", { state: "allowed" }, 409,
      mini ? `https://miniapp.line.me/${mini.liffId}/s/${shareId}` : undefined), viewer: null };
  }
  const viewer = await readLineMiniCredentials(request, env, force);
  if (!viewer) return { response: lineAccessResponse({ state: "not_configured" }), viewer: null };
  if (viewer.access.state !== "allowed") return { response: lineAccessResponse(viewer.access), viewer: null };
  if (!viewer.viewerKey || !viewer.session) return { response: lineAccessResponse({ ...viewer.access, state: "login_required" }), viewer: null };
  return { response: null, viewer };
}

// This gate runs before the share API AND WebSocket. A hidden React component,
// a forged POST result or adding ?line_context=mini cannot grant schedule access.
export async function guardLineServiceRead(request: Request, env: ServiceEnvironment): Promise<Response | null> {
  if (!serviceRequired(env)) return null;
  let path: string;
  try { path = decodeURIComponent(new URL(request.url).pathname).replace(/\/+/g, "/"); }
  catch { return reply("failed", { state: "allowed" }, 400); }
  const match = path.match(/^\/api\/(?:share|realtime)\/([A-Za-z0-9]{6,20})\/?$/);
  if (!match) return reply("failed", { state: "allowed" }, 400);
  const { response, viewer } = await verifiedMini(request, env, match[1]);
  if (response || !viewer) return response;
  try {
    if (!serviceConfig(env)) return reply("not_configured", viewer.access, 503);
    const notice = await noticeState(env, viewer, match[1]);
    return notice === "accepted" ? null : reply(notice, viewer.access, 403);
  } catch { return reply("failed", viewer.access, 503); }
}

export async function handleLineServiceRequest(request: Request, env: ServiceEnvironment): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/line/service/")) return null;
  const match = url.pathname.match(/^\/api\/line\/service\/([A-Za-z0-9]{6,20})$/);
  if (!match) return reply("failed", { state: "allowed" }, 400);
  if (!["GET", "POST"].includes(request.method)) return reply("failed", { state: "allowed" }, 405);
  if (!serviceRequired(env)) return reply("disabled", { state: "allowed" });
  let retry = false;
  if (request.method === "POST") {
    if (request.headers.get("origin") !== url.origin) return reply("failed", { state: "allowed" }, 403);
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return reply("failed", { state: "allowed" }, 415);
    try {
      const body = await readBoundedJson(request, 1024);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "retry")
        || ("retry" in body && body.retry !== true)) return reply("failed", { state: "allowed" }, 400);
      retry = "retry" in body;
    } catch (error) { return reply("failed", { state: "allowed" }, error instanceof InvalidJsonBody ? error.status : 400); }
  }
  const { response, viewer } = await verifiedMini(request, env, match[1], request.method === "POST");
  if (response || !viewer) return response;
  try {
    if (!serviceConfig(env)) return reply("not_configured", viewer.access, 503);
    const record = await env.DB.prepare("SELECT payload FROM pickleball_shared_schedules WHERE id = ?").bind(match[1]).first<{ payload: string }>();
    if (!record) return reply("failed", viewer.access, 404);
    if (request.method === "GET") return reply(await noticeState(env, viewer, match[1]), viewer.access);
    let title = "乱数表";
    try {
      const data = JSON.parse(record.payload);
      const value = data?.title ?? data?.t;
      if (typeof value === "string") title = value;
    } catch { /* A missing title never becomes an arbitrary recipient or URL. */ }
    const result = await room(env, viewer).fetch("https://line-service.internal/delivery", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shareId: match[1], accessToken: viewer.session!.accessToken,
        expires: viewer.session!.expires * 1000, title, retry })
    });
    if (!result.ok) return reply("failed", viewer.access, 503);
    const data = await result.json() as { notice: ServiceNotice };
    return reply(data.notice, viewer.access, data.notice === "accepted" ? 200 : 503);
  } catch { return reply("failed", viewer.access, 503); }
}

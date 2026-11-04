import { DurableObject } from "cloudflare:workers";
import vinextHandler from "vinext/server/fetch-handler";
import { isAdminRequest } from "./app/api/admin/_utils";
import { attachLineCookie, handleLineRequest, isProtectedShareRead, lineAccessResponse, lineMiniConfig, lineRequired, readLineAccess } from "./app/lib/line-access";
import { cleanupLineHistory, handleLineRecentRequest } from "./app/lib/line-recent";
import { guardLineServiceRead, handleLineServiceRequest } from "./app/lib/line-service";
import { cleanupServiceStore, handleServiceRoom, serviceRequired } from "./app/lib/line-service-delivery";

const REALTIME_PATH = /^\/api\/realtime\/([A-Za-z0-9]{6,20})$/;

export class ScheduleRoom extends DurableObject<Env> {
  async fetch(request: Request) {
    const url = new URL(request.url);

    if (url.origin === "https://line-service.internal") {
      return this.ctx.blockConcurrencyWhile(async () =>
        await handleServiceRoom(request, this.ctx.storage, this.env) ?? new Response(null, { status: 404 }));
    }

    if (url.pathname.endsWith("/notify") && request.method === "POST") {
      const message = await request.text();
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(message || "updated");
        } catch {
          socket.close(1011, "Update notification failed");
        }
      }
      return new Response(null, { status: 204 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (message === "ping") socket.send("pong");
  }

  async alarm() {
    await cleanupServiceStore(this.ctx.storage);
  }
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext) {
    // Keep the official-account return link stable across the mini-app rollout.
    const mini = lineMiniConfig(env);
    if (request.method === "GET" && new URL(request.url).pathname === "/resume" && mini && env.LINE_MINIAPP_SHARE_ENABLED === "true") {
      return new Response(null, { status: 302, headers: { Location: `https://miniapp.line.me/${mini.liffId}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    }
    const recentResponse = await handleLineRecentRequest(request, env);
    if (recentResponse) {
      // Free accounts have a shared cron quota. A successful history request
      // performs indexed retention cleanup without allocating another trigger.
      if (recentResponse.ok) context.waitUntil(cleanupLineHistory(env.DB).catch(() => {
        console.warn("LINE_HISTORY_CLEANUP_FAILED");
      }));
      return recentResponse;
    }
    const serviceResponse = await handleLineServiceRequest(request, env);
    if (serviceResponse) return serviceResponse;
    const lineResponse = await handleLineRequest(request, env);
    if (lineResponse) return lineResponse;
    // Legacy links embed the data in the URL hash and cannot be made secret
    // retroactively. Stop the old viewer rather than suggest it is protected.
    if (lineRequired(env) && new URL(request.url).pathname.replace(/\/$/, "") === "/share") {
      return new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>共有リンクの更新が必要です</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:1rem;line-height:1.8"><h1>共有リンクの更新が必要です</h1><p>この古い形式のリンクは利用できません。主催者に新しい共有リンクを依頼してください。</p></body></html>', { status: 410, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    }

    // Keep owner/admin editing independent of participant LINE authentication.
    const participantRead = isProtectedShareRead(request) && !await isAdminRequest(request);
    const access = participantRead && lineRequired(env)
      ? await readLineAccess(request, env)
      : { state: "allowed" as const };
    if (access.state !== "allowed") return lineAccessResponse(access);
    if (participantRead) {
      const noticeResponse = await guardLineServiceRead(request, env);
      if (noticeResponse) return noticeResponse;
    }

    const realtimeMatch = new URL(request.url).pathname.match(REALTIME_PATH);
    if (realtimeMatch) {
      if ((lineRequired(env) || serviceRequired(env)) && request.headers.get("Origin") !== new URL(request.url).origin) {
        return new Response(null, { status: 403 });
      }
      const room = env.SCHEDULE_ROOMS.getByName(realtimeMatch[1]);
      return room.fetch(request);
    }

    const response = await vinextHandler.fetch(request, env, context);
    return isProtectedShareRead(request) ? attachLineCookie(response, access) : response;
  }
} satisfies ExportedHandler<Env>;

import { DurableObject } from "cloudflare:workers";
import vinextHandler from "vinext/server/fetch-handler";
import { isAdminRequest } from "./app/api/admin/_utils";
import { attachLineCookie, handleLineRequest, isProtectedShareRead, lineAccessResponse, lineRequired, readLineAccess } from "./app/lib/line-access";

const REALTIME_PATH = /^\/api\/realtime\/([A-Za-z0-9]{6,20})$/;

export class ScheduleRoom extends DurableObject<Env> {
  async fetch(request: Request) {
    const url = new URL(request.url);

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
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext) {
    const lineResponse = await handleLineRequest(request, env);
    if (lineResponse) return lineResponse;
    // Legacy links embed the data in the URL hash and cannot be made secret
    // retroactively. Stop the old viewer rather than suggest it is protected.
    if (lineRequired(env) && new URL(request.url).pathname.replace(/\/$/, "") === "/share") {
      return new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>共有リンクの更新が必要です</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:1rem;line-height:1.8"><h1>共有リンクの更新が必要です</h1><p>この古い形式のリンクは利用できません。主催者に新しい共有リンクを依頼してください。</p></body></html>', { status: 410, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    }

    // Keep owner/admin editing independent of participant LINE authentication.
    const access = isProtectedShareRead(request) && lineRequired(env) && !await isAdminRequest(request)
      ? await readLineAccess(request, env)
      : { state: "allowed" as const };
    if (access.state !== "allowed") return lineAccessResponse(access);

    const realtimeMatch = new URL(request.url).pathname.match(REALTIME_PATH);
    if (realtimeMatch) {
      if (lineRequired(env) && request.headers.get("Origin") !== new URL(request.url).origin) {
        return new Response(null, { status: 403 });
      }
      const room = env.SCHEDULE_ROOMS.getByName(realtimeMatch[1]);
      return room.fetch(request);
    }

    const response = await vinextHandler.fetch(request, env, context);
    return isProtectedShareRead(request) ? attachLineCookie(response, access) : response;
  }
} satisfies ExportedHandler<Env>;

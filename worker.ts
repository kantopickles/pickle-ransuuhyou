import { DurableObject } from "cloudflare:workers";
import vinextHandler from "vinext/server/fetch-handler";

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
    const realtimeMatch = new URL(request.url).pathname.match(REALTIME_PATH);
    if (realtimeMatch) {
      const room = env.SCHEDULE_ROOMS.getByName(realtimeMatch[1]);
      return room.fetch(request);
    }

    return vinextHandler.fetch(request, env, context);
  }
} satisfies ExportedHandler<Env>;

import { lineMiniConfig, openLineServiceToken, sealLineServiceToken, type LineEnvironment } from "./line-access.ts";

export type ServiceNotice = "disabled" | "required" | "accepted" | "failed" | "uncertain" | "session_limit" | "not_configured" | "mini_required";
type Receipt = { state: "accepted" | "uncertain"; expires: number; accessKey: string };
type Notification = { state: "ready" | "uncertain"; encrypted?: string; remaining: number; expires: number; notificationExpires?: number };
type Stored = Receipt | Notification;
export type ServiceStore = {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: Stored): Promise<void>;
  list<T>(): Promise<Map<string, T>>;
  delete(keys: string[]): Promise<unknown>;
  setAlarm(time: number): Promise<void>;
};
const RETENTION = 90 * 86400_000;
const PRIVATE = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
export const serviceRequired = (env: LineEnvironment) => env.LINE_SERVICE_MESSAGES_REQUIRED === "true";

export function serviceConfig(env: LineEnvironment) {
  const mini = lineMiniConfig(env);
  if (!mini || !mini.liffId.startsWith(`${mini.channelId}-`) || !env.LINE_MINIAPP_CHANNEL_SECRET || !/^[A-Za-z][A-Za-z0-9_]{0,26}_ja$/.test(env.LINE_SERVICE_TEMPLATE_NAME ?? "")) return null;
  try {
    const params = JSON.parse(env.LINE_SERVICE_TEMPLATE_PARAMS ?? "") as unknown;
    if (!params || typeof params !== "object" || Array.isArray(params)) return null;
    const entries = Object.entries(params);
    if (!entries.length || entries.length > 20 || !entries.some(([, value]) => value === "{{shareUrl}}")) return null;
    if (entries.some(([key, value]) => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || typeof value !== "string" || value.length > 150)) return null;
    return { ...mini, secret: env.LINE_MINIAPP_CHANNEL_SECRET, template: env.LINE_SERVICE_TEMPLATE_NAME!, params: params as Record<string, string> };
  } catch { return null; }
}

async function api(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(6000) });
  if (response.status !== 200) throw new Error("LINE service request unavailable");
  return response.json() as Promise<Record<string, unknown>>;
}

async function notification(data: Record<string, unknown>, expires: number, env: LineEnvironment): Promise<Notification> {
  if (!Number.isInteger(data.remainingCount) || Number(data.remainingCount) < 0 || Number(data.remainingCount) > 5
    || typeof data.expiresIn !== "number" || !Number.isFinite(data.expiresIn) || data.expiresIn < 0) throw new Error("Invalid LINE service response");
  // A zero remaining count/expiry is still a successful final delivery. Retain
  // the exhausted record until the LIFF session expires to prevent re-issuance.
  if (!data.remainingCount || !data.expiresIn) return { state: "ready", remaining: 0, expires };
  if (typeof data.notificationToken !== "string" || !data.notificationToken || data.notificationToken.length > 2000) throw new Error("Invalid LINE notification token");
  return { state: "ready", encrypted: await sealLineServiceToken(data.notificationToken, env),
    remaining: Number(data.remainingCount), expires, notificationExpires: Date.now() + data.expiresIn * 1000 };
}

export async function cleanupServiceStore(store: ServiceStore) {
  const entries = await store.list<Stored>();
  const expired = [...entries].filter(([, value]) => !Number.isFinite(value.expires) || value.expires <= Date.now()).map(([key]) => key);
  if (expired.length) await store.delete(expired);
  const next = [...entries.values()].filter(value => value.expires > Date.now()).map(value => value.expires);
  if (next.length) await store.setAlarm(Math.min(...next));
}

// Called only inside a viewer-scoped Durable Object concurrency block. This
// serializes concurrent opens across tabs/devices, not just within one browser.
// No user IDs, LIFF tokens or channel credentials are persisted here. The token
// fingerprint is a SHA-256 key; reusable notification tokens are AES-GCM sealed.
export async function deliverLineService(
  store: ServiceStore, env: LineEnvironment,
  input: { shareId: string; accessToken?: string; expires?: number; title?: string; retry?: boolean }
): Promise<ServiceNotice> {
  await cleanupServiceStore(store);
  const receiptKey = `receipt:${input.shareId}`;
  const receipt = await store.get<Receipt>(receiptKey);
  if (receipt?.state === "accepted") return "accepted";
  if (!input.accessToken) return receipt?.state ?? "required";
  const settings = serviceConfig(env);
  if (!settings || !input.expires || input.expires <= Date.now()) return "not_configured";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.accessToken));
  const accessKey = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (receipt?.state === "uncertain" && (!input.retry || receipt.accessKey === accessKey)) return "uncertain";
  const tokenKey = `token:${accessKey}`;
  let reusable = await store.get<Notification>(tokenKey);
  if (reusable?.state === "uncertain") return "uncertain";
  if (reusable && (reusable.remaining <= 0 || (reusable.notificationExpires ?? 0) <= Date.now())) return "session_limit";

  try {
    // A crash between a durable write and the finally block must still leave
    // an alarm scheduled, so uncertain records are eventually cleaned up.
    await store.setAlarm(Date.now() + 60_000);
    const channel = await api("https://api.line.me/oauth2/v3/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: settings.channelId, client_secret: settings.secret })
    });
    if (typeof channel.access_token !== "string" || !channel.access_token || channel.access_token.length > 2000 || channel.token_type !== "Bearer") return "failed";
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${channel.access_token}` };
    if (!reusable) {
      // Persist BEFORE issuing: an ambiguous timeout must not mint another
      // notification token for the same LIFF token on the next request.
      await store.put(tokenKey, { state: "uncertain", remaining: 0, expires: input.expires });
      const issued = await api("https://api.line.me/message/v3/notifier/token", {
        method: "POST", headers, body: JSON.stringify({ liffAccessToken: input.accessToken })
      });
      reusable = await notification(issued, input.expires, env);
      await store.put(tokenKey, reusable);
    }
    if (!reusable.remaining || !reusable.encrypted) return "session_limit";
    const token = await openLineServiceToken(reusable.encrypted, env);
    if (!token) return "failed";
    const url = `https://miniapp.line.me/${settings.liffId}/s/${input.shareId}`;
    const title = (input.title ?? "乱数表").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 60) || "乱数表";
    const params = Object.fromEntries(Object.entries(settings.params).map(([key, value]) => [key,
      value === "{{shareUrl}}" ? url : value === "{{title}}" ? title : value
    ]));
    // Record uncertain BEFORE sending. A timeout/crash after LINE accepts the
    // message must neither grant access nor silently send a duplicate.
    await store.put(receiptKey, { state: "uncertain", accessKey, expires: Date.now() + RETENTION });
    await store.put(tokenKey, { state: "uncertain", remaining: 0, expires: input.expires });
    const sent = await api("https://api.line.me/message/v3/notifier/send?target=service", {
      method: "POST", headers, body: JSON.stringify({ templateName: settings.template, notificationToken: token, params })
    });
    const updated = await notification(sent, input.expires, env);
    await store.put(tokenKey, updated);
    await store.put(receiptKey, { state: "accepted", accessKey, expires: Date.now() + RETENTION });
    return "accepted";
  } catch {
    // Do not log provider bodies, tokens, private schedule titles or credentials.
    return "failed";
  } finally {
    await cleanupServiceStore(store);
  }
}

export async function handleServiceRoom(request: Request, store: ServiceStore, env: LineEnvironment) {
  const url = new URL(request.url);
  if (url.origin !== "https://line-service.internal" || url.pathname !== "/delivery" || request.method !== "POST") return null;
  if (!serviceRequired(env)) return Response.json({ notice: "disabled" }, { headers: PRIVATE });
  const input = await request.json() as Parameters<typeof deliverLineService>[2];
  if (!input || typeof input.shareId !== "string" || !/^[A-Za-z0-9]{6,20}$/.test(input.shareId)) return new Response(null, { status: 400 });
  return Response.json({ notice: await deliverLineService(store, env, input) }, { headers: PRIVATE });
}

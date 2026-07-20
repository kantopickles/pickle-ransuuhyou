const DEFAULT_ADMIN_PASSWORD = "kanto2025pickles";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export const ADMIN_SESSION_COOKIE = "pickleball_admin_session";

export const SCHEDULE_TABLE = "pickleball_shared_schedules";

export function getSupabaseAdminConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase env vars are missing.");
  }

  return { key, url };
}

export const adminSessionCookieOptions = {
  httpOnly: true,
  maxAge: SESSION_MAX_AGE_SECONDS,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production"
};

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
}

function getSessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || `${getAdminPassword()}-pickleball-session`;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function sign(value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getSessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64Url(new Uint8Array(signature));
}

export function isAdminPassword(request: Request) {
  const supplied = request.headers.get("x-admin-password") ?? "";
  const expected = getAdminPassword();
  return supplied.length > 0 && supplied === expected;
}

export async function createAdminSessionToken() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const signature = await sign(String(expiresAt));
  return `${expiresAt}.${signature}`;
}

export async function hasAdminSession(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const value = cookie.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${ADMIN_SESSION_COOKIE}=`))
    ?.slice(ADMIN_SESSION_COOKIE.length + 1);

  if (!value) return false;
  const [expiresAt, signature] = value.split(".");
  if (!expiresAt || !signature || !/^\d+$/.test(expiresAt)) return false;
  if (Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;
  return signature === await sign(expiresAt);
}

export async function isAdminRequest(request: Request) {
  return isAdminPassword(request) || await hasAdminSession(request);
}

export function unauthorizedResponse() {
  return Response.json({ error: "パスワードが違います。" }, { status: 401 });
}

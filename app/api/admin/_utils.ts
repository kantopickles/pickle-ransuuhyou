const DEFAULT_ADMIN_PASSWORD = "kanto2025pickles";

export const SCHEDULE_TABLE = "pickleball_shared_schedules";

export function getSupabaseAdminConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase env vars are missing.");
  }

  return { key, url };
}

export function isAdminRequest(request: Request) {
  const supplied = request.headers.get("x-admin-password") ?? "";
  const expected = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
  return supplied.length > 0 && supplied === expected;
}

export function unauthorizedResponse() {
  return Response.json({ error: "パスワードが違います。" }, { status: 401 });
}

import { NextResponse } from "next/server";
import {
  adminSessionCookieOptions,
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
  hasAdminSession,
  isAdminPassword,
  unauthorizedResponse
} from "../_utils";

export async function POST(request: Request) {
  if (!isAdminPassword(request) && !await hasAdminSession(request)) return unauthorizedResponse();

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    ...adminSessionCookieOptions,
    name: ADMIN_SESSION_COOKIE,
    value: await createAdminSessionToken()
  });
  return response;
}

export async function GET(request: Request) {
  if (!await hasAdminSession(request)) return unauthorizedResponse();
  return Response.json({ ok: true });
}

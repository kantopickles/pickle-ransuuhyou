import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../_utils";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: "",
    maxAge: 0,
    path: "/"
  });
  return response;
}

import { isAdminRequest, unauthorizedResponse } from "../_utils";

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return unauthorizedResponse();
  return Response.json({ ok: true });
}

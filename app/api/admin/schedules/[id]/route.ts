import { getSupabaseAdminConfig, isAdminRequest, SCHEDULE_TABLE, unauthorizedResponse } from "../../_utils";

function isValidId(id: string) {
  return /^[A-Za-z0-9]{6,20}$/.test(id);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return unauthorizedResponse();

  try {
    const { id } = await context.params;
    const body = await request.json() as { checkedMatches?: unknown };
    if (!isValidId(id) || !Array.isArray(body.checkedMatches)) {
      return Response.json({ error: "入力内容が正しくありません。" }, { status: 400 });
    }

    const checkedMatches = body.checkedMatches.filter(
      (value): value is number => Number.isInteger(value) && value > 0 && value <= 20
    );
    const { key, url } = getSupabaseAdminConfig();
    const response = await fetch(`${url}/rest/v1/${SCHEDULE_TABLE}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        checked_matches: Array.from(new Set(checkedMatches)).sort((left, right) => left - right),
        updated_at: new Date().toISOString()
      })
    });

    if (!response.ok) {
      const message = await response.text();
      return Response.json({ error: message || "更新できませんでした。" }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "更新できませんでした。" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return unauthorizedResponse();

  try {
    const { id } = await context.params;
    if (!isValidId(id)) {
      return Response.json({ error: "入力内容が正しくありません。" }, { status: 400 });
    }

    const { key, url } = getSupabaseAdminConfig();
    const response = await fetch(`${url}/rest/v1/${SCHEDULE_TABLE}?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "return=minimal"
      }
    });

    if (!response.ok) {
      const message = await response.text();
      return Response.json({ error: message || "削除できませんでした。" }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "削除できませんでした。" },
      { status: 500 }
    );
  }
}

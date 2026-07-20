import { getSupabaseAdminConfig, isAdminRequest, SCHEDULE_TABLE, unauthorizedResponse } from "../../_utils";

function isValidId(id: string) {
  return /^[A-Za-z0-9]{6,20}$/.test(id);
}

type EditablePayload = {
  names: string[];
  matches: {
    match: number;
    courts: { court: number; teamA: [number, number]; teamB: [number, number] }[];
    resting: number[];
  }[];
};

function normalizeEditablePayload(value: unknown): EditablePayload | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EditablePayload>;
  if (!Array.isArray(candidate.names) || !candidate.names.every((name) => typeof name === "string")) return null;
  if (!Array.isArray(candidate.matches) || candidate.matches.length === 0 || candidate.matches.length > 20) return null;

  const participantCount = candidate.names.length;
  const matches: EditablePayload["matches"] = [];

  for (const [matchIndex, match] of candidate.matches.entries()) {
    if (!match || typeof match !== "object" || !Array.isArray(match.courts) || match.courts.length === 0) return null;
    const playing = new Set<number>();
    const courts: EditablePayload["matches"][number]["courts"] = [];

    for (const [courtIndex, court] of match.courts.entries()) {
      if (!court || typeof court !== "object" || !Array.isArray(court.teamA) || !Array.isArray(court.teamB)) return null;
      const players = [...court.teamA, ...court.teamB];
      if (players.length !== 4 || players.some((player) => !Number.isInteger(player) || player < 0 || player >= participantCount)) return null;
      if (players.some((player) => playing.has(player))) return null;
      players.forEach((player) => playing.add(player));
      courts.push({
        court: courtIndex + 1,
        teamA: [court.teamA[0], court.teamA[1]],
        teamB: [court.teamB[0], court.teamB[1]]
      });
    }

    matches.push({
      match: matchIndex + 1,
      courts,
      resting: candidate.names.map((_, player) => player).filter((player) => !playing.has(player))
    });
  }

  return { names: candidate.names, matches };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await isAdminRequest(request)) return unauthorizedResponse();

  try {
    const { id } = await context.params;
    const body = await request.json() as { checkedMatches?: unknown; payload?: unknown };
    if (!isValidId(id) || (!Array.isArray(body.checkedMatches) && body.payload === undefined)) {
      return Response.json({ error: "入力内容が正しくありません。" }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (Array.isArray(body.checkedMatches)) {
      const checkedMatches = body.checkedMatches.filter(
        (value): value is number => Number.isInteger(value) && value > 0 && value <= 20
      );
      updates.checked_matches = Array.from(new Set(checkedMatches)).sort((left, right) => left - right);
    }
    if (body.payload !== undefined) {
      const payload = normalizeEditablePayload(body.payload);
      if (!payload) return Response.json({ error: "参加者の変更内容が正しくありません。" }, { status: 400 });
      updates.payload = payload;
    }

    const { key, url } = getSupabaseAdminConfig();
    const response = await fetch(`${url}/rest/v1/${SCHEDULE_TABLE}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(updates)
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
  if (!await isAdminRequest(request)) return unauthorizedResponse();

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

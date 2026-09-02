import { NextResponse } from "next/server";
import { database, notifyScheduleUpdated, parseJson } from "../../../lib/cloudflare-data";
import { isAdminRequest } from "../../admin/_utils";

async function hashToken(token: string) {
  const bytes = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeSchedulePayload(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    title?: unknown;
    names?: unknown;
    matches?: unknown;
  };
  if (!Array.isArray(candidate.names) || !candidate.names.every((name) => typeof name === "string")) return null;
  if (candidate.title !== undefined && (typeof candidate.title !== "string" || candidate.title.length > 60)) return null;
  if (!Array.isArray(candidate.matches) || candidate.matches.length === 0 || candidate.matches.length > 20) return null;

  const names = candidate.names as string[];
  const matches = [];
  for (const [matchIndex, rawMatch] of candidate.matches.entries()) {
    if (!rawMatch || typeof rawMatch !== "object") return null;
    const match = rawMatch as { courts?: unknown; participants?: unknown };
    if (!Array.isArray(match.courts) || match.courts.length === 0 || match.courts.length > 5) return null;
    const playing = new Set<number>();
    const courts = [];

    for (const [courtIndex, rawCourt] of match.courts.entries()) {
      if (!rawCourt || typeof rawCourt !== "object") return null;
      const court = rawCourt as { teamA?: unknown; teamB?: unknown };
      if (!Array.isArray(court.teamA) || !Array.isArray(court.teamB) || court.teamA.length !== 2 || court.teamB.length !== 2) return null;
      const players = [...court.teamA, ...court.teamB];
      if (players.some((player) => !Number.isInteger(player) || Number(player) < 0 || Number(player) >= names.length)) return null;
      if (players.some((player) => playing.has(Number(player)))) return null;
      players.forEach((player) => playing.add(Number(player)));
      courts.push({
        court: courtIndex + 1,
        teamA: [Number(court.teamA[0]), Number(court.teamA[1])],
        teamB: [Number(court.teamB[0]), Number(court.teamB[1])]
      });
    }

    const participants = Array.isArray(match.participants)
      ? Array.from(new Set(match.participants.filter(
          (player): player is number => Number.isInteger(player) && player >= 0 && player < names.length
        )))
      : names.map((_, index) => index);
    if (Array.from(playing).some((player) => !participants.includes(player))) return null;
    matches.push({
      match: matchIndex + 1,
      courts,
      resting: participants.filter((player) => !playing.has(player)),
      ...(Array.isArray(match.participants) ? { participants } : {})
    });
  }

  return {
    ...(typeof candidate.title === "string" && candidate.title.trim() ? { title: candidate.title.trim() } : {}),
    names,
    matches
  };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const row = await database()
      .prepare("SELECT payload, checked_matches FROM pickleball_shared_schedules WHERE id = ?")
      .bind(id)
      .first<{ checked_matches: string; payload: string }>();

    if (!row) {
      return NextResponse.json({ error: "Share not found." }, { status: 404 });
    }

    return NextResponse.json(
      {
        checkedMatches: parseJson<number[]>(row.checked_matches, []),
        payload: parseJson<unknown>(row.payload, null)
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load share." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { checkedMatches?: unknown; editToken?: string; payload?: unknown };
    if (!Array.isArray(body.checkedMatches) && body.payload === undefined) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    // New schedules carry an edit token. Schedules imported from Supabase do not,
    // so an authenticated administrator may update those rows without a token.
    let hasValidEditToken = false;
    if (body.editToken) {
      const tokenHash = await hashToken(body.editToken);
      const tokenRow = await database()
        .prepare("SELECT share_id FROM pickleball_share_edit_tokens WHERE share_id = ? AND token_hash = ?")
        .bind(id, tokenHash)
        .first<{ share_id: string }>();
      hasValidEditToken = Boolean(tokenRow);
    }
    if (!hasValidEditToken && !await isAdminRequest(request)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    let checkedMatchesJson: string | null = null;
    let payloadJson: string | null = null;
    if (Array.isArray(body.checkedMatches)) {
      checkedMatchesJson = JSON.stringify(Array.from(new Set(body.checkedMatches.filter(
        (match): match is number => Number.isInteger(match) && match > 0 && match <= 20
      ))).sort((left, right) => left - right));
    }
    if (body.payload !== undefined) {
      const payload = normalizeSchedulePayload(body.payload);
      if (!payload) return NextResponse.json({ error: "Invalid schedule payload." }, { status: 400 });
      payloadJson = JSON.stringify(payload);
    }

    const result = await database().prepare(
      `UPDATE pickleball_shared_schedules
       SET checked_matches = COALESCE(?, checked_matches),
           payload = COALESCE(?, payload),
           updated_at = ?
       WHERE id = ?`
    ).bind(checkedMatchesJson, payloadJson, new Date().toISOString(), id).run();

    if (!result.meta.changes) return NextResponse.json({ error: "Share not found." }, { status: 404 });
    await notifyScheduleUpdated(id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update share." },
      { status: 500 }
    );
  }
}

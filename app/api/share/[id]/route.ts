import { NextResponse } from "next/server";

const TABLE_NAME = "pickleball_shared_schedules";
const TOKEN_TABLE_NAME = "pickleball_share_edit_tokens";

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase env vars are missing.");
  }

  return { key, url };
}

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
    const { key, url } = getSupabaseConfig();
    const response = await fetch(`${url}/rest/v1/${TABLE_NAME}?id=eq.${encodeURIComponent(id)}&select=payload,checked_matches`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      }
    });

    if (!response.ok) {
      const message = await response.text();
      return NextResponse.json({ error: message || "Failed to load share." }, { status: 500 });
    }

    const rows = (await response.json()) as { checked_matches: number[] | null; payload: unknown }[];
    if (rows.length === 0) {
      return NextResponse.json({ error: "Share not found." }, { status: 404 });
    }

    return NextResponse.json({ checkedMatches: rows[0].checked_matches ?? [], payload: rows[0].payload });
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
    if (!body.editToken || (!Array.isArray(body.checkedMatches) && body.payload === undefined)) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const { key, url } = getSupabaseConfig();
    const tokenHash = await hashToken(body.editToken);
    const tokenResponse = await fetch(
      `${url}/rest/v1/${TOKEN_TABLE_NAME}?share_id=eq.${encodeURIComponent(id)}&token_hash=eq.${encodeURIComponent(tokenHash)}&select=share_id`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`
        }
      }
    );

    if (!tokenResponse.ok) {
      const message = await tokenResponse.text();
      return NextResponse.json({ error: message || "Failed to validate edit token." }, { status: 500 });
    }

    const tokenRows = (await tokenResponse.json()) as { share_id: string }[];
    if (tokenRows.length === 0) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (Array.isArray(body.checkedMatches)) {
      updates.checked_matches = Array.from(new Set(body.checkedMatches.filter(
        (match): match is number => Number.isInteger(match) && match > 0 && match <= 20
      ))).sort((left, right) => left - right);
    }
    if (body.payload !== undefined) {
      const payload = normalizeSchedulePayload(body.payload);
      if (!payload) return NextResponse.json({ error: "Invalid schedule payload." }, { status: 400 });
      updates.payload = payload;
    }

    const response = await fetch(`${url}/rest/v1/${TABLE_NAME}?id=eq.${encodeURIComponent(id)}`, {
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
      return NextResponse.json({ error: message || "Failed to update share." }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update share." },
      { status: 500 }
    );
  }
}

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
    const body = await request.json() as { checkedMatches?: number[]; editToken?: string };
    if (!body.editToken || !Array.isArray(body.checkedMatches)) {
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

    const response = await fetch(`${url}/rest/v1/${TABLE_NAME}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        checked_matches: body.checkedMatches,
        updated_at: new Date().toISOString()
      })
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

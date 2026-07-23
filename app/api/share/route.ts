import { NextResponse } from "next/server";

const TABLE_NAME = "pickleball_shared_schedules";
const TOKEN_TABLE_NAME = "pickleball_share_edit_tokens";
const ID_CHARS = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_SAVED_SCHEDULES = 10;

function createShareId(length = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => ID_CHARS[byte % ID_CHARS.length]).join("");
}

function createEditToken(length = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => ID_CHARS[byte % ID_CHARS.length]).join("");
}

async function hashToken(token: string) {
  const bytes = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase env vars are missing.");
  }

  return { key, url };
}

async function removeSchedulesBeyondLimit(url: string, key: string) {
  // Keep the newest ten schedules. Token rows are removed automatically by the
  // foreign-key cascade, so old share links can no longer be opened either.
  const schedulesResponse = await fetch(
    `${url}/rest/v1/${TABLE_NAME}?select=id&order=created_at.desc,id.desc&offset=${MAX_SAVED_SCHEDULES}`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      }
    }
  );

  if (!schedulesResponse.ok) return;
  const schedules = (await schedulesResponse.json()) as { id: string }[];
  if (schedules.length === 0) return;

  const ids = schedules.map((schedule) => schedule.id).filter((id) => /^[A-Za-z0-9]+$/.test(id));
  if (ids.length === 0) return;

  await fetch(`${url}/rest/v1/${TABLE_NAME}?id=in.(${ids.join(",")})`, {
    method: "DELETE",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "return=minimal"
    }
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { checkedMatches?: number[]; payload?: unknown };
    const payload = body.payload ?? body;
    const checkedMatches = body.payload ? body.checkedMatches ?? [] : [];
    const { key, url } = getSupabaseConfig();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const id = createShareId();
      const editToken = createEditToken();
      const editTokenHash = await hashToken(editToken);
      const response = await fetch(`${url}/rest/v1/${TABLE_NAME}`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          id,
          payload,
          checked_matches: checkedMatches
        })
      });

      if (response.ok) {
        const tokenResponse = await fetch(`${url}/rest/v1/${TOKEN_TABLE_NAME}`, {
          method: "POST",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal"
          },
          body: JSON.stringify({
            share_id: id,
            token_hash: editTokenHash
          })
        });

        if (!tokenResponse.ok) {
          const message = await tokenResponse.text();
          return NextResponse.json({ error: message || "Failed to save edit token." }, { status: 500 });
        }

        await removeSchedulesBeyondLimit(url, key);
        return NextResponse.json({ editToken, id });
      }

      if (response.status !== 409) {
        const message = await response.text();
        return NextResponse.json({ error: message || "Failed to save share." }, { status: 500 });
      }
    }

    return NextResponse.json({ error: "Could not create a unique share id." }, { status: 500 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save share." },
      { status: 500 }
    );
  }
}

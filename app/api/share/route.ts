import { NextResponse } from "next/server";
import { database, removeSchedulesBeyondLimit } from "../../lib/cloudflare-data";
import { isAdminRequest, unauthorizedResponse } from "../admin/_utils";

const ID_CHARS = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createRandomValue(length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => ID_CHARS[byte % ID_CHARS.length]).join("");
}

async function hashToken(token: string) {
  const bytes = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  if (!await isAdminRequest(request)) return unauthorizedResponse();

  try {
    const body = await request.json() as { checkedMatches?: number[]; payload?: unknown };
    const payload = body.payload ?? body;
    const checkedMatches = body.payload ? body.checkedMatches ?? [] : [];

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const id = createRandomValue(8);
      const editToken = createRandomValue(32);
      const tokenHash = await hashToken(editToken);
      const now = new Date().toISOString();

      try {
        await database().batch([
          database().prepare(
            `INSERT INTO pickleball_shared_schedules
              (id, payload, checked_matches, updated_at, created_at)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(id, JSON.stringify(payload), JSON.stringify(checkedMatches), now, now),
          database().prepare(
            `INSERT INTO pickleball_share_edit_tokens (share_id, token_hash, created_at)
             VALUES (?, ?, ?)`
          ).bind(id, tokenHash, now)
        ]);

        await removeSchedulesBeyondLimit();
        return NextResponse.json({ editToken, id });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.toLowerCase().includes("unique")) throw error;
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

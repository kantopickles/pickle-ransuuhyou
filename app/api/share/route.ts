import { NextResponse } from "next/server";

const TABLE_NAME = "pickleball_shared_schedules";
const ID_CHARS = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createShareId(length = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => ID_CHARS[byte % ID_CHARS.length]).join("");
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase env vars are missing.");
  }

  return { key, url };
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { key, url } = getSupabaseConfig();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const id = createShareId();
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
          payload
        })
      });

      if (response.ok) {
        return NextResponse.json({ id });
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

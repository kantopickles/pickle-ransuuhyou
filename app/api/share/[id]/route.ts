import { NextResponse } from "next/server";

const TABLE_NAME = "pickleball_shared_schedules";

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase env vars are missing.");
  }

  return { key, url };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { key, url } = getSupabaseConfig();
    const response = await fetch(`${url}/rest/v1/${TABLE_NAME}?id=eq.${encodeURIComponent(id)}&select=payload`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      }
    });

    if (!response.ok) {
      const message = await response.text();
      return NextResponse.json({ error: message || "Failed to load share." }, { status: 500 });
    }

    const rows = (await response.json()) as { payload: unknown }[];
    if (rows.length === 0) {
      return NextResponse.json({ error: "Share not found." }, { status: 404 });
    }

    return NextResponse.json({ payload: rows[0].payload });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load share." },
      { status: 500 }
    );
  }
}

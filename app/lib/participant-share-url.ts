export function participantShareUrl(origin: string, shareId: string, liffId?: string | null) {
  if (!/^[A-Za-z0-9]{6,20}$/.test(shareId)) throw new Error("Invalid share ID");
  return liffId && /^\d+-[A-Za-z0-9]+$/.test(liffId)
    ? `https://miniapp.line.me/${liffId}/s/${shareId}`
    : `${origin}/s/${shareId}`;
}

export async function buildParticipantShareUrl(origin: string, shareId: string) {
  try {
    const response = await fetch("/api/line/mini/config", { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error("mini configuration");
    const config = await response.json() as { enabled?: boolean; shareEnabled?: boolean; liffId?: string | null };
    return participantShareUrl(origin, shareId, config.enabled && config.shareEnabled ? config.liffId : null);
  } catch { return participantShareUrl(origin, shareId); }
}

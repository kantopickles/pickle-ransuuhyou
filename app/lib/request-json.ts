export class InvalidJsonBody extends Error {
  readonly status: number;
  constructor(status: number) { super("Invalid request body"); this.status = status; }
}

export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new InvalidJsonBody(413);
  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new InvalidJsonBody(413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text.length ? JSON.parse(text) : null;
  } catch (error) {
    if (error instanceof InvalidJsonBody) throw error;
    throw new InvalidJsonBody(400);
  } finally { reader.releaseLock(); }
}

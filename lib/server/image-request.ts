import { requestWithDeadline } from "../request-deadline";

/** One budget covers database reads, upstream headers/body, Storage and image encoding. */
export const IMAGE_REQUEST_TIMEOUT_MS = 18_000;
export const imageFailure = (status: 404 | 502 = 502) =>
  new Response(null, { status, headers: { "Cache-Control": "no-store" } });

export async function imageRequest(request: Request, work: (signal: AbortSignal) => Promise<Response>): Promise<Response> {
  try {
    return await requestWithDeadline(work, { timeoutMs: IMAGE_REQUEST_TIMEOUT_MS, signal: request.signal });
  } catch { return imageFailure(); }
}

export function imageFetchSignal(parent?: AbortSignal, timeoutMs = 15_000): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

/** Also cancel a stalled response stream; the same deadline remains active after fetch resolves. */
export async function imageBytes(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const reader = response.body?.getReader();
  if (!reader) throw new Error("EMPTY_IMAGE");
  const cancel = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    signal?.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new Error("IMAGE_TOO_LARGE");
      }
      chunks.push(value);
    }
    if (!size) throw new Error("EMPTY_IMAGE");
    return new Uint8Array(Buffer.concat(chunks));
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

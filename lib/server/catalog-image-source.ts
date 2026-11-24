import { imageBytes, imageFetchSignal } from "./image-request";

export type RasterContentType = "image/png" | "image/jpeg" | "image/webp";
const RASTER_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const missingUntil = new Map<string, number>();
const MAX_MISSING = 128;
const MISSING_TTL_MS = 30_000;

/** Short missing-source memory avoids repeating a known 404 for a card's original fallback.
 * It stores no bytes, expires after30s and never caches timeouts/provider5xx/decoder failures. */
function knownMissing(key: string): boolean {
  const until = missingUntil.get(key);
  if (until === undefined) return false;
  if (until <= Date.now()) { missingUntil.delete(key); return false; }
  return true;
}
function rememberMissing(key: string) {
  if (missingUntil.size >= MAX_MISSING) missingUntil.delete(missingUntil.keys().next().value!);
  missingUntil.set(key, Date.now() + MISSING_TTL_MS);
}
export function rasterContentType(bytes: Uint8Array): RasterContentType | null {
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0,4)) === "RIFF" &&
      String.fromCharCode(...bytes.subarray(8,12)) === "WEBP") return "image/webp";
  return null;
}

/** Callers validate their supplier/Storage allowlist first. No redirects or credentials.
 * Supplier MIME labels can be wrong; accepted raster magic is authoritative, Sharp still validates decoding. */
export async function downloadRasterSource(
  source: URL, maxBytes: number, { signal, fetcher = fetch, timeoutMs = 15_000 }:
  { signal?: AbortSignal; fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ bytes: Uint8Array; contentType: RasterContentType }> {
  signal?.throwIfAborted();
  if (source.href.length > 2048 || source.username || source.password ||
      !["http:", "https:"].includes(source.protocol)) throw new Error("INVALID_IMAGE_SOURCE");
  const key = source.href;
  if (knownMissing(key)) throw new Error("IMAGE_SOURCE_MISSING");
  const sourceSignal = imageFetchSignal(signal, timeoutMs);
  const response = await fetcher(source, { redirect: "error", cache: "no-store", signal: sourceSignal });
  if (response.status === 404 || response.status === 410) {
    void response.body?.cancel().catch(() => {});
    rememberMissing(key);
    throw new Error("IMAGE_SOURCE_MISSING");
  }
  const declared = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  const length = response.headers.get("content-length");
  if (response.status !== 200 || !RASTER_TYPES.has(declared) ||
      (length !== null && (!/^\d{1,10}$/.test(length) || Number(length) > maxBytes))) {
    void response.body?.cancel().catch(() => {});
    throw new Error("INVALID_IMAGE_RESPONSE");
  }
  const bytes = await imageBytes(response, maxBytes, sourceSignal);
  const actual = rasterContentType(bytes);
  if (!actual) throw new Error("INVALID_IMAGE_MAGIC");
  return { bytes, contentType: actual };
}

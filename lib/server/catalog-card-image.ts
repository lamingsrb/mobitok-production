import type { SupabaseClient } from "@supabase/supabase-js";
import { imageBytes } from "./image-request";
import { downloadRasterSource } from "./catalog-image-source";
import { DV_CARD_KEY, DV_CARD_SKU, dvCardSource, dvCardSourceKey } from "../catalog-card-image";

export const CARD_MAX_BYTES = 2 * 1024 * 1024;
export const CARD_MAX_PIXELS = 16_000_000;
const NO_STORE = { "Cache-Control": "no-store" };
const CARD_CACHE = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600";
/** One bounded source fetch, without Storage/database writes. */
export async function downloadDVCardSource(source: URL, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<Uint8Array> {
  const safe = dvCardSource(source.href);
  if (!safe) throw new Error("INVALID_CARD_SOURCE");
  return (await downloadRasterSource(safe, CARD_MAX_BYTES, { fetcher, signal, timeoutMs: 10_000 })).bytes;
}

export async function encodeDVCardImage(bytes: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted();
  // Import only after the public product/source guard and bounded download.
  const sharp = (await import("sharp")).default;
  signal?.throwIfAborted();
  const pipeline = sharp(bytes, { limitInputPixels: CARD_MAX_PIXELS, sequentialRead: true, animated: false, failOn: "error" })
    .timeout({ seconds: 5 }).rotate().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 85, effort: 4 });
  const cancel = () => { pipeline.once("error", () => {}); pipeline.destroy(new Error("Image encoding cancelled")); };
  signal?.addEventListener("abort", cancel, { once: true });
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true }).finally(() => signal?.removeEventListener("abort", cancel));
  signal?.throwIfAborted();
  if (info.format !== "webp" || info.width > 480 || info.height > 480 || data.length > CARD_MAX_BYTES)
    throw new Error("INVALID_CARD_OUTPUT");
  return new Uint8Array(data);
}

export async function dvCardImageResponse(db: SupabaseClient, sku: string, sourceKey: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<Response> {
  if (!DV_CARD_SKU.test(sku) || !DV_CARD_KEY.test(sourceKey)) return new Response(null, { status: 404, headers: NO_STORE });
  try {
    // Same authoritative public view as the existing image route; inactive/hidden/deleted products cannot fetch a thumbnail.
    const { data: product, error } = await db.from("catalog_visible_products").select("id,image,active")
      .eq("id", `dv-${sku}`).eq("supplier", "dv").eq("supplier_sku", sku).eq("active", true).maybeSingle();
    if (error) return new Response(null, { status: 503, headers: NO_STORE });
    if (!product || product.active !== true || product.id !== `dv-${sku}` || dvCardSourceKey(product.image) !== sourceKey)
      return new Response(null, { status: 404, headers: NO_STORE });
    signal?.throwIfAborted();
    const source = dvCardSource(product.image);
    if (!source) return new Response(null, { status: 404, headers: NO_STORE });
    const output = await encodeDVCardImage(await downloadDVCardSource(source, fetcher, signal), signal);
    return new Response(new Uint8Array(output), { headers: { "Content-Type": "image/webp", "Content-Length": String(output.byteLength),
      "Cache-Control": CARD_CACHE, "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response(null, { status: 502, headers: NO_STORE }); }
}

/**3G/MS cards share the bounded encoder; the original has already been obtained once.
 * No new stored variants, another source GET, or database mutation is introduced. */
export async function proxyCardImageResponse(original: Response, signal?: AbortSignal): Promise<Response> {
  if (original.status !== 200) return original;
  try {
    const bytes = await imageBytes(original, 8 * 1024 * 1024, signal);
    const output = await encodeDVCardImage(bytes, signal);
    return new Response(new Uint8Array(output), { headers: {
      "Content-Type": "image/webp", "Content-Length": String(output.byteLength),
      "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=3600",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch { return new Response(null, { status: 502, headers: NO_STORE }); }
}

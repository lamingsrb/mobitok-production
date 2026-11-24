import { configuredSupabaseUrl } from "../supabase-config";
import { imageBytes, imageFailure, imageFetchSignal } from "./image-request";
import { rasterContentType } from "./catalog-image-source";
import { posaljiSliku } from "./supplier-image";

const MAX_STORED_BYTES = 8 * 1024 * 1024;
const ERROR_BODY_BYTES = 2048;
const RASTER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export type StoredSupplierPhoto =
  | { state: "ready"; response: Response }
  | { state: "missing" }
  | { state: "unavailable"; response: Response };

/** Only this project's existing public3G bucket, including flat legacy raster filenames.
 * New writes retain the source-URL-hash contract; unknown legacy names are never used as a write target. */
export function storedSupplierPhotoURL(value: unknown): URL | null {
  const origin = configuredSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NODE_ENV);
  if (!origin || typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.origin === origin && !url.username && !url.password && !url.search && !url.hash &&
      /^\/storage\/v1\/object\/public\/supplier-images\/trig\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,159}\.(?:jpg|png|webp)$/.test(url.pathname)
      ? url : null;
  } catch { return null; }
}
async function objectMissing(response: Response, signal: AbortSignal): Promise<boolean> {
  if (![400, 404, 410].includes(response.status)) {
    void response.body?.cancel().catch(() => {});
    return false;
  }
  let bytes = new Uint8Array();
  if (response.body) {
    try { bytes = new Uint8Array(await imageBytes(response, ERROR_BODY_BYTES, signal)); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== "EMPTY_IMAGE") throw error;
    }
  }
  if (!bytes.length) return response.status === 404 || response.status === 410;
  let body: { code?: unknown; error?: unknown; message?: unknown; statusCode?: unknown };
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return false; }
  if (!body || typeof body !== "object") return false;
  // Legacy Storage can transport a semantic404 as HTTP400. Bucket/auth/tenant errors must not restore photos.
  if (body.code === "NoSuchKey") return true;
  return String(body.statusCode) === "404" && body.error === "not_found" && body.message === "Object not found";
}

/** Bypass the supplier-source missing memo: a local object may have just been restored.
 * Only authoritative missing-object evidence permits a supplier refetch; unrelated errors stay failures. */
export async function readStoredSupplierPhoto(value: string, signal: AbortSignal): Promise<StoredSupplierPhoto> {
  const url = storedSupplierPhotoURL(value);
  if (!url) return { state: "unavailable", response: imageFailure() };
  try {
    const sourceSignal = imageFetchSignal(signal);
    const response = await fetch(url, { redirect: "error", cache: "no-store", signal: sourceSignal });
    sourceSignal.throwIfAborted();
    if (response.status !== 200) {
      return await objectMissing(response, sourceSignal) ? { state: "missing" } :
        { state: "unavailable", response: imageFailure() };
    }
    const declared = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    const length = response.headers.get("content-length");
    if (!RASTER_TYPES.has(declared) ||
        (length !== null && (!/^\d{1,10}$/.test(length) || Number(length) > MAX_STORED_BYTES))) {
      void response.body?.cancel().catch(() => {});
      return { state: "unavailable", response: imageFailure() };
    }
    const bytes = await imageBytes(response, MAX_STORED_BYTES, sourceSignal);
    const actual = rasterContentType(bytes);
    if (!actual) return { state: "unavailable", response: imageFailure() };
    return { state: "ready", response: await posaljiSliku(url.href, actual, bytes, signal) };
  } catch { return { state: "unavailable", response: imageFailure() }; }
}

/** Create-only race losers read the winner once; no second supplier download or recursive restoration. */
export async function serveSavedSupplierPhoto(
  saved: { publicUrl: string; contentType: string; slika?: Uint8Array }, signal: AbortSignal,
): Promise<Response> {
  signal.throwIfAborted();
  if (saved.slika) return posaljiSliku(saved.publicUrl, saved.contentType, saved.slika, signal);
  const stored = await readStoredSupplierPhoto(saved.publicUrl, signal);
  return stored.state === "ready" ? stored.response : imageFailure();
}

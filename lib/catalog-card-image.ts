/** Fixed card preset. The source checksum is a cache key, never an authorization token. */
export const DV_CARD_VARIANT = "card-480-v1";
export const DV_CARD_KEY = /^[0-9a-f]{16}$/;
export const DV_CARD_SKU = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;
const FNV_OFFSET = BigInt("0xcbf29ce484222325");
const FNV_PRIME = BigInt("0x100000001b3");

/** The supplier sometimes omits the image ID, producing a known 404 path. */
export function malformedBTMImage(source: string): boolean {
  try {
    const url = new URL(source);
    return ["btm.rs", "www.btm.rs"].includes(url.hostname) && url.pathname.startsWith("/images//");
  } catch { return false; }
}

export function dvCardSource(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash &&
      ["digitalvision.rs", "www.digitalvision.rs"].includes(url.hostname) && /\.(?:png|jpe?g|webp)$/i.test(url.pathname)
      ? url : null;
  } catch { return null; }
}

export function dvCardSourceKey(source: string): string | null {
  const url = dvCardSource(source);
  if (!url) return null;
  const text = DV_CARD_VARIANT + "\0" + url.href;
  let value = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) value = BigInt.asUintN(64, (value ^ BigInt(text.charCodeAt(i))) * FNV_PRIME);
  return value.toString(16).padStart(16, "0");
}

export function dvCardImageURL(product: { id: string; image: string; supplier?: string }): string | null {
  if (product.supplier !== "dv" || !product.id.startsWith("dv-")) return null;
  const sku = product.id.slice(3), key = dvCardSourceKey(product.image);
  return DV_CARD_SKU.test(sku) && key
    ? `/api/catalog/image/dv/${encodeURIComponent(sku)}?variant=${DV_CARD_VARIANT}&v=${key}` : null;
}

export function dvCardRequestKey(requestURL: string): string | null {
  try {
    const params = new URL(requestURL).searchParams;
    if ([...params.keys()].length !== 2 || params.getAll("variant").length !== 1 || params.getAll("v").length !== 1 ||
        params.get("variant") !== DV_CARD_VARIANT) return null;
    const key = params.get("v") ?? "";
    return DV_CARD_KEY.test(key) ? key : null;
  } catch { return null; }
}

/** Proxy cards have one fixed preset; detail/gallery URLs keep their original bytes. */
export const PROXY_CARD_VARIANT = "card-480-v1";
export function supplierCardImageURL(product: { id: string; image: string; supplier?: string }): string | null {
  if (product.supplier === "dv") return dvCardImageURL(product);
  const supplier = product.supplier;
  if (supplier !== "trig" && supplier !== "msmobile") return null;
  const prefix = supplier + "-";
  if (!product.id.startsWith(prefix)) return null;
  const sku = product.id.slice(prefix.length);
  if (!DV_CARD_SKU.test(sku)) return null;
  const original = `/api/catalog/image/${supplier}/${encodeURIComponent(sku)}`;
  // A custom/overridden photo must keep its own source; never retarget another SKU.
  return product.image === original ? original + "?variant=" + PROXY_CARD_VARIANT : null;
}
export function proxyCardRequest(requestURL: string): boolean {
  try { return new URL(requestURL).search === "?variant=" + PROXY_CARD_VARIANT; }
  catch { return false; }
}

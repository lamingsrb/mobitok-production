const MIN_BYTES = 24 * 1024;
const RASTER_FORMAT = { "image/jpeg": "jpeg", "image/webp": "webp", "image/png": "png" } as const;

/** Preserve the supplier's format, dimensions and object key. Never store a larger derivative. */
export async function compressSupplierPhoto(bytes: Uint8Array, contentType: string, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const expected = RASTER_FORMAT[contentType as keyof typeof RASTER_FORMAT];
  if (!expected || bytes.byteLength < MIN_BYTES) return bytes;

  const sharp = (await import("sharp")).default;
  signal?.throwIfAborted();
  const input = sharp(bytes, { limitInputPixels: 20_000_000, sequentialRead: true, failOn: "error" });
  const metadata = await input.metadata();
  signal?.throwIfAborted();
  if (metadata.format !== expected) throw new Error("Invalid supplier photo");
  if ((metadata.pages ?? 1) > 1) return bytes;

  // Physically rotate to the display orientation before removing source metadata.
  const pipeline = input.rotate().timeout({ seconds: 4 });
  if (expected === "jpeg") pipeline.jpeg({ quality: 82, progressive: true, mozjpeg: true });
  else if (expected === "webp") pipeline.webp({ quality: 84, effort: 4 });
  else pipeline.png({ compressionLevel: 9 });
  const cancel = () => { pipeline.once("error", () => {}); pipeline.destroy(new Error("Photo request cancelled")); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const optimized = await pipeline.toBuffer();
    signal?.throwIfAborted();
    return optimized.length < bytes.byteLength * 0.92 ? optimized : bytes;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

import { getAdminClient, HttpError } from "@/lib/server/supabase";
import { apiError } from "@/lib/server/http";
import { authorizedSupplierImageRetention } from "@/lib/server/supplier-image-retention-auth";
import { decodeRetentionRaster, runSupplierImageRetention } from "@/lib/server/supplier-image-retention";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };
export async function POST(request: Request) {
  const deadline = Date.now() + 44_000;
  try {
    if (!authorizedSupplierImageRetention(request.headers.get("authorization"), [process.env.SUPPLIER_SYNC_TOKEN, process.env.CRON_SECRET]))
      throw new HttpError(401, "Pristup nije dozvoljen.");
    if (Number(request.headers.get("content-length")) > 2048) throw new HttpError(400, "Zahtev nije ispravan.");
    const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    const bodySignal = AbortSignal.any([request.signal, AbortSignal.timeout(2000)]);
    const abortBody = () => { void reader?.cancel().catch(() => {}); };
    bodySignal.addEventListener("abort", abortBody, { once: true });
    try {
      if (reader) while (true) {
        bodySignal.throwIfAborted();
        const chunk = await reader.read(); bodySignal.throwIfAborted(); if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > 2048) throw new HttpError(400, "Zahtev nije ispravan.");
        chunks.push(chunk.value);
      }
    } finally { bodySignal.removeEventListener("abort", abortBody); void reader?.cancel().catch(() => {}); reader?.releaseLock(); }
    let body: Record<string, unknown> = {};
    try { body = bytes ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; }
    catch { throw new HttpError(400, "Zahtev nije ispravan."); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["mode", "objectName", "expectedVersion", "expectedCommit", "details"].includes(key)) ||
      body.mode !== undefined && !["auto", "dry-run", "pilot"].includes(String(body.mode)) ||
      body.objectName !== undefined && (typeof body.objectName !== "string" || !/^trig\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(body.objectName)) ||
      body.expectedVersion !== undefined && (typeof body.expectedVersion !== "string" || !/^[a-f0-9-]{36}$/i.test(body.expectedVersion)) ||
      body.expectedCommit !== undefined && (typeof body.expectedCommit !== "string" || !/^[a-f0-9]{40}$/.test(body.expectedCommit)) ||
      body.details !== undefined && typeof body.details !== "boolean")
      throw new HttpError(400, "Zahtev nije ispravan.");
    const result = await runSupplierImageRetention({
      now: Date.now, commit: process.env.APP_COMMIT_SHA, fetch,
      decode: decodeRetentionRaster,
      async rpc<T>(name: string, args: Record<string, unknown>, signal: AbortSignal) {
        const { data, error } = await getAdminClient(signal).rpc(name, args);
        if (error) throw new Error("RETENTION_RPC_FAILED");
        return data as T;
      },
      async remove(objectName: string, signal: AbortSignal) {
        const { error } = await getAdminClient(signal).storage.from("supplier-images").remove([objectName]);
        if (error) throw new Error("RETENTION_REMOVE_FAILED");
      },
    }, { mode: body.mode as "auto" | "dry-run" | "pilot" | undefined, objectName: body.objectName as string | undefined,
      expectedVersion: body.expectedVersion as string | undefined, expectedCommit: body.expectedCommit as string | undefined,
      details: body.details === true, signal: request.signal, deadline });
    return Response.json(result, { headers, status: result.status === "pending" ? 503 : 200 });
  } catch (error) { return apiError(error); }
}

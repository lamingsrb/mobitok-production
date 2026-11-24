import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";

export const RETENTION_PROTOCOL = 1;
export const RETENTION_TOTAL_MS = 44_000;
export const RETENTION_SOURCE_BYTES = 8 * 1024 * 1024;
export const RETENTION_VENDOR_BYTES = 20 * 1024 * 1024;
const PATH = /^trig\/([a-f0-9]{64})\.(?:jpg|png|webp)$/;
const SOURCE_HOST = "rstrigb2bee.blob.core.windows.net";
type Signal = AbortSignal;
export type RetentionCandidate = {
  objectName: string; version: string; etag: string; bytes: number;
  updatedAt: string; createdAt: string; sourceUrl: string; supplierSku: string; kind: "primary" | "gallery";
};
export type RetentionClaim = {
  claimed: boolean; reason: string | null; enabled: boolean; autoEnabled?: boolean; active: boolean; bucketBytes: number;
  highWaterBytes: number; lowWaterBytes: number; recoveryProtocol: number; recoveryCommit: string | null; leaseUntil: string;
};
export type RetentionOptions = { mode?: "auto" | "dry-run" | "pilot"; objectName?: string; expectedVersion?: string; expectedCommit?: string; details?: boolean; signal?: Signal; deadline?: number };
export type RetentionDependencies = {
  now(): number; commit: string | undefined;
  rpc<T>(name: string, args: Record<string, unknown>, signal: Signal): Promise<T>;
  fetch(url: string, init: RequestInit): Promise<Response>;
  remove(objectName: string, signal: Signal): Promise<void>;
  decode(bytes: Uint8Array, mime: string, signal: Signal): Promise<void>;
};
class RetentionFailure extends Error { constructor(public code: string) { super(code); } }
const failed = (code: string): never => { throw new RetentionFailure(code); };
const safeCode = (error: unknown, fallback = "WORKER_FAILED") => error instanceof RetentionFailure ? error.code : fallback;
const deadlineSignal = (parent: Signal | undefined, ms: number) => parent ? AbortSignal.any([parent, AbortSignal.timeout(Math.max(1, ms))]) : AbortSignal.timeout(Math.max(1, ms));
const validCandidate = (row: RetentionCandidate) => {
  if (!row || !PATH.test(row.objectName) || !/^[a-f0-9-]{36}$/i.test(row.version) || !/^[a-f0-9]{32}$/i.test(row.etag?.replaceAll('"', "")) ||
    !Number.isSafeInteger(Number(row.bytes)) || Number(row.bytes) <= 0 || Number(row.bytes) > RETENTION_SOURCE_BYTES ||
    !row.supplierSku || !["primary", "gallery"].includes(row.kind)) return false;
  return sourceForObject(row.objectName, row.sourceUrl) !== null;
};
export function sourceForObject(objectName: string, value: string): URL | null {
  const match = PATH.exec(objectName);
  if (!match || typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== SOURCE_HOST || url.port || url.username || url.password || url.hash || url.toString() !== value) return null;
    return createHash("sha256").update(url.toString()).digest("hex") === match[1] ? url : null;
  } catch { return null; }
}
export async function decodeRetentionRaster(bytes: Uint8Array, mime: string, signal: Signal): Promise<void> {
  signal.throwIfAborted();
  const decoder = sharp(bytes, { failOn: "warning", limitInputPixels: 20_000_000, animated: false }).timeout({ seconds: 3 });
  const abort = () => { decoder.once("error", () => {}); decoder.destroy(new Error("RETENTION_DECODE_ABORTED")); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const meta = await decoder.metadata();
    signal.throwIfAborted();
    const expected: Record<string, string> = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" };
    if (meta.format !== expected[mime] || !meta.width || !meta.height || meta.width < 64 || meta.height < 64 || meta.width * meta.height > 20_000_000) failed("SOURCE_INVALID_IMAGE");
    await decoder.raw().toBuffer();
    signal.throwIfAborted();
  } catch (error) {
    if (signal.aborted) failed("SOURCE_ABORTED");
    if (error instanceof RetentionFailure) throw error;
    failed("SOURCE_INVALID_IMAGE");
  } finally { signal.removeEventListener("abort", abort); decoder.destroy(); }
}
async function readSource(response: Response, signal: Signal, budget: { used: number }): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > RETENTION_SOURCE_BYTES) { void response.body?.cancel().catch(() => {}); failed("SOURCE_BODY_TOO_LARGE"); }
  const reader = response.body?.getReader();
  if (!reader) failed("SOURCE_INVALID_IMAGE");
  const chunks: Uint8Array[] = []; let bytes = 0;
  const abort = () => { void reader!.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader!.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.length; budget.used += chunk.value.length;
      if (bytes > RETENTION_SOURCE_BYTES) failed("SOURCE_BODY_TOO_LARGE");
      if (budget.used > RETENTION_VENDOR_BYTES) failed("BUDGET_EXHAUSTED");
      chunks.push(chunk.value);
    }
    if (!bytes) failed("SOURCE_INVALID_IMAGE");
    return new Uint8Array(Buffer.concat(chunks));
  } finally {
    signal.removeEventListener("abort", abort);
    void reader!.cancel().catch(() => {});
    reader!.releaseLock();
  }
}
async function verifySource(row: RetentionCandidate, work: RetentionDependencies, signal: Signal, budget: { used: number }) {
  const url = sourceForObject(row.objectName, row.sourceUrl);
  if (!url) failed("HASH_MISMATCH");
  let response: Response;
  try { response = await work.fetch(url!.toString(), { method: "GET", redirect: "manual", cache: "no-store", signal, headers: { Accept: "image/jpeg,image/png,image/webp" } }); }
  catch { failed(signal.aborted ? "SOURCE_ABORTED" : "SOURCE_TIMEOUT"); }
  if (response!.status >= 300 && response!.status < 400) { void response!.body?.cancel().catch(() => {}); failed("SOURCE_REDIRECT"); }
  if (!response!.ok) {
    void response!.body?.cancel().catch(() => {});
    failed([404, 410, 429].includes(response!.status) ? "SOURCE_HTTP_" + response!.status : response!.status >= 500 ? "SOURCE_HTTP_5XX" : "SOURCE_HTTP_OTHER");
  }
  const mime = (response!.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const objectMime = row.objectName.endsWith(".jpg") ? "image/jpeg" : row.objectName.endsWith(".png") ? "image/png" : "image/webp";
  if (mime !== objectMime) { void response!.body?.cancel().catch(() => {}); failed("SOURCE_INVALID_MIME"); }
  const bytes = await readSource(response!, signal, budget);
  signal.throwIfAborted();
  try { await work.decode(bytes, mime, signal); }
  catch (error) { if (error instanceof RetentionFailure) throw error; failed(signal.aborted ? "SOURCE_ABORTED" : "SOURCE_INVALID_IMAGE"); }
  signal.throwIfAborted();
}
function sameCandidate(a: RetentionCandidate, b: RetentionCandidate) {
  return a.objectName === b.objectName && a.version === b.version && a.etag === b.etag && Number(a.bytes) === Number(b.bytes) &&
    a.updatedAt === b.updatedAt && a.sourceUrl === b.sourceUrl && a.supplierSku === b.supplierSku;
}
export async function runSupplierImageRetention(work: RetentionDependencies, options: RetentionOptions = {}) {
  const started = work.now(), owner = randomUUID(), mode = options.mode ?? "auto", dryRun = mode === "dry-run";
  const cleanupDeadline = Math.min(started + RETENTION_TOTAL_MS, options.deadline ?? Infinity), workDeadline = cleanupDeadline - 9_000;
  const signal = deadlineSignal(options.signal, workDeadline - work.now());
  const cleanup = () => deadlineSignal(undefined, cleanupDeadline - work.now());
  let claimed = false;
  const budget = { used: 0 }, details: Record<string, unknown>[] = [];
  const result = { status: "idle", reason: "", deleted: 0, skipped: 0, failed: 0, sourceWarnings: 0, sourceVerified: 0, confirmedDeletedBytes: 0, vendorBytes: 0, protocol: RETENTION_PROTOCOL, bucketBytesBefore: 0, bucketBytesAfter: 0, active: false, remainingSafeCandidatesUnknown: false, mappingCapacityLimited: false };
  const rpc = async <T>(name: string, args: Record<string, unknown>, useSignal = signal): Promise<T> => {
    try { return await work.rpc<T>(name, { p_owner: owner, ...args }, useSignal); }
    catch { return failed("DB_UNAVAILABLE"); }
  };
  const record = (row: RetentionCandidate, outcome: string, code: string | null) => rpc<{ confirmedAbsent?: boolean; recreated?: boolean }>("record_supplier_image_retention_result", { p_object_name: row.objectName, p_version: row.version, p_outcome: outcome, p_code: code }, cleanup());
  try {
    if (mode === "pilot" && (!options.objectName || !options.expectedVersion || !/^[a-f0-9]{40}$/.test(options.expectedCommit ?? "") || options.expectedCommit !== work.commit)) failed("RELEASE_NOT_READY");
    const claim = await rpc<RetentionClaim>("claim_supplier_image_retention", { p_dry_run: dryRun });
    result.reason = claim.reason ?? ""; result.bucketBytesBefore = Number(claim.bucketBytes); result.bucketBytesAfter = Number(claim.bucketBytes); result.active = claim.active;
    if (!claim.claimed) return { ...result, ...(options.details ? { details } : {}) };
    claimed = true;
    if (!dryRun && (!claim.enabled || !claim.active || claim.recoveryProtocol !== RETENTION_PROTOCOL)) failed("RELEASE_NOT_READY");
    if (mode === "auto" && claim.autoEnabled !== true) {
      result.status = "idle"; result.reason = "AUTO_DISABLED";
    } else {
      if (mode === "auto" && work.now() + 7_000 < workDeadline) {
        const backfillDeadline = Math.min(work.now() + 7_000, workDeadline - 7_000);
        try {
          for (let pageIndex = 0; pageIndex < 4 && work.now() + 500 < backfillDeadline; pageIndex++) {
            const pageSignal = deadlineSignal(signal, backfillDeadline - work.now());
            const page = await rpc<{
              items: { supplierSku: string; sourceUrls: string[]; sourceUrlsTruncated?: boolean }[];
              after: string | null; nextAfter: string | null; done: boolean;
              sourceUrlsTruncated?: boolean; capacityLimited?: boolean;
            }>("supplier_image_retention_backfill_page", { p_limit: 50 }, pageSignal);
            if (page.sourceUrlsTruncated || page.items?.some(item => item.sourceUrlsTruncated)) result.remainingSafeCandidatesUnknown = true;
            if (page.capacityLimited) { result.mappingCapacityLimited = true; break; }
            const rows: { supplierSku: string; sourceUrl: string; urlHash: string }[] = [];
            for (const item of page.items ?? []) for (const source of new Set(item.sourceUrls ?? [])) {
              try {
                const url = new URL(source);
                if (url.protocol === "https:" && url.hostname === SOURCE_HOST && !url.port && !url.username && !url.password && !url.hash && url.toString() === source)
                  rows.push({ supplierSku: item.supplierSku, sourceUrl: source, urlHash: createHash("sha256").update(source).digest("hex") });
              } catch { /* Unknown URL spellings are never guessed. */ }
            }
            if (rows.length > 2000) failed("SOURCE_BACKFILL_FAILED");
            const registered = await rpc<{ capacityLimited?: boolean }>("register_supplier_image_retention_sources", {
              p_rows: rows, p_after: page.after, p_next_after: page.nextAfter, p_scan_done: page.done,
            }, pageSignal);
            if (registered?.capacityLimited) { result.mappingCapacityLimited = true; break; }
            if (page.done) break;
          }
        } catch { result.remainingSafeCandidatesUnknown = true; }
      }
      const candidates = await rpc<RetentionCandidate[]>("supplier_image_retention_candidates", { p_limit: mode === "pilot" ? 1 : dryRun ? 3 : 50, p_object_name: options.objectName ?? null });
      if (!Array.isArray(candidates)) failed("DB_UNAVAILABLE");
      result.remainingSafeCandidatesUnknown ||= candidates.length === 0 && claim.active;
      for (const row of candidates) {
        if (work.now() + 5_000 >= workDeadline || budget.used + RETENTION_SOURCE_BYTES > RETENTION_VENDOR_BYTES) { result.reason = "bounded_step"; break; }
        if (options.signal?.aborted || signal.aborted) failed("DEADLINE");
        if (!validCandidate(row) || !Number.isFinite(Date.parse(row.updatedAt)) || !Number.isFinite(Date.parse(row.createdAt)) || work.now() - Date.parse(row.updatedAt) < 86_400_000 || work.now() - Date.parse(row.createdAt) < 86_400_000) { result.skipped++; if (!dryRun) await record(row, "skipped", "HASH_MISMATCH"); continue; }
        if (mode === "pilot" && row.version !== options.expectedVersion) failed("CANDIDATE_CHANGED");
        try {
          const sourceSignal = deadlineSignal(signal, Math.min(8_000, workDeadline - work.now() - 3_000));
          await verifySource(row, work, sourceSignal, budget);
          result.sourceVerified++;
          if (dryRun) {
            if (options.details) details.push({ objectName: row.objectName, supplierSku: row.supplierSku, version: row.version, etag: row.etag, bytes: Number(row.bytes), kind: row.kind, sourceVerified: true });
            continue;
          }
          const refreshed = await rpc<RetentionCandidate[]>("supplier_image_retention_candidates", { p_limit: 1, p_object_name: row.objectName });
          if (refreshed.length !== 1 || !sameCandidate(row, refreshed[0])) failed("CANDIDATE_CHANGED");
          signal.throwIfAborted();
          if (work.now() + 4_000 >= workDeadline) failed("DEADLINE");
          let confirmed: { confirmedAbsent?: boolean; recreated?: boolean } | undefined;
          try { await work.remove(row.objectName, deadlineSignal(signal, Math.min(5_000, workDeadline - work.now()))); }
          catch {
            // A lost DELETE response is reconciled against authoritative object metadata.
            // The RPC refuses old-version-still-present and applies the same idempotent result.
            try { confirmed = await record(row, "deleted", null); }
            catch { failed("STORAGE_DELETE_FAILED"); }
          }
          confirmed ??= await record(row, "deleted", null);
          if (confirmed.confirmedAbsent !== true && confirmed.recreated !== true) failed("STORAGE_VERIFY_FAILED");
          result.deleted++; result.confirmedDeletedBytes += confirmed.recreated ? 0 : Number(row.bytes);
          if (options.details) details.push({ objectName: row.objectName, supplierSku: row.supplierSku, version: row.version, etag: row.etag, bytes: Number(row.bytes), kind: row.kind, sourceVerified: true, deletionConfirmed: true, recreatedDuringStep: confirmed.recreated === true });
        } catch (error) {
          const code = safeCode(error, signal.aborted ? "DEADLINE" : "WORKER_FAILED");
          const isolatedSource = code.startsWith("SOURCE_") || ["HASH_MISMATCH", "CANDIDATE_CHANGED"].includes(code);
          if (isolatedSource) { result.skipped++; result.sourceWarnings++; } else result.failed++;
          if (!dryRun) { try { await record(row, isolatedSource ? "skipped" : "failed", code); } catch { result.reason = "result_uncertain"; result.failed++; break; } }
          if (options.details) details.push({ objectName: row.objectName, supplierSku: row.supplierSku, code });
          if (signal.aborted) failed("DEADLINE");
          if (!isolatedSource) { result.reason = code; break; }
        }
      }
      result.status = dryRun ? "dry_run" : "complete";
    }
  } catch (error) {
    result.status = "pending"; result.reason = safeCode(error, signal.aborted ? "DEADLINE" : "DB_UNAVAILABLE");
  } finally {
    result.vendorBytes = budget.used;
    if (claimed && work.now() < cleanupDeadline) {
      try {
        const final = await rpc<{ bucketBytes: number; active: boolean }>("finish_supplier_image_retention", { p_error_code: result.status === "pending" ? (["SOURCE_BACKFILL_FAILED", "DB_UNAVAILABLE", "BUDGET_EXHAUSTED", "DEADLINE", "RELEASE_NOT_READY", "WORKER_FAILED"].includes(result.reason) ? result.reason : "WORKER_FAILED") : null }, cleanup());
        result.bucketBytesAfter = Number(final.bucketBytes); result.active = final.active;
      } catch { result.status = "pending"; result.reason ||= "DB_UNAVAILABLE"; }
    }
  }
  return { ...result, ...(options.details ? { details } : {}) };
}

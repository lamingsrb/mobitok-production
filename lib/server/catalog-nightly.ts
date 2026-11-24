import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSyncClient, syncSupplier, type SyncReport } from "./supplier-sync";
import { publishSupplierCatalog, type CatalogPublication } from "./catalog-publish";
import { tooSoon } from "./supplier-rotation";
import { HttpError } from "./supabase";

type StepStatus = "queued" | "syncing" | "publishing" | "ok" | "failed" | "skipped";
type Step = { supplier: string; status: StepStatus; startedAt: string | null; syncRunId: string | null; publicationRunId: string | null };
type Batch = { id: string; status: string; steps: Array<{ supplier: string; status: StepStatus }> };
type Claim = { claimed: boolean; reason: string; batch: Batch | null; step?: Step };
type Attempt = { id: string; status: string; started_at: string; finished_at: string | null };
type Publication = { id: string; owner: string; status: string; phase: string | null; lease_until: string | null; sync_run_id: string };
type Snapshot = {
  enabled: boolean; configured: boolean; publishEnabled: boolean; sourceLeaseUntil: string | null;
  lastAttempt: Attempt | null; lastSuccessful: Attempt | null; publication: Publication | null;
};

export type NightlyResult = { batch: Batch | null; reason: string; reports: SyncReport[]; pending: boolean };
export type NightlyDependencies = {
  now: () => number;
  claim: (owner: string, actor: string | null, supplier: string | null) => Promise<Claim>;
  checkpoint: (batch: string, owner: string, supplier: string, status: StepStatus, runId?: string | null, code?: string | null) => Promise<Batch>;
  release: (batch: string, owner: string) => Promise<void>;
  inspect: (supplier: string) => Promise<Snapshot>;
  sync: (supplier: string, deadline: number) => Promise<SyncReport>;
  publish: (supplier: string, deadline: number) => Promise<CatalogPublication>;
  abandonDisabledPublication: (publication: Publication) => Promise<void>;
};

const SAFE_CODES = new Set(["FEED_FAILED", "PUBLICATION_FAILED", "SOURCE_DISABLED", "SOURCE_NOT_CONFIGURED", "PUBLICATION_DISABLED", "VENDOR_BACKOFF", "SYNC_INTERRUPTED", "SYNC_IN_PROGRESS", "PUBLICATION_CAPACITY", "SYNC_CAPACITY", "CONFIGURATION_CHANGED", "UNKNOWN_RESULT", "57014", "55P03", "40001", "40P01", "53100", "23505", "P0001", "PGRST202", "PGRST000", "PGRST001", "PGRST002", "PGRST003"]);
export function attemptBelongsToStep(attemptStarted: string, stepStarted: string): boolean {
  const micros = (value: string): bigint | null => {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return null;
    const fraction = /\.(\d+)(?:Z|[+-]\d\d(?::?\d\d)?)$/.exec(value)?.[1] ?? "";
    return BigInt(ms) * BigInt(1000) + BigInt(fraction.slice(3, 6).padEnd(3, "0"));
  };
  const attempt = micros(attemptStarted), step = micros(stepStarted);
  return attempt !== null && step !== null && attempt >= step;
}
export function catalogUpdateErrorCode(error: unknown, fallback = "FEED_FAILED"): string {
  const value = typeof error === "string" ? error : error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "";
  if (SAFE_CODES.has(value) || /^HTTP_[45]\d{2}$/.test(value)) return value;
  const http = /\bHTTP[ _:]*(4\d{2}|5\d{2})\b/.exec(value);
  if (http) return `HTTP_${http[1]}`;
  // These legacy feed errors contain no URL/body; expose only their HTTP token.
  const vendorHttp = /^(?:Digital Vision je vratio status ([45]\d{2})\.|MS Mobile je vratio status ([45]\d{2}) za (?:GetProductsAsJsonFile|GetCategoriesAsJsonFile)\.)$/.exec(value);
  if (vendorHttp) return `HTTP_${vendorHttp[1] ?? vendorHttp[2]}`;
  return fallback;
}
const report = (supplier: string, status: SyncReport["status"], code?: string): SyncReport => ({
  supplier, runId: "", status, itemsInSource: 0, skipped: 0, added: 0, returned: 0, removed: 0,
  priceChanged: 0, unchanged: 0, withStock: 0, withImage: 0, durationMs: 0,
  ...(code ? { error: code === "VENDOR_BACKOFF" ? "Dobavljač zahteva duži razmak između preuzimanja." : status === "failed" ? "Obrada nije uspela; detalji su u statusu ažuriranja." : "Obrada čeka nastavak.", publishErrorCode: code } : {}),
});

function dependencies(db: SupabaseClient): NightlyDependencies {
  const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(name, args);
    if (error) throw Object.assign(new Error("CATALOG_UPDATE_RPC"), { code: error.code });
    return data as T;
  };
  return {
    now: Date.now,
    claim: (owner, actor, supplier) => rpc("claim_catalog_update_batch", { p_owner: owner, p_actor: actor, p_supplier: supplier }),
    checkpoint: (batch, owner, supplier, status, runId = null, code = null) => rpc("checkpoint_catalog_update_batch", { p_id: batch, p_owner: owner, p_supplier: supplier, p_status: status, p_sync_run_id: runId, p_error_code: code }),
    release: async (batch, owner) => { await rpc("release_catalog_update_batch", { p_id: batch, p_owner: owner }); },
    inspect: async (supplier) => {
      const [source, settings, last, successful, publication] = await Promise.all([
        db.from("supplier_sources").select("enabled,url,catalog_enabled,sync_lease_until,price_currency,price_includes_vat,price_field").eq("supplier", supplier).single(),
        db.from("shop_settings").select("publish_supplier_catalog").eq("id", true).single(),
        db.from("supplier_sync_runs").select("id,status,started_at,finished_at").eq("supplier", supplier).order("started_at", { ascending: false }).limit(1).maybeSingle(),
        db.from("supplier_sync_runs").select("id,status,started_at,finished_at").eq("supplier", supplier).eq("status", "ok").order("started_at", { ascending: false }).limit(1).maybeSingle(),
        db.from("catalog_publication_runs").select("id,owner,status,phase,lease_until,sync_run_id").eq("supplier", supplier).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (source.error || settings.error || last.error || successful.error || publication.error) throw new Error("CATALOG_UPDATE_METADATA");
      const row = source.data;
      return {
        enabled: row.enabled, configured: Boolean(process.env[`${supplier.toUpperCase()}_FEED_URL`] || row.url),
        publishEnabled: row.enabled && row.catalog_enabled && settings.data.publish_supplier_catalog && row.price_currency === "RSD" && row.price_includes_vat !== null && (supplier !== "trig" || ["Price", "ClientPrice"].includes(row.price_field ?? "")),
        sourceLeaseUntil: row.sync_lease_until, lastAttempt: last.data, lastSuccessful: successful.data, publication: publication.data,
      };
    },
    sync: syncSupplier,
    publish: (supplier, deadline) => publishSupplierCatalog(db, supplier, { deadline }),
    abandonDisabledPublication: async (publication) => { await rpc("release_catalog_publication", { p_id: publication.id, p_owner: publication.owner, p_failed: true }); },
  };
}

/** One bounded supplier step. Every trigger uses the same durable claim, including recovery. */
export async function runCatalogUpdateWorker(
  options: { actor?: string | null; supplier?: string | null; deadline?: number } = {},
  supplied?: NightlyDependencies,
): Promise<NightlyResult> {
  const work = supplied ?? dependencies(getSyncClient());
  const owner = randomUUID(), started = work.now(), deadline = options.deadline ?? started + 240_000;
  let claim: Claim;
  try { claim = await work.claim(owner, options.actor ?? null, options.supplier ?? null); }
  catch (error) {
    const code = catalogUpdateErrorCode(error, "UNKNOWN_RESULT");
    if (["55P03", "40001", "40P01", "57014"].includes(code)) return { batch: null, reason: "busy", reports: [], pending: true };
    throw new HttpError(503, "Status ažuriranja trenutno nije dostupan. Pokušajte ponovo.");
  }
  if (!claim.claimed || !claim.batch || !claim.step)
    return { batch: claim.batch, reason: claim.reason, reports: [], pending: claim.batch?.status === "running" };
  let batch = claim.batch;
  const step = claim.step, supplier = step.supplier;
  let currentStatus = step.status;
  let syncId = step.syncRunId;
  const checkpoint = async (status: StepStatus, runId: string | null = null, code: string | null = null) => {
    batch = await work.checkpoint(batch.id, owner, supplier, status, runId, code);
    currentStatus = status;
  };
  const finish = (reason: string, item: SyncReport): NightlyResult => ({ batch, reason, reports: [{ ...item, durationMs: work.now() - started }], pending: batch.status === "running" });
  try {
    let state = await work.inspect(supplier);
    if (!state.enabled || !state.configured && step.status !== "publishing" || !state.publishEnabled && step.status === "publishing") {
      const pub = state.publication;
      if (pub?.status === "running") {
        if (pub.lease_until && Date.parse(pub.lease_until) > work.now()) return finish("busy", report(supplier, "skipped", "UNKNOWN_RESULT"));
        // Invalid configuration cannot ever finish that snapshot. Existing CAS release
        // invalidates it, rather than leaving a disabled durable run blocking staff.
        await work.abandonDisabledPublication(pub);
      }
      const code = !state.enabled ? "SOURCE_DISABLED" : !state.configured && step.status !== "publishing" ? "SOURCE_NOT_CONFIGURED" : "PUBLICATION_DISABLED";
      await checkpoint("skipped", step.syncRunId, code);
      return finish("skipped", report(supplier, "skipped", code));
    }
    if (step.status === "publishing" && state.lastSuccessful) syncId = state.lastSuccessful.id;
    if (step.status !== "publishing") {
      const freshAttempt = step.startedAt && state.lastAttempt && attemptBelongsToStep(state.lastAttempt.started_at, step.startedAt) ? state.lastAttempt : null;
      if (step.status === "syncing" && freshAttempt) {
        if (freshAttempt.status === "ok") syncId = freshAttempt.id;
        else if (freshAttempt.status === "running" && state.sourceLeaseUntil && Date.parse(state.sourceLeaseUntil) > work.now())
          return finish("sync_in_progress", report(supplier, "skipped", "SYNC_IN_PROGRESS"));
        else {
          await checkpoint("failed", null, freshAttempt.status === "running" ? "SYNC_INTERRUPTED" : "FEED_FAILED");
          return finish("failed", report(supplier, "failed", "FEED_FAILED"));
        }
      }
      if (!syncId) {
        if (tooSoon(supplier, state.lastAttempt, work.now())) {
          await checkpoint("skipped", null, "VENDOR_BACKOFF");
          return finish("backoff", report(supplier, "skipped", "VENDOR_BACKOFF"));
        }
        await checkpoint("syncing");
        const synced = await work.sync(supplier, deadline);
        if (synced.status !== "ok") {
          state = await work.inspect(supplier);
          if (!state.enabled || !state.configured) {
            const code = !state.enabled ? "SOURCE_DISABLED" : "SOURCE_NOT_CONFIGURED";
            await checkpoint("skipped", null, code);
            return finish("skipped", report(supplier, "skipped", code));
          }
          if (state.sourceLeaseUntil && Date.parse(state.sourceLeaseUntil) > work.now())
            return finish("sync_in_progress", report(supplier, "skipped", "UNKNOWN_RESULT"));
          if (synced.status === "skipped" && !synced.runId) {
            await checkpoint("syncing", null, "UNKNOWN_RESULT");
            return finish("recovery_pending", report(supplier, "skipped", "UNKNOWN_RESULT"));
          }
          const code = catalogUpdateErrorCode(synced.errorCode, catalogUpdateErrorCode(synced.error));
          await checkpoint(synced.status === "skipped" ? "skipped" : "failed", null, code);
          return finish("failed", report(supplier, synced.status, code));
        }
        syncId = synced.runId;
        state = await work.inspect(supplier);
        if (!state.publishEnabled) {
          await checkpoint("skipped", syncId, "PUBLICATION_DISABLED");
          return finish("feed_complete", { ...synced, error: undefined, publishReason: "configuration" });
        }
        if (state.publication?.status === "ok" && state.publication.sync_run_id === syncId) {
          await checkpoint("ok", syncId);
          return finish("complete", { ...synced, error: undefined });
        }
        if (state.publication?.status === "failed" && state.publication.sync_run_id === syncId) {
          const code = synced.publishErrorCode ? catalogUpdateErrorCode(synced.publishErrorCode, "PUBLICATION_FAILED") : "PUBLICATION_FAILED";
          await checkpoint("failed", syncId, code);
          return finish("failed", report(supplier, "failed", code));
        }
        await checkpoint("publishing", syncId, synced.publishErrorCode ? catalogUpdateErrorCode(synced.publishErrorCode, "UNKNOWN_RESULT") : null);
        // syncSupplier already used this slice to publish. The next tick resumes its cursor.
        return finish("publication_pending", { ...synced, error: synced.error ? "Objava čeka nastavak." : undefined, publishPending: true });
      }
      await checkpoint("publishing", syncId);
    }
    if (!syncId) {
      await checkpoint("failed", null, "SYNC_INTERRUPTED");
      return finish("failed", report(supplier, "failed", "SYNC_INTERRUPTED"));
    }
    let published: CatalogPublication;
    try { published = await work.publish(supplier, deadline); }
    catch (error) {
      const code = catalogUpdateErrorCode(error, "UNKNOWN_RESULT");
      state = await work.inspect(supplier);
      if (state.publication?.status === "failed" || /^[0-9A-Z]{5}$/.test(code) && !["57014", "55P03", "40001", "40P01"].includes(code)) {
        await checkpoint("failed", syncId, code === "UNKNOWN_RESULT" ? "PUBLICATION_FAILED" : code);
        return finish("failed", report(supplier, "failed", code));
      }
      throw error;
    }
    const pending = ["in_progress", "busy", "capacity"].includes(published.reason ?? "");
    if (pending) {
      const code = published.reason === "capacity" ? "PUBLICATION_CAPACITY" : published.errorCode ? catalogUpdateErrorCode(published.errorCode, "UNKNOWN_RESULT") : null;
      await checkpoint("publishing", syncId, code);
      return finish("publication_pending", { ...report(supplier, "ok"), runId: syncId, action: "publish", published: published.published, publishPending: true, publishReason: published.reason, ...(code ? { publishErrorCode: code } : {}) });
    }
    if (published.reason && published.reason !== "current") {
      const code = published.reason === "configuration" ? "PUBLICATION_DISABLED" : "SYNC_INTERRUPTED";
      await checkpoint("failed", syncId, code);
      return finish("failed", report(supplier, "failed", code));
    }
    await checkpoint("ok", syncId);
    return finish("complete", { ...report(supplier, "ok"), runId: syncId, action: "publish", published: published.published });
  } catch (error) {
    const code = catalogUpdateErrorCode(error, "UNKNOWN_RESULT");
    // Transport uncertainty or a lost worker claim never turns a real job into a failure.
    // A later tick inspects durable sync/publication rows before deciding what to do.
    if (currentStatus === "syncing" || currentStatus === "publishing") {
      try { await checkpoint(currentStatus, syncId, code); } catch {}
    }
    return finish("recovery_pending", report(supplier, "skipped", code));
  } finally {
    try { await work.release(batch.id, owner); } catch {}
  }
}

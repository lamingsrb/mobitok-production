import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { CatalogUpdatesStatus } from "../catalog-update-types";
import { HttpError } from "./supabase";

const instant = z.iso.datetime({ offset: true });
const text = z.string().max(160);
const code = z.string().regex(/^[A-Z0-9_]{1,80}$/).nullable();
const summary = z.string().max(320).refine((value) => !/https?:\/\/|eyJ[A-Za-z0-9_-]+\./i.test(value)).nullable();
const count = z.number().int().nonnegative();
const step = z.object({
  supplier: text, status: z.enum(["queued", "syncing", "publishing", "ok", "failed", "skipped"]),
  startedAt: instant.nullable(), finishedAt: instant.nullable(), errorCode: code, errorSummary: summary,
});
const batch = z.object({
  id: z.string().uuid(), kind: z.enum(["scheduled", "manual", "recovery"]), localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["running", "ok", "partial", "failed"]), startedAt: instant, finishedAt: instant.nullable(),
  updatedAt: instant, currentSupplier: text.nullable(), leaseUntil: instant.nullable(), steps: z.array(step).max(40),
});
const publication = z.object({
  status: text, phase: text.nullable(), createdAt: instant, finishedAt: instant.nullable(), leaseUntil: instant.nullable(),
  staged: count, processed: count, changed: count, deactivated: count,
});
const schema = z.object({
  timezone: z.literal("Europe/Belgrade"), scheduledStart: z.literal("03:00"), nextScheduledAt: instant,
  schedulerConfigured: z.boolean(), schedulerError: z.literal("SCHEDULER_NOT_CONFIGURED").nullable(),
  activeBatch: batch.nullable(), lastBatch: batch.nullable(),
  suppliers: z.array(z.object({
    supplier: text, label: text, enabled: z.boolean(), catalogEnabled: z.boolean(), stockMaxAgeHours: z.number().int().min(1).max(168), lastPublishedAt: instant.nullable(),
    lastAttempt: z.object({
      status: text, startedAt: instant, finishedAt: instant.nullable(),
      rowsInSource: count, added: count, removed: count, priceChanged: count, errorCode: code, errorSummary: summary,
    }).nullable(),
    lastSuccessfulFeed: z.object({ startedAt: instant, finishedAt: instant }).nullable(),
    lastPublication: publication.nullable(),
    activeSync: z.object({ startedAt: instant, leaseUntil: instant.nullable() }).nullable(),
    activePublication: publication.nullable(),
  })).max(40),
});
export function toCatalogUpdatesStatus(value: unknown): CatalogUpdatesStatus {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError(503, "Status ažuriranja trenutno nije dostupan.");
  return parsed.data;
}
export async function readCatalogUpdatesStatus(db: SupabaseClient, actor: string): Promise<CatalogUpdatesStatus> {
  const { data, error } = await db.rpc("admin_catalog_updates_status", { p_actor: actor }, { get: true });
  if (error) throw new HttpError(503, "Status ažuriranja trenutno nije dostupan.");
  return toCatalogUpdatesStatus(data);
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient, HttpError } from "./supabase";

// Tiny indexed metadata read; no stale process cache after an administrative change.
export async function catalogPublicRevision(db: SupabaseClient = getAdminClient()): Promise<string> {
  const { data, error } = await db.rpc("catalog_public_revision", {}, { get: true });
  if (error || typeof data !== "string" || !data.trim())
    throw new HttpError(503, "Stanje kataloga trenutno nije dostupno.");
  return data;
}

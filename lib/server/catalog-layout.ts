import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCatalogLayout, type CatalogLayout } from "../catalog-layout";

/** Mandatory mapping read: errors stop publication/read instead of reverting structural moves. */
export async function loadCatalogLayout(db: SupabaseClient, actor?: string): Promise<CatalogLayout> {
  const { data, error } = await db.rpc(actor ? "admin_catalog_layout" : "catalog_layout", actor ? { p_actor: actor } : {});
  if (error) throw error;
  return parseCatalogLayout(data);
}

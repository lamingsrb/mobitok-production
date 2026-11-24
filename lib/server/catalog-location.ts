import type { SupabaseClient } from "@supabase/supabase-js";
import { CATALOG_LAYOUT_NODE_ID } from "../catalog-layout";

type Node = { id: string; parent: string; slug: string; version: number };
export type CatalogLocationResult = { url: string; redirect: boolean; blocked: boolean };
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const slug = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const unavailable = () => new Error("CATALOG_LOCATION_UNAVAILABLE");
function node(value: unknown): Node {
  if (!record(value) || typeof value.id !== "string" || !CATALOG_LAYOUT_NODE_ID.test(value.id) || !slug(value.parent, 40) || !slug(value.slug, 60) || typeof value.version !== "number" || !Number.isSafeInteger(value.version) || value.version < 0) throw unavailable();
  return { id: value.id, parent: value.parent, slug: value.slug, version: value.version };
}

/** Request-local authoritative lookup. No TTL, persistent cache, public DTO or inventory-wide mapping read. */
export async function catalogLocation(db: SupabaseClient, query: URLSearchParams): Promise<CatalogLocationResult> {
  const output = new URLSearchParams(query);
  const same = (): CatalogLocationResult => ({ url: `/katalog${output.size ? `?${output}` : ""}`, redirect: false, blocked: false });
  const blocked = (): CatalogLocationResult => ({ url: "/katalog", redirect: false, blocked: true });
  if (query.getAll("kategorija").length > 1 || query.getAll("podkategorija").length > 1) return blocked();
  const category = query.get("kategorija") ?? "", subcategory = query.get("podkategorija") ?? "";
  if (!subcategory || !slug(category, 40) || !slug(subcategory, 60)) return same();
  const alias = await db.from("catalog_subcategory_aliases")
    .select("parent,slug,node_id,node:catalog_subcategory_layout!catalog_subcategory_aliases_node_id_fkey(id,parent,slug,version)")
    .eq("parent", category).eq("slug", subcategory).maybeSingle();
  if (alias.error) throw unavailable();
  let current: Node;
  if (alias.data !== null) {
    const value: unknown = alias.data;
    if (!record(value) || value.parent !== category || value.slug !== subcategory) throw unavailable();
    current = node(value.node);
    if (value.node_id !== current.id || current.slug !== subcategory) throw unavailable();
  } else {
    // Keep the existing direct-current-node fallback; absence of an alias is not absence of the node.
    const direct = await db.from("catalog_subcategory_layout").select("id,parent,slug,version")
      .eq("parent", category).eq("slug", subcategory).maybeSingle();
    if (direct.error) throw unavailable();
    if (direct.data === null) return same();
    current = node(direct.data);
    if (current.parent !== category || current.slug !== subcategory) throw unavailable();
  }
  // Use the existing SQL policies on the node's CURRENT pair, including old moved aliases.
  const [live, visible] = await Promise.all([
    db.rpc("_catalog_layout_node_live", { p_node: current.id }),
    db.rpc("_catalog_layout_location_visible", { p_category: current.parent, p_subcategory: current.slug }),
  ]);
  if (live.error || visible.error || typeof live.data !== "boolean" || typeof visible.data !== "boolean") throw unavailable();
  if (!live.data || !visible.data) return blocked();
  // Policies and alias reads are separate HTTP snapshots. A concurrent move (including
  // move-away-and-back) must not validate the old parent against a newer node placement.
  const latest = await db.from("catalog_subcategory_layout").select("id,parent,slug,version").eq("id", current.id).maybeSingle();
  if (latest.error) throw unavailable();
  const checked = node(latest.data);
  if (checked.id !== current.id || checked.parent !== current.parent || checked.slug !== current.slug || checked.version !== current.version) throw unavailable();
  const redirect = current.parent !== category || current.slug !== subcategory;
  if (redirect) { output.set("kategorija", current.parent); output.set("podkategorija", current.slug); }
  return { ...same(), redirect };
}

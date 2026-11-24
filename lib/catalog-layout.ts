// Postgres accepts deterministic UUIDs without RFC version/variant restrictions.
export const CATALOG_LAYOUT_NODE_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/** Stable structural subgroup placement. Aliases resolve only exact parent/slug pairs. */
export interface CatalogLayoutNode {
  id: string;
  originParent: string;
  parent: string;
  slug: string;
  sortOrder: number;
  builtin: boolean;
  live: boolean;
  visible: boolean;
  version: number;
}
export interface CatalogLayoutAlias { parent: string; slug: string; nodeId: string }
export interface CatalogLayout { revision: number; nodes: CatalogLayoutNode[]; aliases: CatalogLayoutAlias[] }
export type CatalogLayoutAction =
  | { action: "taxonomy_reorder"; jobId: string; category: string; orderedIds: string[]; revision: number }
  | { action: "taxonomy_move_subcategory"; jobId: string; nodeId: string; toCategory: string; revision: number };
export interface CatalogLayoutResult { revision: number; changed: number; products: number; overrides: number; nodeId?: string }

export function resolveCatalogLocation(layout: CatalogLayout | null | undefined, category: string, subcategory: string): [string, string] {
  if (!layout || !subcategory) return [category, subcategory];
  const alias = layout.aliases.find((row) => row.parent === category && row.slug === subcategory);
  const node = alias ? layout.nodes.find((row) => row.id === alias.nodeId)
    : layout.nodes.find((row) => row.parent === category && row.slug === subcategory);
  return node ? [node.parent, node.slug] : [category, subcategory];
}

/** Reject an incomplete mapping rather than publishing with a partial/old parent map. */
export function parseCatalogLayout(value: unknown): CatalogLayout {
  const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  const slug = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v);
  if (!record(value) || !integer(value.revision) || !Array.isArray(value.nodes) || !Array.isArray(value.aliases)) throw new Error("CATALOG_LAYOUT_INVALID");
  const ids = new Set<string>();const pairs = new Set<string>();
  for (const node of value.nodes) {
    if (!record(node) || typeof node.id !== "string" || !CATALOG_LAYOUT_NODE_ID.test(node.id) || ids.has(node.id) ||
        !slug(node.originParent) || !slug(node.parent) || !slug(node.slug) || !integer(node.sortOrder) || !integer(node.version) ||
        typeof node.builtin !== "boolean" || typeof node.live !== "boolean" || typeof node.visible !== "boolean" || pairs.has(node.parent + "/" + node.slug)) throw new Error("CATALOG_LAYOUT_INVALID");
    ids.add(node.id);pairs.add(node.parent + "/" + node.slug);
  }
  const aliases = new Map<string, string>();
  const nodes = value.nodes as unknown as CatalogLayoutNode[];
  for (const alias of value.aliases) {
    if (!record(alias) || !slug(alias.parent) || !slug(alias.slug) || typeof alias.nodeId !== "string" || !ids.has(alias.nodeId) || nodes.find((node) => node.id === alias.nodeId)?.slug !== alias.slug ||
        aliases.has(alias.parent + "/" + alias.slug)) throw new Error("CATALOG_LAYOUT_INVALID");
    aliases.set(alias.parent + "/" + alias.slug, alias.nodeId);
  }
  for (const node of nodes) {
    if (aliases.get(node.originParent + "/" + node.slug) !== node.id || aliases.get(node.parent + "/" + node.slug) !== node.id) throw new Error("CATALOG_LAYOUT_INVALID");
  }
  return { revision: value.revision, nodes: nodes.map(({id,originParent,parent,slug,sortOrder,builtin,live,visible,version}) => ({id,originParent,parent,slug,sortOrder,builtin,live,visible,version})),
    aliases: (value.aliases as CatalogLayoutAlias[]).map(({parent,slug,nodeId}) => ({parent,slug,nodeId})) };
}

/** Public metadata contains only aliases between public groups, ending at a visible live node. */
export function publicCatalogLayout(layout: CatalogLayout, visibleParents: ReadonlySet<string>): CatalogLayout {
  const nodes = layout.nodes.filter((node) => node.live && node.visible && visibleParents.has(node.parent))
    .map((node) => ({ ...node, originParent: visibleParents.has(node.originParent) ? node.originParent : node.parent }));
  const ids = new Set(nodes.map((node) => node.id));
  return { revision: layout.revision, nodes, aliases: layout.aliases.filter((alias) => ids.has(alias.nodeId) && visibleParents.has(alias.parent)) };
}

/** Preserve every other filter; malformed/hidden destinations never become a broad catalog query. */
export function canonicalCatalogUrl(layout: CatalogLayout, params: URLSearchParams): { url: string; redirect: boolean; blocked: boolean } {
  const category = params.get("kategorija") ?? "";
  const subcategory = params.get("podkategorija") ?? "";
  const output = new URLSearchParams(params);
  if (params.getAll("kategorija").length > 1 || params.getAll("podkategorija").length > 1) return { url: "/katalog", redirect: false, blocked: true };
  const alias = layout.aliases.find((row) => row.parent === category && row.slug === subcategory);
  const node = alias ? layout.nodes.find((row) => row.id === alias.nodeId)
    : layout.nodes.find((row) => row.parent === category && row.slug === subcategory);
  if (node && (!node.live || !node.visible)) return { url: "/katalog", redirect: false, blocked: true };
  const [parent, slug] = resolveCatalogLocation(layout, category, subcategory);
  const redirect = parent !== category || slug !== subcategory;
  if (redirect) { output.set("kategorija", parent);output.set("podkategorija", slug); }
  const query = output.toString();
  return { url: `/katalog${query ? `?${query}` : ""}`, redirect, blocked: false };
}

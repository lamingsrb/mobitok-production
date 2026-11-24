import { CATALOG_LAYOUT_NODE_ID, parseCatalogLayout, resolveCatalogLocation, type CatalogLayout, type CatalogLayoutResult } from "../catalog-layout";
// Admin 03.11: API alata "Katalog" u admin centru (DESIGN 7). Ruta app/api/admin/catalog/route.ts
// ovde nalazi sheme, mapiranje gresaka i pozive RPC-a (WP1). Odgovori nikad ne nose cene.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { categories } from "@/lib/catalog";
import { CATALOG_MODEL_LIMITS, parseModelSelectionPreview, type CatalogModelOptions, type CatalogModelSelectionPreview } from "@/lib/catalog-model-selection";
import {
  CATALOG_ERROR_MESSAGES,
  CATALOG_ERROR_STATUS,
  CATALOG_LIMITS,
  DELETE_CONFIRM_WORD,
  type AdminProductDetail,
  type AdminProductRow,
  type AdminSearchResult,
  type CatalogAction,
  type CatalogErrorBody,
  type CatalogErrorCode,
  type CatalogFilter,
  type CatalogStatusView,
  type EditProductResult,
  type HistoryJob,
  type HistoryStatus,
  type HistoryView,
  type ProductOriginal,
  type ProductPatch,
  type StepResult,
  type Taxonomy,
  type TaxonomyKind,
  type TaxonomyNode,
  type TaxonomyRow,
  type TaxonomySaveResult,
  type TaxonomyView,
} from "@/lib/catalog-admin-types";
import {
  categorySubcategoryOrder,
  subcategoryName as codeSubcategoryName,
  subcategoryNames,
} from "@/lib/catalog-taxonomy";
import { HttpError } from "@/lib/server/supabase";
import { isValidLocation, mergeTaxonomy } from "@/lib/taxonomy-merge";
import { RESERVED_SLUGS, uniqueSlug } from "@/lib/taxonomy-slug";

type Loose = Record<string, unknown>;
type BulkAction = Extract<CatalogAction, { action: "bulk" }>;
type TaxonomyAction = Extract<CatalogAction, { action: "taxonomy" }>;

// Sheme tela POST zahteva (DESIGN 7.1). Bez .default(): podrazumevane vrednosti dodaje kod,
// pa su z.input i z.output isti tip kao CatalogAction iz ugovora.
const jobId = z.uuid();
// SQL stable subgroup IDs use md5(pair)::uuid, not necessarily an RFC-versioned UUID.
const layoutNodeId = z.string().regex(CATALOG_LAYOUT_NODE_ID);
const productId = z.string().min(1).max(95);
const cursor = z.string().max(95).nullable().optional();
const stepLimit = z.number().int().min(1).max(CATALOG_LIMITS.maxStep).optional();
// Admin 03.11: Postgres ne prima znak \u0000 ni usamljeni surogat; takav tekst je VALIDATION pre RPC-a (C6).
const BAD_TEXT = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const cleanText = (value: string) => !BAD_TEXT.test(value);
const exactModel = z.string().min(1).max(CATALOG_MODEL_LIMITS.modelLength)
  .refine((value) => cleanText(value) && value === value.trim() && !/[\u0000-\u001f]/.test(value), "INVALID_TEXT");
const modelSet = z.array(exactModel).min(1).max(CATALOG_MODEL_LIMITS.models)
  .refine((values) => new Set(values).size === values.length, "DUPLICATE_MODELS");
const modelSetScopeSchema = z.object({
  category: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(40),
  subcategory: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60),
  deviceBrand: z.string().min(1).max(CATALOG_MODEL_LIMITS.brandLength).refine((value) => cleanText(value) && value === value.trim() && !/[\u0000-\u001f]/.test(value), "INVALID_TEXT"),
  devices: modelSet,
});


const filterSchema = z
  .object({
    q: z.string().trim().max(100).refine(cleanText, "INVALID_TEXT").optional(),
    category: z.string().trim().max(40).optional(),
    subcategory: z.string().trim().max(60).optional(),
    supplier: z.string().trim().max(20).optional(),
    status: z.enum(["active", "hidden", "deleted", "all"]).optional(),
    edited: z.boolean().optional(),
    deviceBrand: z.string().trim().min(1).max(60).refine(cleanText, "INVALID_TEXT").optional(),
    device: z.string().trim().min(1).max(120).refine(cleanText, "INVALID_TEXT").optional(),
    devices: modelSet.optional(),
    excludeDeleted: z.boolean().optional(),
  })
  .strict()
  .refine((filter) => !(filter.device !== undefined && filter.devices !== undefined), "DEVICE_XOR_DEVICES")
  .refine((filter) => (!filter.deviceBrand && !filter.device && !filter.devices) ||
    Boolean(filter.deviceBrand && (filter.device || filter.devices) && filter.category && filter.subcategory), "EXACT_MODEL_SCOPE_REQUIRED")
  .refine((filter) => !filter.devices || (filter.status === "all" && filter.excludeDeleted === true && !filter.q && !filter.supplier && !filter.edited), "EXACT_MODEL_SET_REQUIRED");

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(CATALOG_LIMITS.name).refine(cleanText, "INVALID_TEXT").nullable().optional(),
    seoTitle: z.string().trim().min(1).max(CATALOG_LIMITS.seoTitle).refine(cleanText, "INVALID_TEXT").nullable().optional(),
    description: z.string().max(CATALOG_LIMITS.description).refine(cleanText, "INVALID_TEXT").nullable().optional(),
    location: z
      .object({ category: z.string().trim().min(1).max(40), subcategory: z.string().trim().max(60) })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), "EMPTY_PATCH");

export const catalogActionSchema = z.discriminatedUnion("action", [
  modelSetScopeSchema.extend({ action: z.literal("preview_models") }).strict(),
  z.object({ action: z.literal("taxonomy_reorder"), jobId,
    category: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(40),
    orderedIds: z.array(layoutNodeId).min(1).max(2000).refine((ids) => new Set(ids).size === ids.length),
    revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), }).strict(),
  z.object({ action: z.literal("taxonomy_move_subcategory"), jobId, nodeId: layoutNodeId,
    toCategory: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(40),
    revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), }).strict(),
  z
    .object({
      action: z.literal("edit_product"),
      jobId,
      id: productId,
      version: z.number().int().min(0),
      patch: patchSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("bulk"),
      jobId,
      op: z.enum(["move", "delete", "restore", "revert"]),
      ids: z.array(productId).min(1).max(CATALOG_LIMITS.maxStep).optional(),
      filter: filterSchema.optional(),
      after: cursor,
      limit: stepLimit,
      category: z.string().trim().min(1).max(40).optional(),
      subcategory: z.string().trim().max(60).optional(),
      confirm: z.literal(DELETE_CONFIRM_WORD).optional(),
    })
    .strict()
    .refine((bulk) => (bulk.ids !== undefined) !== (bulk.filter !== undefined), "IDS_XOR_FILTER")
    .refine((bulk) => !bulk.filter?.devices || bulk.op === "delete", "MODEL_SET_DELETE_ONLY")
    .refine(
      (bulk) => bulk.op !== "move" || (bulk.category !== undefined && bulk.subcategory !== undefined),
      "DESTINATION_REQUIRED",
    ),
  z
    .object({ action: z.literal("undo"), jobId, undoJobId: z.uuid(), after: cursor, limit: stepLimit })
    .strict()
    .refine((undo) => undo.undoJobId !== undo.jobId, "UNDO_SAME_JOB"),
  z
    .object({
      action: z.literal("taxonomy"),
      jobId,
      op: z.enum(["create", "rename", "hide", "remove"]),
      revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
      kind: z.enum(["group", "sub"]),
      parent: z.string().trim().max(40).optional(),
      slug: z.string().trim().max(60).optional(),
      label: z.string().trim().min(1).max(CATALOG_LIMITS.label).refine(cleanText, "INVALID_TEXT").optional(),
      labelEn: z.string().trim().max(CATALOG_LIMITS.label).refine(cleanText, "INVALID_TEXT").optional(),
      hidden: z.boolean().optional(),
    })
    .strict(),
]);

type SameType<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
/** Admin 03.11: tsc pada ako se shema i ugovor razidju, u bilo kom smeru (ulaz i izlaz sheme). */
export type CatalogActionContractCheck = [
  Assert<SameType<z.input<typeof catalogActionSchema>, CatalogAction>>,
  Assert<SameType<z.output<typeof catalogActionSchema>, CatalogAction>>,
];

// GET parametri: nepoznat view, predugacak tekst ili offset van 0..10000 = VALIDATION.
const VIEWS = ["status", "search", "product", "history", "taxonomy", "models"] as const;
export type CatalogView = (typeof VIEWS)[number];

export const catalogQuerySchema = z
  .object({
    view: z.enum(VIEWS),
    q: z.string().trim().max(100).refine(cleanText, "INVALID_TEXT").optional(),
    category: z.string().trim().max(40).optional(),
    subcategory: z.string().trim().max(60).optional(),
    supplier: z.string().trim().max(20).optional(),
    status: z.enum(["", "active", "hidden", "deleted", "all"]).optional(),
    edited: z.enum(["", "0", "1", "true", "false"]).optional(),
    offset: z
      .string()
      .regex(/^\d{0,5}$/)
      .refine((value) => value === "" || Number(value) <= CATALOG_LIMITS.maxJob, "INVALID_PAGE")
      .optional(),
    id: z.string().trim().max(95).optional(),
    deviceBrand: z.string().trim().min(1).max(60).refine(cleanText, "INVALID_TEXT").optional(),
  })
  .refine((query) => query.view !== "product" || Boolean(query.id), "ID_REQUIRED");

export interface CatalogQuery {
  view: CatalogView;
  filter: CatalogFilter; // samo zadati kljucevi
  offset: number;
  id: string;
  deviceBrand?: string;
}

/** Prazan ili izostavljen parametar = bez filtera; status bez vrednosti = "active"; edited=1 = samo izmenjeni. */
export function parseCatalogQuery(params: URLSearchParams): CatalogQuery {
  const query = catalogQuerySchema.parse(Object.fromEntries(params));
  const filter: CatalogFilter = {};
  if (query.q) filter.q = query.q;
  if (query.category) filter.category = query.category;
  if (query.subcategory) filter.subcategory = query.subcategory;
  if (query.supplier) filter.supplier = query.supplier;
  if (query.status) filter.status = query.status;
  if (query.edited === "1" || query.edited === "true") filter.edited = true;
  return { view: query.view, filter, offset: query.offset ? Number(query.offset) : 0, id: query.id ?? "", ...(query.deviceBrand ? { deviceBrand: query.deviceBrand } : {}) };
}

// Limiti po user.id, prozor 900 s (K2). Koraci posla (after != null) imaju svoj, veci limit.
// consume_request_quota prima najvise 1000 (iznad baca INVALID_QUOTA); veci limit trazi prvo migraciju (C1).
export const CATALOG_RATE_LIMITS = {
  "admin-catalog-read": 900,
  "admin-catalog-write": 300,
  "admin-catalog-step": 1000,
} as const;
export type CatalogRateScope = keyof typeof CATALOG_RATE_LIMITS;

export function rateScopeFor(a: CatalogAction | { view: string }): CatalogRateScope {
  if ("view" in a || a.action === "preview_models") return "admin-catalog-read";
  // Izbor po ID-u nema kursor: svaki paket je korak istog posla i pripada istom limitu kao nastavak filtera.
  if ((a.action === "bulk" && a.ids !== undefined) || ((a.action === "bulk" || a.action === "undo") && a.after != null))
    return "admin-catalog-step";
  return "admin-catalog-write";
}

/** Greska sa poznatim kodom iz ugovora (provera u kodu, pre ili posle RPC-a). */
export class CatalogFailure extends Error {
  constructor(public readonly code: CatalogErrorCode) {
    super(code);
    this.name = "CatalogFailure";
  }
}

export interface CatalogErrorInfo {
  code: CatalogErrorCode;
  status: number;
  retryAfter?: number;
}

// Admin 03.11: istek naredbe, zakljucavanje, deadlock i serijalizacija su prolazni; posao ponavlja korak.
const BUSY_PG_CODES: ReadonlySet<string> = new Set(["57014", "55P03", "40P01", "40001"]);
const MIGRATION_PG_CODES: ReadonlySet<string> = new Set(["PGRST202", "42883", "42P01", "PGRST205"]);
// Admin 03.11: baza ili PostgREST nedostupni (veza, restart, previse veza; i cela klasa 08). Posao se pauzira (C2).
const UNAVAILABLE_PG_CODES: ReadonlySet<string> = new Set(["PGRST000", "PGRST001", "PGRST002", "PGRST003", "53300", "57P01", "57P02", "57P03"]);
// Unos koji Postgres ne prima (znak \u0000, usamljeni surogat, neispravan tekst) je greska podataka, ne servera (C6).
const INPUT_PG_CODES: ReadonlySet<string> = new Set(["22P05", "22P02", "22021"]);
const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(CATALOG_ERROR_STATUS));

function errorCode(e: unknown): CatalogErrorCode {
  if (e instanceof CatalogFailure) return e.code;
  if (e instanceof HttpError) {
    if (e.status === 401) return "UNAUTHORIZED";
    if (e.status === 403) return "FORBIDDEN";
    if (e.status === 429) return "RATE_LIMITED";
    if (e.status === 413) return "REQUEST_TOO_LARGE";
    if (e.status === 400 || e.status === 415) return "VALIDATION";
    if (e.status === 503) return "CATALOG_UNAVAILABLE";
    return "INTERNAL";
  }
  if (e instanceof z.ZodError) return "VALIDATION";
  if (typeof e === "object" && e !== null) {
    const { code, message } = e as { code?: unknown; message?: unknown };
    if (typeof code === "string" && BUSY_PG_CODES.has(code)) return "CATALOG_BUSY";
    if (typeof code === "string" && MIGRATION_PG_CODES.has(code)) return "CATALOG_MIGRATION_PENDING";
    if (typeof code === "string" && (UNAVAILABLE_PG_CODES.has(code) || code.startsWith("08"))) return "CATALOG_UNAVAILABLE";
    if (typeof code === "string" && INPUT_PG_CODES.has(code)) return "VALIDATION";
    const text = typeof message === "string" ? message.trim() : "";
    if (KNOWN_CODES.has(text)) return text as CatalogErrorCode;
    if (text.startsWith("INVALID_")) return "VALIDATION";
    // supabase-js vraca prekid mreze kao gresku bez koda ("TypeError: fetch failed").
    if (!code && text.includes("fetch failed")) return "CATALOG_UNAVAILABLE";
  }
  return "INTERNAL";
}

/** Cisto mapiranje: izuzetak Postgres-a, HttpError, zod ili CatalogFailure -> kod, HTTP status i retryAfter. */
export function mapCatalogError(e: unknown): CatalogErrorInfo {
  const code = errorCode(e);
  // The shared advisory mutex protects only one short transaction. Retrying the
  // same packet is safe; statement/row-lock timeouts still use packet reduction.
  if (code === "CATALOG_BUSY" && typeof e === "object" && e !== null
      && "code" in e && e.code === "55P03" && "message" in e && e.message === "CATALOG_BUSY") {
    return { code, status: CATALOG_ERROR_STATUS[code], retryAfter: 1 };
  }
  return code === "RATE_LIMITED"
    ? { code, status: CATALOG_ERROR_STATUS[code], retryAfter: 900 }
    : { code, status: CATALOG_ERROR_STATUS[code] };
}

/** Telo CatalogErrorBody sa srpskom porukom iz ugovora; detalji idu samo u log servera. */
export function catalogError(e: unknown): Response {
  const { code, status, retryAfter } = mapCatalogError(e);
  if (code !== "UNAUTHORIZED" && code !== "FORBIDDEN" && code !== "RATE_LIMITED") {
    console.error(`Admin catalog: ${code}`, e);
  }
  const body: CatalogErrorBody = { error: CATALOG_ERROR_MESSAGES[code], code };
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (retryAfter !== undefined) {
    body.retryAfter = retryAfter;
    headers["Retry-After"] = String(retryAfter);
  }
  return Response.json(body, { status, headers });
}

/**
 * Admin 03.11: POST samo sa istog sajta. Pregledac salje Sec-Fetch-Site i Origin; klijent bez
 * tih zaglavlja prolazi (i dalje mora imati admin prijavu kroz Bearer token).
 */
export function assertSameOrigin(headers: Headers): void {
  const site = headers.get("sec-fetch-site");
  if (site === "same-origin") return;
  if (site === "cross-site") throw new CatalogFailure("FORBIDDEN");
  const origin = headers.get("origin");
  if (origin === null) return;
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  let originHost = "";
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    originHost = "";
  }
  if (!originHost || originHost !== host) throw new CatalogFailure("FORBIDDEN");
}

const isRecord = (value: unknown): value is Loose =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const record = (value: unknown): Loose => (isRecord(value) ? value : {});
const text = (value: unknown): string =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
const textOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : null;
const whole = (value: unknown): number => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/** none: nema ponistavanja; undone: vraceno sve (restored >= affected); inace partial. */
export function historyStatus(affected: number, restored: number, undoStarted: boolean): HistoryStatus {
  if (!undoStarted && restored === 0) return "none";
  if (restored >= affected) return "undone";
  return "partial";
}

export function toHistoryJob(raw: unknown): HistoryJob {
  const r = record(raw);
  const action = text(r.action);
  const affected = whole(r.affected);
  const restored = whole(r.restored);
  const status = historyStatus(affected, restored, r.undoStarted === true);
  return {
    jobId: text(r.jobId),
    action,
    affected,
    at: text(r.at),
    target: text(r.target),
    details: record(r.details),
    restored,
    status,
    undoable: (action === "move" || action === "delete") && status !== "undone",
  };
}

/** Brisanje po filteru ili vise od confirmOver ID-ova trazi DELETE_CONFIRM_WORD u svakom zahtevu. */
export function needsDeleteConfirm(a: Pick<BulkAction, "op" | "ids" | "filter">): boolean {
  return a.op === "delete" && (a.filter !== undefined || (a.ids?.length ?? 0) > CATALOG_LIMITS.confirmOver);
}

/** Samo polja iz ugovora (bez cena i ostalih kolona koje bi RPC mogao vratiti). */
export function toProductRow(raw: unknown): AdminProductRow {
  const r = record(raw);
  return {
    id: text(r.id),
    name: text(r.name),
    category: text(r.category),
    subcategory: text(r.subcategory),
    supplier: text(r.supplier),
    supplierSku: textOrNull(r.supplierSku),
    brand: text(r.brand),
    image: text(r.image),
    slug: text(r.slug),
    active: r.active === true,
    deleted: r.deleted === true,
    edited: r.edited === true,
  };
}

function toOriginal(raw: unknown): ProductOriginal {
  const r = record(raw);
  const original: ProductOriginal = {};
  if (typeof r.name === "string") original.name = r.name;
  if (typeof r.description === "string") original.description = r.description;
  if (typeof r.category === "string") original.category = r.category;
  if (typeof r.subcategory === "string" || (r.subcategory === null && typeof r.category === "string")) {
    original.subcategory = text(r.subcategory);
  }
  if (typeof r.active === "boolean") original.active = r.active;
  return original;
}

export function toProductDetail(raw: unknown): AdminProductDetail {
  const r = record(raw);
  const overridden = record(r.overridden);
  return {
    ...toProductRow(r),
    description: text(r.description),
    version: whole(r.version),
    seoTitle: typeof r.seoTitle === "string" ? r.seoTitle : null,
    original: toOriginal(r.original),
    updatedAt: text(r.updatedAt),
    overridden: {
      name: overridden.name === true,
      seoTitle: overridden.seoTitle === true,
      description: overridden.description === true,
      location: overridden.location === true,
    },
  };
}

function toSearchResult(raw: unknown, offset: number): AdminSearchResult {
  const r = record(raw);
  return {
    items: Array.isArray(r.items) ? r.items.map((item: unknown) => toProductRow(item)) : [],
    total: Math.min(whole(r.total), CATALOG_LIMITS.maxJob),
    totalCapped: r.totalCapped === true,
    offset: typeof r.offset === "number" ? r.offset : offset,
  };
}

/** Korak bez redova ne vraca changed (= 0); nepoznat oblik zavrsava posao umesto beskonacne petlje. */
function toStepResult(raw: unknown): StepResult {
  const r = record(raw);
  return {
    processed: whole(r.processed),
    changed: whole(r.changed),
    nextAfter: typeof r.nextAfter === "string" ? r.nextAfter : null,
    done: r.done !== false,
    ...(r.selectionBasis === "current_remaining" ? { selectionBasis: "current_remaining" } : {}),
  };
}

/** p_patch za admin_catalog_edit_product: samo poslati kljucevi; null = vrati original dobavljaca. */
export function rpcPatch(patch: ProductPatch): Loose {
  const out: Loose = {};
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.seoTitle !== undefined) out.seoTitle = patch.seoTitle;
  if (patch.description !== undefined) out.description = patch.description;
  if (patch.location !== undefined) {
    out.location =
      patch.location === null
        ? null
        : { category: patch.location.category, subcategory: patch.location.subcategory };
  }
  return out;
}

/** p_filter za admin_catalog_bulk_step: isti podrazumevani kao pretraga ("" = bez filtera, status active). */
export function rpcFilter(filter: CatalogFilter): Loose {
  return {
    ...(filter.deviceBrand ? { device_brand: filter.deviceBrand } : {}),
    ...(filter.device ? { device: filter.device } : {}),
    ...(filter.devices ? { devices: filter.devices } : {}),
    ...(filter.excludeDeleted !== undefined ? { exclude_deleted: filter.excludeDeleted } : {}),
    q: filter.q ?? "",
    category: filter.category ?? "",
    subcategory: filter.subcategory ?? "",
    supplier: filter.supplier ?? "",
    status: filter.status ?? "active",
    edited: filter.edited ?? false,
  };
}

// Taksonomija (pogled Grupe i cuvanje). Ugradjeno = postoji u kodu (lib/catalog.ts, lib/catalog-taxonomy.ts).
export interface TaxonomyCount {
  category: string;
  subcategory: string; // "" = bez podgrupe
  count: number;
}

const BUILTIN_GROUPS: ReadonlySet<string> = new Set(categories.map((category) => category.id));
const hasOwn = (target: object, key: string) => Object.prototype.hasOwnProperty.call(target, key);
const pairKey = (group: string, key: string) => `${group}/${key}`;

export const isBuiltinGroup = (slug: string): boolean => BUILTIN_GROUPS.has(slug);

/** Parovi grupa/podgrupa koji postoje u aktivnim proizvodima (treci argument mergeTaxonomy). */
export function presentPairs(counts: readonly TaxonomyCount[]): { category: string; key: string }[] {
  const seen = new Set<string>();
  const pairs: { category: string; key: string }[] = [];
  for (const c of counts) {
    if (!c.category || !c.subcategory || c.count <= 0 || seen.has(pairKey(c.category, c.subcategory))) continue;
    seen.add(pairKey(c.category, c.subcategory));
    pairs.push({ category: c.category, key: c.subcategory });
  }
  return pairs;
}

/**
 * Ugradjena podgrupa: kljuc ima naziv u kodu, na listi je reda grupe, ili postoji u proizvodima
 * a nema red u tabeli. Red u tabeli za kljuc van koda = korisnicka podgrupa.
 */
export function isBuiltinSub(
  group: string,
  key: string,
  rows: readonly TaxonomyRow[],
  counts: readonly TaxonomyCount[],
): boolean {
  if (hasOwn(subcategoryNames, key)) return true;
  if ((categorySubcategoryOrder[group] ?? []).includes(key)) return true;
  const present = counts.some((c) => c.category === group && c.subcategory === key && c.count > 0);
  return present && !rows.some((r) => r.kind === "sub" && r.parent === group && r.slug === key);
}

/**
 * Zauzeti slug-ovi za create. Grupa: ugradjene grupe, redovi grupa, kategorije iz proizvoda i
 * RESERVED_SLUGS. Podgrupa (globalno): kljucevi iz koda, prisutni kljucevi, svi redovi podgrupa.
 */
export function takenSlugs(
  kind: TaxonomyKind,
  rows: readonly TaxonomyRow[],
  counts: readonly TaxonomyCount[],
): Set<string> {
  const taken = new Set<string>(RESERVED_SLUGS);
  if (kind === "group") {
    BUILTIN_GROUPS.forEach((slug) => taken.add(slug));
    for (const c of counts) if (c.category) taken.add(c.category);
    for (const r of rows) if (r.kind === "group") taken.add(r.slug);
    return taken;
  }
  for (const key of Object.keys(subcategoryNames)) taken.add(key);
  for (const keys of Object.values(categorySubcategoryOrder)) for (const key of keys) taken.add(key);
  for (const c of counts) if (c.subcategory) taken.add(c.subcategory);
  for (const r of rows) if (r.kind === "sub") taken.add(r.slug);
  return taken;
}

/**
 * Pogled Grupe: vidljiva struktura i redosled iz mergeTaxonomy (kao prodavnica), pa sakriveni
 * korisnicki cvorovi iz tabele. count = aktivni proizvodi; za grupu zbir cele grupe.
 */
export function buildTaxonomyView(
  rows: readonly TaxonomyRow[],
  counts: readonly TaxonomyCount[],
  merged: Taxonomy,
  layout?: CatalogLayout,
): TaxonomyView {
  const groupTotals = new Map<string, number>();
  const subTotals = new Map<string, number>();
  for (const c of counts) {
    groupTotals.set(c.category, (groupTotals.get(c.category) ?? 0) + c.count);
    if (c.subcategory) {
      const id = pairKey(c.category, c.subcategory);
      subTotals.set(id, (subTotals.get(id) ?? 0) + c.count);
    }
  }
  const byOrder = (a: TaxonomyRow, b: TaxonomyRow) =>
    a.sort_order - b.sort_order || a.label_sr.localeCompare(b.label_sr, "sr");

  const subNode = (group: string, key: string): TaxonomyNode => {
    const row = rows.find((r) => r.kind === "sub" && r.parent === group && r.slug === key);
    const builtin = layout?.nodes.find((node) => node.parent === group && node.slug === key)?.builtin ?? isBuiltinSub(group, key, rows, counts);
    return {
      kind: "sub",
      parent: group,
      slug: key,
      label: row?.label_sr || merged.subcategoryName(group, key),
      labelEn: row?.label_en ?? null,
      defaultLabel: builtin ? codeSubcategoryName(key) : null,
      builtin,
      renamed: builtin && row !== undefined,
      hidden: !builtin && row?.hidden === true,
      count: subTotals.get(pairKey(group, key)) ?? 0,
      children: [],
    };
  };

  const children = (group: string, visible: readonly string[]): TaxonomyNode[] => {
    const keys: string[] = [];
    const add = (key: string) => {
      if (key && !keys.includes(key)) keys.push(key);
    };
    visible.forEach(add);
    for (const c of counts) if (c.category === group) add(c.subcategory);
    rows.filter((r) => r.kind === "sub" && r.parent === group).sort(byOrder).forEach((r) => add(r.slug));
    for (const node of layout?.nodes ?? []) if (node.parent === group && node.live) add(node.slug);
    if (layout) keys.sort((a, b) => (layout.nodes.find((node) => node.parent === group && node.slug === a)?.sortOrder ?? Number.MAX_SAFE_INTEGER)
      - (layout.nodes.find((node) => node.parent === group && node.slug === b)?.sortOrder ?? Number.MAX_SAFE_INTEGER));
    return keys.map((key) => subNode(group, key));
  };

  const groupNode = (slug: string, label: string, visible: readonly string[]): TaxonomyNode => {
    const row = rows.find((r) => r.kind === "group" && r.slug === slug);
    const builtin = BUILTIN_GROUPS.has(slug);
    return {
      kind: "group",
      parent: "",
      slug,
      label: row?.label_sr || label,
      labelEn: row?.label_en ?? null,
      defaultLabel: builtin ? (categories.find((category) => category.id === slug)?.name ?? null) : null,
      builtin,
      renamed: builtin && row !== undefined,
      hidden: !builtin && row?.hidden === true,
      count: groupTotals.get(slug) ?? 0,
      children: children(slug, visible),
    };
  };

  const groups = merged.groups.map((group) => groupNode(group.id, group.name, merged.subcategories(group.id)));
  const hiddenGroups = rows
    .filter((r) => r.kind === "group" && !BUILTIN_GROUPS.has(r.slug) && !groups.some((g) => g.slug === r.slug))
    .sort(byOrder);
  for (const r of hiddenGroups) groups.push(groupNode(r.slug, r.label_sr, []));
  return { groups, ...(layout ? { layout } : {}) };
}

function findTaxonomyNode(view: TaxonomyView, kind: TaxonomyKind, parent: string, slug: string) {
  if (kind === "group") return view.groups.find((group) => group.slug === slug);
  return view.groups.find((group) => group.slug === parent)?.children.find((sub) => sub.slug === slug);
}

// Pozivi baze (service klijent). Greske RPC-a se bacaju dalje i mapiraju u catalogError.
async function rpc(db: SupabaseClient, name: string, args: Loose): Promise<unknown> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}

function toTaxonomyRow(raw: unknown): TaxonomyRow | null {
  const r = record(raw);
  if ((r.kind !== "group" && r.kind !== "sub") || typeof r.slug !== "string" || !r.slug) return null;
  return {
    kind: r.kind,
    parent: text(r.parent),
    slug: r.slug,
    label_sr: text(r.label_sr),
    label_en: typeof r.label_en === "string" && r.label_en ? r.label_en : null,
    hidden: r.hidden === true,
    sort_order: whole(r.sort_order),
  };
}

/** One stable database snapshot binds the shown labels/counts to its edit revision. */
function taxonomyRequest(action: TaxonomyAction) {
  const { action: _action, jobId: _jobId, ...request } = action;
  return request;
}

async function loadTaxonomy(db: SupabaseClient, actor: string, action?: TaxonomyAction) {
  const snapshot = record(await rpc(db, "admin_catalog_taxonomy_snapshot", {
    p_actor: actor,
    ...(action ? { p_job: action.jobId, p_request: taxonomyRequest(action) } : {}),
  }));
  if (!Array.isArray(snapshot.rows) || !Array.isArray(snapshot.counts)) throw new CatalogFailure("CATALOG_UNAVAILABLE");
  let layout: CatalogLayout;
  try { layout = parseCatalogLayout(snapshot.layout); }
  catch { throw new CatalogFailure("CATALOG_UNAVAILABLE"); }
  const rows = snapshot.rows.map((raw: unknown) => toTaxonomyRow(raw))
    .filter((row): row is TaxonomyRow => row !== null);
  const counts: TaxonomyCount[] = snapshot.counts.map((raw: unknown) => {
    const r = record(raw);
    const [category, subcategory] = resolveCatalogLocation(layout, text(r.category), text(r.subcategory));
    return { category, subcategory, count: whole(r.count) };
  }).filter((c) => c.category !== "");
  let replay: TaxonomySaveResult | null = null;
  if (snapshot.replay !== null && snapshot.replay !== undefined) {
    const saved = record(snapshot.replay);
    if (typeof saved.slug !== "string" || !saved.slug || typeof saved.revision !== "number" || !Number.isSafeInteger(saved.revision) || saved.revision < 1)
      throw new CatalogFailure("CATALOG_UNAVAILABLE");
    replay = { slug: saved.slug, revision: saved.revision };
  }
  return { rows, counts, layout, replay, merged: mergeTaxonomy(rows, "sr", presentPairs(counts), layout) };
}

/** Odrediste mora postojati i biti vidljivo ("" = bez podgrupe), inace INVALID_DESTINATION. */
async function assertLocation(db: SupabaseClient, actor: string, category: string, subcategory: string) {
  const { merged } = await loadTaxonomy(db, actor);
  if (!isValidLocation(merged, category, subcategory)) throw new CatalogFailure("INVALID_DESTINATION");
}

async function getProduct(db: SupabaseClient, actor: string, id: string): Promise<AdminProductDetail> {
  const data = await rpc(db, "admin_catalog_get", { p_actor: actor, p_id: id });
  if (!isRecord(data)) throw new CatalogFailure("NOT_FOUND");
  return toProductDetail(data);
}

const capacityBytes = z.number().int().positive();
const catalogCapacitySchema = z.object({
  profile: z.enum(["free", "pro"]),
  ceilingBytes: capacityBytes,
  warnBytes: capacityBytes,
  writeBytes: capacityBytes,
  bulkBytes: capacityBytes,
  syncBytes: capacityBytes,
  stageBytes: capacityBytes,
  publicationBytes: capacityBytes,
}).refine(({ profile, ceilingBytes, warnBytes, ...limits }) =>
  Object.values(limits).every((limit) => limit >= warnBytes && limit < ceilingBytes),
);

export type CatalogViewResult = CatalogStatusView | AdminSearchResult | AdminProductDetail | HistoryView | TaxonomyView | CatalogModelOptions;

export async function readCatalogView(db: SupabaseClient, actor: string, query: CatalogQuery): Promise<CatalogViewResult> {
  switch (query.view) {
    case "models": {
      const { category, subcategory } = query.filter;
      if (!category || !subcategory) throw new CatalogFailure("VALIDATION");
      // Read-only options already enforce the admin guard and exact scope in SQL.
      // Counting the entire catalog again just to validate this selector adds a
      // redundant RPC and can exceed the production database request budget.
      // Unknown scopes return an empty list; mutation destination checks stay below.
      return toModelOptions(await rpc(db, "admin_catalog_model_options", {
        p_actor: actor, p_category: category, p_subcategory: subcategory, p_device_brand: query.deviceBrand ?? null,
      }));
    }
    case "status": {
      const { data, error } = await db.rpc("admin_catalog_ping", { p_actor: actor });
      if (error) {
        if (mapCatalogError(error).code === "CATALOG_MIGRATION_PENDING") return { ready: false };
        throw error;
      }
      const result = record(data);
      const bytes = result.dbBytes;
      const dbBytes = typeof bytes === "number" ? bytes : typeof bytes === "string" && bytes.trim() ? Number(bytes) : NaN;
      const capacity = catalogCapacitySchema.safeParse(result.capacity);
      return {
        ready: true,
        ...(Number.isSafeInteger(dbBytes) && dbBytes >= 0 ? { dbBytes } : {}),
        ...(capacity.success ? { capacity: capacity.data } : {}),
      };
    }
    case "search": {
      const f = query.filter;
      const data = await rpc(db, "admin_catalog_search", {
        p_actor: actor,
        p_q: f.q ?? "",
        p_category: f.category ?? "",
        p_subcategory: f.subcategory ?? "",
        p_supplier: f.supplier ?? "",
        p_status: f.status ?? "active",
        p_edited: f.edited ?? false,
        p_offset: query.offset,
        p_limit: CATALOG_LIMITS.pageSize,
      });
      return toSearchResult(data, query.offset);
    }
    case "product":
      return getProduct(db, actor, query.id);
    case "history": {
      const data = await rpc(db, "admin_catalog_history", { p_actor: actor, p_limit: 30 });
      return { jobs: Array.isArray(data) ? data.map((raw: unknown) => toHistoryJob(raw)) : [] };
    }
    case "taxonomy": {
      const { rows, counts, merged, layout } = await loadTaxonomy(db, actor);
      return buildTaxonomyView(rows, counts, merged, layout);
    }
  }
}

export type CatalogActionResult = EditProductResult | StepResult | TaxonomySaveResult | CatalogLayoutResult | CatalogModelSelectionPreview;

/**
 * Izvrsava POST radnju. onMutated se zove odmah posle uspesne izmene u bazi (edit_product,
 * korak bulk/undo sa changed > 0, taxonomy), pre ponovnog citanja; ruta tu osvezava kes.
 */
export async function runCatalogAction(
  db: SupabaseClient,
  actor: string,
  action: CatalogAction,
  onMutated: () => void = () => {},
): Promise<CatalogActionResult> {
  if (action.action === "preview_models") {
    const result = await rpc(db, "admin_catalog_model_selection", { p_actor: actor, p_category: action.category,
      p_subcategory: action.subcategory, p_device_brand: action.deviceBrand, p_devices: action.devices });
    try { return parseModelSelectionPreview(result); } catch { throw new CatalogFailure("CATALOG_UNAVAILABLE"); }
  }
  if (action.action === "taxonomy_reorder" || action.action === "taxonomy_move_subcategory") {
    const args = action.action === "taxonomy_reorder"
      ? { p_actor: actor, p_job: action.jobId, p_category: action.category, p_ordered_ids: action.orderedIds, p_expected_revision: action.revision }
      : { p_actor: actor, p_job: action.jobId, p_node: action.nodeId, p_to_category: action.toCategory, p_expected_revision: action.revision };
    const result = record(await rpc(db, action.action === "taxonomy_reorder" ? "admin_catalog_reorder_subcategories" : "admin_catalog_move_subcategory", args));
    if (whole(result.changed) > 0) onMutated();
    return { revision: whole(result.revision), changed: whole(result.changed), products: whole(result.products), overrides: whole(result.overrides),
      ...(typeof result.nodeId === "string" ? { nodeId: result.nodeId } : {}) };
  }
  if (action.action === "edit_product") {
    const location = action.patch.location;
    if (location) await assertLocation(db, actor, location.category, location.subcategory);
    await rpc(db, "admin_catalog_edit_product", {
      p_actor: actor,
      p_job: action.jobId,
      p_id: action.id,
      p_version: action.version,
      p_patch: rpcPatch(action.patch),
    });
    onMutated();
    return { product: await getProduct(db, actor, action.id) };
  }
  if (action.action === "bulk") return bulkStep(db, actor, action, onMutated);
  if (action.action === "undo") {
    const step = toStepResult(
      await rpc(db, "admin_catalog_undo_step", {
        p_actor: actor,
        p_job: action.undoJobId,
        p_new_job: action.jobId,
        p_after: action.after ?? null,
        p_limit: action.limit ?? CATALOG_LIMITS.stepSize,
      }),
    );
    if (step.changed > 0) onMutated();
    return step;
  }
  return saveTaxonomy(db, actor, action, onMutated);
}

async function bulkStep(db: SupabaseClient, actor: string, a: BulkAction, onMutated: () => void): Promise<StepResult> {
  if (needsDeleteConfirm(a) && a.confirm !== DELETE_CONFIRM_WORD) throw new CatalogFailure("CONFIRM_REQUIRED");
  if (a.filter?.devices && a.after == null) {
    await rpc(db, "admin_catalog_model_selection", { p_actor: actor, p_category: a.filter.category, p_subcategory: a.filter.subcategory, p_device_brand: a.filter.deviceBrand, p_devices: a.filter.devices });
  }
  if (a.filter?.device) {
    // Capability preflight for saved exact-model jobs. The SQL rollback also rejects model filters.
    const marker = await rpc(db, "catalog_public_revision", {});
    if (typeof marker !== "string" || !marker) throw new CatalogFailure("CATALOG_MIGRATION_PENDING");
  }
  const move = a.op === "move";
  // Odrediste se proverava samo na prvom koraku posla (after == null).
  if (move && a.after == null) await assertLocation(db, actor, a.category ?? "", a.subcategory ?? "");
  const step = toStepResult(
    await rpc(db, "admin_catalog_bulk_step", {
      p_actor: actor,
      p_job: a.jobId,
      p_op: a.op,
      p_ids: a.ids ?? null,
      p_filter: a.filter ? rpcFilter(a.filter) : null,
      p_after: a.after ?? null,
      p_limit: a.limit ?? CATALOG_LIMITS.stepSize,
      p_category: move ? (a.category ?? null) : null,
      p_subcategory: move ? (a.subcategory ?? null) : null,
    }),
  );
  if (step.changed > 0) onMutated();
  return step;
}

/** Rename reads only the requested authoritative node; no catalog-wide counts or layout scan. */
async function saveTaxonomyRename(
  db: SupabaseClient,
  actor: string,
  a: TaxonomyAction,
  onMutated: () => void,
): Promise<TaxonomySaveResult> {
  if (!a.slug || a.label === undefined || (a.kind === "group" && a.parent))
    throw new CatalogFailure("VALIDATION");
  const parent = a.kind === "group" ? "" : (a.parent ?? "");
  const snapshot = record(await rpc(db, "admin_catalog_taxonomy_rename_snapshot", {
    p_actor: actor, p_job: a.jobId, p_request: taxonomyRequest(a),
  }));
  const savedResult = (value: unknown): TaxonomySaveResult => {
    const saved = record(value);
    if (typeof saved.slug !== "string" || !saved.slug || typeof saved.revision !== "number" || !Number.isSafeInteger(saved.revision) || saved.revision < 1)
      throw new CatalogFailure("CATALOG_UNAVAILABLE");
    return { slug: saved.slug, revision: saved.revision };
  };
  // Replay precedes target/version validation: the original commit may have
  // moved or removed its target before a lost response is retried.
  if (snapshot.replay !== null && snapshot.replay !== undefined) {
    const replay = savedResult(snapshot.replay);
    onMutated();
    return replay;
  }
  if (typeof snapshot.revision !== "number" || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1)
    throw new CatalogFailure("CATALOG_UNAVAILABLE");
  if (snapshot.revision !== a.revision) throw new CatalogFailure("TAXONOMY_VERSION_CONFLICT");
  if (snapshot.target === null) throw new CatalogFailure("VALIDATION");
  const target = record(snapshot.target);
  if (target.kind !== a.kind || target.slug !== a.slug || typeof target.parent !== "string"
    || (a.kind === "group" ? target.parent !== "" : !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target.parent))
    || typeof target.builtin !== "boolean" || (target.labelEn !== null && typeof target.labelEn !== "string"))
    throw new CatalogFailure("CATALOG_UNAVAILABLE");
  const saved = await rpc(db, "admin_catalog_taxonomy_save_checked", {
    p_actor: actor,
    p_job: a.jobId,
    p_expected_revision: a.revision,
    p_request: taxonomyRequest(a),
    p_op: "rename",
    p_kind: a.kind,
    // Keep the original alias parent bound to the original request. The SQL
    // wrapper resolves it canonically under the existing mutation lock/CAS.
    p_parent: parent,
    p_slug: a.slug,
    p_label: a.label,
    p_label_en: a.labelEn !== undefined ? a.labelEn || null : target.labelEn,
    p_hidden: false,
    p_builtin: target.builtin,
  });
  onMutated();
  return savedResult(saved);
}

async function saveTaxonomy(
  db: SupabaseClient,
  actor: string,
  a: TaxonomyAction,
  onMutated: () => void,
): Promise<TaxonomySaveResult> {
  if (a.revision === undefined) throw new CatalogFailure("TAXONOMY_VERSION_CONFLICT");
  if (a.op === "rename") return saveTaxonomyRename(db, actor, a, onMutated);
  const { rows, counts, merged, layout, replay } = await loadTaxonomy(db, actor, a);
  if (replay) { onMutated(); return replay; }
  if (layout.revision !== a.revision) throw new CatalogFailure("TAXONOMY_VERSION_CONFLICT");
  const parent = a.kind === "group" ? "" : (a.parent ?? "");
  if (a.kind === "group" && a.parent) throw new CatalogFailure("VALIDATION");
  if (a.kind === "sub" && !BUILTIN_GROUPS.has(parent) && !rows.some((r) => r.kind === "group" && r.slug === parent)) {
    throw new CatalogFailure("VALIDATION");
  }
  let slug: string;
  let label: string;
  let labelEn: string | null;
  let builtin = false;
  if (a.op === "create") {
    if (a.label === undefined) throw new CatalogFailure("VALIDATION");
    slug = uniqueSlug(a.label, a.kind, takenSlugs(a.kind, rows, counts));
    label = a.label;
    labelEn = a.labelEn || null;
  } else {
    if (!a.slug) throw new CatalogFailure("VALIDATION");
    const node = findTaxonomyNode(buildTaxonomyView(rows, counts, merged, layout), a.kind, parent, a.slug);
    if (!node) throw new CatalogFailure("VALIDATION");
    const row = rows.find((r) => r.kind === a.kind && r.slug === node.slug && (a.kind === "group" || r.parent === parent));
    slug = node.slug;
    builtin = node.builtin;
    // K6: ugradjeni cvor se ne sakriva (proverava se pre SQL-a, koji prvo trazi naziv).
    if (a.op === "hide" && builtin) throw new CatalogFailure("TAXONOMY_BUILTIN_HIDE");
    if (a.op === "hide" && a.hidden === undefined) throw new CatalogFailure("VALIDATION");
    // Hide/remove preserve both saved labels; rename has its own bounded snapshot.
    label = row?.label_sr || node.label;
    labelEn = row?.label_en ?? null;
  }
  const saved = record(
    await rpc(db, "admin_catalog_taxonomy_save_checked", {
      p_actor: actor,
      p_job: a.jobId,
      p_expected_revision: a.revision,
      p_request: taxonomyRequest(a),
      p_op: a.op,
      p_kind: a.kind,
      p_parent: parent,
      p_slug: slug,
      p_label: label,
      p_label_en: labelEn,
      p_hidden: a.op === "hide" ? a.hidden === true : false,
      p_builtin: builtin,
    }),
  );
  onMutated();
  if (typeof saved.slug !== "string" || !saved.slug || typeof saved.revision !== "number" || !Number.isSafeInteger(saved.revision) || saved.revision < 1)
    throw new CatalogFailure("CATALOG_UNAVAILABLE");
  return { slug: saved.slug, revision: saved.revision };
}


/** Exact existing model groups only; never expose supplier costs or source payloads. */
export function toModelOptions(value: unknown): CatalogModelOptions {
  const row = record(value);
  if (!Array.isArray(row.brands) || !Array.isArray(row.models)) throw new CatalogFailure("CATALOG_UNAVAILABLE");
  const nonnegative = (value: unknown) => Math.max(0, whole(value));
  return {
    brands: row.brands.map((raw: unknown) => { const item = record(raw); return {
      value: text(item.value), count: nonnegative(item.count),
    }; }).filter((item) => item.value),
    models: row.models.map((raw: unknown) => { const item = record(raw); return {
      device: text(item.device), total: nonnegative(item.total), shared: nonnegative(item.shared),
    }; }).filter((item) => item.device && item.total > 0),
  };
}

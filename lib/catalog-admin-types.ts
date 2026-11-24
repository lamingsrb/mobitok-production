import type { CatalogModelSetScope } from "./catalog-model-selection";
import type { CatalogLayout, CatalogLayoutAction } from "./catalog-layout";
// Feedback 02.11.2026: ugovor alata "Katalog" u admin centru (DESIGN 9.1).
// Dele ga API (lib/server/catalog-admin.ts, app/api/admin/catalog/route.ts), panel
// (components/catalog-admin-panel.tsx) i prodavnica (lib/taxonomy-merge.ts). Samo tipovi i
// konstante, bez zavisnosti; menja se samo dogovorom svih strana.

export const CATALOG_ADMIN_API = "/api/admin/catalog";
export const CATALOG_JOB_STORAGE_KEY = "mobitok.catalog.job";

export const CATALOG_LIMITS = {
  pageSize: 50, // strana pretrage
  stepSize: 50, // podrazumevani korak masovne radnje
  maxStep: 100, // najveci korak i najvise ID-ova u jednom zahtevu
  minStep: 10, // korak se smanjuje do ovoga posle CATALOG_BUSY
  maxJob: 10000, // najvise proizvoda u jednom poslu
  confirmOver: 50, // brisanje vise od ovoga (ili po filteru) trazi "OBRIŠI"
  warnBytes: 440_000_000, // rezervni prag za stariju verziju admin_catalog_ping
  name: 200,
  seoTitle: 100,
  description: 4000,
  label: 60,
} as const;

export const DELETE_CONFIRM_WORD = "OBRIŠI";

/** U prodavnici | nisu u prodavnici (dobavljac, lager) | obrisani (Kanta) | svi. */
export type CatalogStatus = "active" | "hidden" | "deleted" | "all";

export interface CatalogFilter {
  q?: string;
  category?: string;
  subcategory?: string;
  supplier?: string;
  deviceBrand?: string; // exact brand + device require category and subcategory
  device?: string;
  devices?: string[]; // Exact model set; mutually exclusive with device.
  excludeDeleted?: boolean; // model-wide current selection excludes the existing trash
  status?: CatalogStatus; // podrazumevano "active"
  edited?: boolean; // samo rucno izmenjeni
}

export type BulkOp = "move" | "delete" | "restore" | "revert";
export type TaxonomyOp = "create" | "rename" | "hide" | "remove";
export type TaxonomyKind = "group" | "sub";

/** Kljuc koji nije poslat se ne menja; null vraca polje na original dobavljaca. */
export interface ProductPatch {
  name?: string | null;
  seoTitle?: string | null;
  description?: string | null;
  location?: { category: string; subcategory: string } | null; // subcategory "" = bez podgrupe
}

/** Telo POST zahteva kako ga salje panel (z.input sheme iz lib/server/catalog-admin.ts). */
export type CatalogAction =
  | CatalogLayoutAction
  | ({ action: "preview_models" } & CatalogModelSetScope)
  | { action: "edit_product"; jobId: string; id: string; version: number; patch: ProductPatch }
  | {
      action: "bulk";
      jobId: string;
      op: BulkOp;
      ids?: string[]; // tacno jedno od ids (<= maxStep) i filter
      filter?: CatalogFilter;
      after?: string | null; // kursor po id; null = prvi korak posla
      limit?: number;
      category?: string; // obavezno za move
      subcategory?: string; // obavezno za move ("" = bez podgrupe)
      confirm?: typeof DELETE_CONFIRM_WORD;
    }
  | { action: "undo"; jobId: string; undoJobId: string; after?: string | null; limit?: number }
  | {
      action: "taxonomy";
      jobId: string;
      op: TaxonomyOp;
      revision?: number; // Older clients are recognized but must reload before a checked write.
      kind: TaxonomyKind;
      parent?: string; // "" za grupu, slug grupe za podgrupu
      slug?: string; // obavezno osim za create (server ga pravi iz naziva)
      label?: string; // obavezno za create i rename
      labelEn?: string;
      hidden?: boolean; // za op "hide": true sakriva, false prikazuje
    };

export type CatalogErrorCode =
  | "CATALOG_MIGRATION_PENDING"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION"
  | "REQUEST_TOO_LARGE"
  | "CONFIRM_REQUIRED"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "PRODUCT_DELETED"
  | "BULK_TOO_LARGE"
  | "BULK_JOB_EXPIRED"
  | "CATALOG_CAPACITY"
  | "CATALOG_BUSY"
  | "INVALID_DESTINATION"
  | "TAXONOMY_VERSION_CONFLICT"
  | "TAXONOMY_EXISTS"
  | "TAXONOMY_NOT_EMPTY"
  | "TAXONOMY_BUILTIN_HIDE"
  | "NOT_UNDOABLE"
  | "CATALOG_UNAVAILABLE"
  | "PUBLICATION_RUNNING"
  | "CATALOG_LAST_ITEMS"
  | "RATE_LIMITED"
  | "INTERNAL";

export const CATALOG_ERROR_STATUS: Record<CatalogErrorCode, number> = {
  CATALOG_MIGRATION_PENDING: 503,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  VALIDATION: 400,
  REQUEST_TOO_LARGE: 413,
  CONFIRM_REQUIRED: 400,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  PRODUCT_DELETED: 409,
  BULK_TOO_LARGE: 413,
  BULK_JOB_EXPIRED: 409,
  CATALOG_CAPACITY: 507,
  CATALOG_BUSY: 503,
  INVALID_DESTINATION: 400,
  TAXONOMY_VERSION_CONFLICT: 409,
  TAXONOMY_EXISTS: 409,
  TAXONOMY_NOT_EMPTY: 409,
  TAXONOMY_BUILTIN_HIDE: 409,
  NOT_UNDOABLE: 409,
  CATALOG_UNAVAILABLE: 503,
  PUBLICATION_RUNNING: 409,
  CATALOG_LAST_ITEMS: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export const CATALOG_ERROR_MESSAGES: Record<CatalogErrorCode, string> = {
  CATALOG_MIGRATION_PENDING: "Alati za katalog još nisu uključeni.",
  UNAUTHORIZED: "Prijavite se ponovo.",
  FORBIDDEN: "Nemate dozvolu.",
  VALIDATION: "Neispravni podaci.",
  REQUEST_TOO_LARGE: "Zahtev je prevelik.",
  CONFIRM_REQUIRED: "Upišite OBRIŠI da potvrdite.",
  NOT_FOUND: "Proizvod nije pronađen.",
  VERSION_CONFLICT: "Proizvod je u međuvremenu izmenjen. Osvežite prikaz.",
  PRODUCT_DELETED: "Proizvod je obrisan. Prvo ga vratite.",
  BULK_TOO_LARGE: "Izabrano je previše proizvoda (najviše 10.000).",
  BULK_JOB_EXPIRED: "Sačuvani izbor je istekao. Odbacite stari posao i ponovo izaberite proizvode.",
  CATALOG_CAPACITY: "Zaštita baze je zaustavila izmenu. Proverite slobodan prostor u bazi pre ponovnog pokušaja.",
  CATALOG_BUSY: "Druga izmena je pri kraju. Vaš posao je sačuvan; korak će se ponoviti.",
  INVALID_DESTINATION: "Odredište ne postoji ili je sakriveno.",
  TAXONOMY_VERSION_CONFLICT: "Grupe ili podgrupe su u međuvremenu izmenjene. Osvežite prikaz i ponovite izmenu.",
  TAXONOMY_EXISTS: "Grupa sa tim imenom već postoji.",
  TAXONOMY_NOT_EMPTY: "U grupi ima proizvoda. Prvo ih premestite.",
  TAXONOMY_BUILTIN_HIDE: "Ugrađene grupe se ne mogu sakriti, samo preimenovati.",
  NOT_UNDOABLE: "Ova radnja se ne može poništiti.",
  CATALOG_UNAVAILABLE: "Servis trenutno nije dostupan. Pokušajte ponovo za minut.",
  PUBLICATION_RUNNING: "Katalog se upravo osvežava. Ova radnja je sačuvana; nastavite je po završetku osvežavanja.",
  CATALOG_LAST_ITEMS: "Ne mogu se obrisati svi artikli dobavljača. Dobavljača isključite u „Nabavka i dobavljači“.",
  RATE_LIMITED: "Previše zahteva. Sačekajte i nastavite posao.",
  INTERNAL: "Došlo je do greške. Pokušajte ponovo.",
};

/** Telo svake greske API-ja. retryAfter (sekunde) uz limit zahteva ili kratak katalog mutex. */
export interface CatalogErrorBody {
  error: string;
  code: CatalogErrorCode;
  retryAfter?: number;
}

/** GET ?view=status; bez migracije 200 sa ready=false. Auth, limit i ostale greske su standardne greske (CatalogErrorBody). */
export interface CatalogStatusView {
  ready: boolean;
  dbBytes?: number;
  capacity?: CatalogCapacity;
}

export interface CatalogCapacity {
  profile: "free" | "pro";
  ceilingBytes: number;
  warnBytes: number;
  writeBytes: number;
  bulkBytes: number;
  syncBytes: number;
  stageBytes: number;
  publicationBytes: number;
}

/** Red liste (GET ?view=search). Cene se ne prikazuju. */
export interface AdminProductRow {
  id: string;
  name: string;
  category: string;
  subcategory: string; // "" = bez podgrupe
  supplier: string; // "" za artikle bez dobavljaca
  supplierSku: string | null;
  brand: string;
  image: string;
  slug: string;
  active: boolean;
  deleted: boolean;
  edited: boolean;
}

export interface AdminSearchResult {
  items: AdminProductRow[];
  total: number; // najvise maxJob
  totalCapped: boolean; // pogodaka ima vise od maxJob
  offset: number;
}

/** Snimak originala dobavljaca, samo za polja koja su menjana. */
export interface ProductOriginal {
  name?: string;
  description?: string;
  category?: string;
  subcategory?: string;
  active?: boolean;
}

/** GET ?view=product&id */
export interface AdminProductDetail extends AdminProductRow {
  description: string;
  version: number; // 0 = nikad menjan; salje se nazad uz edit_product
  seoTitle: string | null;
  original: ProductOriginal;
  updatedAt: string; // ISO
  overridden: { name: boolean; seoTitle: boolean; description: boolean; location: boolean };
}

/** POST edit_product: proizvod posle izmene (server ga ponovo cita). */
export interface EditProductResult {
  product: AdminProductDetail;
}

/** POST bulk i undo: jedan korak; panel ponavlja sa after=nextAfter dok done nije true. */
export interface StepResult {
  selectionBasis?: "current_remaining" | null; // legacy remainder, never a reconstructed original snapshot
  processed: number; // obradjenih ID-ova u koraku
  changed: number; // stvarno promenjenih redova u prodavnici
  nextAfter: string | null;
  done: boolean;
}

export type HistoryStatus = "none" | "undone" | "partial";

/** GET ?view=history: poslednjih 30 poslova, najnoviji prvi. */
export interface HistoryJob {
  jobId: string;
  action: string; // move | delete | restore | revert | edit_product | taxonomy_create | taxonomy_rename | ...
  affected: number;
  at: string; // ISO
  target: string; // "kategorija/podgrupa" za move, "kind:parent/slug" za taksonomiju
  details: Record<string, unknown>;
  restored: number; // vraceno ponistavanjem
  status: HistoryStatus; // none bez ponistavanja; undone kad restored >= affected; inace partial
  undoable: boolean; // move ili delete, a status nije undone
}

export interface HistoryView {
  jobs: HistoryJob[];
}

/** Red tabele catalog_taxonomy kako ga vraca catalogMeta (CatalogMeta.taxonomy). */
export interface TaxonomyRow {
  kind: TaxonomyKind;
  parent: string;
  slug: string;
  label_sr: string;
  label_en: string | null;
  hidden: boolean;
  sort_order: number;
}

/** Cvor u pogledu Grupe (GET ?view=taxonomy). */
export interface TaxonomyNode {
  kind: TaxonomyKind;
  parent: string;
  slug: string;
  label: string; // trenutni naziv
  labelEn: string | null;
  defaultLabel: string | null; // naziv iz koda; null za korisnicke
  builtin: boolean;
  renamed: boolean; // ugradjeni sa redom u tabeli
  hidden: boolean;
  count: number; // aktivni proizvodi; za grupu zbir cele grupe
  children: TaxonomyNode[]; // podgrupe; [] za podgrupu
}

export interface TaxonomyView {
  groups: TaxonomyNode[];
  layout?: CatalogLayout;
}

export interface TaxonomySaveResult {
  slug: string;
  revision?: number;
}

/** Grupa prodavnice posle spajanja koda i tabele (mergeTaxonomy). */
export interface TaxonomyGroup {
  id: string;
  name: string;
  short?: string;
  description: string;
  icon: string;
  builtin: boolean;
}

/**
 * Taksonomija prodavnice: ugradjene grupe redom iz lib/catalog.ts, pa korisnicke (sort_order, naziv).
 * Nazivi su na srpskom kao i do sada (prodavnica ih provlaci kroz t()); za "en" se koristi label_en,
 * a ugradjeni cvor bez label_en zadrzava podrazumevani naziv koji t() prevodi.
 */
export interface Taxonomy {
  groups: readonly TaxonomyGroup[]; // bez sakrivenih korisnickih
  categoryName(id: string): string;
  subcategoryName(category: string, key: string): string;
  /** Kao menuSubcategories iz lib/catalog-taxonomy.ts; korisnicke podgrupe samo kad imaju proizvoda. */
  menuSubcategories(category: string, available: readonly string[]): string[];
  /** Sve podgrupe grupe (ugradjene po redu, pa korisnicke), bez sakrivenih. */
  subcategories(category: string): string[];
}

/** Nedovrsen masovni posao u localStorage (CATALOG_JOB_STORAGE_KEY). */
export interface JobState {
  reviewRequired?: boolean; // expired selection requires explicit discard/reselect
  jobId: string;
  kind: "bulk" | "model_bulk" | "model_set_bulk" | "undo"; // model_bulk protects exact-scope saved jobs from older clients
  op: BulkOp | "undo";
  label: string; // npr. "Premeštanje 1.284 proizvoda"
  ids?: string[]; // izbor po ID-u; idsDone pokazuje koliko je poslato
  idsDone?: number;
  filter?: CatalogFilter;
  category?: string;
  subcategory?: string;
  undoJobId?: string;
  after: string | null;
  limit: number;
  processed: number;
  changed: number;
  total: number;
  startedAt: string; // ISO
}

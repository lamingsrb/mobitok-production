"use client";

// Admin 03.11: alat "Katalog" u admin centru (pretraga, masovne izmene u koracima, grupe, istorija).
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArchiveRestore,
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CirclePause,
  ExternalLink,
  Eye,
  EyeOff,
  FolderPlus,
  History as HistoryIcon,
  Info,
  Library,
  ListTree,
  LoaderCircle,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import {
  CATALOG_ADMIN_API,
  CATALOG_JOB_STORAGE_KEY,
  CATALOG_LIMITS,
  DELETE_CONFIRM_WORD,
  type AdminProductDetail,
  type AdminProductRow,
  type AdminSearchResult,
  type BulkOp,
  type CatalogAction,
  type CatalogFilter,
  type CatalogStatus,
  type CatalogStatusView,
  type EditProductResult,
  type HistoryJob,
  type HistoryView,
  type JobState,
  type ProductPatch,
  type StepResult,
  type TaxonomyKind,
  type TaxonomyNode,
  type TaxonomySaveResult,
  type TaxonomyView,
} from "@/lib/catalog-admin-types";
import { parseCatalogLayout, type CatalogLayout, type CatalogLayoutAction, type CatalogLayoutResult } from "@/lib/catalog-layout";
import { withCatalogJobLock } from "@/lib/catalog-job-lock";
import { notifyCatalogChanged } from "@/lib/catalog-events";
import { brandLabel, modelLabel } from "@/lib/device-tiles";
import { CATALOG_MODEL_LIMITS, parseModelSelectionPreview, type CatalogModelOptions, type CatalogModelScope, type CatalogModelSetScope, type CatalogModelSelectionPreview } from "@/lib/catalog-model-selection";
import "./catalog-admin-panel.css";

/** Admin 03.11: greska helpera api iz account-panel (HTTP status, kod i retryAfter iz tela odgovora). */
export class ApiFailure extends Error {
  status: number;
  code?: string;
  retryAfter?: number;

  constructor(message: string, status: number, code?: string, retryAfter?: number) {
    super(message);
    this.name = "ApiFailure";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Call = <T>(request: string | CatalogAction) => Promise<T>;
type Phase = "loading" | "ready" | "pending" | "error";
type View = "products" | "groups" | "models" | "history";
type Tone = "error" | "warning" | "success" | "info";
type Picked = { id: string; name: string };
type Selection = { mode: "ids"; items: Picked[] } | { mode: "filter"; filter: CatalogFilter; total: number };
type JobTarget =
  | { mode: "ids"; ids: string[]; samples: string[] }
  | { mode: "filter"; filter: CatalogFilter; total: number; samples: string[]; modelScope?: CatalogModelScope; modelSetScope?: CatalogModelSetScope; shared?: number };
type Destination = { category: string; subcategory: string };
type DialogSpec =
  | { kind: BulkOp; target: JobTarget }
  | { kind: "undo"; undoJobId: string; label: string; total: number };
type RunView = {
  phase: "running" | "paused" | "failed" | "done";
  job: JobState;
  message?: string;
  tone?: "error" | "warning";
};
type Notice = { tone: "success" | "info" | "error"; text: string };
type Labels = {
  group: (slug: string) => string;
  sub: (group: string, slug: string) => string;
  path: (group: string, sub: string) => string;
};
type OpenBulk = (op: BulkOp, target: JobTarget) => void;

const GROUPS_REFRESH_AGE_MS = 60_000;
const PENDING_TEXT =
  "Alati za katalog još nisu uključeni. Potrebna je jednokratna priprema baze; obratite se osobi koja održava sajt.";
const formatDatabaseSize = (bytes: number) =>
  (bytes / 1_000_000).toLocaleString("sr-Latn-RS", { maximumFractionDigits: 1 }) + " MB";
const CONFLICT_TEXT = "Ovaj proizvod je u međuvremenu izmenjen. Osvežite prikaz pa ponovite izmenu.";
const MOVE_NOTE = "Izmena je odmah vidljiva u prodavnici i možete je poništiti.";
const BRAND_NOTE = "Marka i modeli uređaja se dopunjuju pri sledećoj automatskoj objavi.";
const SLUG_HELP = "Adresa linka se ne menja kada preimenujete, pa postojeći linkovi nastavljaju da rade.";
const BUILTIN_HELP = "Ugrađene grupe se ne mogu sakriti, samo preimenovati.";
const NAME_HELP = "Ovako se proizvod zove u prodavnici, u pretrazi i u korpi.";
const SEO_HELP = "Tekst u kartici pregledača i u Google rezultatima. Ako ostane prazno, koristi se naziv.";
const OVERRIDE_NOTE = "Dok je naziv ili opis izmenjen ručno, ispravke dobavljača se za to polje ne primaju.";
const SEARCH_HELP = "Na primer: maska samsung a54, ili šifra 055833";
const LOCK_TEXT = "Prvo završite ili odbacite nedovršen posao; do tada su masovne izmene isključene.";
const GENERIC_ERROR = "Došlo je do greške. Pokušajte ponovo.";
const CAP_TEXT = "Za masovnu izmenu može se izabrati najviše 10.000 proizvoda; suzite pretragu.";
const OVER_CAP_TEXT = "Više od 10.000 proizvoda, suzite pretragu";
const OFFLINE_JOB_TEXT = "Veza trenutno nije dostupna. Posao je sačuvan; nastavite kada se veza vrati.";
const BUSY_JOB_TEXT = "Druga izmena je pri kraju. Posao je sačuvan; nastavite za nekoliko sekundi.";
const STOPPED_TEXT = "Posao je zaustavljen. Nastavite ga kada želite.";
const EXPIRED_JOB_TEXT = "Sačuvani izbor je istekao. Odbacite stari posao i ponovo izaberite proizvode.";
const LEGACY_SELECTION_NOTE = "Nastavak starog posla obuhvata preostale proizvode prema sadašnjem katalogu.";
// Admin 03.11 (E3): posao je odbacen ili zamenjen u drugom prozoru dok je ovaj radio.
const LOST_JOB_TEXT =
  "Posao je u međuvremenu odbačen ili zamenjen u drugom prozoru, pa je ovde zaustavljen. Izmene koje su već urađene ostaju.";
const DISCARD_BUSY_TEXT = "Posao još radi. Prvo ga zaustavite (Prekini), pa ga odbacite.";
// Admin 03.11 (K8): granica od 10.000 po poslu je dostignuta pre kraja izbora.
const LIMIT_NOTE =
  "Dostignuta je granica od 10.000 proizvoda po poslu; preostali proizvodi nisu obrađeni. Pokrenite nov posao za njih.";

// Admin 03.11: dobavljaci su staticki (kao supplierMarks u procurement-panel, uz btm).
const SUPPLIERS = [
  { id: "btm", name: "BTM", mark: "BTM" },
  { id: "trig", name: "3G", mark: "3G" },
  { id: "msmobile", name: "MS Mobile", mark: "MS" },
  { id: "dv", name: "Digital Vision", mark: "DV" },
] as const;

const STATUS_OPTIONS: { value: CatalogStatus; label: string }[] = [
  { value: "active", label: "U prodavnici" },
  { value: "hidden", label: "Nisu u prodavnici" },
  { value: "deleted", label: "Obrisani" },
  { value: "all", label: "Svi" },
];

const VIEWS = [
  { id: "products", label: "Proizvodi", Icon: Package },
  { id: "groups", label: "Grupe", Icon: ListTree },
  { id: "models", label: "Modeli", Icon: Library },
  { id: "history", label: "Istorija", Icon: HistoryIcon },
] as const;

const DIALOG_TITLES: Record<BulkOp | "undo", string> = {
  move: "Premeštanje proizvoda",
  delete: "Brisanje proizvoda",
  restore: "Vraćanje u prodavnicu",
  revert: "Vraćanje originalnih podataka",
  undo: "Poništavanje izmene",
};

// Admin 03.11: poruke helpera api su u ti obliku; alat Katalog ih prikazuje u vi obliku.
const HELPER_TEXTS: Record<string, string> = {
  "Prijavi se da nastaviš.": "Prijavite se da nastavite.",
  "Veza trenutno nije dostupna. Proveri internet i pokušaj ponovo.":
    "Veza trenutno nije dostupna. Proverite internet i pokušajte ponovo.",
  "Podaci trenutno nisu dostupni. Pokušaj ponovo.": "Podaci trenutno nisu dostupni. Pokušajte ponovo.",
};

const numberFormat = new Intl.NumberFormat("sr-RS");

function formatCount(value: number) {
  return numberFormat.format(value);
}

function isSingular(value: number) {
  return value % 10 === 1 && value % 100 !== 11;
}

function productCount(value: number) {
  return `${formatCount(value)} ${isSingular(value) ? "proizvod" : "proizvoda"}`;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (date.toDateString() === new Date().toDateString()) return `Danas ${time}`;
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}. ${time}`;
}

function cut(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function supplierName(id: string) {
  if (!id) return "Bez dobavljača";
  const found = SUPPLIERS.find((supplier) => supplier.id === id);
  return found ? found.name : id.toUpperCase();
}

function supplierMark(id: string) {
  if (!id) return "";
  const found = SUPPLIERS.find((supplier) => supplier.id === id);
  return found ? found.mark : id.slice(0, 3).toUpperCase();
}

function messageOf(error: unknown) {
  if (error instanceof ApiFailure) return HELPER_TEXTS[error.message] ?? (error.message || GENERIC_ERROR);
  return GENERIC_ERROR;
}

function codeOf(error: unknown) {
  return error instanceof ApiFailure ? (error.code ?? "") : "";
}

function statusOf(error: unknown) {
  return error instanceof ApiFailure ? error.status : -1;
}

function rateText(error: unknown) {
  const seconds = error instanceof ApiFailure ? error.retryAfter : undefined;
  if (typeof seconds === "number" && seconds > 0) {
    return `Previše zahteva. Posao je sačuvan; nastavite ga za ${formatCount(Math.ceil(seconds / 60))} min.`;
  }
  return "Previše zahteva. Posao je sačuvan; nastavite ga kasnije.";
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function newJobId(): string {
  const cryptoApi = typeof crypto !== "undefined" ? crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  // Admin 03.11: rezerva za stare pregledace; isti v4 oblik koji server proverava.
  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") cryptoApi.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_VALUES: readonly string[] = ["active", "hidden", "deleted", "all"];
const BULK_OPS: readonly string[] = ["move", "delete", "restore", "revert"];

function cleanFilter(value: unknown): CatalogFilter | undefined {
  if (!isRecord(value)) return undefined;
  const filter: CatalogFilter = {};
  const { q, category, subcategory, supplier, status, edited, deviceBrand, device, devices, excludeDeleted } = value;
  if (typeof q === "string" && q.trim() && q.length <= 100) filter.q = q.trim();
  if (typeof category === "string" && category && category.length <= 40) {
    filter.category = category;
    if (typeof subcategory === "string" && subcategory && subcategory.length <= 60) filter.subcategory = subcategory;
  }
  if (typeof supplier === "string" && supplier && supplier.length <= 20) filter.supplier = supplier;
  if (typeof status === "string" && STATUS_VALUES.includes(status)) filter.status = status as CatalogStatus;
  if (edited === true) filter.edited = true;
  // Unknown/incomplete model scope must never resume as a category-only deletion.
  if (["deviceBrand", "device", "devices", "excludeDeleted"].some((key) => key in value)) {
    if (typeof deviceBrand !== "string" || !deviceBrand.trim() || deviceBrand !== deviceBrand.trim() || deviceBrand.length > 60 ||
        /[\u0000-\u001f]/.test(deviceBrand) || !filter.category || !filter.subcategory ||
        status !== "all" || excludeDeleted !== true || filter.q || filter.supplier || filter.edited ||
        (("device" in value) === ("devices" in value))) return undefined;
    if ("devices" in value) {
      if (!Array.isArray(devices) || !devices.length || devices.length > CATALOG_MODEL_LIMITS.models ||
          devices.some((item) => typeof item !== "string" || !item || item !== item.trim() || item.length > CATALOG_MODEL_LIMITS.modelLength || /[\u0000-\u001f]/.test(item)) ||
          new Set(devices).size !== devices.length) return undefined;
      filter.devices = [...devices];
    } else {
      if (typeof device !== "string" || !device.trim() || device.length > 120 || /[\u0000-\u001f]/.test(device)) return undefined;
      filter.device = device;
    }
    filter.deviceBrand = deviceBrand;filter.excludeDeleted = true;
  }
  return filter;
}

/** Admin 03.11: posao iz localStorage se proverava pre nastavka (rucno menjan ili star zapis). */
function parseJob(value: unknown): JobState | null {
  if (!isRecord(value)) return null;
  const { jobId, kind, op, label, ids, idsDone, filter, category, subcategory, undoJobId, after, limit } = value;
  if (typeof jobId !== "string" || !UUID_RE.test(jobId)) return null;
  const base = {
    jobId,
    ...(value.reviewRequired === true ? { reviewRequired: true } : {}),
    label: typeof label === "string" && label ? label.slice(0, 200) : "Masovna izmena",
    after: typeof after === "string" && after.length <= 95 ? after : null,
    limit: Math.min(CATALOG_LIMITS.maxStep, Math.max(CATALOG_LIMITS.minStep, toCount(limit) || CATALOG_LIMITS.stepSize)),
    processed: toCount(value.processed),
    changed: toCount(value.changed),
    total: toCount(value.total),
    startedAt: typeof value.startedAt === "string" ? value.startedAt : new Date().toISOString(),
  };
  if (kind === "undo") {
    if (op !== "undo" || typeof undoJobId !== "string" || !UUID_RE.test(undoJobId) || undoJobId === jobId) return null;
    return { ...base, kind: "undo", op: "undo", undoJobId };
  }
  const singleModelJob = kind === "model_bulk";
  const modelSetJob = kind === "model_set_bulk";
  const modelJob = singleModelJob || modelSetJob;
  if ((kind !== "bulk" && !modelJob) || typeof op !== "string" || !BULK_OPS.includes(op)) return null;
  const bulkOp = op as BulkOp;
  if (modelJob && bulkOp !== "delete") return null;
  const job: JobState = { ...base, kind: modelSetJob ? "model_set_bulk" : singleModelJob ? "model_bulk" : "bulk", op: bulkOp };
  if (Array.isArray(ids)) {
    if (modelJob) return null;
    const list = ids
      .filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 95)
      .slice(0, CATALOG_LIMITS.maxJob);
    if (!list.length) return null;
    job.ids = list;
    job.idsDone = Math.min(list.length, toCount(idsDone));
    job.after = null;
  } else {
    const hasModelFilter = isRecord(filter) && ["deviceBrand", "device", "devices", "excludeDeleted"].some((key) => key in filter);
    if (hasModelFilter !== modelJob) return null;
    const clean = cleanFilter(filter);
    if (!clean || (modelJob && (!clean.deviceBrand || clean.excludeDeleted !== true)) ||
        (singleModelJob && (!clean.device || clean.devices !== undefined)) ||
        (modelSetJob && (!clean.devices || clean.device !== undefined))) return null;
    job.filter = clean;
  }
  if (bulkOp === "move") {
    if (typeof category !== "string" || !category || category.length > 40) return null;
    if (typeof subcategory !== "string" || subcategory.length > 60) return null;
    job.category = category;
    job.subcategory = subcategory;
  }
  return job;
}

// Admin 03.11: localStorage moze biti nedostupan (privatni rezim, pun disk); svaki pristup je u try/catch.
function writeStoredJob(job: JobState): boolean {
  try {
    window.localStorage.setItem(CATALOG_JOB_STORAGE_KEY, JSON.stringify(job));
    return true;
  } catch {
    // Admin 03.11: posao tece i bez cuvanja; nastavak posle osvezavanja tada nije moguc.
    return false;
  }
}

function clearStoredJob() {
  try {
    window.localStorage.removeItem(CATALOG_JOB_STORAGE_KEY);
  } catch {
    // Admin 03.11: nema sta da se obrise kada skladiste nije dostupno.
  }
}

const WIDE_QUERY = "(min-width: 900px)";

function subscribeWide(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function readWide() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(WIDE_QUERY).matches;
}

function useWide() {
  return useSyncExternalStore(subscribeWide, readWide, () => false);
}

type FilterDraft = {
  q: string;
  category: string;
  subcategory: string;
  supplier: string;
  status: CatalogStatus;
  edited: boolean;
};

const EMPTY_DRAFT: FilterDraft = { q: "", category: "", subcategory: "", supplier: "", status: "active", edited: false };

function toFilter(draft: FilterDraft): CatalogFilter {
  const filter: CatalogFilter = { status: draft.status };
  const q = draft.q.trim();
  if (q) filter.q = q;
  if (draft.category) {
    filter.category = draft.category;
    if (draft.subcategory) filter.subcategory = draft.subcategory;
  }
  if (draft.supplier) filter.supplier = draft.supplier;
  if (draft.edited) filter.edited = true;
  return filter;
}

function searchQuery(filter: CatalogFilter, offset: number) {
  const params = new URLSearchParams({ view: "search" });
  if (filter.q) params.set("q", filter.q);
  if (filter.category) params.set("category", filter.category);
  if (filter.subcategory) params.set("subcategory", filter.subcategory);
  if (filter.supplier) params.set("supplier", filter.supplier);
  params.set("status", filter.status ?? "active");
  if (filter.edited) params.set("edited", "1");
  params.set("offset", String(offset));
  return params.toString();
}

function normalizeResult(value: unknown, offset: number): AdminSearchResult {
  if (!isRecord(value) || !Array.isArray(value.items)) return { items: [], total: 0, totalCapped: false, offset };
  return {
    items: value.items as AdminProductRow[],
    total: toCount(value.total),
    totalCapped: value.totalCapped === true,
    offset: toCount(value.offset) || offset,
  };
}

function normalizeGroups(value: unknown): TaxonomyNode[] {
  if (!isRecord(value) || !Array.isArray(value.groups)) return [];
  return (value.groups as TaxonomyNode[]).map((group) => ({
    ...group,
    children: Array.isArray(group.children) ? group.children : [],
  }));
}

function makeLabels(groups: TaxonomyNode[]): Labels {
  const bySlug = new Map<string, TaxonomyNode>();
  for (const group of groups) bySlug.set(group.slug, group);
  const group = (slug: string) => bySlug.get(slug)?.label ?? slug;
  const sub = (groupSlug: string, slug: string) => {
    if (!slug) return "Bez podgrupe";
    return (bySlug.get(groupSlug)?.children ?? []).find((child) => child.slug === slug)?.label ?? slug;
  };
  return { group, sub, path: (groupSlug, slug) => `${group(groupSlug)} › ${sub(groupSlug, slug)}` };
}

function targetTotal(target: JobTarget) {
  return target.mode === "ids" ? target.ids.length : target.total;
}

function actionLabel(action: string) {
  switch (action) {
    case "move":
      return "Premeštanje";
    case "delete":
      return "Brisanje";
    case "restore":
      return "Vraćanje u prodavnicu";
    case "revert":
      return "Vraćanje originalnih podataka";
    case "edit_product":
      return "Izmena proizvoda";
    case "taxonomy_reorder":
      return "Redosled podgrupa";
    case "taxonomy_move_subcategory":
      return "Premeštanje cele podgrupe";
    default:
      return action.startsWith("taxonomy") ? "Izmena grupa" : "Izmena kataloga";
  }
}

/** Admin 03.11: naziv posla, npr. "Premestanje 1.284 proizvoda" (genitiv, uvek "proizvoda"). */
function opLabel(action: string, total: number) {
  const count = `${formatCount(total)} proizvoda`;
  switch (action) {
    case "move":
      return `Premeštanje ${count}`;
    case "delete":
      return `Brisanje ${count}`;
    case "restore":
      return `Vraćanje ${count} u prodavnicu`;
    case "revert":
      return `Vraćanje originalnih podataka za ${count}`;
    default:
      return `${actionLabel(action)}: ${productCount(total)}`;
  }
}

function jobLabel(op: BulkOp, total: number) {
  return opLabel(op, total);
}

/** Admin 03.11: napredak; za izbor po ID-u broje se poslati ID-ovi, za filter obradjeni redovi. */
function jobProgress(job: JobState) {
  if (job.ids) return { done: Math.min(job.idsDone ?? 0, job.ids.length), total: job.ids.length };
  return { done: job.processed, total: Math.max(job.total, job.processed) };
}

function progressText(job: JobState) {
  const { done, total } = jobProgress(job);
  const counts = `${formatCount(done)} od ${formatCount(total)} proizvoda`;
  switch (job.op) {
    case "move":
      return `Premešteno ${counts}`;
    case "delete":
      return `Obrisano ${counts}`;
    case "restore":
      return `Vraćeno u prodavnicu ${counts}`;
    case "revert":
      return `Vraćeni originalni podaci za ${counts}`;
    default:
      return `Poništeno ${counts}`;
  }
}

function doneLines(job: JobState): string[] {
  const changed = job.changed;
  const one = isSingular(changed);
  const count = productCount(changed);
  const lines: string[] = [];
  if (changed === 0) lines.push("Nijedan proizvod nije promenjen.");
  else if (job.op === "move") lines.push(`${one ? "Premešten je" : "Premešteno je"} ${count}.`);
  else if (job.op === "delete") {
    lines.push(
      one
        ? `Obrisan je ${count}. Ostaje u Kanti i možete ga vratiti.`
        : `Obrisano je ${count}. Ostaju u Kanti i možete ih vratiti.`,
    );
  } else if (job.op === "restore") lines.push(`Iz Kante ${one ? "je vraćen" : "je vraćeno"} ${count}.`);
  else if (job.op === "revert") lines.push(`Originalni podaci su vraćeni za ${count}.`);
  else lines.push(`Izmena je poništena za ${count}.`);
  const skipped = job.processed - changed;
  if (skipped > 0) {
    lines.push(`${job.op === "undo" ? "Nije trebalo vraćati" : "Nije trebalo menjati"}: ${productCount(skipped)}.`);
  }
  if (job.op === "move" && changed > 0) lines.push(BRAND_NOTE);
  if ((job.op === "restore" || job.op === "undo") && changed > 0)
    lines.push("Vraćeni artikli dobavljača ponovo se proveravaju pri sledećem automatskom osvežavanju kataloga; u prodavnici će se pojaviti ako su i dalje dostupni i dozvoljeni za prodaju.");
  return lines;
}

/** Admin 03.11: isto pravilo kao server (needsDeleteConfirm): brisanje po filteru ili vise od confirmOver ID-ova. */
function needsConfirm(job: JobState) {
  return job.op === "delete" && (!job.ids || job.ids.length > CATALOG_LIMITS.confirmOver);
}

function isConfirmWord(value: string) {
  const word = value.trim().toUpperCase();
  return word === DELETE_CONFIRM_WORD || word === "OBRISI";
}

function stepBody(job: JobState, packet: string[] | null): CatalogAction {
  if (job.kind === "undo") {
    return { action: "undo", jobId: job.jobId, undoJobId: job.undoJobId ?? "", after: job.after, limit: job.limit };
  }
  const body: Extract<CatalogAction, { action: "bulk" }> = { action: "bulk", jobId: job.jobId, op: job.op as BulkOp };
  if (packet) {
    body.ids = packet;
    body.after = null;
    body.limit = packet.length;
  } else {
    body.filter = job.filter ?? { status: "active" };
    body.after = job.after;
    body.limit = job.limit;
  }
  if (job.op === "move") {
    body.category = job.category ?? "";
    body.subcategory = job.subcategory ?? "";
  }
  if (needsConfirm(job)) body.confirm = DELETE_CONFIRM_WORD;
  return body;
}

function unwrapProduct(value: unknown): AdminProductDetail | null {
  if (!isRecord(value)) return null;
  const inner = value.product;
  if (isRecord(inner) && typeof inner.id === "string") return inner as unknown as AdminProductDetail;
  return typeof value.id === "string" ? (value as unknown as AdminProductDetail) : null;
}

function rowOf(product: AdminProductDetail): AdminProductRow {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    subcategory: product.subcategory,
    supplier: product.supplier,
    supplierSku: product.supplierSku,
    brand: product.brand,
    image: product.image,
    slug: product.slug,
    active: product.active,
    deleted: product.deleted,
    edited: product.edited,
  };
}

function restoreFocus(opener: HTMLElement | null) {
  window.setTimeout(() => {
    if (opener && opener.isConnected) opener.focus();
    else document.querySelector<HTMLElement>("[data-cat-return]")?.focus();
  }, 0);
}

function peekStoredJob(): { ok: boolean; job: JobState | null } {
  try {
    const raw = window.localStorage.getItem(CATALOG_JOB_STORAGE_KEY);
    return { ok: true, job: raw ? parseJob(JSON.parse(raw)) : null };
  } catch {
    return { ok: false, job: null };
  }
}

// Admin 03.11: jedan posao odjednom, i kada se panel ponovo otvori dok prethodni korak jos traje.
let loopActive = false;

async function waitForIdle() {
  for (let tries = 0; loopActive && tries < 150; tries += 1) await wait(200);
  return !loopActive;
}

type EditorForm = { name: string; seoTitle: string; description: string; category: string; subcategory: string };
type EditorField = "name" | "seoTitle" | "description" | "location";

function formOf(product: AdminProductDetail): EditorForm {
  return {
    name: product.name ?? "",
    seoTitle: product.seoTitle ?? "",
    description: product.description ?? "",
    category: product.category ?? "",
    subcategory: product.subcategory ?? "",
  };
}

/** Admin 03.11: salju se samo promenjena polja; prazan naslov za pretrazivace je null. */
function buildPatch(product: AdminProductDetail, form: EditorForm): ProductPatch {
  const patch: ProductPatch = {};
  const name = form.name.trim();
  if (name !== product.name) patch.name = name;
  const seoTitle = form.seoTitle.trim();
  if (seoTitle !== (product.seoTitle ?? "")) patch.seoTitle = seoTitle ? seoTitle : null;
  if (form.description !== (product.description ?? "")) patch.description = form.description;
  if (form.category !== product.category || form.subcategory !== (product.subcategory ?? "")) {
    patch.location = { category: form.category, subcategory: form.subcategory };
  }
  return patch;
}

function patchError(form: EditorForm) {
  const name = form.name.trim();
  if (!name) return "Upišite naziv proizvoda.";
  if (name.length > CATALOG_LIMITS.name) return `Naziv može imati najviše ${formatCount(CATALOG_LIMITS.name)} znakova.`;
  if (form.seoTitle.trim().length > CATALOG_LIMITS.seoTitle) {
    return `Naslov za pretraživače može imati najviše ${formatCount(CATALOG_LIMITS.seoTitle)} znakova.`;
  }
  if (form.description.length > CATALOG_LIMITS.description) {
    return `Opis može imati najviše ${formatCount(CATALOG_LIMITS.description)} znakova.`;
  }
  if (!form.category) return "Izaberite grupu.";
  return "";
}

function historyTarget(job: HistoryJob, labels: Labels) {
  const target = typeof job.target === "string" ? job.target : "";
  if (!target) return "";
  const node = /^(group|sub):([^/]*)\/(.+)$/.exec(target);
  if (node) return node[1] === "group" ? labels.group(node[3]) : labels.path(node[2], node[3]);
  if (job.action !== "move") return "";
  const slash = target.indexOf("/");
  const category = slash >= 0 ? target.slice(0, slash) : target;
  const subcategory = slash >= 0 ? target.slice(slash + 1) : "";
  return `→ ${labels.path(category, subcategory)}`;
}

function partialText(restored: number, affected: number) {
  const rest = Math.max(0, affected - restored);
  const tail = isSingular(rest) ? "je u međuvremenu menjan" : "su u međuvremenu menjana";
  return `Delimično poništeno: ${formatCount(restored)} od ${formatCount(affected)}; ${formatCount(rest)} ${tail}.`;
}

/** Admin 03.11: aria-live napredak najvise jednom u ms milisekundi; poslednja vrednost uvek stigne. */
function useThrottled(text: string, ms: number) {
  const [shown, setShown] = useState(text);
  const lastRef = useRef(0);
  useEffect(() => {
    const delay = Math.max(0, lastRef.current + ms - Date.now());
    const timer = window.setTimeout(() => {
      lastRef.current = Date.now();
      setShown(text);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [text, ms]);
  return shown;
}

function Banner({ tone, children, actions }: { tone: Tone; children: ReactNode; actions?: ReactNode }) {
  const Icon = tone === "success" ? CircleCheck : tone === "info" ? Info : TriangleAlert;
  return (
    <div className={`cat-banner is-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon className="cat-banner-icon" size={18} aria-hidden="true" />
      <div className="cat-banner-text">{children}</div>
      {actions ? <div className="cat-banner-actions">{actions}</div> : null}
    </div>
  );
}

function Samples({ names }: { names: string[] }) {
  const list = names.filter(Boolean).slice(0, 3);
  if (!list.length) return null;
  return (
    <div className="cat-samples">
      <p>Na primer:</p>
      <ul>
        {list.map((name, index) => (
          <li key={`${index}-${name}`}>{name}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Admin 03.11: <dialog> preko showModal (fokus ostaje u prozoru, Esc). Stanje otvorenosti drzi React;
 * dok posao tece (locked) Esc i zatvaranje ne rade, a fokus se posle zatvaranja vraca na okidac.
 */
function Modal({
  open,
  title,
  locked = false,
  wide = false,
  onDismiss,
  children,
}: {
  open: boolean;
  title: string;
  locked?: boolean;
  wide?: boolean;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const openerRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(false);
  const lockedRef = useRef(locked);
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    lockedRef.current = locked;
    dismissRef.current = onDismiss;
  });

  useLayoutEffect(() => {
    const dialog = ref.current;
    openRef.current = open;
    if (!dialog) return;
    if (open && !dialog.open) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute("open", "");
      }
    } else if (!open && dialog.open) {
      dialog.close();
      restoreFocus(openerRef.current);
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) {
        dialog.close();
        restoreFocus(openerRef.current);
      }
    };
  }, []);

  const reopenIfNeeded = () => {
    window.setTimeout(() => {
      const dialog = ref.current;
      if (!openRef.current || !dialog || dialog.open) return;
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute("open", "");
      }
    }, 60);
  };

  return (
    <dialog
      ref={ref}
      className={`cat-dialog${wide ? " is-wide" : ""}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!lockedRef.current) dismissRef.current();
      }}
      onClose={() => {
        // Admin 03.11: pregledac ponekad zatvori prozor i bez nase odluke (drugi Esc); stanje se vraca.
        const dialog = ref.current;
        if (!openRef.current || !dialog || dialog.open) return;
        if (!lockedRef.current) dismissRef.current();
        reopenIfNeeded();
      }}
    >
      <div className="cat-dialog-head">
        <h2 id={titleId}>{title}</h2>
        {!locked ? (
          <button type="button" className="cat-icon-button" aria-label="Zatvori" onClick={() => dismissRef.current()}>
            <X size={18} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="cat-dialog-body">{open ? children : null}</div>
    </dialog>
  );
}

export default function CatalogAdminPanel({ api }: { api: Api }) {
  const titleId = useId();
  const wide = useWide();
  const [phase, setPhase] = useState<Phase>("loading");
  const [statusError, setStatusError] = useState("");
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatusView | null>(null);
  const [view, setView] = useState<View>("products");
  const [groups, setGroups] = useState<TaxonomyNode[]>([]);
  const [layout, setLayout] = useState<CatalogLayout | null>(null);
  const groupsRequest = useRef(0);
  const lastGroupsReadAt = useRef(0);
  const [groupsState, setGroupsState] = useState({ loading: true, error: "" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [selection, setSelection] = useState<Selection>({ mode: "ids", items: [] });
  const [storedJob, setStoredJob] = useState<JobState | null>(null);
  const [pauseNote, setPauseNote] = useState("");
  const [run, setRun] = useState<RunView | null>(null);
  const [stopping, setStopping] = useState(false);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [rowPatches, setRowPatches] = useState<ReadonlyMap<string, AdminProductRow>>(() => new Map());
  const mountedRef = useRef(false);
  const stopRef = useRef(false);
  const runningRef = useRef(false);
  const labels = useMemo(() => makeLabels(groups), [groups]);
  const running = run?.phase === "running";
  const locked = storedJob !== null || running;
  const { dbBytes, capacity } = catalogStatus ?? {};
  const capacityWarning = typeof dbBytes === "number" && dbBytes >= (capacity?.warnBytes ?? CATALOG_LIMITS.warnBytes);

  const call = useCallback(
    <T,>(request: string | CatalogAction): Promise<T> => {
      const pending =
        typeof request === "string"
          ? api<T>(`${CATALOG_ADMIN_API}?${request}`)
          : api<T>(CATALOG_ADMIN_API, { method: "POST", body: JSON.stringify(request) });
      return pending.catch((error: unknown) => {
        // Admin 03.11: migracija nije primenjena -> samo kartica 2.5; ostatak admina radi.
        const modelRequest = typeof request === "string" ? new URLSearchParams(request).get("view") === "models" : request.action === "preview_models" || (request.action === "bulk" && Boolean(request.filter?.device || request.filter?.devices));
        if (codeOf(error) === "CATALOG_MIGRATION_PENDING" && !modelRequest && mountedRef.current) setPhase("pending");
        throw error;
      });
    },
    [api],
  );

  useEffect(() => {
    mountedRef.current = true;
    setStoredJob(peekStoredJob().job);
    return () => {
      mountedRef.current = false;
      // Admin 03.11: panel je zatvoren; posao staje posle tekuceg koraka i ceka "Nastavi".
      stopRef.current = true;
    };
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const result = await call<CatalogStatusView>("view=status");
      if (!mountedRef.current) return;
      if (!isRecord(result) || result.ready !== true) {
        setPhase("pending");
        return;
      }
      setCatalogStatus(result);
      setPhase("ready");
    } catch (error) {
      if (!mountedRef.current || codeOf(error) === "CATALOG_MIGRATION_PENDING") return;
      setStatusError(messageOf(error));
      setPhase("error");
    }
  }, [call]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const retryStatus = () => {
    setPhase("loading");
    setStatusError("");
    void loadStatus();
  };

  const loadGroups = useCallback(async () => {
    const request = ++groupsRequest.current;
    setGroupsState({ loading: true, error: "" });
    setLayout(null);
    try {
      const result = await call<TaxonomyView>("view=taxonomy");
      if (!mountedRef.current) return;
      if (request !== groupsRequest.current) return;
      const nextLayout = result.layout ? parseCatalogLayout(result.layout) : null;
      setGroups(normalizeGroups(result));
      setLayout(nextLayout);
      lastGroupsReadAt.current = Date.now();
      setGroupsState({ loading: false, error: "" });
    } catch (error) {
      if (!mountedRef.current) return;
      if (request !== groupsRequest.current) return;
      setGroupsState({ loading: false, error: messageOf(error) });
    }
  }, [call]);

  useEffect(() => {
    if (phase === "ready") void loadGroups();
  }, [phase, loadGroups, refreshKey]);

  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const runJob = useCallback(
    async (start: JobState, resumed: boolean) => {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        const acquired = await withCatalogJobLock(async () => {
          stopRef.current = false;
          setStopping(false);
          setPauseNote("");
          setNotice(null);
          setRun({ phase: "running", job: start });
          let job = start;
          let selectionNote: string | undefined;
          let owner = false;
          let written = false;
          let lost = false;
          const show = (next: RunView) => {
            if (mountedRef.current) setRun(next);
          };
          // Admin 03.11 (E3): upis samo ako skladiste jos drzi ovaj posao; inace je odbacen/zamenjen u drugom prozoru.
          const save = (next: JobState) => {
            job = next;
            const stored = peekStoredJob();
            if (stored.ok && (stored.job ? stored.job.jobId !== next.jobId : written)) {
              lost = true;
              stopRef.current = true;
              return;
            }
            // written samo kad je upis uspeo; inace bi prazno skladiste bilo pogresno procitano kao "odbaceno u drugom prozoru".
            if (writeStoredJob(next)) written = true;
            if (mountedRef.current) setStoredJob(next);
          };
          // Brise skladiste samo kada u njemu stoji ovaj posao (ili nista); tudji posao ostaje.
          const release = () => {
            const stored = peekStoredJob();
            const other = stored.ok && stored.job && stored.job.jobId !== job.jobId ? stored.job : null;
            if (!other) clearStoredJob();
            if (mountedRef.current) setStoredJob(other);
          };
          const pause = (message: string, tone: "error" | "warning" = "error") => {
            show({ phase: "paused", job, message, tone });
          };
          const finish = (final: JobState, note?: string) => {
            job = final;
            notifyCatalogChanged();
            release();
            if (mountedRef.current) setRefreshKey((key) => key + 1);
            const message = [selectionNote, note].filter(Boolean).join(" ");
            show(message ? { phase: "done", job: final, message, tone: "warning" } : { phase: "done", job: final });
          };
          const fail = (message: string) => {
            release();
            show({ phase: "failed", job, message, tone: "error" });
          };
          try {
            // Admin 03.11: nov posao se upisuje odmah, pre prvog koraka.
            if (!resumed) save(job);
            if (!(await waitForIdle())) {
              pause(BUSY_JOB_TEXT);
              return;
            }
            owner = true;
            loopActive = true;
            if (resumed) {
              // Admin 03.11: vazi poslednji potvrdjen korak iz skladista; posao je mozda vec zavrsen drugde.
              const peek = peekStoredJob();
              if (peek.ok) {
                if (!peek.job || peek.job.jobId !== start.jobId) {
                  if (mountedRef.current) {
                    setStoredJob(peek.job);
                    setRun(null);
                    setNotice({ tone: "info", text: "Ovaj posao je već završen ili odbačen." });
                  }
                  return;
                }
                job = peek.job;
              }
            }
            if (job.reviewRequired || (Number.isFinite(Date.parse(job.startedAt))
                && Date.now() - Date.parse(job.startedAt) > 180 * 24 * 60 * 60_000)) {
              save({ ...job, reviewRequired: true });
              pause(EXPIRED_JOB_TEXT, "warning");
              return;
            }
            save(job);
            show({ phase: "running", job });
            let busyAtMin = 0;
            let mutexRetries = 0;
            for (;;) {
              if (lost) {
                const stored = peekStoredJob();
                if (mountedRef.current && stored.ok) setStoredJob(stored.job);
                show({ phase: "failed", job, message: LOST_JOB_TEXT, tone: "error" });
                return;
              }
              if (stopRef.current) {
                pause(STOPPED_TEXT, "warning");
                return;
              }
              const sent = job.idsDone ?? 0;
              const packet = job.ids ? job.ids.slice(sent, sent + job.limit) : null;
              let result: StepResult;
              try {
                result = await call<StepResult>(stepBody(job, packet));
              } catch (error) {
                const code = codeOf(error);
                const status = statusOf(error);
                if (code === "CATALOG_BUSY") {
                  const retryAfter = error instanceof ApiFailure ? error.retryAfter : undefined;
                  if (typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter > 0) {
                    // A publisher owns one short transaction. Keep the exact unconfirmed
                    // packet and saved cursor so the database can replay a lost response.
                    if (mutexRetries >= 10) {
                      pause(BUSY_JOB_TEXT, "warning");
                      return;
                    }
                    mutexRetries += 1;
                    show({ phase: "running", job, message: "Druga izmena je pri kraju. Vaš posao je sačuvan; korak se ponavlja.", tone: "warning" });
                    await wait(Math.min(3, Math.max(1, retryAfter)) * 1000);
                    continue;
                  }
                  mutexRetries = 0;
                  if (job.limit > CATALOG_LIMITS.minStep) {
                    save({ ...job, limit: Math.max(CATALOG_LIMITS.minStep, Math.floor(job.limit / 2)) });
                    busyAtMin = 0;
                  } else {
                    busyAtMin += 1;
                    if (busyAtMin >= 3) {
                      pause(BUSY_JOB_TEXT);
                      return;
                    }
                  }
                  show({ phase: "running", job });
                  await wait(800);
                  continue;
                }
                if (code === "BULK_JOB_EXPIRED") {
                  save({ ...job, reviewRequired: true });
                  pause(EXPIRED_JOB_TEXT, "warning");
                  return;
                }
                if (code === "RATE_LIMITED" || status === 429) {
                  pause(rateText(error));
                  return;
                }
                if (status === 0) {
                  pause(OFFLINE_JOB_TEXT);
                  return;
                }
                // Admin 03.11 (K8): BULK_TOO_LARGE usred posla = dostignuta granica od 10.000; posao je gotov (uz napomenu ako je ostalo).
                if (code === "BULK_TOO_LARGE" && (job.after !== null || (job.idsDone ?? 0) > 0)) {
                  finish(job, job.processed < job.total ? LIMIT_NOTE : undefined);
                  return;
                }
                // Admin 03.11 (E1): objava dobavljaca je u toku; posao se pauzira i nastavlja kasnije
                if (code === "PUBLICATION_RUNNING") {
                  pause(messageOf(error), "warning");
                  return;
                }
                if (
                  code === "CATALOG_CAPACITY" ||
                  code === "UNAUTHORIZED" ||
                  status === 401 ||
                  code === "CATALOG_MIGRATION_PENDING" ||
                  code === "CATALOG_UNAVAILABLE" ||
                  code === "INTERNAL" ||
                  status >= 500 ||
                  !code
                ) {
                  pause(messageOf(error));
                  return;
                }
                fail(messageOf(error));
                return;
              }
              busyAtMin = 0;
              mutexRetries = 0;
              if (result.selectionBasis === "current_remaining") selectionNote = LEGACY_SELECTION_NOTE;
              const processed = job.processed + toCount(result?.processed);
              const changed = job.changed + toCount(result?.changed);
              if (packet) {
                const idsDone = sent + packet.length;
                const next: JobState = { ...job, idsDone, processed, changed, after: null };
                if (idsDone >= (job.ids?.length ?? 0)) {
                  finish(next);
                  return;
                }
                save(next);
              } else {
                const nextAfter = typeof result?.nextAfter === "string" && result.nextAfter ? result.nextAfter : null;
                const next: JobState = { ...job, processed, changed, after: nextAfter ?? job.after };
                if (result?.done !== false || nextAfter === null || nextAfter === job.after) {
                  finish(next);
                  return;
                }
                save(next);
              }
              show({ phase: "running", job, ...(selectionNote ? { message: selectionNote, tone: "warning" as const } : {}) });
            }
          } finally {
            if (owner) loopActive = false;
          }
        });
        if (!acquired && mountedRef.current) {
          setRun(null);
          setStoredJob(peekStoredJob().job);
          setNotice({ tone: "info", text: "Posao radi u drugoj kartici ili pregledač ne podržava bezbedan nastavak. Zaustavite ga tamo pa nastavite u savremenom pregledaču." });
        }
      } catch {
        if (mountedRef.current) setNotice({ tone: "error", text: GENERIC_ERROR });
      } finally {
        runningRef.current = false;
      }
    },
    [call],
  );

  const requestStop = () => {
    stopRef.current = true;
    setStopping(true);
  };

  const resume = () => {
    const job = peekStoredJob();
    const target = job.ok ? job.job : storedJob;
    if (!target) {
      setStoredJob(null);
      setPauseNote("");
      setNotice({ tone: "info", text: "Ovaj posao je već završen ili odbačen." });
      return;
    }
    setDialog(null);
    void runJob(target, true);
  };

  const discard = () => {
    void withCatalogJobLock(async () => {
      if (loopActive || runningRef.current) {
        setNotice({ tone: "info", text: DISCARD_BUSY_TEXT });
        return;
      }
      clearStoredJob();
      setStoredJob(null);
      setPauseNote("");
      setRun(null);
      setNotice({ tone: "info", text: "Nedovršen posao je odbačen. Izmene koje su već urađene ostaju." });
    }).then((acquired) => {
      if (!acquired && mountedRef.current) setNotice({ tone: "info", text: DISCARD_BUSY_TEXT });
    }).catch(() => {
      if (mountedRef.current) setNotice({ tone: "error", text: GENERIC_ERROR });
    });
  };

  const openBulk: OpenBulk = (op, target) => {
    if (locked) {
      setNotice({ tone: "error", text: LOCK_TEXT });
      return;
    }
    setNotice(null);
    setDialog({ kind: op, target });
  };

  const startBulk = (op: BulkOp, target: JobTarget, destination?: Destination) => {
    const total = targetTotal(target);
    const job: JobState = {
      jobId: newJobId(),
      // Old bundles reject this unknown kind instead of stripping the model filter on resume.
      kind: target.mode === "filter" && target.filter.devices ? "model_set_bulk" : target.mode === "filter" && target.filter.device ? "model_bulk" : "bulk",
      op,
      label: jobLabel(op, total),
      after: null,
      limit: target.mode === "ids" ? CATALOG_LIMITS.maxStep : CATALOG_LIMITS.stepSize,
      processed: 0,
      changed: 0,
      total,
      startedAt: new Date().toISOString(),
    };
    if (target.mode === "ids") {
      job.ids = target.ids.slice(0, CATALOG_LIMITS.maxJob);
      job.idsDone = 0;
    } else {
      job.filter = target.filter;
      if (target.modelSetScope) {
        const scope = target.modelSetScope;
        job.label = cut(`Brisanje modela ${labels.path(scope.category, scope.subcategory)} · ${brandLabel("phone", scope.deviceBrand)} (${scope.devices.length} modela, ${productCount(total)})`, 200);
      }
      if (target.modelScope) {
        const scope = target.modelScope;
        job.label = cut(`Brisanje podgrupe ${labels.path(scope.category, scope.subcategory)} · ${brandLabel("phone", scope.deviceBrand)} · ${modelLabel(scope.deviceBrand, scope.device)} (${productCount(total)})`, 200);
      }
    }
    if (op === "move" && destination) {
      job.category = destination.category;
      job.subcategory = destination.subcategory;
    }
    setDialog(null);
    setSelection({ mode: "ids", items: [] });
    void runJob(job, false);
  };

  const startUndo = (undoJobId: string, label: string, total: number) => {
    const job: JobState = {
      jobId: newJobId(),
      kind: "undo",
      op: "undo",
      undoJobId,
      label: cut(`Poništavanje izmene „${label}“`, 200),
      after: null,
      limit: CATALOG_LIMITS.stepSize,
      processed: 0,
      changed: 0,
      total,
      startedAt: new Date().toISOString(),
    };
    setDialog(null);
    void runJob(job, false);
  };

  const undoFromHistory = (job: HistoryJob) => {
    if (locked) {
      setNotice({ tone: "error", text: LOCK_TEXT });
      return;
    }
    const remaining = job.status === "partial" ? Math.max(0, job.affected - job.restored) : job.affected;
    setNotice(null);
    setDialog({ kind: "undo", undoJobId: job.jobId, label: opLabel(job.action, job.affected), total: remaining });
  };

  const dismissJob = () => {
    if (run?.phase === "running") return;
    if (run?.phase === "paused") setPauseNote(run.message ?? "");
    setRun(null);
    setDialog(null);
  };

  // Admin 03.11 (E4): sacuvani redovi se drze po id dok ih nova ucitana lista ne pokaze; izmena drugog reda ne brise prethodne.
  const onSaved = (product: AdminProductDetail, moved: boolean) => {
    notifyCatalogChanged();
    const row = rowOf(product);
    setRowPatches((current) => new Map(current).set(row.id, row));
    if (moved) void loadGroups();
  };
  const clearShownPatches = useCallback((shown: ReadonlyMap<string, AdminProductRow>) => {
    setRowPatches((current) => {
      const stale = Array.from(shown.entries()).filter(([id, row]) => current.get(id) === row);
      if (stale.length === 0) return current;
      const next = new Map(current);
      stale.forEach(([id]) => next.delete(id));
      return next;
    });
  }, []);

  const head = (
    <div className="account-section-title">
      <h2 id={titleId}>Katalog</h2>
      <Library size={23} aria-hidden="true" />
    </div>
  );

  if (phase === "pending") {
    return (
      <section className="panel account-admin-section cat-panel" aria-labelledby={titleId}>
        {head}
        <div className="cat-pending" role="status">
          <Info size={20} aria-hidden="true" />
          <p>{PENDING_TEXT}</p>
        </div>
        <div className="cat-actions">
          <button type="button" className="button" onClick={retryStatus}>
            <RefreshCw size={16} aria-hidden="true" /> Proveri ponovo
          </button>
        </div>
      </section>
    );
  }

  if (phase !== "ready") {
    return (
      <section className="panel account-admin-section cat-panel" aria-labelledby={titleId} aria-busy={phase === "loading"}>
        {head}
        {phase === "loading" ? (
          <p className="cat-loading">
            <LoaderCircle className="cat-spin" size={18} aria-hidden="true" /> Učitavanje kataloga…
          </p>
        ) : (
          <Banner
            tone="error"
            actions={
              <button type="button" className="button" onClick={retryStatus}>
                <RefreshCw size={16} aria-hidden="true" /> Pokušajte ponovo
              </button>
            }
          >
            {statusError || GENERIC_ERROR}
          </Banner>
        )}
      </section>
    );
  }

  return (
    <section className="panel account-admin-section cat-panel" aria-labelledby={titleId}>
      {head}
      <p className="account-hint">
        Pretraga i masovne izmene proizvoda, grupe, modeli uređaja i istorija izmena. Izmene su odmah vidljive u prodavnici.
      </p>
      {capacityWarning && typeof dbBytes === "number" ? (
        <Banner tone="warning">
          Baza podataka zauzima {formatDatabaseSize(dbBytes)}. {capacity
            ? `Prag za masovne izmene je ${formatDatabaseSize(capacity.bulkBytes)}.`
            : "Baza je blizu praga za masovne izmene."} Ako je posao zaustavljen, proverite slobodan prostor u bazi pre nastavka.
        </Banner>
      ) : null}
      {storedJob && !run ? (
        <Banner
          tone="warning"
          actions={
            <>
              {!storedJob.reviewRequired ? <button type="button" className="button button-dark" onClick={resume}>
                <RotateCcw size={16} aria-hidden="true" /> Nastavi
              </button> : null}
              <button type="button" className="button" onClick={discard}>
                <X size={16} aria-hidden="true" /> Odbaci
              </button>
            </>
          }
        >
          <p>
            Posao „{storedJob.label}“ nije završen ({formatCount(jobProgress(storedJob).done)} od{" "}
            {formatCount(jobProgress(storedJob).total)}).
          </p>
          {pauseNote ? <p>{pauseNote}</p> : null}
        </Banner>
      ) : null}
      {notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}
      <div className="cat-views" role="group" aria-label="Prikaz"
        style={{ gridTemplateColumns: `repeat(${wide ? 4 : 2}, minmax(0, 1fr))`, maxWidth: 640 }}>
        {VIEWS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={view === id ? "button button-dark" : "button"}
            aria-pressed={view === id}
            data-cat-return={view === id ? "" : undefined}
            onClick={() => {
              setView(id);
              if (id === "groups" && view !== "groups" && !groupsState.loading &&
                (groupsState.error || Date.now() - lastGroupsReadAt.current >= GROUPS_REFRESH_AGE_MS)) void loadGroups();
            }}
          >
            <Icon size={16} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      {view === "products" ? (
        <ProductsView
          call={call}
          wide={wide}
          groups={groups}
          labels={labels}
          groupsState={groupsState}
          onReloadGroups={() => void loadGroups()}
          refreshKey={refreshKey}
          selection={selection}
          setSelection={setSelection}
          locked={locked}
          onBulk={openBulk}
          onEdit={setEditing}
          rowPatches={rowPatches}
          onPatchShown={clearShownPatches}
        />
      ) : null}
      {view === "groups" ? (
        <GroupsView
          call={call}
          groups={groups}
          state={groupsState}
          layout={layout}
          locked={locked}
          onReload={() => void loadGroups()}
          onChanged={() => setRefreshKey((key) => key + 1)}
        />
      ) : null}
      {view === "models" ? (
        <ModelsView call={call} groups={groups} labels={labels} groupsState={groupsState}
          onReloadGroups={() => void loadGroups()} refreshKey={refreshKey} locked={locked} onBulk={openBulk} />
      ) : null}
      {view === "history" ? (
        <HistoryPanel call={call} labels={labels} refreshKey={refreshKey} locked={locked} onUndo={undoFromHistory} />
      ) : null}
      {editing ? (
        <ProductEditor
          key={editing}
          id={editing}
          call={call}
          groups={groups}
          labels={labels}
          refreshKey={refreshKey}
          locked={locked}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
          onBulk={openBulk}
        />
      ) : null}
      <JobDialog
        dialog={dialog}
        run={run}
        stopping={stopping}
        groups={groups}
        layout={layout}
        labels={labels}
        call={call}
        onCancel={dismissJob}
        onStart={startBulk}
        onUndo={startUndo}
        onStop={requestStop}
        onResume={() => {
          if (run) void runJob(run.job, true);
        }}
        onGroupsChanged={() => void loadGroups()}
      />
    </section>
  );
}

type StartBulk = (op: BulkOp, target: JobTarget, destination?: Destination) => void;
type StartUndo = (undoJobId: string, label: string, total: number) => void;

function JobDialog({
  dialog,
  run,
  stopping,
  groups,
  layout,
  labels,
  call,
  onCancel,
  onStart,
  onUndo,
  onStop,
  onResume,
  onGroupsChanged,
}: {
  dialog: DialogSpec | null;
  run: RunView | null;
  stopping: boolean;
  groups: TaxonomyNode[];
  layout: CatalogLayout | null;
  labels: Labels;
  call: Call;
  onCancel: () => void;
  onStart: StartBulk;
  onUndo: StartUndo;
  onStop: () => void;
  onResume: () => void;
  onGroupsChanged: () => void;
}) {
  const open = Boolean(dialog || run);
  let title = "";
  if (run) title = DIALOG_TITLES[run.job.op];
  else if (dialog?.kind === "move") title = `Premesti ${productCount(targetTotal(dialog.target))}`;
  else if (dialog) title = DIALOG_TITLES[dialog.kind];
  let body: ReactNode = null;
  if (run) {
    body = <JobProgress run={run} stopping={stopping} onStop={onStop} onResume={onResume} onClose={onCancel} onUndo={onUndo} />;
  } else if (dialog?.kind === "move") {
    body = (
      <MoveForm
        target={dialog.target}
        groups={groups}
        layout={layout}
        labels={labels}
        call={call}
        onCancel={onCancel}
        onStart={onStart}
        onGroupsChanged={onGroupsChanged}
      />
    );
  } else if (dialog?.kind === "delete") {
    body = <DeleteForm target={dialog.target} labels={labels} onCancel={onCancel} onStart={onStart} />;
  } else if (dialog) {
    body = <SimpleConfirm dialog={dialog} onCancel={onCancel} onStart={onStart} onUndo={onUndo} />;
  }
  return (
    <Modal open={open} title={title} locked={run?.phase === "running"} onDismiss={onCancel}>
      {body}
    </Modal>
  );
}

type SubOption = { slug: string; label: string };

function MoveForm({
  target,
  groups,
  layout,
  labels,
  call,
  onCancel,
  onStart,
  onGroupsChanged,
}: {
  target: JobTarget;
  groups: TaxonomyNode[];
  layout: CatalogLayout | null;
  labels: Labels;
  call: Call;
  onCancel: () => void;
  onStart: StartBulk;
  onGroupsChanged: () => void;
}) {
  const fieldId = useId();
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [extras, setExtras] = useState<(SubOption & { group: string })[]>([]);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const createRevision = useRef<number | null>(null);
  const pendingCreate = useRef<{ key: string; action: Extract<CatalogAction, { action: "taxonomy" }> } | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const total = targetTotal(target);
  const count = productCount(total);
  // Admin 03.11: sakrivene grupe i podgrupe se ne nude kao odrediste.
  const visibleGroups = groups.filter((group) => !group.hidden);
  const current = groups.find((group) => group.slug === category);
  const known = current?.children ?? [];
  const subs: SubOption[] = [
    ...known.filter((child) => !child.hidden).map((child) => ({ slug: child.slug, label: child.label })),
    ...extras
      .filter((extra) => extra.group === category && !known.some((child) => child.slug === extra.slug))
      .map(({ slug, label }) => ({ slug, label })),
  ];
  const subLabel = subcategory ? (subs.find((sub) => sub.slug === subcategory)?.label ?? subcategory) : "Bez podgrupe";

  const create = async () => {
    const label = newLabel.trim();
    if (!label) {
      setError("Upišite naziv nove podgrupe.");
      return;
    }
    if (!layout || createRevision.current === null) {
      setError("Osvežite grupe pre dodavanja podgrupe.");
      onGroupsChanged();
      return;
    }
    const key = JSON.stringify({ parent: category, label });
    const action = pendingCreate.current?.key === key ? pendingCreate.current.action : {
      action: "taxonomy" as const, jobId: newJobId(), op: "create" as const, kind: "sub" as const,
      parent: category, label, revision: createRevision.current,
    };
    pendingCreate.current = { key, action };
    setCreating(true);
    setError("");
    setInfo("");
    try {
      const result = await call<TaxonomySaveResult>(action);
      pendingCreate.current = null;
      const slug = isRecord(result) && typeof result.slug === "string" ? result.slug : "";
      if (!slug) throw new ApiFailure(GENERIC_ERROR, 500);
      notifyCatalogChanged();
      setExtras((list) => [...list, { group: category, slug, label }]);
      setSubcategory(slug);
      setAdding(false);
      setNewLabel("");
      setInfo(`Podgrupa „${label}“ je napravljena (adresa: ${slug}).`);
      onGroupsChanged();
    } catch (failure) {
      setError(messageOf(failure));
      if (codeOf(failure) === "TAXONOMY_VERSION_CONFLICT") {
        pendingCreate.current = null;
        createRevision.current = null;
        setAdding(false);
        onGroupsChanged();
      }
    } finally {
      setCreating(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!category) {
      setError("Izaberite grupu u koju premeštate proizvode.");
      return;
    }
    if (adding) {
      setError("Završite dodavanje nove podgrupe ili izaberite postojeću.");
      return;
    }
    onStart("move", target, { category, subcategory });
  };

  return (
    <form className="cat-form" onSubmit={submit} noValidate>
      <div className="cat-field">
        <label htmlFor={`${fieldId}-group`}>Grupa</label>
        <select
          id={`${fieldId}-group`}
          className="field"
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            setSubcategory("");
            setAdding(false);
            setError("");
          }}
        >
          <option value="">Izaberite grupu</option>
          {visibleGroups.map((group) => (
            <option key={group.slug} value={group.slug}>
              {group.label}
            </option>
          ))}
        </select>
      </div>
      <div className="cat-field">
        <label htmlFor={`${fieldId}-sub`}>Podgrupa</label>
        <select
          id={`${fieldId}-sub`}
          className="field"
          value={adding ? "__new__" : subcategory}
          disabled={!category || creating}
          onChange={(event) => {
            const value = event.target.value;
            setError("");
            if (value === "__new__") {
              createRevision.current = layout?.revision ?? null;
              setAdding(true);
              return;
            }
            setAdding(false);
            setSubcategory(value);
          }}
        >
          <option value="">Bez podgrupe</option>
          {subs.map((sub) => (
            <option key={sub.slug} value={sub.slug}>
              {sub.label}
            </option>
          ))}
          <option value="__new__" disabled={!layout}>+ Nova podgrupa…</option>
        </select>
      </div>
      {adding ? (
        <div className="cat-inline-form">
          <div className="cat-field">
            <label htmlFor={`${fieldId}-new`}>Naziv nove podgrupe</label>
            <input
              id={`${fieldId}-new`}
              className="field"
              value={newLabel}
              maxLength={CATALOG_LIMITS.label}
              autoComplete="off"
              onChange={(event) => setNewLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (!creating) void create();
                }
              }}
            />
          </div>
          <div className="cat-actions">
            <button type="button" className="button" disabled={creating || !layout} onClick={() => void create()}>
              <Plus size={16} aria-hidden="true" /> {creating ? "Dodavanje…" : "Dodaj podgrupu"}
            </button>
            <button
              type="button"
              className="button"
              disabled={creating}
              onClick={() => {
                setAdding(false);
                setNewLabel("");
                setError("");
              }}
            >
              Otkaži
            </button>
          </div>
        </div>
      ) : null}
      {info ? <Banner tone="success">{info}</Banner> : null}
      {category ? (
        <p className="cat-lead">
          Premestiće se {count} u „{labels.group(category)} › {subLabel}“.
        </p>
      ) : null}
      <Samples names={target.samples} />
      <p className="cat-help">{MOVE_NOTE}</p>
      {error ? (
        <p className="cat-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="cat-actions">
        <button type="submit" className="button button-dark" disabled={creating}>
          <ArrowRightLeft size={16} aria-hidden="true" /> Premesti {count}
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Otkaži
        </button>
      </div>
    </form>
  );
}

function DeleteForm({ target, labels, onCancel, onStart }: { target: JobTarget; labels: Labels; onCancel: () => void; onStart: StartBulk }) {
  const inputId = useId();
  const [word, setWord] = useState("");
  const total = targetTotal(target);
  // Admin 03.11: isto pravilo kao server: po filteru ili vise od confirmOver proizvoda trazi se rec OBRISI.
  const strong = target.mode === "filter" || target.ids.length > CATALOG_LIMITS.confirmOver;
  const single = target.mode === "ids" && target.ids.length === 1;
  const modelScope = target.mode === "filter" ? target.modelScope : undefined;
  const modelSetScope = target.mode === "filter" ? target.modelSetScope : undefined;
  const ready = !strong || isConfirmWord(word);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) onStart("delete", target);
  };
  return (
    <form className="cat-form" onSubmit={submit} noValidate>
      <p className="cat-lead">
        {single
          ? `Ukloniti „${target.samples[0] ?? "proizvod"}“ iz prodavnice? Ostaje u Kanti i možete ga vratiti.`
          : `Ukloniti ${productCount(total)} iz prodavnice? Proizvodi ostaju u Kanti i možete ih vratiti.`}
      </p>
      {modelScope ? <>
        <p className="cat-lead">{labels.path(modelScope.category, modelScope.subcategory)} · {brandLabel("phone", modelScope.deviceBrand)} · {modelLabel(modelScope.deviceBrand, modelScope.device)}</p>
        <p>Obuhvaćeni su svi sadašnji artikli ove podgrupe modela, kod svih dobavljača, uključujući one koji trenutno nisu u prodavnici. Buduće artikle ova radnja ne blokira.</p>
        {target.mode === "filter" && (target.shared ?? 0) > 0 ? <Banner tone="warning">
          Zajednički artikli: {productCount(target.shared ?? 0)}. Brišu se celi artikli, pa nestaju i iz ponude za druge modele koje podržavaju.
        </Banner> : null}
      </> : null}
      {modelSetScope ? <>
        <p className="cat-lead">{labels.path(modelSetScope.category, modelSetScope.subcategory)} {"·"} {brandLabel("phone", modelSetScope.deviceBrand)}</p>
        <p>Izabrani modeli: {modelSetScope.devices.map((device) => modelLabel(modelSetScope.deviceBrand, device)).join(", ")}.</p>
        <p>Brišu se svi sadašnji artikli koji podržavaju bar jedan izabrani model, kod svih dobavljača, uključujući artikle koji trenutno nisu u prodavnici. Isti artikal briše se jednom. Buduće artikle ova radnja ne blokira.</p>
        {target.mode === "filter" && (target.shared ?? 0) > 0 ? <Banner tone="warning">
          Zajednički artikli izvan izbora: {productCount(target.shared ?? 0)}. Brišu se celi artikli, pa nestaju i iz ponude za druge modele koje niste izabrali.
        </Banner> : null}
      </> : null}
      {strong ? (
        <>
          <Samples names={target.samples} />
          <div className="cat-field">
            <label htmlFor={inputId}>Upišite {DELETE_CONFIRM_WORD} da potvrdite</label>
            <input
              id={inputId}
              className="field"
              value={word}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              onChange={(event) => setWord(event.target.value)}
            />
          </div>
        </>
      ) : null}
      <div className="cat-actions">
        <button type="submit" className="button cat-button-danger" disabled={!ready}>
          <Trash2 size={16} aria-hidden="true" /> {single ? "Obriši proizvod" : `Obriši ${productCount(total)}`}
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Otkaži
        </button>
      </div>
    </form>
  );
}

function SimpleConfirm({
  dialog,
  onCancel,
  onStart,
  onUndo,
}: {
  dialog: DialogSpec;
  onCancel: () => void;
  onStart: StartBulk;
  onUndo: StartUndo;
}) {
  let text: string;
  let action: string;
  let Icon = ArchiveRestore;
  let danger = false;
  let confirm: () => void;
  if (dialog.kind === "undo") {
    const { undoJobId, label, total } = dialog;
    text = `Poništiti „${label}“? Proizvodi se vraćaju na stanje pre izmene (${productCount(total)}). Proizvodi koji su u međuvremenu menjani ostaju kako jesu. Kod premeštanja se proizvodi vraćaju u grupu koju je odredio dobavljač, a ne u raniju ručno izabranu grupu.`;
    action = "Poništi";
    Icon = Undo2;
    confirm = () => onUndo(undoJobId, label, total);
  } else {
    const op = dialog.kind;
    const target = dialog.target;
    const single = target.mode === "ids" && target.ids.length === 1;
    const what = single ? `„${target.samples[0] ?? "proizvod"}“` : productCount(targetTotal(target));
    if (op === "revert") {
      text = `Vratiti originalne podatke dobavljača za ${what}? Ručno izmenjeni naziv, naslov za pretraživače, opis i grupa se brišu. Ovo se ne može poništiti.`;
      action = "Vrati na originalno";
      Icon = RotateCcw;
      danger = true;
    } else {
      text = `Vratiti ${what} u prodavnicu?`;
      action = "Vrati u prodavnicu";
    }
    confirm = () => onStart(op, target);
  }
  return (
    <div className="cat-form">
      <p className="cat-lead">{text}</p>
      <div className="cat-actions">
        <button type="button" className={danger ? "button cat-button-danger" : "button button-dark"} onClick={confirm}>
          <Icon size={16} aria-hidden="true" /> {action}
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Otkaži
        </button>
      </div>
    </div>
  );
}

function JobProgress({
  run,
  stopping,
  onStop,
  onResume,
  onClose,
  onUndo,
}: {
  run: RunView;
  stopping: boolean;
  onStop: () => void;
  onResume: () => void;
  onClose: () => void;
  onUndo: StartUndo;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { job, phase } = run;
  const { done, total } = jobProgress(job);
  const finished = phase === "done";
  const max = Math.max(total, 1);
  const now = finished ? max : Math.min(done, max);
  const percent = Math.round((now / max) * 100);
  const text = `${progressText(job)}${phase === "running" ? "…" : ""}`;
  const spoken = useThrottled(text, 2000);
  const undoable = finished && (job.op === "move" || job.op === "delete") && job.processed > 0;

  useEffect(() => {
    // Admin 03.11: posle promene faze fokus ide na sadrzaj prozora (citac ekrana cita novo stanje).
    if (phase !== "running") rootRef.current?.focus();
  }, [phase]);

  return (
    <div className="cat-job" ref={rootRef} tabIndex={-1}>
      <div
        className="cat-progress"
        role="progressbar"
        aria-label="Napredak posla"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={now}
        aria-valuetext={text}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="cat-progress-text" aria-hidden="true">
        {text}
      </p>
      <p className="cat-sr" aria-live="polite">
        {spoken}
      </p>
      {phase === "running" && run.message ? <Banner tone={run.tone ?? "warning"}>{run.message}</Banner> : null}
      {phase === "running" ? (
        <div className="cat-actions">
          <button type="button" className="button" disabled={stopping} onClick={onStop}>
            <CirclePause size={16} aria-hidden="true" /> {stopping ? "Zaustavljanje posle ovog koraka…" : "Prekini"}
          </button>
        </div>
      ) : null}
      {phase === "paused" ? (
        <>
          <Banner tone={run.tone ?? "error"}>{run.message || STOPPED_TEXT}</Banner>
          <div className="cat-actions">
            {!job.reviewRequired ? <button type="button" className="button button-dark" onClick={onResume}>
              <RotateCcw size={16} aria-hidden="true" /> Nastavi
            </button> : null}
            <button type="button" className="button" onClick={onClose}>
              Zatvori
            </button>
          </div>
        </>
      ) : null}
      {phase === "failed" ? (
        <>
          <Banner tone="error">{run.message || GENERIC_ERROR}</Banner>
          <div className="cat-actions">
            <button type="button" className="button" onClick={onClose}>
              Zatvori
            </button>
          </div>
        </>
      ) : null}
      {finished ? (
        <>
          <div className="cat-done" role="status">
            <CircleCheck size={20} aria-hidden="true" />
            <div>
              {doneLines(job).map((line) => (
                <p key={line}>{line}</p>
              ))}
              {run.message ? <p>{run.message}</p> : null}
            </div>
          </div>
          <div className="cat-actions">
            {undoable ? (
              <button type="button" className="button" onClick={() => onUndo(job.jobId, job.label, job.changed || job.processed)}>
                <Undo2 size={16} aria-hidden="true" /> Poništi
              </button>
            ) : null}
            <button type="button" className="button button-dark" onClick={onClose}>
              Zatvori
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

type GroupsState = { loading: boolean; error: string };

function ProductsView({
  call,
  wide,
  groups,
  labels,
  groupsState,
  onReloadGroups,
  refreshKey,
  selection,
  setSelection,
  locked,
  onBulk,
  onEdit,
  rowPatches,
  onPatchShown,
}: {
  call: Call;
  wide: boolean;
  groups: TaxonomyNode[];
  labels: Labels;
  groupsState: GroupsState;
  onReloadGroups: () => void;
  refreshKey: number;
  selection: Selection;
  setSelection: (next: Selection) => void;
  locked: boolean;
  onBulk: OpenBulk;
  onEdit: (id: string) => void;
  rowPatches: ReadonlyMap<string, AdminProductRow>;
  onPatchShown: (shown: ReadonlyMap<string, AdminProductRow>) => void;
}) {
  const baseId = useId();
  const [draft, setDraft] = useState<FilterDraft>(EMPTY_DRAFT);
  const [applied, setApplied] = useState<CatalogFilter>(() => toFilter(EMPTY_DRAFT));
  const [offset, setOffset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<AdminSearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const pendingPageOffset = useRef<number | null>(null);
  const patchRef = useRef(rowPatches);
  useEffect(() => {
    patchRef.current = rowPatches;
  }, [rowPatches]);

  useEffect(() => {
    let cancelled = false;
    // Samo izmene sacuvane pre slanja ovog zahteva su u odgovoru; kasnije ostaju u mapi.
    const sentPatches = patchRef.current;
    setLoading(true);
    setError("");
    call<AdminSearchResult>(searchQuery(applied, offset))
      .then((value) => {
        if (cancelled) return;
        setResult(normalizeResult(value, offset));
        if (sentPatches.size > 0) onPatchShown(sentPatches);
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(messageOf(failure));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [call, applied, offset, refreshKey, reloadKey, onPatchShown]);

  useLayoutEffect(() => {
    if (loading || error || !result || pendingPageOffset.current !== result.offset) return;
    pendingPageOffset.current = null;
    listRef.current?.focus({ preventScroll: true });
    listRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [loading, error, result]);

  // Admin 03.11: filter vazi tek na Trazi/Enter ili promenu filtera; izbor se tada brise.
  const apply = (next: FilterDraft) => {
    pendingPageOffset.current = null;
    setDraft(next);
    setApplied(toFilter(next));
    setOffset(0);
    setReloadKey((key) => key + 1);
    setSelection({ mode: "ids", items: [] });
  };

  const status = applied.status ?? "active";
  const pageSize = CATALOG_LIMITS.pageSize;
  const items = (result?.items ?? []).map((item) => rowPatches.get(item.id) ?? item);
  const allMode = selection.mode === "filter";
  const picked = new Set(selection.mode === "ids" ? selection.items.map((item) => item.id) : []);
  const pageSelected = items.length > 0 && (allMode || items.every((item) => picked.has(item.id)));
  const selectedCount = selection.mode === "ids" ? selection.items.length : selection.total;
  const total = result?.total ?? 0;
  const capped = Boolean(result?.totalCapped);
  const tooMany = capped || total > CATALOG_LIMITS.maxJob;
  const page = Math.floor(offset / pageSize) + 1;
  const pages = result && !capped ? Math.max(1, Math.ceil(total / pageSize)) : null;
  const hasNext = result
    ? capped
      ? items.length === pageSize && offset + pageSize <= CATALOG_LIMITS.maxJob
      : offset + pageSize < total
    : false;
  const goToOffset = (next: number) => {
    pendingPageOffset.current = next;
    setOffset(next);
  };
  const pager = (position: "na vrhu" | "na dnu") => (
    <nav className="cat-pager" aria-label={`Strane proizvoda ${position}`}>
      <button
        type="button"
        className="button"
        disabled={offset === 0 || loading}
        onClick={() => goToOffset(offset - pageSize)}
      >
        <ChevronLeft size={16} aria-hidden="true" /> Prethodna
      </button>
      <span aria-current="page">{pages ? `Strana ${page} od ${pages}` : `Strana ${page}`}</span>
      <button
        type="button"
        className="button"
        disabled={!hasNext || loading}
        onClick={() => goToOffset(offset + pageSize)}
      >
        Sledeća <ChevronRight size={16} aria-hidden="true" />
      </button>
    </nav>
  );
  const activeFilters =
    (draft.category ? 1 : 0) + (draft.supplier ? 1 : 0) + (draft.status !== "active" ? 1 : 0) + (draft.edited ? 1 : 0);
  const currentGroup = groups.find((group) => group.slug === draft.category);
  const lockId = `${baseId}-lock`;
  const capId = `${baseId}-cap`;

  const toggle = (item: AdminProductRow) => {
    if (selection.mode !== "ids") return;
    if (picked.has(item.id)) {
      setSelection({ mode: "ids", items: selection.items.filter((entry) => entry.id !== item.id) });
    } else if (selection.items.length < CATALOG_LIMITS.maxJob) {
      setSelection({ mode: "ids", items: [...selection.items, { id: item.id, name: item.name }] });
    }
  };

  const togglePage = (checked: boolean) => {
    if (selection.mode !== "ids") return;
    if (checked) {
      const added = items.filter((item) => !picked.has(item.id)).map((item) => ({ id: item.id, name: item.name }));
      setSelection({ mode: "ids", items: [...selection.items, ...added].slice(0, CATALOG_LIMITS.maxJob) });
    } else {
      const remove = new Set(items.map((item) => item.id));
      setSelection({ mode: "ids", items: selection.items.filter((entry) => !remove.has(entry.id)) });
    }
  };

  const target = (): JobTarget =>
    selection.mode === "ids"
      ? {
          mode: "ids",
          ids: selection.items.map((item) => item.id),
          samples: selection.items.slice(0, 3).map((item) => item.name),
        }
      : {
          mode: "filter",
          filter: selection.filter,
          total: selection.total,
          samples: items.slice(0, 3).map((item) => item.name),
        };

  const groupSum = groups.reduce((sum, group) => sum + toCount(group.count), 0);
  const treeItem = (key: string, label: string, count: number, current: boolean, onClick: () => void, sub = false) => (
    <li key={key}>
      <button
        type="button"
        className={`cat-tree-item${sub ? " is-sub" : ""}${current ? " is-current" : ""}`}
        aria-current={current ? "true" : undefined}
        onClick={onClick}
      >
        <span>{label}</span>
        <span className="cat-count">{formatCount(toCount(count))}</span>
      </button>
    </li>
  );

  const tree = (
    <nav className="cat-tree-wrap" aria-label="Grupe">
      {groupsState.error ? (
        <Banner
          tone="error"
          actions={
            <button type="button" className="button cat-small" onClick={onReloadGroups}>
              <RefreshCw size={14} aria-hidden="true" /> Pokušajte ponovo
            </button>
          }
        >
          {groupsState.error}
        </Banner>
      ) : null}
      <ul className="cat-tree">
        {treeItem("all", "Sve grupe", groupSum, !applied.category, () => apply({ ...draft, category: "", subcategory: "" }))}
        {groups.map((group) => (
          <li key={group.slug} className="cat-tree-group">
            <ul>
              {treeItem(
                group.slug,
                `${group.label}${group.hidden ? " (sakrivena)" : ""}`,
                group.count,
                applied.category === group.slug && !applied.subcategory,
                () => apply({ ...draft, category: group.slug, subcategory: "" }),
              )}
              {applied.category === group.slug
                ? group.children.map((child) =>
                    treeItem(
                      `${group.slug}/${child.slug}`,
                      `${child.label}${child.hidden ? " (sakrivena)" : ""}`,
                      child.count,
                      applied.subcategory === child.slug,
                      () => apply({ ...draft, category: group.slug, subcategory: child.slug }),
                      true,
                    ),
                  )
                : null}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );

  const filters = (
    <div className="cat-filters">
      {!wide ? (
        <>
          <div className="cat-field">
            <label htmlFor={`${baseId}-group`}>Grupa</label>
            <select
              id={`${baseId}-group`}
              className="field"
              value={draft.category}
              onChange={(event) => apply({ ...draft, category: event.target.value, subcategory: "" })}
            >
              <option value="">Sve grupe</option>
              {groups.map((group) => (
                <option key={group.slug} value={group.slug}>
                  {group.label}
                  {group.hidden ? " (sakrivena)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="cat-field">
            <label htmlFor={`${baseId}-sub`}>Podgrupa</label>
            <select
              id={`${baseId}-sub`}
              className="field"
              value={draft.subcategory}
              disabled={!draft.category}
              onChange={(event) => apply({ ...draft, subcategory: event.target.value })}
            >
              <option value="">Sve podgrupe</option>
              {(currentGroup?.children ?? []).map((child) => (
                <option key={child.slug} value={child.slug}>
                  {child.label}
                  {child.hidden ? " (sakrivena)" : ""}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : null}
      <div className="cat-field">
        <label htmlFor={`${baseId}-supplier`}>Dobavljač</label>
        <select
          id={`${baseId}-supplier`}
          className="field"
          value={draft.supplier}
          onChange={(event) => apply({ ...draft, supplier: event.target.value })}
        >
          <option value="">Svi dobavljači</option>
          {SUPPLIERS.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </div>
      <div className="cat-field">
        <label htmlFor={`${baseId}-status`}>Status</label>
        <select
          id={`${baseId}-status`}
          className="field"
          value={draft.status}
          onChange={(event) => apply({ ...draft, status: event.target.value as CatalogStatus })}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <label className="cat-check">
        <input type="checkbox" checked={draft.edited} onChange={(event) => apply({ ...draft, edited: event.target.checked })} />
        <span>Samo ručno izmenjeni</span>
      </label>
    </div>
  );

  const search = (
    <form
      className="cat-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        apply(draft);
      }}
    >
      <label htmlFor={`${baseId}-q`}>Naziv, šifra ili ID proizvoda</label>
      <div className="cat-search-row">
        <input
          id={`${baseId}-q`}
          className="field"
          type="search"
          value={draft.q}
          maxLength={100}
          autoComplete="off"
          aria-describedby={`${baseId}-q-help`}
          onChange={(event) => setDraft({ ...draft, q: event.target.value })}
        />
        <button type="submit" className="button button-dark">
          <Search size={16} aria-hidden="true" /> Traži
        </button>
      </div>
      <p id={`${baseId}-q-help`} className="cat-help">
        {SEARCH_HELP}
      </p>
    </form>
  );

  let list: ReactNode;
  if (error) {
    list = (
      <Banner
        tone="error"
        actions={
          <button type="button" className="button" onClick={() => setReloadKey((key) => key + 1)}>
            <RefreshCw size={16} aria-hidden="true" /> Pokušajte ponovo
          </button>
        }
      >
        {error}
      </Banner>
    );
  } else if (!result) {
    list = (
      <p className="cat-loading" aria-busy="true">
        <LoaderCircle className="cat-spin" size={18} aria-hidden="true" /> Učitavanje proizvoda…
      </p>
    );
  } else if (!items.length) {
    list = (
      <>
        {page > 1 && pager("na vrhu")}
        <div className="cat-empty" role="status">
          <p>Nema proizvoda za ovu pretragu.</p>
          <p className="cat-help">Proverite filtere ili pretražite drugi naziv.</p>
          <button type="button" className="button" onClick={() => apply(EMPTY_DRAFT)}>
            <X size={16} aria-hidden="true" /> Poništi filtere
          </button>
        </div>
      </>
    );
  } else {
    list = (
      <>
        <div className="cat-list-head">
          <p className="cat-total" role="status">
            {capped ? OVER_CAP_TEXT : productCount(total)}
            {loading ? " · učitavanje…" : ""}
          </p>
          <label className="cat-check">
            <input
              type="checkbox"
              checked={pageSelected}
              disabled={allMode}
              onChange={(event) => togglePage(event.target.checked)}
            />
            <span>Izaberi ovu stranu ({formatCount(items.length)})</span>
          </label>
        </div>
        {selectedCount > 0 ? (
          <div className="cat-selectbar" role="status">
            {allMode ? (
              <p>Izabrano je svih {productCount(selectedCount)} koji odgovaraju pretrazi.</p>
            ) : (
              <p>
                {pageSelected && selectedCount === items.length
                  ? `Izabrano je ${productCount(selectedCount)} sa ove strane.`
                  : `Izabrano je ${productCount(selectedCount)}.`}
              </p>
            )}
            {!allMode && pageSelected && total > items.length ? (
              tooMany ? (
                <>
                  <button type="button" className="button cat-small" disabled aria-describedby={capId}>
                    Izaberi sve koji odgovaraju pretrazi
                  </button>
                  <p id={capId} className="cat-help">
                    {CAP_TEXT}
                  </p>
                </>
              ) : (
                <button
                  type="button"
                  className="button cat-small"
                  onClick={() => setSelection({ mode: "filter", filter: applied, total })}
                >
                  Izaberi svih {formatCount(total)} koji odgovaraju pretrazi
                </button>
              )
            ) : null}
          </div>
        ) : null}
        {(page > 1 || hasNext) && pager("na vrhu")}
        <ul className={`cat-cards${loading ? " is-loading" : ""}`} aria-busy={loading}>
          {items.map((item) => {
            const checked = allMode || picked.has(item.id);
            const meta = [
              item.category ? labels.path(item.category, item.subcategory) : "",
              supplierMark(item.supplier),
              item.supplierSku ? `šifra ${item.supplierSku}` : `ID ${item.id}`,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={item.id} className={`cat-card${checked ? " is-selected" : ""}`}>
                <label className="cat-card-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={allMode}
                    aria-label={`Izaberi: ${item.name}`}
                    onChange={() => toggle(item)}
                  />
                </label>
                {item.image ? (
                  <img className="cat-thumb" src={item.image} alt="" width={48} height={48} loading="lazy" decoding="async" />
                ) : (
                  <span className="cat-thumb is-empty" aria-hidden="true">
                    <Package size={20} />
                  </span>
                )}
                <div className="cat-card-body">
                  <button type="button" className="cat-card-name" onClick={() => onEdit(item.id)}>
                    {item.name}
                  </button>
                  <p className="cat-card-meta">{meta}</p>
                  {item.edited || item.deleted || !item.active ? (
                    <p className="cat-badges">
                      {item.edited ? <span className="cat-badge is-edited">Izmenjen ručno</span> : null}
                      {item.deleted ? <span className="cat-badge is-danger">Obrisan</span> : null}
                      {!item.active && !item.deleted ? <span className="cat-badge">Nije u prodavnici</span> : null}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="cat-icon-button"
                  aria-label={`Uredi: ${item.name}`}
                  onClick={() => onEdit(item.id)}
                >
                  <Pencil size={18} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
        {pager("na dnu")}
      </>
    );
  }

  return (
    <div className={`cat-products${wide ? " is-wide" : ""}`}>
      {wide ? tree : null}
      <div className="cat-main">
        {search}
        {wide ? (
          filters
        ) : (
          <details className="cat-more">
            <summary>Filteri{activeFilters ? ` (${activeFilters})` : ""}</summary>
            {filters}
          </details>
        )}
        <div className="cat-product-list" ref={listRef} tabIndex={-1}>
          {list}
        </div>
        {selectedCount > 0 ? (
          <div className="cat-actionbar" role="region" aria-label="Izabrani proizvodi">
            <p className="cat-actionbar-count">Izabrano: {formatCount(selectedCount)}</p>
            <div className="cat-actions">
              {status !== "deleted" ? (
                <>
                  <button
                    type="button"
                    className="button button-dark"
                    disabled={locked}
                    aria-describedby={locked ? lockId : undefined}
                    onClick={() => onBulk("move", target())}
                  >
                    <ArrowRightLeft size={16} aria-hidden="true" /> Premesti
                  </button>
                  <button
                    type="button"
                    className="button cat-button-danger"
                    disabled={locked}
                    aria-describedby={locked ? lockId : undefined}
                    onClick={() => onBulk("delete", target())}
                  >
                    <Trash2 size={16} aria-hidden="true" /> Obriši
                  </button>
                </>
              ) : null}
              {status === "deleted" || status === "all" ? (
                <button
                  type="button"
                  className="button"
                  disabled={locked}
                  aria-describedby={locked ? lockId : undefined}
                  onClick={() => onBulk("restore", target())}
                >
                  <ArchiveRestore size={16} aria-hidden="true" /> Vrati u prodavnicu
                </button>
              ) : null}
              {applied.edited ? (
                <button
                  type="button"
                  className="button"
                  disabled={locked}
                  aria-describedby={locked ? lockId : undefined}
                  onClick={() => onBulk("revert", target())}
                >
                  <RotateCcw size={16} aria-hidden="true" /> Vrati na originalno
                </button>
              ) : null}
              <button type="button" className="button" onClick={() => setSelection({ mode: "ids", items: [] })}>
                <X size={16} aria-hidden="true" /> Poništi izbor
              </button>
            </div>
            {locked ? (
              <p id={lockId} className="cat-help">
                {LOCK_TEXT}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type EditorMessage = { tone: Tone; text: string; action?: "refresh" | "restore" };

function productHref(slug: string) {
  return `/proizvod/${slug.split("/").map(encodeURIComponent).join("/")}`;
}

function OverrideNote({ original, disabled, onRevert }: { original: string; disabled: boolean; onRevert: () => void }) {
  return (
    <div className="cat-override">
      <span className="cat-badge is-edited">Izmenjeno ručno</span>
      <p>Originalno: {original}</p>
      <button type="button" className="button cat-small" disabled={disabled} onClick={onRevert}>
        <RotateCcw size={14} aria-hidden="true" /> Vrati na originalno
      </button>
    </div>
  );
}

function ProductEditor({
  id,
  call,
  groups,
  labels,
  refreshKey,
  locked,
  onClose,
  onSaved,
  onBulk,
}: {
  id: string;
  call: Call;
  groups: TaxonomyNode[];
  labels: Labels;
  refreshKey: number;
  locked: boolean;
  onClose: () => void;
  onSaved: (product: AdminProductDetail, moved: boolean) => void;
  onBulk: OpenBulk;
}) {
  const baseId = useId();
  const [detail, setDetail] = useState<AdminProductDetail | null>(null);
  const [form, setForm] = useState<EditorForm | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<EditorMessage | null>(null);
  const patch: ProductPatch = detail && form ? buildPatch(detail, form) : {};
  const dirty = Object.keys(patch).length > 0;
  const dirtyRef = useRef(false);

  useEffect(() => {
    dirtyRef.current = dirty;
  });

  const load = useCallback(
    async (force: boolean) => {
      // Admin 03.11: nesacuvane izmene se ne gaze automatskim osvezavanjem.
      if (dirtyRef.current && !force) return;
      setLoadError("");
      try {
        const value = await call<AdminProductDetail>(new URLSearchParams({ view: "product", id }).toString());
        const product = unwrapProduct(value);
        if (!product) throw new ApiFailure(GENERIC_ERROR, 500);
        setDetail(product);
        setForm(formOf(product));
        if (force) setMessage(null);
      } catch (failure) {
        setLoadError(messageOf(failure));
      }
    },
    [call, id],
  );

  useEffect(() => {
    void load(false);
  }, [load, refreshKey]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const send = async (body: ProductPatch, okText: string, field?: EditorField) => {
    if (!detail) return;
    setSaving(true);
    setMessage(null);
    try {
      const value = await call<EditProductResult>({
        action: "edit_product",
        jobId: newJobId(),
        id: detail.id,
        version: detail.version,
        patch: body,
      });
      const product = unwrapProduct(value);
      if (!product) throw new ApiFailure(GENERIC_ERROR, 500);
      const moved = product.category !== detail.category || product.subcategory !== detail.subcategory;
      setDetail(product);
      setForm((current) => {
        const fresh = formOf(product);
        if (!field || !current) return fresh;
        if (field === "location") return { ...current, category: fresh.category, subcategory: fresh.subcategory };
        const next = { ...current };
        next[field] = fresh[field];
        return next;
      });
      setMessage({ tone: "success", text: okText });
      onSaved(product, moved);
    } catch (failure) {
      const code = codeOf(failure);
      if (code === "VERSION_CONFLICT") setMessage({ tone: "error", text: CONFLICT_TEXT, action: "refresh" });
      else if (code === "PRODUCT_DELETED") setMessage({ tone: "error", text: messageOf(failure), action: "restore" });
      else setMessage({ tone: "error", text: messageOf(failure) });
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (dirty && !window.confirm("Imate nesačuvane izmene. Da li želite da ih odbacite?")) return;
    onClose();
  };

  const revertField = (field: EditorField) => {
    if (!window.confirm("Vratiti originalnu vrednost dobavljača? Ručna izmena ovog polja se briše.")) return;
    const body: ProductPatch = {};
    body[field] = null;
    void send(body, "Vraćeno je originalno.", field);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form || !detail || !dirty || saving) return;
    const problem = patchError(form);
    if (problem) {
      setMessage({ tone: "error", text: problem });
      return;
    }
    void send(patch, "Izmene su sačuvane.");
  };

  const bulkOne = (op: BulkOp) => {
    if (!detail) return;
    onBulk(op, { mode: "ids", ids: [detail.id], samples: [detail.name] });
  };

  let content: ReactNode;
  if (!detail || !form) {
    content = loadError ? (
      <Banner
        tone="error"
        actions={
          <button type="button" className="button" onClick={() => void load(true)}>
            <RefreshCw size={16} aria-hidden="true" /> Pokušajte ponovo
          </button>
        }
      >
        {loadError}
      </Banner>
    ) : (
      <p className="cat-loading" aria-busy="true">
        <LoaderCircle className="cat-spin" size={18} aria-hidden="true" /> Učitavanje proizvoda…
      </p>
    );
  } else {
    const groupOptions = groups.filter((group) => !group.hidden || group.slug === form.category);
    const currentGroup = groups.find((group) => group.slug === form.category);
    const subOptions = (currentGroup?.children ?? []).filter((child) => !child.hidden || child.slug === form.subcategory);
    const missingGroup = form.category && !groupOptions.some((group) => group.slug === form.category);
    const missingSub = form.subcategory && !subOptions.some((child) => child.slug === form.subcategory);
    const shownName = form.name.trim() || detail.name;
    const browserTitle = `${cut(form.seoTitle.trim() || shownName, CATALOG_LIMITS.seoTitle)} | MOBITOK`;
    const originalPath =
      detail.original.category !== undefined
        ? labels.path(detail.original.category, detail.original.subcategory ?? "")
        : "nije zabeleženo";
    const lockId = `${baseId}-lock`;
    content = (
      <form className="cat-form cat-editor" onSubmit={submit} noValidate>
        <p className="cat-editor-meta">
          Izvor: {supplierName(detail.supplier)} · ID: {detail.id} · Poslednja izmena:{" "}
          {formatWhen(detail.updatedAt) || "nema podatka"}
        </p>
        {detail.deleted ? (
          <Banner
            tone="warning"
            actions={
              <button type="button" className="button" disabled={locked} onClick={() => bulkOne("restore")}>
                <ArchiveRestore size={16} aria-hidden="true" /> Vrati u prodavnicu
              </button>
            }
          >
            Proizvod je obrisan i nije u prodavnici. Ostaje u Kanti dok ga ne vratite.
          </Banner>
        ) : !detail.active ? (
          <Banner tone="info">Proizvod trenutno nije u prodavnici (dobavljač ili lager).</Banner>
        ) : null}
        <div className="cat-field">
          <label htmlFor={`${baseId}-name`}>Naziv</label>
          <input
            id={`${baseId}-name`}
            className="field"
            value={form.name}
            maxLength={CATALOG_LIMITS.name}
            aria-describedby={`${baseId}-name-help`}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
          <p id={`${baseId}-name-help`} className="cat-help">
            {NAME_HELP}
          </p>
          {detail.overridden.name ? (
            <OverrideNote
              original={detail.original.name || "nije zabeleženo"}
              disabled={saving}
              onRevert={() => revertField("name")}
            />
          ) : null}
        </div>
        <div className="cat-field">
          <label htmlFor={`${baseId}-seo`}>Naslov za pretraživače</label>
          <input
            id={`${baseId}-seo`}
            className="field"
            value={form.seoTitle}
            maxLength={CATALOG_LIMITS.seoTitle}
            aria-describedby={`${baseId}-seo-help`}
            onChange={(event) => setForm({ ...form, seoTitle: event.target.value })}
          />
          <p id={`${baseId}-seo-help`} className="cat-help">
            {SEO_HELP} {formatCount(form.seoTitle.length)} / {formatCount(CATALOG_LIMITS.seoTitle)}
          </p>
          {detail.overridden.seoTitle ? (
            <OverrideNote
              original="bez posebnog naslova (koristi se naziv)"
              disabled={saving}
              onRevert={() => revertField("seoTitle")}
            />
          ) : null}
        </div>
        <div className="cat-field">
          <label htmlFor={`${baseId}-description`}>Opis</label>
          <textarea
            id={`${baseId}-description`}
            className="field"
            rows={7}
            value={form.description}
            maxLength={CATALOG_LIMITS.description}
            aria-describedby={`${baseId}-description-help`}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
          <p id={`${baseId}-description-help`} className="cat-help">
            {formatCount(form.description.length)} / {formatCount(CATALOG_LIMITS.description)}
          </p>
          {detail.overridden.description ? (
            <OverrideNote
              original={cut(detail.original.description || "bez opisa", 300)}
              disabled={saving}
              onRevert={() => revertField("description")}
            />
          ) : null}
        </div>
        <div className="cat-field-row">
          <div className="cat-field">
            <label htmlFor={`${baseId}-group`}>Grupa</label>
            <select
              id={`${baseId}-group`}
              className="field"
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value, subcategory: "" })}
            >
              {missingGroup ? <option value={form.category}>{labels.group(form.category)}</option> : null}
              {groupOptions.map((group) => (
                <option key={group.slug} value={group.slug}>
                  {group.label}
                </option>
              ))}
            </select>
          </div>
          <div className="cat-field">
            <label htmlFor={`${baseId}-sub`}>Podgrupa</label>
            <select
              id={`${baseId}-sub`}
              className="field"
              value={form.subcategory}
              onChange={(event) => setForm({ ...form, subcategory: event.target.value })}
            >
              <option value="">Bez podgrupe</option>
              {missingSub ? <option value={form.subcategory}>{labels.sub(form.category, form.subcategory)}</option> : null}
              {subOptions.map((child) => (
                <option key={child.slug} value={child.slug}>
                  {child.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {detail.overridden.location ? (
          <OverrideNote original={originalPath} disabled={saving} onRevert={() => revertField("location")} />
        ) : null}
        <p className="cat-help">{OVERRIDE_NOTE}</p>
        <section className="cat-preview" aria-labelledby={`${baseId}-preview`}>
          <h3 id={`${baseId}-preview`}>Pregled (približan)</h3>
          <div className="cat-preview-card">
            {detail.image ? (
              <img className="cat-thumb" src={detail.image} alt="" width={48} height={48} loading="lazy" decoding="async" />
            ) : (
              <span className="cat-thumb is-empty" aria-hidden="true">
                <Package size={20} />
              </span>
            )}
            <div>
              <strong>{shownName}</strong>
              <span>{form.category ? labels.path(form.category, form.subcategory) : ""}</span>
            </div>
          </div>
          <p>Naslov u kartici pregledača: {browserTitle}</p>
          <p className="cat-preview-text">{cut(form.description.trim(), 160) || "Bez opisa."}</p>
          {detail.slug && !detail.deleted ? (
            <a className="cat-link" href={productHref(detail.slug)} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={16} aria-hidden="true" /> Otvori u prodavnici
            </a>
          ) : null}
        </section>
        {message ? (
          <Banner
            tone={message.tone}
            actions={
              message.action === "refresh" ? (
                <button type="button" className="button" onClick={() => void load(true)}>
                  <RefreshCw size={16} aria-hidden="true" /> Osveži
                </button>
              ) : message.action === "restore" ? (
                <button type="button" className="button" disabled={locked} onClick={() => bulkOne("restore")}>
                  <ArchiveRestore size={16} aria-hidden="true" /> Vrati u prodavnicu
                </button>
              ) : undefined
            }
          >
            {message.text}
          </Banner>
        ) : null}
        <div className="cat-actions">
          <button type="submit" className="button button-dark" disabled={!dirty || saving}>
            {saving ? "Čuvanje…" : "Sačuvaj izmene"}
          </button>
          <button type="button" className="button" onClick={close}>
            Otkaži
          </button>
          <button
            type="button"
            className="button cat-button-danger cat-push"
            disabled={locked || saving || detail.deleted}
            aria-describedby={locked ? lockId : undefined}
            onClick={() => bulkOne("delete")}
          >
            <Trash2 size={16} aria-hidden="true" /> Obriši proizvod
          </button>
        </div>
        {locked ? (
          <p id={lockId} className="cat-help">
            {LOCK_TEXT}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <Modal open title="Uređivanje proizvoda" wide onDismiss={close}>
      {content}
    </Modal>
  );
}

type TaxonomyBody = Omit<Extract<CatalogAction, { action: "taxonomy" }>, "action" | "jobId">;
type NodeFormDraft = { label: string; labelEn: string };
type NodeFormState =
  | { mode: "group"; revision: number }
  | { mode: "sub"; parent: string; revision: number }
  | { mode: "rename"; key: string; revision: number; draft: NodeFormDraft; saved: NodeFormDraft; nodeId: string | null; reviewRequired: boolean }
  | null;

function nodeKey(node: TaxonomyNode) {
  return `${node.kind}:${node.parent}/${node.slug}`;
}

function NodeForm({
  mode,
  initial = "",
  initialEn = "",
  draft,
  onDraftChange,
  busy,
  onSubmit,
  onCancel,
}: {
  mode: "group" | "sub" | "rename";
  initial?: string;
  initialEn?: string;
  draft?: NodeFormDraft;
  onDraftChange?: (draft: NodeFormDraft) => void;
  busy: boolean;
  onSubmit: (label: string, labelEn: string) => void;
  onCancel: () => void;
}) {
  const baseId = useId();
  const [localLabel, setLabel] = useState(initial);
  const [localLabelEn, setLabelEn] = useState(initialEn);
  const label = draft?.label ?? localLabel;
  const labelEn = draft?.labelEn ?? localLabelEn;
  const [error, setError] = useState("");
  const title = mode === "group" ? "Naziv nove grupe" : mode === "sub" ? "Naziv nove podgrupe" : "Novi naziv";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const clean = label.trim();
    if (!clean) {
      setError("Upišite naziv.");
      return;
    }
    setError("");
    onSubmit(clean, labelEn.trim());
  };
  return (
    <form className="cat-node-form" onSubmit={submit} noValidate>
      <div className="cat-field">
        <label htmlFor={`${baseId}-sr`}>{title}</label>
        <input
          id={`${baseId}-sr`}
          className="field"
          value={label}
          maxLength={CATALOG_LIMITS.label}
          autoComplete="off"
          autoFocus
          onChange={(event) => {
            if (onDraftChange) onDraftChange({ label: event.target.value, labelEn });
            else setLabel(event.target.value);
          }}
        />
      </div>
      <div className="cat-field">
        <label htmlFor={`${baseId}-en`}>Naziv na engleskom (nije obavezno)</label>
        <input
          id={`${baseId}-en`}
          className="field"
          value={labelEn}
          maxLength={CATALOG_LIMITS.label}
          autoComplete="off"
          onChange={(event) => {
            if (onDraftChange) onDraftChange({ label, labelEn: event.target.value });
            else setLabelEn(event.target.value);
          }}
        />
      </div>
      <p className="cat-help">{SLUG_HELP}</p>
      {error ? (
        <p className="cat-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="cat-actions">
        <button type="submit" className="button button-dark" disabled={busy}>
          {mode === "rename" ? "Sačuvaj naziv" : "Napravi"}
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Otkaži
        </button>
      </div>
    </form>
  );
}


type SubgroupMove = { id: string; parent: string; label: string };

/** Structural changes use one atomic RPC and a stable subgroup identifier. */
function SubcategoryLayoutControls({ call, groups, layout, locked, onChanged, onReload, moving, onMove }: {
  call: Call; groups: TaxonomyNode[]; layout: CatalogLayout | null; locked: boolean;
  onChanged: () => void; onReload: () => void;
  moving: SubgroupMove | null; onMove: (move: SubgroupMove | null) => void;
}) {
  const baseId = useId();
  const [category, setCategory] = useState("");
  const [positionedId, setPositionedId] = useState("");
  const [draft, setDraft] = useState<string[]>([]);
  const [destination, setDestination] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Notice | null>(null);
  const pending = useRef<{ key: string; action: CatalogLayoutAction } | null>(null);
  const siblings = useMemo(() => (layout?.nodes ?? []).filter((node) => node.live && node.parent === category)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)), [layout, category]);
  const idsKey = siblings.map((node) => node.id).join("|");
  useEffect(() => { setDraft(idsKey ? idsKey.split("|") : []); }, [idsKey, layout?.revision]);
  const ordered = draft.length === siblings.length && draft.every((id) => siblings.some((node) => node.id === id))
    ? draft.map((id) => siblings.find((node) => node.id === id)!) : siblings;
  const positionedIndex = ordered.findIndex((node) => node.id === positionedId);
  const group = groups.find((node) => node.slug === category);
  const label = (id: string) => { const node = layout?.nodes.find((row) => row.id === id);
    return group?.children.find((child) => child.slug === node?.slug)?.label ?? node?.slug ?? ""; };
  const movingNode = moving ? layout?.nodes.find(node => node.id === moving.id && node.live) : null;
  const moveTargetUnchanged = Boolean(moving && movingNode?.parent === moving.parent);
  const available = Boolean(layout) && !locked && !busy;

  useEffect(() => {
    if (!moving) return;
    setDestination("");
    setConfirm("");
    setMessage(null);
  }, [moving]);
  const dirty = ordered.some((node, index) => node.id !== siblings[index]?.id);
  const send = async (body: Omit<Extract<CatalogLayoutAction, { action: "taxonomy_reorder" }>, "jobId"> | Omit<Extract<CatalogLayoutAction, { action: "taxonomy_move_subcategory" }>, "jobId">) => {
    if (!available) return;
    const key = JSON.stringify(body);
    const action = pending.current?.key === key ? pending.current.action : { ...body, jobId: newJobId() };
    pending.current = { key, action };
    setBusy(true);setMessage(null);
    try {
      const acquired = await withCatalogJobLock(async () => {
        const stored = peekStoredJob();
        if (!stored.ok || stored.job) throw new Error(LOCK_TEXT);
        const result = await call<CatalogLayoutResult>(action);
        pending.current = null;
        if (result.changed > 0) notifyCatalogChanged();
        onMove(null);setConfirm("");
        setMessage({ tone: "success", text: action.action === "taxonomy_reorder" ? "Redosled podgrupa je sačuvan u adminu i prodavnici."
          : "Cela podgrupa je premeštena. Novi artikli dobavljača pratiće novu grupu; stare adrese ostaju upotrebljive." });
        onChanged();
      });
      if (!acquired) throw new Error("Drugi prozor trenutno menja katalog. Pokušajte ponovo kada završi.");
    } catch (error) {
      setMessage({ tone: "error", text: messageOf(error) });
      if (codeOf(error) === "TAXONOMY_VERSION_CONFLICT") onReload();
    } finally { setBusy(false); }
  };
  const moveToPosition = (index: number, position: number) => {
    if (!available || index < 0 || position < 0 || position >= ordered.length || index === position) return;
    const next = ordered.map((node) => node.id);
    const [id] = next.splice(index, 1);
    next.splice(position, 0, id);
    setDraft(next);
  };
  return <section className="cat-group" aria-label="Redosled i premeštanje podgrupa">
    <h3>Redosled i premeštanje podgrupa</h3>
    <p className="account-hint">Izaberite grupu. Promena redosleda važi i u meniju prodavnice. Premeštanje cele podgrupe važi za sadašnje i buduće artikle svih dobavljača.</p>
    <div className="cat-field"><label htmlFor={`${baseId}-layout-group`}>Grupa za uređivanje podgrupa</label>
      <select id={`${baseId}-layout-group`} className="field" value={category} disabled={busy || locked} onChange={(event) => { setCategory(event.target.value); setPositionedId(""); setMessage(null); }}>
        <option value="">Izaberite grupu</option>{groups.filter((node) => !node.hidden).map((node) => <option key={node.slug} value={node.slug}>{node.label}</option>)}
      </select>
    </div>
    {!layout && !locked ? <p className="cat-help">Osvežite grupe da učitate mogućnosti premeštanja i redosleda.</p> : null}
    {category && layout ? <>
      {ordered.length > 1 && <div className="cat-field-row">
        <div className="cat-field">
          <label htmlFor={baseId + "-layout-positioned"}>Podgrupa za promenu pozicije</label>
          <select id={baseId + "-layout-positioned"} className="field" value={positionedIndex < 0 ? "" : positionedId} disabled={!available}
            onChange={(event) => setPositionedId(event.target.value)}>
            <option value="">Izaberite podgrupu</option>
            {ordered.map((node) => <option key={node.id} value={node.id}>{label(node.id)}</option>)}
          </select>
        </div>
        <div className="cat-field">
          <label htmlFor={baseId + "-layout-position"}>Pozicija podgrupe</label>
          <select id={baseId + "-layout-position"} className="field" value={positionedIndex < 0 ? "" : positionedIndex + 1}
            disabled={!available || positionedIndex < 0}
            onChange={(event) => moveToPosition(positionedIndex, Number(event.target.value) - 1)}>
            <option value="" disabled>Izaberite poziciju</option>
            {Array.from({ length: ordered.length }, (_, index) => {
              const position = index + 1;
              return <option key={position} value={position}>{position}</option>;
            })}
          </select>
        </div>
      </div>}
      <ol className="cat-sub-list" aria-label="Redosled podgrupa">
        {ordered.map((node, index) => <li key={node.id} className="cat-node"><div className="cat-node-main"><p className="cat-node-name">{label(node.id)}</p></div>
          <div className="cat-node-actions">
            <button type="button" className="button cat-small" aria-label={`Pomeri naviše: ${label(node.id)}`} disabled={!available || index === 0} onClick={() => moveToPosition(index, index - 1)}>↑ Naviše</button>
            <button type="button" className="button cat-small" aria-label={`Pomeri naniže: ${label(node.id)}`} disabled={!available || index === ordered.length - 1} onClick={() => moveToPosition(index, index + 1)}>↓ Naniže</button>
            <button type="button" className="button cat-small" aria-label={`Premesti celu podgrupu: ${label(node.id)}`} disabled={!available || dirty} onClick={() => onMove({ id: node.id, parent: node.parent, label: label(node.id) })}>Premesti u drugu grupu</button>
          </div></li>)}
      </ol>
      {!ordered.length ? <p className="cat-help">Ova grupa nema podgrupe.</p> : null}
      <div className="cat-actions"><button type="button" className="button button-dark" disabled={!available || !dirty} onClick={() => layout && void send({ action: "taxonomy_reorder", category, orderedIds: ordered.map((node) => node.id), revision: layout.revision })}>{busy ? "Čuvanje…" : "Sačuvaj redosled"}</button>
        <button type="button" className="button" disabled={busy || !dirty} onClick={() => setDraft(siblings.map((node) => node.id))}>Poništi redosled</button></div>
    </> : null}
    {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
    <Modal open={Boolean(moving)} title="Premesti celu podgrupu" locked={busy} onDismiss={() => !busy && onMove(null)}>
      {moving ? <form onSubmit={(event) => {
        event.preventDefault();
        if (layout && moveTargetUnchanged && destination && confirm.trim().toUpperCase() === "PREMESTI") {
          void send({ action: "taxonomy_move_subcategory", nodeId: moving.id, toCategory: destination, revision: layout.revision });
        }
      }}>
        <p><strong>{groups.find(node => node.slug === moving.parent)?.label ?? moving.parent} › {moving.label}</strong></p>
        <p>Premestiće se cela podgrupa sa svim sadašnjim artiklima, uključujući neaktivne i obrisane. Zalihe i cene ostaju sačuvane; sakriveni i obrisani artikli se ne vraćaju u prodavnicu. Budući artikli dobavljača iz ove podgrupe dolaziće u novu grupu. Pojedinačno ručno premešteni artikli izvan ove podgrupe ostaju gde jesu.</p>
        <div className="cat-field">
          <label htmlFor={baseId + "-layout-destination"}>Nova grupa</label>
          <select id={baseId + "-layout-destination"} className="field" value={destination} disabled={busy || !moveTargetUnchanged}
            onChange={event => setDestination(event.target.value)}>
            <option value="">Izaberite novu grupu</option>
            {groups.filter(node => !node.hidden && node.slug !== moving.parent).map(node =>
              <option key={node.slug} value={node.slug}>{node.label}</option>
            )}
          </select>
        </div>
        <div className="cat-field">
          <label htmlFor={baseId + "-layout-confirm"}>Upišite PREMESTI za potvrdu</label>
          <input id={baseId + "-layout-confirm"} className="field" value={confirm} disabled={busy || !moveTargetUnchanged}
            autoComplete="off" onChange={event => setConfirm(event.target.value)} />
        </div>
        {!moveTargetUnchanged && <Banner tone="warning">Položaj podgrupe se promenio. Zatvorite ovaj prozor i otvorite premeštanje iz aktuelne grupe.</Banner>}
        {message?.tone === "error" && <Banner tone="error">{message.text}</Banner>}
        <div className="cat-actions">
          <button type="submit" className="button button-dark" disabled={!available || !moveTargetUnchanged || !destination || confirm.trim().toUpperCase() !== "PREMESTI"}>
            {busy ? "Premeštanje…" : "Premesti celu podgrupu"}
          </button>
          <button type="button" className="button" disabled={busy} onClick={() => onMove(null)}>Otkaži</button>
        </div>
      </form> : null}
    </Modal>
  </section>;
}

function GroupsView({
  call,
  groups,
  state,
  layout,
  locked,
  onReload,
  onChanged,
}: {
  call: Call;
  groups: TaxonomyNode[];
  state: GroupsState;
  layout: CatalogLayout | null;
  locked: boolean;
  onReload: () => void;
  onChanged: () => void;
}) {
  const [form, setForm] = useState<NodeFormState>(null);
  const [movingSubgroup, setMovingSubgroup] = useState<SubgroupMove | null>(null);
  const [confirmKey, setConfirmKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Notice | null>(null);
  const confirmRevision = useRef<number | null>(null);
  const pending = useRef<{ key: string; action: Extract<CatalogAction, { action: "taxonomy" }> } | null>(null);
  const available = Boolean(layout) && !busy && !state.loading && !state.error;
  const renameKey = form?.mode === "rename" ? form.key : null;
  const renameTargetPresent = !renameKey || groups.some((group) =>
    nodeKey(group) === renameKey || group.children.some((child) => nodeKey(child) === renameKey));
  const updateRenameDraft = (draft: NodeFormDraft) => {
    setForm((current) => current?.mode === "rename" ? { ...current, draft } : current);
  };

  const layoutNodeId = (node: TaxonomyNode) => node.kind === "sub"
    ? layout?.nodes.find((item) => item.parent === node.parent && item.slug === node.slug)?.id ?? null
    : null;

  const send = async (body: TaxonomyBody, okText: (slug: string) => string, renameNode?: TaxonomyNode) => {
    if (!available || !layout) return;
    let revision = body.revision ?? layout.revision;
    const { revision: _revision, ...intent } = body;
    const key = JSON.stringify(intent);
    const retry = pending.current?.key === key ? pending.current.action : null;
    if (!retry && renameNode && form?.mode === "rename" && revision !== layout.revision) {
      // A refreshed view can advance for unrelated edits. Apply this draft to the
      // fresh revision only when the shown target and both saved labels still match.
      if (form.key !== nodeKey(renameNode) || form.nodeId !== layoutNodeId(renameNode) ||
        form.saved.label !== renameNode.label || form.saved.labelEn !== (renameNode.labelEn ?? "")) {
        setForm({ ...form, reviewRequired: true });
        return;
      }
      revision = layout.revision;
    }
    const action = retry ?? { action: "taxonomy" as const, jobId: newJobId(), ...body, revision };
    pending.current = { key, action };
    setBusy(true);
    setMessage(null);
    try {
      const result = await call<TaxonomySaveResult>(action);
      pending.current = null;
      const slug = isRecord(result) && typeof result.slug === "string" && result.slug ? result.slug : (body.slug ?? "");
      notifyCatalogChanged();
      setMessage({ tone: "success", text: okText(slug) });
      setForm(null);
      setConfirmKey("");
      onChanged();
    } catch (failure) {
      const code = codeOf(failure);
      const renamePending = body.op === "rename";
      const text = renamePending && ["CATALOG_BUSY", "CATALOG_UNAVAILABLE"].includes(code)
        ? "Nismo dobili potvrdu da je naziv sačuvan. Vaš tekst je ostao u obrascu. Sačekajte pa ponovite čuvanje."
        : messageOf(failure);
      setMessage({ tone: "error", text });
      if (code === "TAXONOMY_VERSION_CONFLICT") {
        pending.current = null;
        setForm((current) => current?.mode === "rename" ? { ...current, reviewRequired: true } : null);
        setConfirmKey("");
        onReload();
      }
    } finally {
      setBusy(false);
    }
  };

  const create = (kind: TaxonomyKind, parent: string, label: string, labelEn: string) => {
    const noun = kind === "group" ? "grupa" : "podgrupa";
    void send(
      { op: "create", kind, parent, label, revision: form?.revision, ...(labelEn ? { labelEn } : {}) },
      (slug) => `Napravljena je ${noun} „${label}“ (adresa: ${slug}).`,
    );
  };

  const renderNode = (node: TaxonomyNode) => {
    const key = nodeKey(node);
    const isGroup = node.kind === "group";
    const where = isGroup ? "grupi" : "podgrupi";
    const ref = { kind: node.kind, parent: node.parent, slug: node.slug };
    const position = !isGroup && layout?.nodes.find(item => item.live && item.parent === node.parent && item.slug === node.slug);
    const meta = [
      node.count > 0 ? productCount(node.count) : "Prazna",
      node.builtin ? "Ugrađena" : "",
      node.builtin && node.renamed && node.defaultLabel ? `Podrazumevano: ${node.defaultLabel}` : "",
      node.hidden ? "Sakrivena" : "",
      `adresa: ${node.slug}`,
    ].filter(Boolean);
    return (
      <div className={`cat-node${node.hidden ? " is-hidden" : ""}`}>
        <div className="cat-node-main">
          <p className="cat-node-name">{node.label}</p>
          <p className="cat-node-meta">{meta.join(" · ")}</p>
        </div>
        <div className="cat-node-actions">
          <button
            type="button"
            className="button cat-small"
            disabled={!available}
            aria-label={`Preimenuj: ${node.label}`}
            onClick={() => {
              const saved = { label: node.label, labelEn: node.labelEn ?? "" };
              setForm({ mode: "rename", key, revision: layout!.revision, draft: saved, saved, nodeId: layoutNodeId(node), reviewRequired: false });
              setConfirmKey("");
            }}
          >
            <Pencil size={14} aria-hidden="true" /> Preimenuj
          </button>
          {position && (
            <button type="button" className="button cat-small"
              disabled={!available || locked} aria-label={"Premesti podgrupu: " + node.label}
              onClick={() => setMovingSubgroup({ id: position.id, parent: position.parent, label: node.label })}>
              <ArrowRightLeft size={14} aria-hidden="true" /> Premesti
            </button>
          )}
          {node.builtin && node.renamed ? (
            <button
              type="button"
              className="button cat-small"
              disabled={!available}
              onClick={() =>
                void send(
                  { op: "remove", ...ref },
                  () => `Vraćen je podrazumevani naziv „${node.defaultLabel ?? node.slug}“.`,
                )
              }
            >
              <RotateCcw size={14} aria-hidden="true" /> Vrati podrazumevani naziv
            </button>
          ) : null}
          {!node.builtin ? (
            <button
              type="button"
              className="button cat-small"
              disabled={!available}
              onClick={() =>
                void send({ op: "hide", ...ref, hidden: !node.hidden }, () =>
                  node.hidden
                    ? `„${node.label}“ je ponovo vidljiva u prodavnici.`
                    : `„${node.label}“ je sakrivena iz prodavnice.`,
                )
              }
            >
              {node.hidden ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}{" "}
              {node.hidden ? "Prikaži" : "Sakrij"}
            </button>
          ) : null}
          {!node.builtin ? (
            <button
              type="button"
              className="button cat-small cat-button-danger"
              disabled={!available}
              onClick={() => {
                confirmRevision.current = layout!.revision;
                setConfirmKey(key);
                setForm(null);
              }}
            >
              <Trash2 size={14} aria-hidden="true" /> Ukloni
            </button>
          ) : null}
        </div>
        {confirmKey === key ? (
          node.count > 0 ? (
            <p className="cat-note" role="alert">
              U {where} ima {productCount(node.count)}. Prvo ih premestite.{" "}
              <button type="button" className="button cat-small" onClick={() => setConfirmKey("")}>
                U redu
              </button>
            </p>
          ) : (
            <div className="cat-confirm" role="group" aria-label={`Uklanjanje: ${node.label}`}>
              <p>Ukloniti „{node.label}“?</p>
              <div className="cat-actions">
                <button
                  type="button"
                  className="button cat-small cat-button-danger"
                  disabled={!available}
                  onClick={() =>
                    void send(
                      { op: "remove", ...ref, revision: confirmRevision.current ?? undefined },
                      () => `Uklonjena je ${isGroup ? "grupa" : "podgrupa"} „${node.label}“.`,
                    )
                  }
                >
                  Ukloni
                </button>
                <button type="button" className="button cat-small" onClick={() => setConfirmKey("")}>
                  Otkaži
                </button>
              </div>
            </div>
          )
        ) : null}
        {form?.mode === "rename" && form.key === key ? (
          <>
            {!available && !busy && !form.reviewRequired ? (
              <div className="cat-note" role="status">
                <p>{state.loading
                  ? "Učitavamo grupe. Čuvanje naziva će biti dostupno po završetku učitavanja."
                  : "Trenutno ne možemo da proverimo grupe. Tekst je ostao u obrascu. Ponovo učitajte grupe da biste sačuvali naziv."}</p>
                {!state.loading ? (
                  <button type="button" className="button cat-small" onClick={onReload}>
                    Ponovo učitaj grupe
                  </button>
                ) : null}
              </div>
            ) : null}
            {form.reviewRequired ? (
              <div className="cat-note" role="alert">
                <p>
                  {state.loading ? "Učitavamo trenutno sačuvan naziv." : state.error
                    ? "Trenutno sačuvan naziv nije učitan. Osvežite grupe da biste ga pregledali."
                    : <>Trenutno sačuvan naziv: <strong>{node.label}</strong>.
                      {node.labelEn || form.saved.labelEn ? <> Engleski naziv: <strong>{node.labelEn || "Nije unet"}</strong>.</> : null}</>}
                  {" "}Vaš nacrt je sačuvan ispod. Pregledajte novu verziju pre ponovnog čuvanja.
                </p>
                <button
                  type="button"
                  className="button cat-small"
                  disabled={!available}
                  onClick={() => {
                    if (!layout) return;
                    setForm((current) => current?.mode === "rename" && current.key === key
                      ? { ...current, revision: layout.revision, saved: { label: node.label, labelEn: node.labelEn ?? "" },
                        nodeId: layoutNodeId(node), reviewRequired: false } : current);
                  }}
                >
                  Pregledano, nastavi sa nacrtom
                </button>
              </div>
            ) : null}
            <NodeForm
              mode="rename"
              draft={form.draft}
              onDraftChange={updateRenameDraft}
              busy={!available || form.reviewRequired}
              onCancel={() => setForm(null)}
              onSubmit={(label, labelEn) =>
                void send({ op: "rename", ...ref, label, labelEn, revision: form.revision }, () => `Naziv je sačuvan: „${label}“.`, node)
              }
            />
          </>
        ) : null}
      </div>
    );
  };

  return (
    <div className="cat-groups">
      <p className="account-hint">
        {SLUG_HELP} {BUILTIN_HELP}
      </p>
      <SubcategoryLayoutControls call={call} groups={groups} layout={layout}
        locked={locked || busy || state.loading || Boolean(state.error)} onChanged={onChanged} onReload={onReload}
        moving={movingSubgroup} onMove={setMovingSubgroup} />
      {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
      {state.error ? (
        <Banner
          tone="error"
          actions={
            <button type="button" className="button" onClick={onReload}>
              <RefreshCw size={16} aria-hidden="true" /> Pokušajte ponovo
            </button>
          }
        >
          {state.error}
        </Banner>
      ) : null}
      {state.loading && !groups.length ? (
        <p className="cat-loading" aria-busy="true">
          <LoaderCircle className="cat-spin" size={18} aria-hidden="true" /> Učitavanje grupa…
        </p>
      ) : null}
      <div className="cat-actions">
        <button
          type="button"
          className="button button-dark"
          disabled={!available}
          onClick={() => {
            setForm({ mode: "group", revision: layout!.revision });
            setConfirmKey("");
          }}
        >
          <FolderPlus size={16} aria-hidden="true" /> Nova grupa
        </button>
        {!state.error ? (
          <button type="button" className="button" onClick={onReload} disabled={state.loading || busy}>
            <RefreshCw size={16} aria-hidden="true" /> Osveži grupe
          </button>
        ) : null}
      </div>
      {form?.mode === "group" ? (
        <NodeForm
          mode="group"
          busy={!available}
          onCancel={() => setForm(null)}
          onSubmit={(label, labelEn) => create("group", "", label, labelEn)}
        />
      ) : null}
      <ul className="cat-group-list">
        {groups.map((group) => (
          <li key={group.slug} className="cat-group">
            {renderNode(group)}
            {group.children.length ? (
              <ul className="cat-sub-list">
                {group.children.map((child) => (
                  <li key={child.slug}>{renderNode(child)}</li>
                ))}
              </ul>
            ) : null}
            {form?.mode === "sub" && form.parent === group.slug ? (
              <NodeForm
                mode="sub"
                busy={!available}
                onCancel={() => setForm(null)}
                onSubmit={(label, labelEn) => create("sub", group.slug, label, labelEn)}
              />
            ) : (
              <button
                type="button"
                className="button cat-small cat-add-sub"
                disabled={!available}
                aria-label={`Nova podgrupa u grupi ${group.label}`}
                onClick={() => {
                  setForm({ mode: "sub", parent: group.slug, revision: layout!.revision });
                  setConfirmKey("");
                }}
              >
                <Plus size={14} aria-hidden="true" /> Nova podgrupa
              </button>
            )}
          </li>
        ))}
      </ul>
      {form?.mode === "rename" && !renameTargetPresent && !state.loading && !state.error ? (
        <div className="cat-note" role="alert">
          <p>Ova grupa ili podgrupa više nije u osveženom prikazu. Vaš nacrt je sačuvan ispod i nije primenjen na drugu stavku. Kopirajte naziv pre izbora druge stavke.</p>
          <NodeForm
            mode="rename"
            draft={form.draft}
            onDraftChange={updateRenameDraft}
            busy
            onCancel={() => setForm(null)}
            onSubmit={() => {}}
          />
        </div>
      ) : null}
    </div>
  );
}

function normalizeModelOptions(value: unknown): CatalogModelOptions {
  const count = (item: unknown) => typeof item === "number" && Number.isSafeInteger(item) && item >= 0;
  if (!isRecord(value) || !Array.isArray(value.brands) || !Array.isArray(value.models) ||
      !value.brands.every((row) => isRecord(row) && typeof row.value === "string" && row.value.length > 0 && count(row.count)) ||
      !value.models.every((row) => isRecord(row) && typeof row.device === "string" && row.device.length > 0 &&
        count(row.total) && count(row.shared) && (row.shared as number) <= (row.total as number))) {
    throw new ApiFailure("Podaci o modelima trenutno nisu dostupni.", 503);
  }
  return value as unknown as CatalogModelOptions;
}

function ModelsView({ call, groups, labels, groupsState, onReloadGroups, refreshKey, locked, onBulk }: {
  call: Call; groups: TaxonomyNode[]; labels: Labels; groupsState: GroupsState;
  onReloadGroups: () => void; refreshKey: number; locked: boolean; onBulk: OpenBulk;
}) {
  const baseId = useId();
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [deviceBrand, setDeviceBrand] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [chosen, setChosen] = useState<{ scope: string; devices: string[] }>({ scope: "", devices: [] });
  const [reloadKey, setReloadKey] = useState(0);
  const [load, setLoad] = useState<{ key: string; options: CatalogModelOptions | null; error: string }>({ key: "", options: null, error: "" });
  const [previewLoad, setPreviewLoad] = useState<{ key: string; data: CatalogModelSelectionPreview | null; error: string }>({ key: "", data: null, error: "" });
  const previewQueue = useRef<Promise<void>>(Promise.resolve());
  const currentGroup = groups.find((group) => group.slug === category && !group.hidden);
  const currentSub = currentGroup?.children.find((sub) => sub.slug === subcategory && !sub.hidden);
  const hasScope = Boolean(currentGroup && currentSub);
  const query = new URLSearchParams({ view: "models", category, subcategory, ...(deviceBrand ? { deviceBrand } : {}) }).toString();
  const requestKey = `${query}|${refreshKey}|${reloadKey}`;
  const options = hasScope && load.key === requestKey ? load.options : null;
  const error = hasScope && load.key === requestKey ? load.error : "";
  const loading = hasScope && !options && !error;
  const scopeKey = JSON.stringify([category, subcategory, deviceBrand]);
  const selectedDevices = useMemo(() => chosen.scope === scopeKey && options && deviceBrand
    ? chosen.devices.filter((device) => options.models.some((model) => model.device === device && model.total > 0)).sort() : [], [chosen, scopeKey, options, deviceBrand]);
  const selectedSet = new Set(selectedDevices);
  const selectionKey = `${requestKey}|${JSON.stringify(selectedDevices)}`;
  const previewBody = useMemo<Extract<CatalogAction, { action: "preview_models" }> | null>(() => selectedDevices.length
    ? { action: "preview_models", category, subcategory, deviceBrand, devices: selectedDevices } : null, [category, subcategory, deviceBrand, selectedDevices]);
  const preview = previewLoad.key === selectionKey ? previewLoad.data : null;
  const previewError = previewLoad.key === selectionKey ? previewLoad.error : "";
  const previewLoading = Boolean(previewBody && !preview && !previewError);
  const models = deviceBrand ? (options?.models ?? []).filter((model) => model.total > 0) : [];
  const visibleModels = models.filter((model) => modelLabel(deviceBrand, model.device).toLocaleLowerCase("sr").includes(modelSearch.trim().toLocaleLowerCase("sr")));

  useEffect(() => {
    if (!hasScope) return;
    let cancelled = false;
    setLoad({ key: requestKey, options: null, error: "" });
    call<CatalogModelOptions>(query)
      .then((value) => { const next = normalizeModelOptions(value);if (!cancelled) setLoad({ key: requestKey, options: next, error: "" }); })
      .catch((failure: unknown) => { if (!cancelled) setLoad({ key: requestKey, options: null, error: messageOf(failure) }); });
    return () => { cancelled = true; };
  }, [call, hasScope, query, requestKey]);

  useEffect(() => {
    if (!previewBody) { setPreviewLoad({ key: selectionKey, data: null, error: "" });return; }
    let cancelled = false;
    setPreviewLoad({ key: selectionKey, data: null, error: "" });
    // Coalesce quick changes and serialize counts: stale queued selections never query the database.
    const timer = window.setTimeout(() => {
      const run = async () => {
        if (cancelled) return;
        try {
          const next = parseModelSelectionPreview(await call<CatalogModelSelectionPreview>(previewBody));
          if (!cancelled) setPreviewLoad({ key: selectionKey, data: next, error: "" });
        } catch (failure) {
          if (!cancelled) setPreviewLoad({ key: selectionKey, data: null, error: failure instanceof Error && failure.message === "CATALOG_MODEL_SELECTION_INVALID" ? GENERIC_ERROR : messageOf(failure) });
        }
      };
      previewQueue.current = previewQueue.current.catch(() => {}).then(run);
    }, 200);
    return () => { cancelled = true;window.clearTimeout(timer); };
  }, [call, previewBody, selectionKey]);

  const resetChoice = () => { setChosen({ scope: "", devices: [] });setModelSearch(""); };
  const toggle = (device: string) => {
    if (locked || !models.some((model) => model.device === device)) return;
    if (selectedSet.has(device)) setChosen({ scope: scopeKey, devices: selectedDevices.filter((value) => value !== device) });
    else if (selectedDevices.length < CATALOG_MODEL_LIMITS.models) setChosen({ scope: scopeKey, devices: [...selectedDevices, device].sort() });
  };
  const remove = () => {
    if (!preview || !preview.total || preview.totalCapped || locked || !selectedDevices.length) return;
    const scope: CatalogModelSetScope = { category, subcategory, deviceBrand, devices: [...selectedDevices] };
    const common = { total: preview.total, samples: preview.samples.map((sample) => sample.name), shared: preview.shared };
    if (selectedDevices.length === 1) {
      const single: CatalogModelScope = { category, subcategory, deviceBrand, device: selectedDevices[0] };
      onBulk("delete", { mode: "filter", filter: { ...single, status: "all", excludeDeleted: true }, modelScope: single, ...common });
    } else onBulk("delete", { mode: "filter", filter: { ...scope, status: "all", excludeDeleted: true }, modelSetScope: scope, ...common });
  };
  return (
    <div className="cat-groups cat-models">
      <p className="account-hint">Izaberite jedan ili više modela pa obrišite sve njihove sadašnje artikle jednom potvrdom. Buduće artikle ova radnja ne blokira.</p>
      {groupsState.error ? <Banner tone="error" actions={<button type="button" className="button" onClick={onReloadGroups}>Pokušajte ponovo</button>}>{groupsState.error}</Banner> : null}
      <div className="cat-filters">
        <div className="cat-field"><label htmlFor={`${baseId}-model-group`}>Grupa</label>
          <select className="field" id={`${baseId}-model-group`} value={category} disabled={groupsState.loading}
            onChange={(event) => { setCategory(event.target.value);setSubcategory("");setDeviceBrand("");resetChoice(); }}>
            <option value="">Izaberite grupu</option>{groups.filter((group) => !group.hidden).map((group) => <option key={group.slug} value={group.slug}>{group.label}</option>)}
          </select></div>
        <div className="cat-field"><label htmlFor={`${baseId}-model-sub`}>Podgrupa</label>
          <select className="field" id={`${baseId}-model-sub`} value={subcategory} disabled={!currentGroup}
            onChange={(event) => { setSubcategory(event.target.value);setDeviceBrand("");resetChoice(); }}>
            <option value="">Izaberite podgrupu</option>{(currentGroup?.children ?? []).filter((sub) => !sub.hidden).map((sub) => <option key={sub.slug} value={sub.slug}>{sub.label}</option>)}
          </select></div>
        <div className="cat-field"><label htmlFor={`${baseId}-model-brand`}>Brend uređaja</label>
          <select className="field" id={`${baseId}-model-brand`} value={deviceBrand} disabled={!options}
            onChange={(event) => { const value = event.target.value;if (value && !options?.brands.some((brand) => brand.value === value)) return;setDeviceBrand(value);resetChoice(); }}>
            <option value="">Izaberite brend uređaja</option>{(options?.brands ?? []).map((brand) => <option key={brand.value} value={brand.value}>{brandLabel("phone", brand.value)} ({formatCount(brand.count)})</option>)}
          </select></div>
      </div>
      {!hasScope ? <p className="cat-note">Prvo izaberite grupu i podgrupu.</p> : null}
      {loading ? <p className="cat-loading" role="status" aria-busy="true"><LoaderCircle className="cat-spin" size={18} aria-hidden="true" /> Učitavanje modela…</p> : null}
      {error ? <Banner tone="error" actions={<button type="button" className="button" onClick={() => setReloadKey((key) => key + 1)}>Pokušajte ponovo</button>}>Alat za modele trenutno nije dostupan. {error}</Banner> : null}
      {hasScope && options && deviceBrand && !models.length ? <p className="cat-empty">U ovoj podgrupi nema modela sa artiklima za izabrani brend.</p> : null}
      {models.length ? <fieldset className="cat-model-picker"><legend>Modeli uređaja</legend>
        <div className="cat-field"><label htmlFor={`${baseId}-model-search`}>Pronađi model</label><input id={`${baseId}-model-search`} className="field" type="search" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Naziv modela" /></div>
        <div className="cat-actions"><p role="status">Izabrano: {selectedDevices.length} / {CATALOG_MODEL_LIMITS.models}</p><button type="button" className="button cat-small" disabled={!selectedDevices.length || locked} onClick={() => setChosen({ scope: scopeKey, devices: [] })}>Očisti izbor</button></div>
        <div className="cat-model-grid">
          {visibleModels.map((model) => <label key={model.device} className={`cat-model-tile${selectedSet.has(model.device) ? " is-selected" : ""}`}>
            <input type="checkbox" checked={selectedSet.has(model.device)} aria-label={modelLabel(deviceBrand, model.device)} disabled={locked || (!selectedSet.has(model.device) && selectedDevices.length >= CATALOG_MODEL_LIMITS.models)} onChange={() => toggle(model.device)} />
            <span><strong>{modelLabel(deviceBrand, model.device)}</strong><small>{productCount(model.total)}</small></span>
          </label>)}
        </div>
        {!visibleModels.length ? <p className="cat-note">Nema modela sa tim nazivom.</p> : null}
      </fieldset> : null}
      {previewBody ? <section className="cat-group" aria-label={selectedDevices.length === 1 ? "Pregled izabrane podgrupe modela" : "Pregled izabranih modela"}>
        <h3 style={{ overflowWrap: "anywhere" }}>{labels.path(category, subcategory)} {"·"} {brandLabel("phone", deviceBrand)}</h3>
        <p className="cat-model-selection">Izabrani modeli: {selectedDevices.map((device) => modelLabel(deviceBrand, device)).join(", ")}.</p>
        {previewLoading ? <p className="cat-loading" role="status" aria-busy="true"><LoaderCircle className="cat-spin" size={18} aria-hidden="true" /> Proveravamo broj različitih artikala…</p> : null}
        {previewError ? <Banner tone="error" actions={<button type="button" className="button" onClick={() => setReloadKey((key) => key + 1)}>Pokušajte ponovo</button>}>Pregled izbora trenutno nije dostupan. {previewError}</Banner> : null}
        {preview && !preview.totalCapped ? <>
          <p>Za brisanje: {productCount(preview.total)}, kod svih dobavljača, uključujući artikle koji trenutno nisu u prodavnici. Svaki artikal se broji jednom.</p>
          {preview.shared > 0 ? <Banner tone="warning">Zajednički artikli: {productCount(preview.shared)}. Brišu se celi artikli, pa nestaju i iz ponude za druge modele koje niste izabrali.</Banner> : null}
          {!preview.total ? <p className="cat-note">U izboru više nema artikala za brisanje.</p> : null}
        </> : null}
        {preview?.totalCapped ? <p className="cat-error" role="alert">{CAP_TEXT}</p> : null}
        <p>Kada izabrani modeli ostanu bez artikala, njihove pločice se uklanjaju iz ponude.</p>
        <div className="cat-actions"><button type="button" className="button cat-button-danger" disabled={locked || !preview || !preview.total || preview.totalCapped} onClick={remove}>
          <Trash2 size={16} aria-hidden="true" /> {selectedDevices.length === 1 ? "Obriši podgrupu sa svim artiklima" : "Obriši izabrane modele sa svim artiklima"}
        </button></div>
      </section> : null}
      {locked ? <p className="cat-note">{LOCK_TEXT}</p> : null}
    </div>
  );
}

function HistoryPanel({
  call,
  labels,
  refreshKey,
  locked,
  onUndo,
}: {
  call: Call;
  labels: Labels;
  refreshKey: number;
  locked: boolean;
  onUndo: (job: HistoryJob) => void;
}) {
  const baseId = useId();
  const [jobs, setJobs] = useState<HistoryJob[] | null>(null);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError("");
    call<HistoryView>("view=history")
      .then((value) => {
        if (!cancelled) setJobs(isRecord(value) && Array.isArray(value.jobs) ? (value.jobs as HistoryJob[]) : []);
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(messageOf(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [call, refreshKey, reloadKey]);

  const lockId = `${baseId}-lock`;
  let content: ReactNode;
  if (error) {
    content = (
      <Banner
        tone="error"
        actions={
          <button type="button" className="button" onClick={() => setReloadKey((key) => key + 1)}>
            <RefreshCw size={16} aria-hidden="true" /> Pokušajte ponovo
          </button>
        }
      >
        {error}
      </Banner>
    );
  } else if (!jobs) {
    content = (
      <p className="cat-loading" aria-busy="true">
        <LoaderCircle className="cat-spin" size={18} aria-hidden="true" /> Učitavanje istorije…
      </p>
    );
  } else if (!jobs.length) {
    content = <p className="cat-empty">Još nema izmena u katalogu.</p>;
  } else {
    content = (
      <ul className="cat-history">
        {jobs.map((job) => {
          const affected = toCount(job.affected);
          const parts = [
            formatWhen(job.at),
            actionLabel(job.action),
            job.action.startsWith("taxonomy") ? "" : productCount(affected),
            historyTarget(job, labels),
          ].filter(Boolean);
          return (
            <li key={job.jobId} className="cat-history-item">
              <div>
                <p>{parts.join(" · ")}</p>
                {job.status === "undone" ? <p className="cat-history-status">Poništeno</p> : null}
                {job.status === "partial" ? (
                  <p className="cat-history-status">{partialText(toCount(job.restored), affected)}</p>
                ) : null}
              </div>
              {job.undoable ? (
                <button
                  type="button"
                  className="button cat-small"
                  disabled={locked}
                  aria-describedby={locked ? lockId : undefined}
                  onClick={() => onUndo(job)}
                >
                  <Undo2 size={14} aria-hidden="true" /> Poništi
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="cat-history-wrap">
      <p className="account-hint">Poslednjih 30 izmena, najnovije prvo. Premeštanje i brisanje možete poništiti.</p>
      {locked ? (
        <p id={lockId} className="cat-help">
          {LOCK_TEXT}
        </p>
      ) : null}
      {content}
    </div>
  );
}

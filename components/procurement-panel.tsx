"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Copy,
  Download,
  Info,
  Layers3,
  LoaderCircle,
  Package,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Truck,
  TriangleAlert,
} from "lucide-react";
import { prikazIznosa } from "@/lib/pricing";
import SupplierSourceEditor from "./supplier-source-editor";
import "./procurement-panel.css";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

// Oznaka dobavljaca u krugu: kratka, a ne prva tri slova naziva ("MS ", "DIG").
const supplierMarks: Record<string, string> = { trig: "3G", msmobile: "MS", dv: "DV" };
const supplierMark = (code: string, label: string) =>
  supplierMarks[code] ?? label.slice(0, 3).toUpperCase();
type ProcurementStatus =
  | "pending"
  | "ordered"
  | "confirmed"
  | "partially_received"
  | "received"
  | "issue"
  | "cancelled";
type ProcurementItem = {
  id: string;
  product_id: string;
  name: string;
  quantity: number;
  received_quantity: number;
  unit_price: number;
  line_total: number;
  supplier_sku: string | null;
  supplier_unit_cost: number | null;
  supplier_cost_currency: string | null;
  supplier_price_includes_vat: boolean | null;
};
type ProcurementGroup = {
  id: string;
  order_id: string;
  supplier: string;
  supplier_label: string;
  status: ProcurementStatus;
  version: number;
  supplier_reference: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  ordered_at: string | null;
  received_at: string | null;
  demo: boolean;
  order: {
    id: string;
    reference: string;
    status: string;
    customer?: { fullName?: string };
    total: number;
    currency: string;
    created_at: string;
  };
  items: ProcurementItem[];
  nextAction: string;
  warnings: string[];
  allowedTransitions: ProcurementStatus[];
};
type SupplierOverview = {
  supplier: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  catalog_enabled: boolean;
  price_currency: "RSD" | "EUR" | "USD" | null;
  price_includes_vat: boolean | null;
  fulfillment_mode: "manual";
  stock_max_age_hours: number;
  safety_stock: number;
  lead_time_days: number | null;
  priority: number;
  lastSync: {
    status?: string;
    finished_at?: string | null;
    started_at?: string;
    error?: string | null;
  } | null;
  price_field: "Price" | "ClientPrice" | null;
  syncRequired?: boolean;
  status: "ready" | "stale" | "unconfigured" | "disabled" | "needs_setup";
  productCount: number | null;
  availableCount: number | null;
  warnings: string[];
};
type CountedSupplier = SupplierOverview & { productCount: number; availableCount: number };
type ProcurementData = {
  orders: ProcurementGroup[];
  suppliers: SupplierOverview[];
  summary: Record<ProcurementStatus | "demo" | "total", number>;
  demo: boolean;
  hasMore: boolean;
  offset: number;
  totalCount: number;
};
type CatalogPreview = {
  supplier: string;
  hasMore: boolean;
  items: {
    supplier_sku: string;
    name: string;
    price: number | null;
    client_price: number | null;
    stock: number | null;
    available: boolean;
    stock_status: string | null;
    currency: string | null;
  }[];
};
const statuses: Record<ProcurementStatus, string> = {
  pending: "Za nabavku",
  ordered: "Poručeno",
  confirmed: "Potvrđeno",
  partially_received: "Delimično primljeno",
  received: "Primljeno",
  issue: "Potrebna provera",
  cancelled: "Otkazano",
};
const supplierStatuses: Record<SupplierOverview["status"], string> = {
  ready: "Katalog spreman",
  stale: "Podaci zastareli",
  unconfigured: "Čeka povezivanje",
  disabled: "Izvor isključen",
  needs_setup: "Potrebna podešavanja",
};
function money(value: number | null, currency: string | null) {
  if (value === null || !currency || !Number.isFinite(Number(value)))
    return "Nije potvrđeno";
  return `${prikazIznosa(Number(value))} ${currency}`;
}
function dateTime(value?: string | null) {
  if (!value || Number.isNaN(new Date(value).getTime())) return "Nema podatka";
  return new Intl.DateTimeFormat("sr-Latn-RS", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
function quantity(group: ProcurementGroup) {
  return group.items.reduce((sum, item) => sum + item.quantity, 0);
}
function costTotals(group: ProcurementGroup) {
  const totals: Record<string, number> = {};
  let missing = 0;
  for (const item of group.items) {
    if (item.supplier_unit_cost === null || !item.supplier_cost_currency) {
      missing++;
      continue;
    }
    totals[item.supplier_cost_currency] =
      (totals[item.supplier_cost_currency] ?? 0) +
      Number(item.supplier_unit_cost) * item.quantity;
  }
  return { totals, missing };
}
function handoffText(group: ProcurementGroup) {
  return [
    group.demo
      ? "TEST PORUDŽBINA — NE SLATI DOBAVLJAČU"
      : `Lista za nabavku · ${group.supplier_label}`,
    `Porudžbina: ${group.order.reference}`,
    ...group.items.map(
      (item) =>
        `${item.quantity} × ${item.name} | Šifra: ${item.supplier_sku || "NIJE POTVRĐENA"}`,
    ),
    "Molimo potvrdu dostupnosti, konačne cene i roka isporuke.",
  ].join("\n");
}
function csvCell(value: unknown) {
  const raw = String(value ?? "");
  const safe = /^[\s\uFEFF]*[=+\-@\t\r\n]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
function exportGroup(group: ProcurementGroup) {
  const rows: unknown[][] = [
    [
      group.demo ? "TEST PORUDŽBINA — NE SLATI DOBAVLJAČU" : "LISTA ZA NABAVKU",
      "Nabavne cene su snimak u trenutku kupovine; potvrditi kod dobavljača.",
    ],
    [
      "Porudžbina",
      "Dobavljač",
      "Šifra dobavljača",
      "Artikal",
      "Količina",
      "Nabavna cena/kom",
      "Valuta",
      "PDV uključen",
    ],
    ...group.items.map((item) => [
      group.order.reference,
      group.supplier_label,
      item.supplier_sku,
      item.name,
      item.quantity,
      item.supplier_unit_cost,
      item.supplier_cost_currency,
      item.supplier_price_includes_vat === null
        ? "Nije potvrđeno"
        : item.supplier_price_includes_vat
          ? "Da"
          : "Ne",
    ]),
  ];
  const blob = new Blob(
    ["\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n")],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download =
    `${group.demo ? "TEST-" : ""}nabavka-${group.order.reference}-${group.supplier}.csv`.replace(
      /[^a-zA-Z0-9._-]/g,
      "_",
    );
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Status({ status }: { status: ProcurementStatus }) {
  return (
    <span className={`proc-status is-${status}`}>
      <span />
      {statuses[status] ?? status}
    </span>
  );
}

export default function ProcurementPanel({ api }: { api: Api }) {
  const [data, setData] = useState<ProcurementData | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [messageWarning, setMessageWarning] = useState(false);
  const [view, setView] = useState<"queue" | "suppliers">("queue");
  const [orderMode, setOrderMode] = useState<"real" | "demo">("real");
  const [filter, setFilter] = useState("active");
  const [supplier, setSupplier] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [offset, setOffset] = useState(0);
  const requestId = useRef(0);
  const detailRef = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    setBusy(true);
    setError("");
    try {
      const result = await api<ProcurementData>(
        `/api/admin/procurement?offset=${offset}&supplierStats=${view === "suppliers" ? "1" : "0"}`,
      );
      if (current === requestId.current) {
        if (view === "suppliers" && result.suppliers.some((source) => typeof source.productCount !== "number" || typeof source.availableCount !== "number")) {
          throw new Error("Statistika dobavljača trenutno nije dostupna. Osvežite podatke.");
        }
        setData(result);
      }
    } catch (err) {
      if (current === requestId.current)
        setError(
          err instanceof Error
            ? err.message
            : "Nabavka trenutno nije dostupna.",
        );
    } finally {
      if (current === requestId.current) setBusy(false);
    }
  }, [api, offset, view]);
  useEffect(() => {
    void load();
    return () => {
      requestId.current++;
    };
  }, [load]);

  const suppliersWithStats = (data?.suppliers ?? []).filter((source): source is CountedSupplier =>
    typeof source.productCount === "number" && typeof source.availableCount === "number");
  const supplierStatsReady = Boolean(data && suppliersWithStats.length === data.suppliers.length);

  const modeOrders = useMemo(
    () =>
      (data?.orders ?? []).filter(
        (group) => group.demo === (orderMode === "demo"),
      ),
    [data, orderMode],
  );
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("sr-Latn");
    return modeOrders.filter((group) => {
      const matchesStatus =
        filter === "all" ||
        (filter === "active"
          ? !["received", "cancelled"].includes(group.status)
          : group.status === filter);
      const matchesSupplier = supplier === "all" || group.supplier === supplier;
      const haystack = [
        group.order.reference,
        group.order.customer?.fullName,
        group.supplier_label,
        ...group.items.flatMap((item) => [item.name, item.supplier_sku]),
      ]
        .join(" ")
        .toLocaleLowerCase("sr-Latn");
      return (
        matchesStatus && matchesSupplier && (!query || haystack.includes(query))
      );
    });
  }, [modeOrders, filter, supplier, search]);
  const selected =
    filtered.find((group) => group.id === selectedId) ?? filtered[0] ?? null;
  const realCount = data?.orders.filter((group) => !group.demo).length ?? 0;
  const demoCount = data?.orders.filter((group) => group.demo).length ?? 0;

  async function updateGroup(
    group: ProcurementGroup,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(group.id);
    setError("");
    setMessage("");
    setMessageWarning(false);
    try {
      await api("/api/admin/procurement", {
        method: "PATCH",
        body: JSON.stringify({
          action: "update_procurement",
          id: group.id,
          version: group.version,
          status: form.get("status"),
          supplierReference: String(form.get("supplierReference") || "").trim(),
          note: String(form.get("note") || "").trim(),
          // Polje postoji samo dok je prijem otvoren; inace kolicine ostaju kakve jesu.
          items: form.get("items")
            ? (JSON.parse(String(form.get("items"))) as {
                id: string;
                quantity: number;
              }[])
            : undefined,
        }),
      });
      setMessage(
        group.demo
          ? "Demo status je sačuvan. Ništa nije poslato dobavljaču."
          : "Evidencija je sačuvana. Poruka dobavljaču se šalje kroz vaš dogovoreni kanal.",
      );
      await load();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Status nije sačuvan. Osvežite podatke i pokušajte ponovo.",
      );
    } finally {
      setSaving(null);
    }
  }
  async function updateSupplier(
    source: SupplierOverview,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(source.supplier);
    setError("");
    setMessage("");
    try {
      const result = await api<{
        result?: { warning?: string; syncRequired?: boolean };
      }>("/api/admin/procurement", {
        method: "PATCH",
        body: JSON.stringify({
          action: "update_supplier_settings",
          supplier: source.supplier,
          priceCurrency: form.get("priceCurrency") || null,
          priceField:
            source.supplier === "trig"
              ? form.get("priceField") || null
              : source.price_field,
          priceIncludesVat:
            form.get("priceIncludesVat") === ""
              ? null
              : form.get("priceIncludesVat") === "true",
          catalogEnabled: form.get("catalogEnabled") === "on",
          stockMaxAgeHours: Number(form.get("stockMaxAgeHours")),
          safetyStock: Number(form.get("safetyStock")),
          priority: Number(form.get("priority")),
          leadTimeDays:
            form.get("leadTimeDays") === ""
              ? null
              : Number(form.get("leadTimeDays")),
        }),
      });
      setMessageWarning(Boolean(result.result?.warning || result.result?.syncRequired));
      setMessage(
        result.result?.warning ||
          (result.result?.syncRequired
            ? `Podešavanja za ${source.label} su sačuvana. Pre objave pokrenite novu sinhronizaciju, pa uključite katalog.`
            : `Podešavanja za ${source.label} su sačuvana.`),
      );
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Podešavanja nisu sačuvana.",
      );
    } finally {
      setSaving(null);
    }
  }
  async function syncCatalog() {
    setSyncing(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{
        reports: { supplier: string; status: string; itemsInSource?: number; error?: string }[];
      }>("/api/cron/supplier-sync", { method: "POST" });
      // Uspesno osvezen izvor moze da nosi gresku objave kataloga; i ona se prikazuje.
      setMessageWarning(!result.reports?.length || result.reports.some(report => report.status !== "ok" || Boolean(report.error)));
      setMessage(
        result.reports?.length
          ? result.reports
              .map(
                (report) =>
                  `${report.supplier}: ${report.status === "ok" ? `osveženo (${report.itemsInSource ?? 0} artikala)` : report.status === "skipped" ? "preskočeno" : "osvežavanje nije uspelo"}${report.error ? ` (${report.error})` : ""}`,
              )
              .join(" · ")
          : "Nema izvora spremnih za osvežavanje.",
      );
      await load();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Osvežavanje nije potvrđeno. Proverite status dobavljača pre ponovnog pokušaja.",
      );
    } finally {
      setSyncing(false);
    }
  }
  function selectGroup(id: string) {
    setSelectedId(id);
    setMobileDetail(true);
    window.requestAnimationFrame(() => {
      detailRef.current?.focus({ preventScroll: true });
      if (window.matchMedia("(max-width: 760px)").matches)
        detailRef.current?.scrollIntoView({
          block: "start",
          behavior: "instant",
        });
    });
  }
  const metrics = [
    {
      label: "Čeka nabavku",
      value: modeOrders.filter((group) => group.status === "pending").length,
      icon: ClipboardList,
      kind: "pending",
    },
    {
      label: "Kod dobavljača",
      value: modeOrders.filter((group) =>
        ["ordered", "confirmed"].includes(group.status),
      ).length,
      icon: Truck,
      kind: "ordered",
    },
    {
      label: "Za proveru",
      value: modeOrders.filter(
        (group) =>
          group.status === "issue" ||
          (group.warnings.length > 0 &&
            !["received", "cancelled"].includes(group.status)),
      ).length,
      icon: TriangleAlert,
      kind: "issue",
    },
    {
      label: "Primljeno",
      value: modeOrders.filter((group) => group.status === "received").length,
      icon: CheckCircle2,
      kind: "received",
    },
  ];

  return (
    <div className="procurement-panel">
      <div className="proc-intro">
        <div>
          <span className="proc-eyebrow">
            <Layers3 size={15} /> NABAVKA BEZ PREKLAPANJA
          </span>
          <h2>
            Jedna porudžbina.
            <br />
            <span>Jasan sledeći korak.</span>
          </h2>
          <p>
            Sistem razdvaja artikle po dobavljaču. Vi dobijate spremne liste i
            pratite svaki deo do prijema.
          </p>
        </div>
        <div className="proc-flow" aria-label="Tok nabavke">
          <span>
            <ClipboardList size={18} /> Priprema
          </span>
          <ChevronRight size={15} />
          <span>
            <Truck size={18} /> Dobavljač
          </span>
          <ChevronRight size={15} />
          <span>
            <Package size={18} /> Prijem
          </span>
        </div>
      </div>
      {demoCount > 0 && (
        <div className="proc-banner is-demo">
          <ShieldCheck size={20} />
          <div>
            <strong>Postoje test porudžbine</strong>
            <p>
              Test porudžbine su odvojene od stvarne nabavke. Ne pokreću
              naplatu, slanje dobavljaču ni isporuku.
            </p>
          </div>
        </div>
      )}
      <div className="proc-toolbar">
        <div
          className="proc-view-switch"
          role="group"
          aria-label="Prikaz nabavke"
        >
          <button
            type="button"
            aria-pressed={view === "queue"}
            onClick={() => setView("queue")}
          >
            <ClipboardList size={17} />
            Radni pregled
          </button>
          <button
            type="button"
            aria-pressed={view === "suppliers"}
            onClick={() => setView("suppliers")}
          >
            <Settings2 size={17} />
            Dobavljači
          </button>
        </div>
        <button
          type="button"
          className="proc-icon-button"
          disabled={busy}
          onClick={() => void load()}
          aria-label="Osveži pregled nabavke"
        >
          <RefreshCw size={18} className={busy ? "account-spin" : ""} />
        </button>
      </div>
      {error && (
        <div className="proc-banner is-error" role="alert">
          <TriangleAlert size={20} />
          <div>
            <strong>Potrebna je provera</strong>
            <p>{error}</p>
            <button type="button" onClick={() => void load()} disabled={busy}>
              Osveži podatke
            </button>
          </div>
        </div>
      )}
      {message && (
        <div className={`proc-banner ${messageWarning ? "is-warning" : "is-success"}`} role="status">
          {messageWarning ? <TriangleAlert size={20} /> : <CheckCircle2 size={20} />}
          <p>{message}</p>
        </div>
      )}
      {(busy && !data) || (view === "suppliers" && (busy || !supplierStatsReady) && !error) ? (
        <div className="proc-empty" role="status">
          <LoaderCircle size={28} className="account-spin" />
          <h3>Pripremamo pregled nabavke…</h3>
        </div>
      ) : data && view === "queue" ? (
        <>
          <div
            className="proc-order-mode"
            role="group"
            aria-label="Vrsta porudžbina"
          >
            <button
              type="button"
              aria-pressed={orderMode === "real"}
              onClick={() => {
                setOrderMode("real");
                setMobileDetail(false);
              }}
            >
              Stvarne <span>{realCount}</span>
            </button>
            <button
              type="button"
              aria-pressed={orderMode === "demo"}
              onClick={() => {
                setOrderMode("demo");
                setMobileDetail(false);
              }}
            >
              Demo / test <span>{demoCount}</span>
            </button>
            <span className="proc-mode-note">Broj zadataka po dobavljaču</span>
          </div>
          <div className="proc-metrics">
            {metrics.map((metric) => (
              <div
                key={metric.kind}
                className={`proc-metric is-${metric.kind}`}
              >
                <div>
                  <span>{metric.label}</span>
                  <metric.icon size={18} />
                </div>
                <strong>{metric.value.toLocaleString("sr-Latn-RS")}</strong>
                <small>
                  {orderMode === "demo" ? "test zadataka" : "nabavki"}
                </small>
              </div>
            ))}
          </div>
          <div className="proc-filters">
            <label className="proc-search">
              <Search size={18} />
              <input
                type="search"
                placeholder="Porudžbina, artikal ili šifra…"
                aria-label="Pretraži nabavke"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setMobileDetail(false);
                }}
              />
            </label>
            <label>
              <span className="proc-sr-only">Dobavljač</span>
              <select
                value={supplier}
                onChange={(event) => {
                  setSupplier(event.target.value);
                  setMobileDetail(false);
                }}
              >
                <option value="all">Svi dobavljači</option>
                {data.suppliers.map((source) => (
                  <option key={source.supplier} value={source.supplier}>
                    {source.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="proc-sr-only">Status nabavke</span>
              <select
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value);
                  setMobileDetail(false);
                }}
              >
                <option value="active">Aktivne nabavke</option>
                <option value="all">Svi statusi</option>
                {Object.entries(statuses).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {(data.hasMore || offset > 0) && (
            <div className="proc-banner">
              <Info size={18} />
              <p>
                Aktivne nabavke su prve u redu. Brojevi, pretraga i filteri
                odnose se na ovu stranu; dugmad za ostale strane su ispod liste.
              </p>
            </div>
          )}
          {!filtered.length ? (
            <div className="proc-empty">
              <span className="proc-empty-icon">
                <CheckCircle2 size={30} />
              </span>
              <h3>
                {search || filter !== "active" || supplier !== "all"
                  ? "Nema rezultata za ovaj izbor"
                  : orderMode === "real"
                    ? "Trenutno nema aktivne nabavke"
                    : "Nema aktivnih test zadataka"}
              </h3>
              <p>
                {orderMode === "real" && !realCount
                  ? "Kada stigne stvarna porudžbina, ovde će se pojaviti zasebna lista za svakog dobavljača."
                  : "Promenite filter ili pretragu da biste prikazali ostale porudžbine."}
              </p>
              {orderMode === "real" && demoCount > 0 && (
                <button
                  className="button"
                  type="button"
                  onClick={() => setOrderMode("demo")}
                >
                  Pogledaj test porudžbine <ArrowRight size={16} />
                </button>
              )}
            </div>
          ) : (
            <div
              className={`proc-workspace ${mobileDetail ? "is-detail-open" : ""}`}
            >
              <div className="proc-queue">
                <div className="proc-queue-heading">
                  <h3>Lista nabavke</h3>
                  <span>{filtered.length} zadataka</span>
                </div>
                <div className="proc-queue-columns" aria-hidden="true">
                  <span>Porudžbina / dobavljač</span>
                  <span>Status</span>
                </div>
                <div className="proc-queue-list">
                  {filtered.map((group) => (
                    <button
                      className={`proc-queue-item ${selected?.id === group.id ? "is-selected" : ""}`}
                      type="button"
                      key={group.id}
                      aria-pressed={selected?.id === group.id}
                      onClick={() => selectGroup(group.id)}
                    >
                      <div className="proc-queue-main">
                        <span
                          className={`proc-supplier-mark is-${group.supplier.toLowerCase()}`}
                        >
                          {supplierMark(group.supplier, group.supplier_label)}
                        </span>
                        <div>
                          <strong>{group.order.reference}</strong>
                          <span>
                            {group.supplier_label} · {quantity(group)} kom.
                          </span>
                        </div>
                      </div>
                      <Status status={group.status} />
                      <div className="proc-queue-foot">
                        <span>{dateTime(group.created_at)}</span>
                        {group.warnings.length > 0 ? (
                          <span className="proc-queue-warning">
                            <TriangleAlert size={13} /> Proveriti
                          </span>
                        ) : (
                          <span>{group.items.length} stavki</span>
                        )}
                        {group.demo && <b>TEST</b>}
                        <ChevronRight size={14} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              {selected && (
                <section
                  className="proc-detail"
                  ref={detailRef}
                  tabIndex={-1}
                  aria-label={`Nabavka ${selected.order.reference} kod ${selected.supplier_label}`}
                >
                  <button
                    type="button"
                    className="proc-mobile-back"
                    onClick={() => setMobileDetail(false)}
                  >
                    <ArrowLeft size={18} /> Sve nabavke
                  </button>
                  <GroupDetail
                    key={`${selected.id}-${selected.version}`}
                    group={selected}
                    saving={saving === selected.id}
                    onSubmit={(event) => void updateGroup(selected, event)}
                    onMessage={value => { setMessage(value); setMessageWarning(false); }}
                  />
                </section>
              )}
            </div>
          )}
          {(data.hasMore || offset > 0) && (
            <div className="proc-pagination">
              <button
                className="button"
                type="button"
                disabled={busy || offset === 0}
                onClick={() => {
                  setOffset(Math.max(0, offset - 200));
                  setMobileDetail(false);
                }}
              >
                <ArrowLeft size={16} /> Prethodna
              </button>
              <span>
                Strana {Math.floor(offset / 200) + 1}
                <small>Brojevi i filteri važe za ovu stranu.</small>
              </span>
              <button
                className="button"
                type="button"
                disabled={busy || !data.hasMore}
                onClick={() => {
                  setOffset(offset + 200);
                  setMobileDetail(false);
                }}
              >
                Sledeća <ArrowRight size={16} />
              </button>
            </div>
          )}
        </>
      ) : (
        data && supplierStatsReady && !busy && !error && (
          <div className="proc-suppliers">
            <div className="proc-suppliers-heading">
              <div>
                <h3>Više izvora. Jedna prodavnica.</h3>
                <p>
                  Povezivanje, svežina kataloga i pravila dostupnosti za svakog
                  dobavljača.
                </p>
              </div>
              <button
                className="button"
                type="button"
                disabled={syncing || !!saving}
                onClick={() => void syncCatalog()}
              >
                <RefreshCw
                  size={16}
                  className={syncing ? "account-spin" : ""}
                />
                {syncing ? "Osvežavanje…" : "Osveži kataloge"}
              </button>
            </div>
            <div className="proc-supplier-grid">
              {suppliersWithStats.map((source) => (
                <SupplierCard
                  api={api}
                  key={`${source.supplier}-${source.price_field}-${source.catalog_enabled}-${source.price_currency}-${source.price_includes_vat}-${source.stock_max_age_hours}-${source.safety_stock}-${source.lead_time_days}-${source.priority}`}
                  source={source}
                  saving={saving === source.supplier}
                  onSubmit={(event) => void updateSupplier(source, event)}
                    onSourceSaved={(syncRequired) => {
                      setMessageWarning(syncRequired);
                      setMessage(syncRequired
                        ? `Izvor za ${source.label} je sačuvan. Osvežite kataloge, pa ponovo uključite objavu u podešavanjima dobavljača.`
                        : `Podešavanja izvora za ${source.label} su sačuvana.`);
                      void load();
                    }}
                />
              ))}
            </div>
            <div className="proc-banner">
              <ShieldCheck size={20} />
              <div>
                <strong>Pristupni podaci ostaju zaštićeni</strong>
                <p>
                  API ključevi se podešavaju na serveru i ne prikazuju se u
                  admin centru. Preuzimanje kataloga ne šalje porudžbine
                  dobavljačima.
                </p>
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function GroupDetail({
  group,
  saving,
  onSubmit,
  onMessage,
}: {
  group: ProcurementGroup;
  saving: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onMessage: (message: string) => void;
}) {
  const [status, setStatus] = useState<ProcurementStatus>(group.status);
  const [manualCopy, setManualCopy] = useState(false);
  const costs = costTotals(group);
  const closed = ["completed", "cancelled"].includes(group.order.status);
  // Primljene kolicine se upisuju tek kad je nabavka potvrdena kod dobavljaca.
  // Komponenta se remontira na svaku promenu verzije, pa je pocetno stanje uvek sveze.
  const receiptOpen =
    !closed &&
    (group.status === "partially_received" ||
      group.allowedTransitions.includes("partially_received") ||
      group.allowedTransitions.includes("received"));
  const [received, setReceived] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      group.items.map((item) => [item.id, item.received_quantity]),
    ),
  );
  const receivedTotal = group.items.reduce(
    (sum, item) => sum + (received[item.id] ?? 0),
    0,
  );
  const steps: ProcurementStatus[] = [
    "pending",
    "ordered",
    "confirmed",
    "received",
  ];
  // Delimican prijem deli mesto sa potvrdom: roba je na putu, posao jos traje.
  const currentStep = steps.indexOf(
    group.status === "partially_received" ? "confirmed" : group.status,
  );
  async function copyList() {
    try {
      await navigator.clipboard.writeText(handoffText(group));
      onMessage(
        group.demo
          ? "Kopirana je lista TEST porudžbine. Ne šaljite je dobavljaču."
          : "Lista je kopirana. Pošaljite je dobavljaču kroz dogovoreni kanal, pa evidentirajte poručivanje.",
      );
    } catch {
      setManualCopy(true);
    }
  }
  return (
    <>
      <div className="proc-detail-heading">
        <span className="proc-eyebrow">
          {group.demo ? "TEST NABAVKA" : "NABAVKA PO DOBAVLJAČU"}
        </span>
        <div>
          <h3>{group.order.reference}</h3>
          <Status status={group.status} />
        </div>
        <p>
          {group.supplier_label}
          <span>·</span>
          {dateTime(group.created_at)}
          {group.order.customer?.fullName && (
            <>
              <span>·</span>
              {group.order.customer.fullName}
            </>
          )}
        </p>
      </div>
      {group.demo && (
        <div className="proc-demo-strip">
          <ShieldCheck size={17} /> Test podaci — ovu listu ne šaljite
          dobavljaču.
        </div>
      )}
      <ol className="proc-progress" aria-label="Napredak nabavke">
        {steps.map((step, index) => (
          <li
            key={step}
            className={index <= currentStep ? "is-done" : ""}
            aria-current={group.status === step ? "step" : undefined}
          >
            <span>{index < currentStep ? <Check size={12} /> : index + 1}</span>
            <small>{statuses[step]}</small>
          </li>
        ))}
      </ol>
      <div
        className={`proc-next ${group.status === "issue" ? "is-issue" : ""}`}
      >
        <span>
          <ArrowRight size={19} />
        </span>
        <div>
          <strong>Sledeći korak</strong>
          <p>{group.nextAction}</p>
        </div>
      </div>
      {group.warnings.length > 0 && (
        <div className="proc-warnings">
          <strong>
            <TriangleAlert size={16} /> Proverite pre nastavka
          </strong>
          <ul>
            {group.warnings.map((warning, index) => (
              <li key={`${index}-${warning}`}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="proc-items-head">
        <h4>Artikli za {group.supplier_label}</h4>
        <span>{quantity(group)} kom.</span>
      </div>
      <div className="proc-item-table">
        <table>
          <thead>
            <tr>
              <th scope="col">Artikal / šifra dobavljača</th>
              <th scope="col">Kom.</th>
              <th scope="col">Primljeno</th>
              <th scope="col">Nabavna / kom.</th>
            </tr>
          </thead>
          <tbody>
            {group.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.name}</strong>
                  <code>{item.supplier_sku || "Šifra nije potvrđena"}</code>
                </td>
                <td>{item.quantity}</td>
                <td className="proc-received-cell">
                  {receiptOpen ? (
                    <input
                      type="number"
                      min={0}
                      max={item.quantity}
                      step={1}
                      value={received[item.id] ?? 0}
                      aria-label={`Primljeno komada — ${item.name}`}
                      onChange={(event) =>
                        setReceived((prev) => ({
                          ...prev,
                          [item.id]: Math.max(
                            0,
                            Math.min(
                              item.quantity,
                              Number(event.target.value) || 0,
                            ),
                          ),
                        }))
                      }
                    />
                  ) : (
                    <strong>{item.received_quantity}</strong>
                  )}
                </td>
                <td>
                  {money(item.supplier_unit_cost, item.supplier_cost_currency)}
                  <small>
                    {item.supplier_price_includes_vat === null
                      ? "PDV nije potvrđen"
                      : item.supplier_price_includes_vat
                        ? "sa PDV-om"
                        : "bez PDV-a"}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="proc-item-cards">
        {group.items.map((item) => (
          <div className="proc-item-card" key={item.id}>
            <div>
              <strong>{item.name}</strong>
              <code>{item.supplier_sku || "Šifra nije potvrđena"}</code>
            </div>
            <span>{item.quantity} kom.</span>
            <p className="proc-received-line">
              <span>Primljeno od {item.quantity} kom.</span>
              {receiptOpen ? (
                <input
                  type="number"
                  min={0}
                  max={item.quantity}
                  step={1}
                  value={received[item.id] ?? 0}
                  aria-label={`Primljeno komada — ${item.name}`}
                  onChange={(event) =>
                    setReceived((prev) => ({
                      ...prev,
                      [item.id]: Math.max(
                        0,
                        Math.min(item.quantity, Number(event.target.value) || 0),
                      ),
                    }))
                  }
                />
              ) : (
                <b>{item.received_quantity}</b>
              )}
            </p>
            <p>
              Nabavna / kom.{" "}
              <b>
                {money(item.supplier_unit_cost, item.supplier_cost_currency)}
              </b>
              <small>
                {item.supplier_price_includes_vat === null
                  ? "PDV nije potvrđen"
                  : item.supplier_price_includes_vat
                    ? "sa PDV-om"
                    : "bez PDV-a"}
              </small>
            </p>
          </div>
        ))}
      </div>
      <div className="proc-cost-total">
        <span>Snimak nabavne vrednosti</span>
        <strong>
          {Object.entries(costs.totals)
            .map(([currency, total]) => money(total, currency))
            .join(" + ") || "Nije potvrđeno"}
        </strong>
      </div>
      <p className="proc-help">
        {costs.missing > 0
          ? `${costs.missing} stavki nema potvrđenu nabavnu cenu. `
          : ""}
        Cene su sačuvane uz porudžbinu. Konačnu cenu, PDV i trošak dostave
        potvrdite sa dobavljačem.
      </p>
      <div className="proc-handoff-actions">
        <button
          className="button button-dark"
          type="button"
          onClick={() => void copyList()}
        >
          <Copy size={16} />
          Kopiraj {group.demo ? "test " : ""}listu
        </button>
        <button
          className="button"
          type="button"
          onClick={() => exportGroup(group)}
        >
          <Download size={16} />
          Preuzmi CSV
        </button>
      </div>
      {manualCopy && (
        <label className="proc-copy-fallback">
          Kopirajte listu ručno
          <textarea
            readOnly
            rows={6}
            value={handoffText(group)}
            onFocus={(event) => event.currentTarget.select()}
            autoFocus
          />
        </label>
      )}
      <p className="proc-handoff-note">
        <Info size={14} /> Kopiranje i preuzimanje ne šalju porudžbinu
        dobavljaču.
      </p>
      {closed ? (
        <div className="proc-closed-note">
          <strong>Porudžbina je zatvorena</strong>
          <p>Referenca: {group.supplier_reference || "Nije uneta"}</p>
          {group.note && <p>{group.note}</p>}
        </div>
      ) : (
        <form className="proc-update-form" onSubmit={onSubmit}>
          <h4>Evidencija nabavke</h4>
          {receiptOpen && (
            <>
              <input
                type="hidden"
                name="items"
                value={JSON.stringify(
                  group.items.map((item) => ({
                    id: item.id,
                    quantity: received[item.id] ?? 0,
                  })),
                )}
              />
              <p className="proc-help">
                Primljeno {receivedTotal} od {quantity(group)} kom. Upišite
                stvarno stigle količine u tabeli iznad, pa izaberite status.
              </p>
            </>
          )}
          <div className="proc-form-grid">
            <label>
              Status
              <select
                name="status"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as ProcurementStatus)
                }
              >
                {Array.from(
                  new Set([group.status, ...group.allowedTransitions]),
                ).map((value) => (
                  <option key={value} value={value}>
                    {statuses[value]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Referenca dobavljača
              <input
                name="supplierReference"
                defaultValue={group.supplier_reference ?? ""}
                maxLength={160}
                required={[
                  "ordered",
                  "confirmed",
                  "partially_received",
                  "received",
                ].includes(status)}
                placeholder="Broj porudžbine ili potvrde"
              />
            </label>
          </div>
          <label>
            {["issue", "cancelled"].includes(status)
              ? "Šta treba rešiti?"
              : "Interna beleška"}
            <textarea
              name="note"
              defaultValue={group.note ?? ""}
              maxLength={2000}
              rows={3}
              required={["issue", "cancelled"].includes(status)}
              minLength={
                ["issue", "cancelled"].includes(status) ? 3 : undefined
              }
              placeholder="Dostupnost, dogovoreni rok, napomena za kolege…"
            />
          </label>
          {status !== group.status &&
            ["ordered", "partially_received", "received", "cancelled"].includes(
              status,
            ) && (
              <label className="proc-check">
                <input type="checkbox" required />
                <span>
                  {group.demo
                    ? "Potvrđujem promenu test statusa; bez stvarne nabavke."
                    : status === "ordered"
                      ? "Nabavka je poslata dobavljaču kroz dogovoreni kanal."
                      : status === "partially_received"
                        ? "Upisane količine odgovaraju robi koja je stvarno stigla."
                        : status === "received"
                          ? "Sve stavke i količine ove nabavke su stvarno primljene."
                          : "Potvrđujem otkazivanje ove nabavke; dobavljač je obavešten ako je poručivanje već obavljeno."}
                </span>
              </label>
            )}
          <button
            className="button button-dark"
            type="submit"
            disabled={saving}
          >
            {saving ? (
              <LoaderCircle size={16} className="account-spin" />
            ) : (
              <Check size={16} />
            )}
            {saving
              ? "Čuvanje…"
              : group.demo
                ? "Sačuvaj test status"
                : "Sačuvaj evidenciju"}
          </button>
          <small>
            Poslednja izmena {dateTime(group.updated_at)}
            {group.ordered_at
              ? ` · Poručeno ${dateTime(group.ordered_at)}`
              : ""}
          </small>
        </form>
      )}
    </>
  );
}

function SupplierCard({
  source,
  saving,
  onSubmit,
  api,
  onSourceSaved,
}: {
  source: CountedSupplier;
  saving: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  api: Api;
  onSourceSaved: (syncRequired: boolean) => void;
}) {
  return (
    <article className="proc-supplier-card">
      <div className="proc-supplier-card-head">
        <span
          className={`proc-supplier-mark is-${source.supplier.toLowerCase()}`}
        >
          {supplierMark(source.supplier, source.label)}
        </span>
        <div>
          <h4>{source.label}</h4>
          <span className={`proc-source-status is-${source.status}`}>
            {supplierStatuses[source.status]}
          </span>
        </div>
        <Truck size={21} />
      </div>
      <div className="proc-supplier-numbers">
        <div>
          <strong>{source.productCount.toLocaleString("sr-Latn-RS")}</strong>
          <span>u katalogu</span>
        </div>
        <div>
          <strong>{source.availableCount.toLocaleString("sr-Latn-RS")}</strong>
          <span>dostupnih artikala</span>
        </div>
      </div>
      <dl className="proc-source-meta">
        <div>
          <dt>API / cenovnik</dt>
          <dd>
            {source.configured ? "Pristup podešen" : "Čeka pristupne podatke"}
          </dd>
        </div>
        <div>
          <dt>Poslednje osvežavanje</dt>
          <dd>
            {dateTime(
              source.lastSync?.finished_at || source.lastSync?.started_at,
            )}
          </dd>
        </div>
        <div>
          <dt>Poručivanje</dt>
          <dd>Lista → dogovoreni kanal</dd>
        </div>
        <div>
          <dt>Prodajni katalog</dt>
          <dd>
            {source.catalog_enabled
              ? "Uključen uz proveru podataka"
              : "Čeka aktivaciju"}
          </dd>
        </div>
      </dl>
      {source.warnings.length > 0 && (
        <div className="proc-warnings">
          <ul>
            {source.warnings.map((warning, index) => (
              <li key={`${index}-${warning}`}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      <SupplierCatalog source={source} api={api} />
      <SupplierSourceEditor supplier={source.supplier} api={api} onSaved={onSourceSaved} />
      <details className="proc-supplier-settings">
        <summary>
          <Settings2 size={16} /> Podešavanja dobavljača{" "}
          <ChevronRight size={16} />
        </summary>
        <form onSubmit={onSubmit}>
          <p className="proc-help">
            Cenu, valutu i poreski tretman potvrdite sa dobavljačem. Promena
            cenovne osnove isključuje objavu do novog osvežavanja kataloga.
          </p>
          <div className="proc-form-grid">
            {source.supplier === "trig" && (
              <label className="proc-field-full">
                Koja API cena važi za prodavnicu?
                <select
                  name="priceField"
                  defaultValue={source.price_field ?? ""}
                >
                  <option value="">Nije potvrđena</option>
                  <option value="Price">Price</option>
                  <option value="ClientPrice">ClientPrice</option>
                </select>
              </label>
            )}
            <label>
              Valuta nabavne cene
              <select
                name="priceCurrency"
                defaultValue={source.price_currency ?? ""}
              >
                <option value="">Nije potvrđena</option>
                <option value="RSD">RSD — dinar</option>
                <option value="EUR">EUR — evro</option>
                <option value="USD">USD — dolar</option>
              </select>
            </label>
            <label>
              PDV u nabavnoj ceni
              <select
                name="priceIncludesVat"
                defaultValue={
                  source.price_includes_vat === null
                    ? ""
                    : String(source.price_includes_vat)
                }
              >
                <option value="">Nije potvrđeno</option>
                <option value="false">Cena bez PDV-a</option>
                <option value="true">Cena sa PDV-om</option>
              </select>
            </label>
            <label>
              Svežina zaliha (sati)
              <input
                name="stockMaxAgeHours"
                type="number"
                min={1}
                max={168}
                step={1}
                required
                defaultValue={source.stock_max_age_hours}
              />
            </label>
            <label>
              Rezerva zaliha (kom.)
              <input
                name="safetyStock"
                type="number"
                min={0}
                max={100000}
                step={1}
                required
                defaultValue={source.safety_stock}
              />
            </label>
            <label>
              Dogovoreni rok (dana)
              <input
                name="leadTimeDays"
                type="number"
                min={0}
                max={90}
                step={1}
                defaultValue={source.lead_time_days ?? ""}
                placeholder="Nije potvrđen"
              />
            </label>
            <label>
              Prioritet izvora
              <input
                name="priority"
                type="number"
                min={0}
                max={1000}
                step={1}
                required
                defaultValue={source.priority}
              />
            </label>
          </div>
          <p className="proc-help">
            Rezerva se primenjuje na poznate količine. Dostupnost bez tačne
            količine traži proveru kod dobavljača. Dogovoreni rok dobavljača
            nije obećani rok isporuke kupcu.
          </p>
          <label className="proc-check">
            <input
              type="checkbox"
              name="catalogEnabled"
              defaultChecked={source.catalog_enabled}
            />
            <span>
              Uključi ovog dobavljača u prodajni katalog kada podaci prođu
              proveru.
            </span>
          </label>
          <button
            className="button button-dark"
            type="submit"
            disabled={saving}
          >
            {saving ? (
              <LoaderCircle size={16} className="account-spin" />
            ) : (
              <Check size={16} />
            )}
            Sačuvaj podešavanja
          </button>
        </form>
      </details>
    </article>
  );
}

function SupplierCatalog({
  source,
  api,
}: {
  source: SupplierOverview;
  api: Api;
}) {
  const [catalog, setCatalog] = useState<CatalogPreview | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function searchCatalog() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ catalog: CatalogPreview }>(
        `/api/admin/procurement?supplier=${encodeURIComponent(source.supplier)}&catalogQuery=${encodeURIComponent(query.trim())}&supplierStats=0`,
      );
      if (active.current) setCatalog(result.catalog);
    } catch (err) {
      if (active.current)
        setError(
          err instanceof Error
            ? err.message
            : "Pregled kataloga nije dostupan.",
        );
    } finally {
      if (active.current) setBusy(false);
    }
  }
  function rawPrice(value: number | null) {
    return value === null
      ? "—"
      : prikazIznosa(Number(value));
  }
  return (
    <details
      className="proc-supplier-settings proc-catalog-preview"
      onToggle={(event) => {
        if (event.currentTarget.open && !catalog && !busy) void searchCatalog();
      }}
    >
      <summary>
        <Search size={16} /> Pregled uvezenih artikala{" "}
        <ChevronRight size={16} />
      </summary>
      <p className="proc-help">
        Ovo su podaci dobavljača. Pregled je dostupan i kada artikli još nisu
        odobreni za prodavnicu.
      </p>
      <form
        className="proc-catalog-search"
        onSubmit={(event) => {
          event.preventDefault();
          void searchCatalog();
        }}
      >
        <label className="proc-search">
          <span className="proc-sr-only">Naziv artikla kod dobavljača</span>
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={100}
            placeholder="Naziv artikla…"
          />
        </label>
        <button
          type="submit"
          className="proc-icon-button"
          disabled={busy}
          aria-label="Pretraži katalog dobavljača"
        >
          {busy ? (
            <LoaderCircle size={18} className="account-spin" />
          ) : (
            <ArrowRight size={18} />
          )}
        </button>
      </form>
      {error && (
        <p className="proc-catalog-error" role="alert">
          {error}
        </p>
      )}
      {!source.price_currency && (
        <p className="proc-help">
          Valuta prikazanih cena nije potvrđena. Vrednosti se ne koriste za
          prodaju dok se cenovna osnova ne potvrdi.
        </p>
      )}
      {source.price_currency && (
        <p className="proc-help">
          Potvrđena valuta: {source.price_currency}.{" "}
          {source.price_includes_vat === null
            ? "PDV nije potvrđen."
            : source.price_includes_vat
              ? "Cena uključuje PDV."
              : "Cena je bez PDV-a."}
        </p>
      )}
      <div className="proc-catalog-results" aria-busy={busy}>
        {catalog?.items.map((item) => (
          <div key={item.supplier_sku} className="proc-catalog-item">
            <strong>{item.name}</strong>
            <code>{item.supplier_sku}</code>
            <div>
              <span>
                {source.supplier === "trig" ? "Price" : "Nabavna cena"}
                <b>
                  {rawPrice(item.price)}
                  {source.price_currency ? ` ${source.price_currency}` : ""}
                </b>
              </span>
              {source.supplier === "trig" && (
                <span>
                  ClientPrice
                  <b>
                    {rawPrice(item.client_price)}
                    {source.price_currency ? ` ${source.price_currency}` : ""}
                  </b>
                </span>
              )}
            </div>
            <small
              className={
                item.available && item.stock_status === "available"
                  ? "is-available"
                  : ""
              }
            >
              {!item.available || item.stock_status === "unavailable"
                ? "Nije dostupno"
                : item.stock_status !== "available"
                  ? "Lager treba proveriti"
                  : item.stock !== null
                    ? `Raspoloživo ${item.stock} kom.`
                    : "Dostupnost bez tačne količine"}
            </small>
          </div>
        ))}
      </div>
      {catalog && !catalog.items.length && (
        <p className="proc-help">Nema artikala za ovu pretragu.</p>
      )}
      {catalog?.hasMore && (
        <p className="proc-help">
          Prikazano je prvih 50 rezultata. Unesite precizniji naziv za uži
          izbor.
        </p>
      )}
    </details>
  );
}

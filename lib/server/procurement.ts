import { z } from "zod";
import { getAdminClient, HttpError } from "@/lib/server/supabase";

export const procurementStatuses = ["pending", "ordered", "confirmed", "partially_received", "received", "issue", "cancelled"] as const;
export type ProcurementStatus = (typeof procurementStatuses)[number];

export const procurementActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_procurement"),
    id: z.uuid(), version: z.number().int().positive(), status: z.enum(procurementStatuses),
    supplierReference: z.string().trim().max(160).optional(),
    note: z.string().trim().max(2000).optional(),
    // Primljene kolicine po stavci. Izostanak znaci "ne diraj kolicine", pa
    // stari tok potvrde prijema radi nepromenjeno.
    items: z.array(z.object({
      id: z.uuid(), quantity: z.number().int().min(0).max(20),
    }).strict()).max(50).optional(),
  }).strict(),
  z.object({
    action: z.literal("update_supplier_settings"),
    // Kod dobavljaca iz supplier_sources; da li postoji proverava RPC (NOT_FOUND).
    supplier: z.string().regex(/^[a-z0-9_-]{1,40}$/),
    priceCurrency: z.enum(["RSD", "EUR", "USD"]).nullable(),
    priceField: z.enum(["Price", "ClientPrice"]).nullable(),
    priceIncludesVat: z.boolean().nullable(), catalogEnabled: z.boolean(),
    stockMaxAgeHours: z.number().int().min(1).max(168),
    safetyStock: z.number().int().min(0).max(100000),
    leadTimeDays: z.number().int().min(0).max(90).nullable(),
    priority: z.number().int().min(0).max(1000),
  }).strict(),
]);

export const procurementTransitions: Record<ProcurementStatus, ProcurementStatus[]> = {
  pending: ["ordered", "issue", "cancelled"],
  ordered: ["confirmed", "issue", "cancelled"],
  confirmed: ["partially_received", "received", "issue", "cancelled"],
  partially_received: ["received", "issue", "cancelled"],
  received: ["issue"],
  issue: ["pending", "ordered", "confirmed", "partially_received", "received", "cancelled"],
  cancelled: [],
};

const nextActions: Record<ProcurementStatus, string> = {
  pending: "Proverite lager i uslove, pošaljite pripremljen spisak dobavljaču i upišite broj njegove potvrde.",
  ordered: "Sačekajte potvrdu dobavljača za sve stavke; zatim označite da je nabavka potvrđena.",
  confirmed: "Pratite isporuku i uporedite primljenu robu sa stavkama pre potvrde prijema.",
  partially_received: "Stigao je deo robe. Upišite koliko je komada primljeno i dogovorite ostatak sa dobavljačem.",
  received: "Roba ove nabavke je primljena. Kada stignu svi artikli, pripremite isporuku kupcu.",
  issue: "Razrešite zabeležen problem sa dobavljačem i kupcem, pa upišite dogovor i odgovarajući status.",
  cancelled: "Nabavka je otkazana. Proverite ostale grupe i dogovorite nastavak sa kupcem.",
};

export function procurementError(message: string): never {
  const messages: Record<string, [number, string]> = {
    PAYMENT_NOT_PAID: [409, "Najpre potvrdite priliv QR uplate prema bankarskom izvodu."],
    PAYMENT_NOT_AUTHORIZED: [409, "Najpre sačekajte potvrdu rezervacije sredstava iz banke."],
    PAYMENT_CAPTURE_REQUIRED: [409, "Konačna naplata mora biti potvrđena u banci pre završetka porudžbine."],
    PAYMENT_REQUIRED: [409, "Najpre sačekajte potvrđenu rezervaciju sredstava za ovu porudžbinu."],
    PAYMENT_REVERSAL_REQUIRED: [409, "Najpre proverite rezervaciju, naplatu ili povraćaj u banci. Otkazivanje ne vraća sredstva automatski."],
    VERSION_CONFLICT: [409, "Drugi administrator je već izmenio nabavku. Osvežite prikaz i pokušajte ponovo."],
    NOT_FOUND: [404, "Tražena nabavka ili dobavljač ne postoji."],
    FORBIDDEN: [403, "Ova radnja je dostupna administratoru."],
    ORDER_CLOSED: [409, "Porudžbina je završena ili otkazana i više se ne menja."],
    INVALID_TRANSITION: [409, "Ovaj prelaz statusa nije dozvoljen. Osvežite prikaz."],
    REFERENCE_REQUIRED: [400, "Upišite referencu porudžbine ili potvrde koju ste dobili od dobavljača."],
    NOTE_REQUIRED: [400, "Opišite razlog problema ili otkazivanja u napomeni."],
    SUPPLIER_NOT_READY: [409, "Najpre potvrdite izvor, valutu i PDV za ovog dobavljača."],
    UNSUPPORTED_CURRENCY: [409, "Objava u dinarima zahteva potvrđenu RSD cenu. Konverzija iz druge valute nije podešena."],
    RESYNC_REQUIRED: [409, "Posle izmene cenovne osnove prvo pokrenite novu sinhronizaciju, pa uključite katalog."],
    INVALID_STATUS: [400, "Status ili uneti podaci nisu ispravni."],
    INVALID_RECEIPT: [400, "Primljena količina ne može biti veća od poručene. Proverite unos."],
    RECEIPT_EMPTY: [400, "Upišite koliko je komada stiglo da biste zabeležili delimičan prijem."],
    RECEIPT_COMPLETE: [400, "Sve stavke su primljene u celosti. Označite prijem kao potpun."],
    PROCUREMENT_INCOMPLETE: [409, "Najpre potvrdite prijem svih nabavki u Centru nabavke."],
    PROCUREMENT_IN_PROGRESS: [409, "Najpre sa dobavljačima razrešite i otkažite aktivne nabavke u Centru nabavke."],
  };
  for (const [code, [status, text]] of Object.entries(messages)) {
    if (message.includes(code)) throw new HttpError(status, text);
  }
  throw new HttpError(503, "Izmena nabavke nije sačuvana. Pokušajte ponovo.");
}

type GroupItem = {
  id: string; product_id: string; name: string; quantity: number; received_quantity: number; unit_price: number; line_total: number;
  supplier_sku: string | null; supplier_unit_cost: number | null; supplier_cost_currency: string | null;
  supplier_price_includes_vat: boolean | null;
};
type Group = {
  id: string; order_id: string; supplier: string; supplier_label: string; status: ProcurementStatus;
  version: number; supplier_reference: string; note: string; created_at: string; updated_at: string;
  ordered_at: string | null; received_at: string | null;
  order: { id: string; reference: string; status: string; customer: Record<string, string>; payment_method: string; payment_status: string; total: number; currency: string; created_at: string; demo: boolean };
  items: GroupItem[];
};

/** Absent flag preserves the full response expected by older admin bundles. */
export function parseSupplierStatsFlag(value: string | null): boolean {
  if (value === null || value === "1") return true;
  if (value === "0") return false;
  throw new HttpError(400, "Prikaz statistike dobavljača nije ispravan.");
}

export async function getProcurementOverview(catalogSupplier?: string, catalogQuery = "", offset = 0, includeSupplierStats = true) {
  const admin = getAdminClient();
  const [groupsResult, sourcesResult, runsResult] = await Promise.all([
    admin.from("supplier_orders").select(`id,order_id,supplier,supplier_label,status,version,supplier_reference,note,created_at,updated_at,ordered_at,received_at,
      order:orders!inner(id,reference,status,customer,total,currency,created_at,demo,payment_method,payment_status),
      items:order_items(id,product_id,name,quantity,received_quantity,unit_price,line_total,supplier_sku,supplier_unit_cost,supplier_cost_currency,supplier_price_includes_vat)`, { count: "exact" })
      .order("is_open", { ascending: false }).order("created_at").order("id").range(offset, offset + 200),
    admin.from("supplier_sources").select("supplier,label,enabled,url,kind,catalog_enabled,price_currency,price_includes_vat,price_field,price_basis_updated_at,fulfillment_mode,stock_is_quantity,stock_max_age_hours,safety_stock,lead_time_days,priority"),
    admin.from("supplier_sync_runs").select("id,supplier,status,started_at,finished_at,rows_in_source,added,removed,price_changed,error")
      .order("started_at", { ascending: false }).limit(100),
  ]);
  if (groupsResult.error || sourcesResult.error || runsResult.error) {
    throw new HttpError(503, "Centar nabavke trenutno nije dostupan. Pokušajte ponovo.");
  }
  const groups = (groupsResult.data ?? []).slice(0, 200) as unknown as Group[];
  type SourceRow = NonNullable<typeof sourcesResult.data>[number];
  type RunRow = NonNullable<typeof runsResult.data>[number];
  type SupplierSummary = Omit<SourceRow, "url"> & {
    configured: boolean;
    lastSync: RunRow | null;
    latestRun: RunRow | null;
    productCount: number | null;
    availableCount: number | null;
    warnings: string[];
    syncRequired: boolean;
    status: "ready" | "stale" | "unconfigured" | "disabled" | "needs_setup";
  };
  const suppliers: SupplierSummary[] = [];
  // At most one supplier's two counts run together; the queue/catalog preview need neither.
  for (const source of sourcesResult.data ?? []) {
    let productCount: number | null = null;
    let availableCount: number | null = null;
    if (includeSupplierStats) {
      const [total, available] = await Promise.all([
        admin.from("supplier_products").select("supplier_sku", { count: "exact", head: true }).eq("supplier", source.supplier),
        admin.from("supplier_products").select("supplier_sku", { count: "exact", head: true }).eq("supplier", source.supplier).eq("available", true).eq("stock_status", "available"),
      ]);
      if (total.error || available.error || typeof total.count !== "number" || typeof available.count !== "number") {
        throw new HttpError(503, "Stanje dobavljača trenutno nije dostupno.");
      }
      productCount = total.count;
      availableCount = available.count;
    }
    const latestRun = (runsResult.data ?? []).find((run) => run.supplier === source.supplier);
    const lastSync = (runsResult.data ?? []).find((run) => run.supplier === source.supplier && run.status === "ok" && run.finished_at) ?? null;
    const stale = !lastSync || Date.now() - Date.parse(lastSync.finished_at!) > source.stock_max_age_hours * 3600000;
    // MS Mobile ima adresu i bez prijave; bez naloga u okruzenju sinhronizacija ne moze da prodje.
    // Vrednosti se nikad ne ispisuju, samo da li postoje.
    const configured = Boolean(source.url)
      && (source.supplier !== "msmobile" || Boolean(process.env.MSMOBILE_EMAIL && process.env.MSMOBILE_PASSWORD));
    const warnings: string[] = [];
    if (!configured) warnings.push(source.supplier === "msmobile" && source.url ? "Nalog za MS Mobile (MSMOBILE_EMAIL i MSMOBILE_PASSWORD) nije podešen na serveru." : "Pristup izvoru nije podešen.");
    if (!source.enabled) warnings.push("Sinhronizacija je isključena.");
    if (!source.price_currency || source.price_includes_vat === null) warnings.push("Valuta i način obračuna PDV-a čekaju potvrdu dobavljača.");
    if (source.supplier === "trig" && !source.price_field) warnings.push("Potvrdite koja cena iz API-ja važi za ovu prodavnicu: Price ili ClientPrice.");
    const syncRequired = Boolean(source.price_basis_updated_at && (!lastSync || Date.parse(lastSync.started_at) < Date.parse(source.price_basis_updated_at)));
    if (syncRequired) warnings.push("Cenovna osnova je promenjena. Nova sinhronizacija je obavezna pre objave.");
    if (source.price_currency && source.price_currency !== "RSD") warnings.push("Objava zahteva potvrđenu konverziju u RSD.");
    if (stale) warnings.push("Lager nije dovoljno svež za sigurnu nabavku; proverite stanje sa dobavljačem.");
    if (latestRun?.status === "failed") warnings.push(`Poslednja sinhronizacija nije uspela${latestRun.error ? `: ${latestRun.error}` : "."}`);
    if (!source.catalog_enabled) warnings.push("Katalog ovog dobavljača nije uključen za objavu.");
    if (source.supplier === "trig") warnings.push("API ne šalje porudžbine. Dostupnost iz izvora može biti bez tačne količine.");
    else if (source.stock_is_quantity === false) warnings.push("Izvor šalje samo da li artikal ima, bez tačne količine. Porudžbine se šalju ručno; količinu potvrđuje dobavljač.");
    // Deliberately omit credential-bearing source URLs and arbitrary source notes.
    const { url: _url, ...safe } = source;
    suppliers.push({
      ...safe, configured, lastSync, latestRun: latestRun ?? null, productCount,
      availableCount, warnings, syncRequired,
      status: !configured ? "unconfigured" : !source.enabled ? "disabled" : !source.price_currency || source.price_includes_vat === null
        || (source.supplier === "trig" && !source.price_field) || syncRequired
        ? "needs_setup" : stale || latestRun?.status === "failed" ? "stale" : "ready",
    });
  }
  const summary = { pending: 0, ordered: 0, confirmed: 0, partially_received: 0, received: 0, issue: 0, cancelled: 0, demo: 0, total: groups.length };
  const orders = groups.map((group) => {
    summary[group.status]++;
    if (group.order.demo) summary.demo++;
    const source = suppliers.find((supplier) => supplier.supplier === group.supplier);
    const warnings: string[] = [];
    if (group.order.demo) warnings.push("Demo porudžbina: ne rezerviše lager i ne predstavlja stvarnu nabavku.");
    if (group.supplier === "unassigned") warnings.push("Artikli nemaju povezanog dobavljača. Nabavka ne može biti potvrđena.");
    if (group.items.some((item) => item.supplier_unit_cost === null || item.supplier_cost_currency === null)) warnings.push("Za deo stavki nabavna cena nije potvrđena. Zbir nije konačna obaveza prema dobavljaču.");
    if (source?.status !== "ready" && group.status === "pending") warnings.push("Proverite podešavanja dobavljača i aktuelni lager pre nabavke.");
    const paymentBlocked = group.order.payment_method === "ips_qr" ? group.order.payment_status !== "paid" : group.order.payment_method === "card" && !["authorized", "paid"].includes(group.order.payment_status);
    if (paymentBlocked) warnings.push("Plaćanje još nije potvrđeno. Nabavku nastavite tek nakon potvrde banke.");
    const closed = ["completed", "cancelled"].includes(group.order.status);
    return {
      ...group, demo: group.order.demo, warnings,
      nextAction: paymentBlocked && !closed ? "Sačekajte potvrdu plaćanja. Ne poručujte robu od dobavljača." : closed ? "Porudžbina je zatvorena. Sačuvani podaci služe za pregled istorije." : group.order.demo ? `Simulacija toka: ${nextActions[group.status]}` : nextActions[group.status],
      allowedTransitions: closed || paymentBlocked ? [] : procurementTransitions[group.status].filter((status) => group.supplier !== "unassigned" || !["ordered", "confirmed", "partially_received", "received"].includes(status)),
    };
  });
  let catalog = null;
  if (catalogSupplier) {
    if (!suppliers.some((source) => source.supplier === catalogSupplier)) throw new HttpError(400, "Izaberite postojećeg dobavljača.");
    let query = admin.from("supplier_products")
      .select("supplier_sku,name,price_excl_vat,currency,stock,stock_status,available,source_payload")
      .eq("supplier", catalogSupplier).order("supplier_sku").limit(51);
    // Parameterized ilike; escape wildcard characters to make search literal.
    const needle = catalogQuery.trim().slice(0, 100).replace(/[\\%_]/g, "\\$&");
    if (needle) query = query.ilike("name", `%${needle}%`);
    const result = await query;
    if (result.error) throw new HttpError(503, "Pregled artikala dobavljača trenutno nije dostupan.");
    catalog = {
      supplier: catalogSupplier,
      items: (result.data ?? []).slice(0, 50).map((item) => {
        const payload = item.source_payload as Record<string, unknown> | null;
        const amount = (value: unknown) => value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
        return {
          supplier_sku: item.supplier_sku, name: item.name,
          price: catalogSupplier === "trig" ? amount(payload?.Price) : Number(item.price_excl_vat),
          client_price: catalogSupplier === "trig" ? amount(payload?.ClientPrice) : null,
          currency: suppliers.find((source) => source.supplier === catalogSupplier)?.price_currency ?? null,
          stock: item.stock, available: item.available,
          stock_status: item.stock_status ?? "unknown",
        };
      }),
      hasMore: (result.data?.length ?? 0) > 50,
    };
  }
  return { orders, suppliers, summary, catalog, demo: orders.some((group) => group.demo), hasMore: (groupsResult.data?.length ?? 0) > 200, offset, totalCount: groupsResult.count ?? groups.length, summaryScope: "displayed", generatedAt: new Date().toISOString() };
}

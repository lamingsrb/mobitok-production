// Admin 03.11: rucne izmene osoblja (tabela product_overrides) koje automatska objava kataloga postuje.
// Bez migracije (tabela ili funkcije ne postoje) sve ovde je prazan prolaz: objava radi kao i ranije.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface OverrideRow {
  product_id: string;
  name: string | null;
  seo_title: string | null;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  deleted: boolean;
  orig: Record<string, unknown>;
}
export type OverrideMap = ReadonlyMap<string, OverrideRow>;
export const NO_OVERRIDES: OverrideMap = new Map();
/** Prikazana polja stage reda. Original je ono sto bi objava upisala bez rucne izmene. */
export type OverrideFields = { name: string; description: string | null; category: string; subcategory: string | null };

const PAGE_SIZE = 1000;
const RECONCILE_LIMIT = 500;
// Najvise 20 krugova po objavi; ostatak ispravljaju stage redovi sledece objave.
const RECONCILE_ROUNDS = 20;
const REFRESH_BATCH = 200;
// "Nema migracije": tabela ili funkcija ne postoji (kodovi Postgres-a i PostgREST-a).
const MISSING_TABLE = new Set(["42P01", "PGRST205"]);
const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);
const COLUMNS = "product_id,name,seo_title,description,category,subcategory,deleted,orig";

const errorCode = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "";
const text = (value: unknown) => (typeof value === "string" ? value : null);
const toOverride = (row: Record<string, unknown>): OverrideRow => ({
  product_id: String(row.product_id),
  name: text(row.name),
  seo_title: text(row.seo_title),
  description: text(row.description),
  category: text(row.category),
  subcategory: text(row.subcategory),
  deleted: row.deleted === true,
  orig: typeof row.orig === "object" && row.orig !== null && !Array.isArray(row.orig) ? (row.orig as Record<string, unknown>) : {},
});

/** Cita sve override-e jednog dobavljaca (keyset po product_id, strana 1000). 42P01/PGRST205 ili data===null -> NO_OVERRIDES. */
export async function loadSupplierOverrides(db: SupabaseClient, supplier: string): Promise<OverrideMap> {
  const map = new Map<string, OverrideRow>();
  let after: string | null = null;
  for (;;) {
    let query = db.from("product_overrides").select(COLUMNS).eq("supplier", supplier).order("product_id").limit(PAGE_SIZE);
    if (after !== null) query = query.gt("product_id", after);
    const { data, error } = await query;
    if (error) {
      if (MISSING_TABLE.has(errorCode(error))) return NO_OVERRIDES;
      // Ostale greske prekidaju objavu dobavljaca: bez mape bi vratila stare nazive i obrisane artikle.
      throw error;
    }
    if (!data) {
      if (after === null) return NO_OVERRIDES;
      // Delimicna mapa bi u ostatku kataloga pregazila izmene osoblja.
      throw new Error("Rucne izmene osoblja nisu procitane u celosti");
    }
    for (const row of data) map.set(String(row.product_id), toOverride(row));
    // Admin 03.11 (K1): PostgREST max-rows moze skratiti stranu ispod PAGE_SIZE; zato se cita do prazne strane.
    if (data.length === 0) break;
    after = String(data[data.length - 1].product_id);
  }
  return map.size ? map : NO_OVERRIDES;
}

/** Primenjuje override na staging red; vraca null kad je artikal obrisan (pozivalac radi `return []`). Cista funkcija. */
export function resolveOverride<T extends OverrideFields>(row: T, override: OverrideRow | undefined): T | null {
  if (!override) return row;
  if (override.deleted) return null;
  const patch: Partial<OverrideFields> = {};
  if (override.name !== null) patch.name = override.name;
  if (override.description !== null) patch.description = override.description;
  // Lokacija samo u paru (par-constraint u tabeli); "bez podgrupe" je subcategory "" i prenosi se takva.
  if (override.category !== null && override.subcategory !== null) {
    patch.category = override.category;
    patch.subcategory = override.subcategory;
  }
  return { ...row, ...patch };
}

/** Za override-ovan artikal gradi red {id,name,description,category,subcategory} sa dobavljacevim ORIGINALOM (pre override-a). */
export function origRefreshRow(id: string, original: OverrideFields): Record<string, string | null> {
  return { id, name: original.name, description: original.description, category: original.category, subcategory: original.subcategory };
}

/** Da li bi refresh_override_originals promenio snimak `orig` (isto pravilo kao SQL). Objava salje samo takve redove (K9). */
export function originalChanged(orig: Record<string, unknown>, original: OverrideFields): boolean {
  if ("name" in orig && orig.name !== original.name) return true;
  if ("description" in orig && original.description !== null && orig.description !== original.description) return true;
  return "category" in orig && (orig.category !== original.category || orig.subcategory !== (original.subcategory ?? ""));
}

/** Poziva reconcile_product_overrides(p_supplier,p_since,500) u petlji dok vraca 500; PGRST202/42883 -> 0; ostale greske se loguju i NE bacaju. */
export async function reconcileOverrides(db: SupabaseClient, supplier: string, since: Date): Promise<number> {
  let total = 0;
  try {
    for (let round = 0; round < RECONCILE_ROUNDS; round++) {
      const { data, error } = await db.rpc("reconcile_product_overrides", { p_supplier: supplier, p_since: since.toISOString(), p_limit: RECONCILE_LIMIT });
      if (error) {
        if (!MISSING_FUNCTION.has(errorCode(error))) console.error("Rucne izmene nisu ponovo primenjene posle objave", error);
        break;
      }
      const count = typeof data === "number" ? data : 0;
      total += count;
      if (count < RECONCILE_LIMIT) break;
    }
  } catch (error) {
    console.error("Rucne izmene nisu ponovo primenjene posle objave", error);
  }
  return total;
}

/** Salje origRefreshRow redove u paketima <= 200 u refresh_override_originals; PGRST202/42883 -> 0; ne baca. */
export async function refreshOriginals(db: SupabaseClient, supplier: string, rows: Array<Record<string, string | null>>): Promise<number> {
  let total = 0;
  try {
    for (let start = 0; start < rows.length; start += REFRESH_BATCH) {
      const { data, error } = await db.rpc("refresh_override_originals", { p_supplier: supplier, p_rows: rows.slice(start, start + REFRESH_BATCH) });
      if (error) {
        if (!MISSING_FUNCTION.has(errorCode(error))) console.error("Originali rucnih izmena nisu osvezeni", error);
        break;
      }
      if (typeof data === "number") total += data;
    }
  } catch (error) {
    console.error("Originali rucnih izmena nisu osvezeni", error);
  }
  return total;
}

import { categories as builtinCategories } from "../catalog";
import { publicCatalogLayout } from "../catalog-layout";
import { loadCatalogLayout } from "./catalog-layout";
import { catalogOperation } from "./catalog-timing";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogFacets, CatalogMeta, CatalogSearch, CatalogSpecValue, Product } from "../catalog";

export type { CatalogFacets, CatalogMeta, CatalogSearch };

// Katalog ima blizu 25.000 artikala od dva dobavljaca. Pregledac zato nikad ne
// dobija ceo katalog: baza vrati tacno jednu stranicu i brojace za filtere, pa
// je posao pretrage i sortiranja tamo gde su indeksi.
//
// Nabavna cena i uslovi dobavljaca ne smeju da izadju u javni sloj, pa su ove
// funkcije u bazi dodeljene samo service_role ulozi. Zove ih iskljucivo server.

export type CatalogQuery = {
  query?: string | null;
  category?: string | null;
  subcategory?: string | null;
  deviceBrand?: string | null;
  device?: string | null;
  brand?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  sort?: string | null;
  page?: number;
  pageSize?: number;
  withFacets?: boolean;
  // Izabrane vrednosti svojstava: ILI unutar jednog kljuca, I izmedju kljuceva
  // ({"Snaga": ["65 W", "90 W"], "Napon": ["19 V"]}). Ruta je vec proverila kljuceve
  // i vrednosti, a baza ih proverava ponovo.
  specs?: Record<string, string[]> | null;
  // Za koje kljuceve se traze brojaci vrednosti (samo uz withFacets).
  specKeys?: string[] | null;
};

const tekst = (value: unknown) => (typeof value === "string" ? value : "");
const nizTekstova = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const broj = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const zapis = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

// Baza vraca tacno polja koja prodajna povrsina cita. Ovde se popunjava samo ono
// cega u listi nema, da tip artikla ostane jedan u celoj aplikaciji. Lista ne
// nosi opis i specifikaciju, pa `detailed` kaze da li zapis sme na stranicu
// artikla ili se za njega jos mora pitati catalog_items.
function uArtikal(raw: Record<string, unknown>, detailed: boolean): Product {
  const specs: Record<string, string> = {};
  for (const [kljuc, vrednost] of Object.entries(zapis(raw.specs)))
    if (typeof vrednost === "string") specs[kljuc] = vrednost;
  const availability: Product["availability"] =
    raw.availability === "available" || raw.availability === "unavailable" ? raw.availability : "check";
  return {
    id: tekst(raw.id),
    slug: tekst(raw.slug),
    name: tekst(raw.name),
    category: tekst(raw.category),
    subcategory: tekst(raw.subcategory),
    brand: tekst(raw.brand),
    deviceBrand: typeof raw.deviceBrand === "string" ? raw.deviceBrand : null,
    devices: nizTekstova(raw.devices),
    price: Number(raw.price) || 0,
    image: tekst(raw.image),
    images: nizTekstova(raw.images),
    description: tekst(raw.description),
    specs,
    stock: Number(raw.stock) || 0,
    isDemo: raw.isDemo === true,
    sourceUrl: typeof raw.sourceUrl === "string" ? raw.sourceUrl : undefined,
    tags: nizTekstova(raw.tags),
    supplier: typeof raw.supplier === "string" ? raw.supplier : undefined,
    availability,
    leadTimeDays: broj(raw.leadTimeDays),
    detailed,
  };
}

const brojaci = (value: unknown): Record<string, number> => {
  const rezultat: Record<string, number> = {};
  for (const [kljuc, vrednost] of Object.entries(zapis(value)))
    if (typeof vrednost === "number" && Number.isFinite(vrednost)) rezultat[kljuc] = vrednost;
  return rezultat;
};

// Stara baza (pre migracije 202610110001) ne salje deviceModels ni specs: tada ostaju
// prazni objekti i odgovor je i dalje ispravan.
const uSvojstva = (value: unknown): Record<string, CatalogSpecValue[]> => {
  const rezultat: Record<string, CatalogSpecValue[]> = {};
  for (const [kljuc, lista] of Object.entries(zapis(value))) {
    if (!Array.isArray(lista)) continue;
    const vrednosti: CatalogSpecValue[] = [];
    for (const red of lista) {
      const r = zapis(red);
      const vrednost = tekst(r.value);
      const n = broj(r.count);
      if (vrednost && n !== null && n > 0) vrednosti.push({ value: vrednost, count: Math.trunc(n) });
    }
    if (vrednosti.length) rezultat[kljuc] = vrednosti;
  }
  return rezultat;
};

export const uFasete = (value: unknown): CatalogFacets | null => {
  const sirovo = zapis(value);
  if (!Object.keys(sirovo).length) return null;
  const opseg = zapis(sirovo.priceRange);
  return {
    categories: brojaci(sirovo.categories),
    subcategories: brojaci(sirovo.subcategories),
    deviceBrands: brojaci(sirovo.deviceBrands),
    brands: brojaci(sirovo.brands),
    priceRange: { min: broj(opseg.min), max: broj(opseg.max) },
    deviceModels: brojaci(sirovo.deviceModels),
    specs: uSvojstva(sirovo.specs),
  };
};

const kodDijagnostike=(error:unknown)=>{
  const code=typeof error==="object"&&error!==null&&"code" in error?error.code:null;
  return typeof code==="string"&&/^(?:[0-9A-Z]{5}|PGRST[0-9A-Z]{3})$/.test(code)?code:"unknown";
};
// Samo ime RPC-a, bezbedan kod i trajanje: upit, kljucevi i poruke baze se ne beleze.
const catalogRpc=async(db:SupabaseClient,rpc:"search_catalog"|"catalog_meta"|"catalog_navigation_meta",args:Record<string,unknown>={})=>{
  const started=Date.now();
  const diagnostic=(error:unknown)=>console.warn("Katalog RPC nije uspeo",{rpc,code:kodDijagnostike(error),durationMs:Date.now()-started});
  try {
    const result=await db.rpc(rpc,args);
    if(result.error)diagnostic(result.error);
    return result;
  } catch(error) {
    diagnostic(error);
    throw error;
  }
};
const ceoBroj = (value: unknown, podrazumevano: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : podrazumevano;
};

const imaSvojstva = (izbor: Record<string, string[]> | null | undefined): izbor is Record<string, string[]> =>
  !!izbor && Object.values(izbor).some((vrednosti) => vrednosti.length > 0);

// Novi parametri se salju SAMO kad ih ima: poziv bez njih je isti kao ranije, pa deploy
// aplikacije ne mora da ceka migraciju za obicno listanje. Dok migracija nije pustena,
// PostgREST vraca PGRST202 (nema funkcije sa tim imenovanim argumentima):
//   - uz izabrana svojstva greska ide dalje (503 u ruti): bolje nista nego lista koja
//     tiho ignorise filter koji je kupac kliknuo;
//   - uz samo trazene brojace svojstava poziv se ponavlja bez njih, pa strana radi,
//     samo bez grupa svojstava.
export async function searchCatalog(db: SupabaseClient, upit: CatalogQuery): Promise<CatalogSearch> {
  const osnova = {
    p_query: upit.query || null,
    p_category: upit.category || null,
    p_subcategory: upit.subcategory || null,
    p_device_brand: upit.deviceBrand || null,
    p_device: upit.device || null,
    p_brand: upit.brand || null,
    p_min_price: typeof upit.minPrice === "number" ? upit.minPrice : null,
    p_max_price: typeof upit.maxPrice === "number" ? upit.maxPrice : null,
    p_sort: upit.sort || null,
    p_page: upit.page ?? 1,
    p_page_size: upit.pageSize ?? 48,
    p_with_facets: upit.withFacets !== false,
  };
  const dodatno: { p_specs?: Record<string, string[]>; p_spec_keys?: string[] } = {};
  if (imaSvojstva(upit.specs)) dodatno.p_specs = upit.specs;
  if (upit.specKeys?.length && osnova.p_with_facets) dodatno.p_spec_keys = upit.specKeys;
  let { data, error } = await catalogRpc(db,"search_catalog", { ...osnova, ...dodatno });
  if (error && error.code === "PGRST202" && dodatno.p_spec_keys && !dodatno.p_specs) {
    ({ data, error } = await catalogRpc(db,"search_catalog", osnova));
  }
  if (error) throw error;
  const odgovor = zapis(data);
  return {
    items: (Array.isArray(odgovor.items) ? odgovor.items : []).map((item) => uArtikal(zapis(item), false)),
    total: ceoBroj(odgovor.total, 0),
    page: ceoBroj(odgovor.page, 1),
    pageSize: ceoBroj(odgovor.pageSize, 48),
    pages: Math.max(1, ceoBroj(odgovor.pages, 1)),
    sort: tekst(odgovor.sort) || "newest",
    approximate: odgovor.approximate === true,
    facets: uFasete(odgovor.facets),
    ...(tekst(odgovor.catalogRevision) ? { catalogRevision: tekst(odgovor.catalogRevision) } : {}),
  };
}

// Korpa, sacuvano i stranica artikla traze poznate artikle po id-u ili slug-u.
// Uvek se cita sveze stanje, jer je lager dobavljaca snimak a ne rezervacija.
export async function catalogItems(db: SupabaseClient, kljucevi: string[]): Promise<Product[]> {
  const trazeni = Array.from(new Set(kljucevi.map((k) => (k || "").trim()).filter(Boolean))).slice(0, 60);
  if (!trazeni.length) return [];
  const { data, error } = await db.rpc("catalog_items", { p_ids: trazeni });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map((item) => uArtikal(zapis(item), true));
}

// Spisak kategorija, podkategorija i modela za navigaciju i biranje telefona.
// Ruta ih trenutno cita sveze, zajedno sa rezimom pripreme.
export async function catalogMeta(db: SupabaseClient, navigation = false): Promise<CatalogMeta> {
  // Admin 03.11: vidljivi redovi catalog_taxonomy (nazivi i nove grupe) citaju se uporedo sa RPC-om.
  // Bez tabele ili uz bilo koju gresku prodavnica radi kao do sada: prazan spisak, bez dijagnostike.
  type Red = NonNullable<CatalogMeta["taxonomy"]>[number];
  const taksonomija = (async (): Promise<Red[]> => {
    try {
      const { data, error } = await db
        .from("catalog_taxonomy")
        .select("kind,parent,slug,label_sr,label_en,hidden,sort_order")
        .limit(1000);
      if (error || !Array.isArray(data)) return [];
      return data.map(zapis).flatMap((red): Red[] => {
        const kind = red.kind;
        const slug = tekst(red.slug);
        const label_sr = tekst(red.label_sr);
        if ((kind !== "group" && kind !== "sub") || !slug || !label_sr) return [];
        return [{
          kind,
          parent: tekst(red.parent),
          slug,
          label_sr,
          label_en: tekst(red.label_en) || null,
          hidden: red.hidden === true,
          sort_order: ceoBroj(red.sort_order ?? 1000, 1000),
        }];
      });
    } catch {
      return [];
    }
  })();
  const [{ data, error }, layout] = await Promise.all([catalogRpc(db, navigation ? "catalog_navigation_meta" : "catalog_meta"), catalogOperation("layout", () => loadCatalogLayout(db))]);
  if (error) throw error;
  const odgovor = zapis(data);
  const rows = await taksonomija;
  const hiddenGroups = new Set(rows.filter((row) => row.kind === "group" && row.hidden).map((row) => row.slug));
  const hiddenSubs = new Set(rows.filter((row) => row.kind === "sub" && row.hidden).map((row) => `${row.parent}/${row.slug}`));
  const visiblePair = (category: string, key: string) => !hiddenGroups.has(category) && !hiddenSubs.has(`${category}/${key}`);
  const lista = (value: unknown) => (Array.isArray(value) ? value.map(zapis) : []);
  return {
    total: ceoBroj(odgovor.total, 0),
    ...(tekst(odgovor.catalogRevision) ? { catalogRevision: tekst(odgovor.catalogRevision) } : {}),
    priceMax: broj(odgovor.priceMax),
    categories: lista(odgovor.categories)
      .map((red) => ({ key: tekst(red.key), count: ceoBroj(red.count, 0) }))
      .filter((red) => red.key && !hiddenGroups.has(red.key)),
    subcategories: lista(odgovor.subcategories)
      .map((red) => ({ category: tekst(red.category), key: tekst(red.key), count: ceoBroj(red.count, 0) }))
      .filter((red) => red.key && visiblePair(red.category, red.key)),
    deviceBrands: lista(odgovor.deviceBrands)
      .map((red) => ({ key: tekst(red.key), count: ceoBroj(red.count, 0) }))
      .filter((red) => red.key),
    devices: lista(odgovor.devices)
      .map((red) => ({ brand: tekst(red.brand), key: tekst(red.key), count: ceoBroj(red.count, 0) }))
      .filter((red) => red.key),
    // Sakriveni cvorovi i njihovi brojaci ne izlaze u javni JSON. Bez brojaca ih merge ne moze ponovo dodati.
    layout: publicCatalogLayout(layout, new Set([...builtinCategories.map((group) => group.id), ...rows.filter((row) => row.kind === "group" && !row.hidden).map((row) => row.slug)])),
    taxonomy: rows.filter((row) => !row.hidden && (row.kind === "group" || !hiddenGroups.has(row.parent))),
  };
}

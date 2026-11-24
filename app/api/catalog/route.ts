import { getAdminClient, HttpError } from "@/lib/server/supabase";
import { searchCatalog, type CatalogQuery } from "@/lib/server/catalog-search";
import { readSpecParams, SPEC_LABELS, SPEC_KEYS, SPEC_SUBS } from "@/lib/catalog-specs";
import { samsungModelAlias } from "@/lib/server/samsung-code-aliases";
import { apiError, rateLimit } from "@/lib/server/http";
import { preparationMode } from "@/lib/server/shop-mode";
import { catalogTimings } from "@/lib/server/catalog-timing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTIRANJA = new Set(["newest", "low", "high", "relevance", "naziv"]);

const NE_KESIRAJ = { "Cache-Control": "no-store" };
const CATALOG_READ_DEADLINE_MS = 14_000;

const sqlCancelled = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "57014";

const parametar = (value: string | null, najvise = 80) => {
  const ocisceno = (value ?? "").trim().slice(0, najvise);
  return ocisceno || null;
};

const cena = (value: string | null) => {
  if (!value) return null;
  const broj = Number(value);
  return Number.isFinite(broj) && broj >= 0 && broj <= 100000000 ? broj : null;
};

export async function GET(request: Request) {
  const timings = catalogTimings();
  try {
    const trazeno = new URL(request.url).searchParams;
    const upit = parametar(trazeno.get("q"));
    // Upit od jednog slova poklapa pola kataloga i kupcu ne znaci nista.
    if (upit && upit.length < 2)
      return Response.json({ error: "Unesi bar dva slova." }, { status: 400, headers: NE_KESIRAJ });
    const strana = Number(trazeno.get("strana") ?? 1);
    if (!Number.isInteger(strana) || strana < 1 || strana > 5000)
      return Response.json({ error: "Stranica kataloga nije ispravna." }, { status: 400, headers: NE_KESIRAJ });
    const velicina = Number(trazeno.get("velicina") ?? 48);
    if (!Number.isInteger(velicina) || velicina < 1 || velicina > 96)
      return Response.json({ error: "Velicina stranice nije ispravna." }, { status: 400, headers: NE_KESIRAJ });
    const sort = parametar(trazeno.get("sort"), 12);
    // Svojstva (snaga, napon, struja, konektor): ponovljen parametar je ILI unutar grupe.
    // Losa vrednost je 400, ne tiho odbacen filter koji bi vratio pogresan skup.
    const svojstva = readSpecParams(trazeno);
    // Telo kaze koje svojstvo i koja granica, da se greska vidi bez citanja koda.
    if ("error" in svojstva) return Response.json(svojstva, { status: 400, headers: NE_KESIRAJ });
    const kategorija = parametar(trazeno.get("kategorija"), 40);
    const podkategorija = parametar(trazeno.get("podkategorija"), 60);
    const faseti = trazeno.get("faseti") === "1";
    const brendUredjaja = parametar(trazeno.get("brendUredjaja"), 60);
    const model = parametar(trazeno.get("model"), 80);
    // Stara adresa modela (Samsung kod "A546B" ili staro ime "A54 5G") vodi na novi kljuc;
    // nepoznat model nema zamenu. Podkategorija odlucuje kod starog kljuca koji jos nose
    // neki artikli (A226B kod baterije): tamo zamene nema.
    const noviModel = samsungModelAlias(brendUredjaja, model, podkategorija);
    // Tekstualna pretraga ima mnogo kombinacija upita i dodatno ogranicenje
    // ucestalosti. Ruta trenutno svaki put cita bazu i ne koristi HTTP kes.
    if (upit) await rateLimit(request, "catalog-search", 300);
    // One deadline for the full read, including a possible recovery or model alias.
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(CATALOG_READ_DEADLINE_MS)]);
    const db = getAdminClient(signal);
    const minPrice = cena(trazeno.get("minCena"));
    const maxPrice = cena(trazeno.get("maxCena"));
    const podrazumevanoSortiranje = upit ? "relevance" : "newest";
    const sortiranjePoCeni = sort === "low" || sort === "high";
    const upitBaze: CatalogQuery = {
      query: upit,
      category: kategorija,
      subcategory: podkategorija,
      deviceBrand: brendUredjaja,
      device: model,
      brand: parametar(trazeno.get("brend"), 60),
      minPrice,
      maxPrice,
      sort: sort && SORTIRANJA.has(sort) ? sort : podrazumevanoSortiranje,
      page: strana,
      pageSize: velicina,
      withFacets: faseti,
      specs: svojstva.specs,
      // Brojaci svojstava samo uz podkategoriju u kojoj prodavnica crta grupe svojstava
      // (SPEC_SUBS): drugde bi bili skup posao koji niko ne prikazuje. Ne otkrivaju cene,
      // pa ostaju i u rezimu pripreme.
      specKeys: faseti && podkategorija && SPEC_SUBS.has(podkategorija) ? SPEC_KEYS.map((k) => SPEC_LABELS[k]) : null,
    };
    const rezim = timings.measure("mode", () => preparationMode(signal));
    let listingOnly = false;
    const bezBrojaca = (query: CatalogQuery): CatalogQuery => ({ ...query, withFacets: false, specKeys: null });
    const trazi = async (query: CatalogQuery, stage: "search" | "alias") => {
      const selected = listingOnly ? bezBrojaca(query) : query;
      try {
        const result = await timings.measure(stage, () => searchCatalog(db, selected));
        return listingOnly ? { ...result, facets: null } : result;
      } catch (error) {
        // A cancelled SQL statement has already stopped. Retry once without the
        // expensive filter counters, keeping every filter and the requested page.
        if (!selected.withFacets || listingOnly || signal.aborted || !sqlCancelled(error)) throw error;
        listingOnly = true;
        const result = await timings.measure("listing", () => searchCatalog(db, bezBrojaca(query)));
        return { ...result, facets: null };
      }
    };
    // Obicno listanje ne zavisi od cena: citanja mogu uporedo, a odgovor ceka oba.
    // Cenovni filter/redosled mora prvo da dobije pouzdan rezim prodavnice.
    const pretraga = minPrice !== null || maxPrice !== null || sortiranjePoCeni
      ? rezim.then((priprema) => {
          if (priprema) {
            upitBaze.minPrice = null;
            upitBaze.maxPrice = null;
            if (sortiranjePoCeni) upitBaze.sort = podrazumevanoSortiranje;
          }
          return trazi(upitBaze, "search");
        })
      : trazi(upitBaze, "search");
    const [uPripremi, pocetniRezultat] = await Promise.all([rezim, pretraga]);
    let rezultat = pocetniRezultat;
    // Model se prvo trazi onakav kakav je stigao, a novi kljuc tek kad stari ne nadje nista.
    // Novi kljucevi stizu u bazu tek sledecom objavom kataloga, pa do tada plocice i adrese
    // i dalje nose stari kljuc. I posle nje kod ostaje kljuc artikla ciji naziv nema ime
    // modela: takav artikal se ne sme izgubiti iza zamene.
    if (noviModel !== model && rezultat.total === 0) {
      const poNovom = await trazi({ ...upitBaze, device: noviModel }, "alias");
      if (poNovom.total > 0) rezultat = poNovom;
      else if (listingOnly) rezultat = { ...rezultat, facets: null };
    }
    const javniRezultat = uPripremi
      ? { ...rezultat, items: rezultat.items.map((item) => ({ ...item, price: 0 })),
          facets: rezultat.facets ? { ...rezultat.facets, priceRange: { min: null, max: null } } : null }
      : rezultat;
    return Response.json(
      { ...javniRezultat, ...(listingOnly ? { facetsUnavailable: true } : {}), updatedAt: new Date().toISOString() },
      {
        headers: {
          // Svaki odgovor postuje trenutno stanje rezima pripreme i ostaje van HTTP kesa.
          "Cache-Control": "no-store",
          "Server-Timing": timings.header(),
        },
      },
    );
  } catch (error) {
    timings.failure(error);
    if (error instanceof HttpError) {
      const response = apiError(error);
      response.headers.set("Server-Timing", timings.header());
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    return Response.json({ error: "Katalog trenutno nije dostupan." }, { status: 503, headers: { ...NE_KESIRAJ, "Server-Timing": timings.header() } });
  }
}

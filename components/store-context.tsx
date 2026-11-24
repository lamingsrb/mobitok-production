"use client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import {
  type CatalogFacets,
  type CatalogMeta,
  type Product,
} from "@/lib/catalog";
import { SPEC_KEYS } from "@/lib/catalog-specs";
import { InFlightRead } from "@/lib/in-flight-read";
import { evictMissingProducts } from "@/lib/catalog-cache";
import { CatalogRequestQueue, CatalogViewCache, subscribeCatalogChanges } from "@/lib/catalog-events";
import { translate, type Language } from "@/lib/i18n";
import { mergeTaxonomy } from "@/lib/taxonomy-merge";
import type { Taxonomy } from "@/lib/catalog-admin-types";
import { getClient } from "@/lib/supabase-browser";
import { cenaZaKupca, prikazIznosa, type Buyer } from "@/lib/pricing";
type Line = { productId: string; quantity: number };
type Store = {
  // Ogranicen kes poznatih artikala, ne ceo katalog. Puni se onim sto je kupac
  // stvarno video: rezultatima pretrage, korpom, sacuvanim i gledanim.
  products: Product[];
  // Kategorije, vrste opreme i modeli telefona za navigaciju i filtere.
  meta: CatalogMeta | null;
  catalogEpoch: number;
  // Dovuci tacno ove artikle (po id-u ili slug-u) ako ih jos nemamo.
  ensureProducts: (kljucevi: string[], osvezi?: boolean) => Promise<boolean>;
  // Upisi u kes ono sto je stranica vec dobila sa servera.
  mergeProducts: (lista: Product[]) => void;
  catalogLoading: boolean;
  // Artikli iz korpe su provereni na serveru. Dok nisu, placanje je zakljucano.
  catalogComplete: boolean;
  catalogTotal: number | null;
  catalogError: boolean;
  refreshCatalog: () => Promise<Product[] | null>;
  cart: Line[];
  favorites: string[];
  recent: string[];
  dismissedSuggestions: string[];
  dismissSuggestion: (id: string) => void;
  add: (id: string, quantity?: number) => void;
  setQuantity: (id: string, q: number) => void;
  toggleFavorite: (id: string) => void;
  view: (id: string) => void;
  clear: () => void;
  toast: string;
  cartOpen: boolean;
  setCartOpen: (v: boolean) => void;
  notify: (v: string) => void;
  hydrated: boolean;
  // null dok se sesija ne proveri, da zaglavlje ne trepne pogresnim tekstom
  signedIn: boolean | null;
  currency: Currency;
  setCurrency: (v: Currency) => void;
  language: Language;
  setLanguage: (v: Language) => void;
  // Prevod prodajne povrsine; vraca original ako prevoda nema.
  t: (tekst: string) => string;
  // Admin 03.11: grupe i podgrupe iz koda spojene sa catalog_taxonomy (nazivi i nove grupe).
  taxonomy: Taxonomy;
  // Konacna cena, uvek u dinarima, sa oznakom.
  formatPrice: (value: number) => string;
  // Zadrzan ugovor prikaza za postojece komponente; nema preracuna u stranu valutu.
  formatEur: (value: number) => string;
  // Osnovna cena iz kataloga -> cena koju bas ovaj kupac placa.
  cena: (osnovna: number) => number;
  // Popust u procentima i vrsta kupca, za objasnjenje u korpi.
  popust: number;
  vrstaKupca: Buyer;
  // Podaci koje unosi vlasnik. Polje koje nije uneto je null i nigde se ne
  // prikazuje — prodavnica ne izmislja rok, cenu dostave ni poslovne podatke.
  prodavnica: PodaciProdavnice;
  // Kontakt i uslovi stizu sa /api/pricing. Dok odgovor ne stigne stranica pise
  // "ucitava", a posle neuspelih pokusaja "greska" — nikad lazno "nema kontakta".
  prodavnicaStanje: "ucitava" | "spremno" | "greska";
  // null dok se aktivni rezim ne procita; javna prodaja je tada zakljucana.
  preparationMode: boolean | null;
  refreshPreparationMode: () => Promise<void>;
};
export type Currency = "RSD";

// Podaci prodavnice koje vlasnik unosi u admin panelu. Sve je opciono: dok
// nesto nije uneto, prodavnica o tome cuti umesto da nagadja.
export type PodaciProdavnice = {
  phone: string | null;
  email: string | null;
  hours: string | null;
  courier: string | null;
  deliveryFee: number | null;
  deliveryFreeOver: number | null;
  deliveryTime: string | null;
  companyName: string | null;
  companyShortName: string | null;
  companyStartedOn: string | null;
  companyActivity: string | null;
  companyPib: string | null;
  companyRegistrationNumber: string | null;
  companyAddress: string | null;
};
const PRAZNA_PRODAVNICA: PodaciProdavnice = {
  phone: null, email: null, hours: null, courier: null, deliveryFee: null,
  deliveryFreeOver: null, deliveryTime: null,
  companyName: "SLOBODAN VASILJEVIĆ PR TRGOVINA NA MALO POSREDSTVOM POŠTE ILI PREKO INTERNETA MOBITOK BEOGRAD",
  companyShortName: "SLOBODAN VASILJEVIĆ PR MOBITOK BEOGRAD",
  companyStartedOn: "2026-09-30",
  companyActivity: "4791 - Trgovina na malo posredstvom pošte ili preko interneta",
  companyPib: "115987689", companyRegistrationNumber: "68804787",
  companyAddress: "Mirka Milojkovića 46, sprat 3, stan 37, 11060 Beograd (Palilula), Srbija",
};

// Duga sesija pregledanja ne sme da napuni memoriju. Preko ove granice ispadaju
// najstariji zapisi, osim onih koje kupac drzi u korpi, sacuvanim ili gledanim.
const GRANICA_KESA = 3000;

const Context = createContext<Store | null>(null);

export const usePrice = () => useStore().formatPrice;
export const useCena = () => useStore().cena;
export const useProdavnica = () => useStore().prodavnica;
export const useT = () => useStore().t;
export const useTaxonomy = () => useStore().taxonomy;
export const useStore = () => {
  const value = useContext(Context);
  if (!value) throw new Error("StoreProvider missing");
  return value;
};
export const resolveCart = (cart: Line[], catalog: Product[]) =>
  cart
    .map((line) => ({
      ...line,
      product: catalog.find((p) => p.id === line.productId),
    }))
    .filter((line): line is Line & { product: Product } => !!line.product);

// Lager dobavljaca je snimak, nikad rezervacija.
export const productLimit = (product: Product) => {
  if (product.availability === "unavailable") return 0;
  // Dok dostupnost nije potvrdjena, artikal se ne dodaje u korpu.
  if (product.availability !== "available") return 0;
  if (!Number.isFinite(product.stock)) return 0;
  return Math.max(0, Math.min(20, Math.floor(product.stock)));
};

export const cartIssues = (cart: Line[], catalog: Product[], complete = true) =>
  cart.flatMap((line) => {
    const product = catalog.find((item) => item.id === line.productId);
    if (!product) return complete ? [{ id: line.productId, message: "Artikal više nije u ponudi. Ukloni ga iz korpe." }] : [];
    const limit = productLimit(product);
    if (!limit) return [{ id: line.productId, message: `${product.name}: ${product.availability === "unavailable" ? "trenutno nije dostupan" : "dostupnost čeka novu proveru"}.` }];
    if (line.quantity > limit) return [{ id: line.productId, message: `${product.name}: smanji količinu na ${limit} ili manje.` }];
    return [];
  });

// Osvezenje menja i kompatibilne modele, cak i kad cena i lager ostanu isti.
export function mergeCatalogProduct(stari: Product | undefined, stigao: Product): Product {
  return stari?.detailed && !stigao.detailed
    ? { ...stari, ...stigao, description: stari.description, specs: stari.specs, sourceUrl: stari.sourceUrl, detailed: true }
    : stigao;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  // Katalog ima blizu 25.000 artikala od dva dobavljaca i nema razloga da ijedan
  // pregledac to povlaci. Sortiranje, filtriranje i pretragu radi baza, koja za
  // to ima indekse, a ovde ostaje samo kes onoga sto je kupac video.
  const [products, setProducts] = useState<Product[]>([]);
  const [meta, setMeta] = useState<CatalogMeta | null>(null);
  const [catalogEpoch, setCatalogEpoch] = useState(KES_PRIKAZA.generation);
  const metaRequest = useRef(0);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogComplete, setCatalogComplete] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const poznati = useRef<Map<string, Product>>(new Map());
  const poSlugu = useRef<Map<string, string>>(new Map());
  const uToku = useRef<Map<string, Promise<boolean>>>(new Map());
  const itemQueue = useRef(new CatalogRequestQueue(4));
  const cuvaj = useRef<Set<string>>(new Set());
  const mergeProducts = useCallback((lista: Product[]) => {
    if (!lista.length) return;
    let promena = false;
    for (const stigao of lista) {
      if (!stigao.id) continue;
      const stari = poznati.current.get(stigao.id);
      // Zapis sa opisom i specifikacijom se ne gazi listom, koja ih nema.
      const novi = mergeCatalogProduct(stari, stigao);
      if (!stari || JSON.stringify(stari) !== JSON.stringify(novi)) promena = true;
      poznati.current.set(stigao.id, novi);
      if (novi.slug) poSlugu.current.set(novi.slug, novi.id);
    }
    // Kes ne sme da raste bez granice kroz dugo pregledanje. Najstariji zapisi
    // ispadaju prvi, osim onih koji su u korpi, sacuvani ili skoro gledani.
    if (poznati.current.size > GRANICA_KESA)
      for (const kljuc of Array.from(poznati.current.keys())) {
        if (poznati.current.size <= GRANICA_KESA) break;
        if (cuvaj.current.has(kljuc)) continue;
        const izbaceni = poznati.current.get(kljuc);
        poznati.current.delete(kljuc);
        if (izbaceni?.slug) poSlugu.current.delete(izbaceni.slug);
        promena = true;
      }
    if (promena) setProducts(Array.from(poznati.current.values()));
  }, []);
  // Isti artikal se ne trazi dva puta u isto vreme: zahtev u letu se deli sa
  // svakim ko ga zatrazi dok traje.
  const ensureProducts = useCallback(
    (kljucevi: string[], osvezi = false): Promise<boolean> => {
      const trazeni = Array.from(
        new Set(kljucevi.map((kljuc) => (kljuc || "").trim()).filter(Boolean)),
      );
      const generation = KES_PRIKAZA.generation;
      const cekanja: Promise<boolean>[] = [];
      const potrebni: string[] = [];
      for (const kljuc of trazeni) {
        const uLetu = uToku.current.get(`${generation}:${kljuc}`);
        if (uLetu) {
          cekanja.push(uLetu);
          continue;
        }
        if (!osvezi && (poznati.current.has(kljuc) || poSlugu.current.has(kljuc))) continue;
        potrebni.push(kljuc);
      }
      for (let pocetak = 0; pocetak < potrebni.length; pocetak += 60) {
        const deo = potrebni.slice(pocetak, pocetak + 60);
        let posao!: Promise<boolean>;
        posao = itemQueue.current.run(async () => {
          try {
            // Zastareli posao koji je cekao u redu ne salje novi HTTP zahtev.
            if (generation !== KES_PRIKAZA.generation) return false;
            const odgovor = await fetch(
              "/api/catalog/items?ids=" + deo.map(encodeURIComponent).join(","),
              { cache: "no-store", signal: AbortSignal.timeout(15000) },
            );
            if (!odgovor.ok) return false;
            const podaci = await odgovor.json();
            if (!Array.isArray(podaci.items) || !prihvatiReviziju(podaci.catalogRevision, generation)) return false;
            mergeProducts(podaci.items as Product[]);
            if (osvezi) {
              const removed = evictMissingProducts(poznati.current, poSlugu.current, deo, podaci.items as Product[]);
              if (removed.size) {
                for (const [key, view] of KES_PRIKAZA)
                  if (view.items.some((item) => removed.has(item.id))) KES_PRIKAZA.delete(key);
                setProducts(Array.from(poznati.current.values()));
                setFavorites((ids) => ids.filter((id) => !removed.has(id)));
                setRecent((ids) => ids.filter((id) => !removed.has(id)));
              }
            }
            return true;
          } catch {
            return false;
          } finally {
            for (const kljuc of deo) {
              const key = `${generation}:${kljuc}`;
              if (uToku.current.get(key) === posao) uToku.current.delete(key);
            }
          }
        });
        for (const kljuc of deo) uToku.current.set(`${generation}:${kljuc}`, posao);
        cekanja.push(posao);
      }
      if (!cekanja.length) return Promise.resolve(true);
      return Promise.all(cekanja).then((ishodi) => ishodi.every(Boolean));
    },
    [mergeProducts],
  );
  // Prvi upit ume da vrati 503 dok se baza budi. Bez ovih podataka meni
  // kategorija nema podkategorije, pa se pokusa jos dva puta.
  const metaReads = useRef(new InFlightRead<void>());
  const ucitajMeta = useCallback((signal?: AbortSignal): Promise<void> => {
    const generation = KES_PRIKAZA.generation;
    return metaReads.current.run(generation, async () => {
      const request = ++metaRequest.current;
      for (const pauza of [0, 1500, 4000]) {
        if (pauza) await new Promise((resolve) => setTimeout(resolve, pauza));
        // Kupac je napustio stranicu: novi upiti se vise ne salju.
        if (signal?.aborted || generation !== KES_PRIKAZA.generation || request !== metaRequest.current) return;
        try {
          const odgovor = await fetch("/api/catalog/meta", {
            headers: { "X-Catalog-View": "navigation" },
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
          });
          if (!odgovor.ok) continue;
          const podaci = await odgovor.json();
          if (podaci && typeof podaci.total === "number") {
            if (signal?.aborted || request !== metaRequest.current || !prihvatiReviziju(podaci.catalogRevision, generation)) return;
            setMeta(podaci as CatalogMeta);
            return;
          }
        } catch {}
      }
    }, signal);
  }, []);
  useEffect(() => {
    const kontrola = new AbortController();
    void ucitajMeta(kontrola.signal);
    return () => kontrola.abort();
  }, [ucitajMeta]);
  const [cart, setCart] = useState<Line[]>([]),
    [favorites, setFavorites] = useState<string[]>([]),
    [recent, setRecent] = useState<string[]>([]),
    [dismissedSuggestions, setDismissedSuggestions] = useState<string[]>([]),
    [toast, setToast] = useState(""),
    [cartOpen, setCartOpen] = useState(false),
    [hydrated, setHydrated] = useState(false),
    [signedIn, setSignedIn] = useState<boolean | null>(null),
    [currency, setCurrency] = useState<Currency>("RSD"),
    [popust, setPopust] = useState(0),
    [vrstaKupca, setVrstaKupca] = useState<Buyer>("guest"),
    [prodavnica, setProdavnica] = useState<PodaciProdavnice>(PRAZNA_PRODAVNICA),
    [prodavnicaStanje, setProdavnicaStanje] = useState<"ucitava" | "spremno" | "greska">("ucitava"),
    [preparationMode, setPreparationMode] = useState<boolean | null>(null),
    [language, setLanguage] = useState<Language>("sr");
  const lastKnownMode = useRef<boolean | null>(null);
  const modeRequest = useRef(0);
  const modeReads = useRef(new InFlightRead<void>());
  const refreshPreparationMode = useCallback((): Promise<void> => {
    const generation = KES_PRIKAZA.generation;
    return modeReads.current.run(generation, async () => {
      const request = ++modeRequest.current;
      try {
        const response = await fetch("/api/shop-mode", { cache: "no-store", signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error("mode");
        const body = await response.json();
        if (typeof body.preparationMode !== "boolean") throw new Error("mode");
        if (generation !== KES_PRIKAZA.generation || request !== modeRequest.current) return;
        const changed = lastKnownMode.current !== null && lastKnownMode.current !== body.preparationMode;
        lastKnownMode.current = body.preparationMode;
        setPreparationMode(body.preparationMode);
        prihvatiReviziju(body.catalogRevision, generation);
        if (changed) {
          KES_PRIKAZA.invalidate();
          window.location.reload();
        }
      } catch {
        if (generation === KES_PRIKAZA.generation && request === modeRequest.current) setPreparationMode(null);
      }
    });
  }, []);
  useEffect(() => {
    void refreshPreparationMode();
    const onFocus = () => { if (document.visibilityState === "visible") void refreshPreparationMode(); };
    const interval = setInterval(onFocus, 20000);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshPreparationMode]);
  const kljucKorpe = cart
    .map((line) => line.productId)
    .sort()
    .join(",");
  useEffect(() => {
    cuvaj.current = new Set([
      ...cart.map((line) => line.productId),
      ...favorites,
      ...recent,
    ]);
  }, [cart, favorites, recent]);
  // Korpa mora da zna sveze stanje bas svojih artikala, a ne celog kataloga.
  // Dok se to ne potvrdi, placanje je zakljucano.
  useEffect(() => {
    if (!hydrated) return;
    const trazeni = kljucKorpe ? kljucKorpe.split(",") : [];
    if (!trazeni.length) {
      setCatalogComplete(true);
      setCatalogError(false);
      return;
    }
    // Proveri količinu i dostupnost na serveru i za artikle koje je kupac već video.
    setCatalogComplete(false);
    setCatalogLoading(true);
    let ziv = true;
    void ensureProducts(trazeni, true).then((uspelo) => {
      if (!ziv) return;
      setCatalogComplete(uspelo);
      setCatalogError(!uspelo);
      setCatalogLoading(false);
    });
    return () => {
      ziv = false;
    };
  }, [kljucKorpe, hydrated, ensureProducts, catalogEpoch]);
  const refreshCatalog = useCallback(async (): Promise<Product[] | null> => {
    const generation = KES_PRIKAZA.generation;
    setCatalogLoading(true);
    const kljucevi = Array.from(cuvaj.current);
    const uspelo = kljucevi.length ? await ensureProducts(kljucevi, true) : true;
    if (generation !== KES_PRIKAZA.generation) return null;
    void ucitajMeta();
    setCatalogError(!uspelo);
    if (uspelo) setCatalogComplete(true);
    setCatalogLoading(false);
    // Vraca se svez spisak iz samog kesa, ne iz stanja komponente: potvrda
    // porudzbine mora da racuna sa onim sto je bas sad stiglo, a ne sa onim
    // sto je bilo na ekranu pre provere.
    return uspelo ? Array.from(poznati.current.values()) : null;
  }, [ensureProducts, ucitajMeta]);
  // Cache se obnavlja i kada kupac nema korpu, favorite ni nedavno gledane.
  // Callback je registrovan tek posto su sve zavisnosti definisane.
  useEffect(() => {
    const changed = () => {
      uToku.current.clear();
      setMeta(null);
      setCatalogComplete(false);
      setCatalogEpoch(KES_PRIKAZA.generation);
    };
    const stop = KES_PRIKAZA.subscribe(changed);
    if (catalogEpoch !== KES_PRIKAZA.generation) changed();
    return stop;
  }, []);
  useEffect(() => subscribeCatalogChanges(() => KES_PRIKAZA.invalidate(true)), []);
  const refreshedEpoch = useRef(catalogEpoch);
  useEffect(() => {
    if (refreshedEpoch.current === catalogEpoch) return;
    refreshedEpoch.current = catalogEpoch;
    void refreshCatalog();
  }, [catalogEpoch, refreshCatalog]);
  // Lager dobavljaca se menja tokom dana, pa se ono sto kupac drzi u korpi ili
  // je sacuvao proverava ponovo svakog minuta i kad se vrati na karticu.
  useEffect(() => {
    const osvezi = () => {
      if (document.visibilityState === "visible" && cuvaj.current.size) void refreshCatalog();
    };
    const interval = setInterval(osvezi, 60000);
    window.addEventListener("online", osvezi);
    document.addEventListener("visibilitychange", osvezi);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", osvezi);
      document.removeEventListener("visibilitychange", osvezi);
    };
  }, [refreshCatalog]);
  useEffect(() => {
    try {
      const sacuvano = localStorage.getItem("phonex-language");
      if (sacuvano === "en" || sacuvano === "sr") setLanguage(sacuvano);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("phonex-language", language);
    } catch {}
    // Citaci ekrana i pretrazivaci treba da znaju na kom je jeziku stranica.
    document.documentElement.lang = language === "en" ? "en" : "sr-Latn";
  }, [language]);
  const t = useCallback(
    (tekst: string) => translate(tekst, language),
    [language],
  );
  // Admin 03.11: dok meta ne stigne (ili bez tabele) vazi taksonomija iz koda, kao do sada.
  const taxonomy = useMemo(
    () => {
      const subcategories = Array.isArray(meta?.subcategories) ? meta.subcategories : undefined;
      return mergeTaxonomy(meta?.taxonomy ?? [], language, subcategories?.filter((s) => s.count > 0), meta?.layout, { hideEmptySubcategories: subcategories !== undefined });
    },
    [meta, language],
  );
  useEffect(() => {
    try {
      localStorage.setItem("phonex-currency", currency);
    } catch {}
  }, [currency]);
  // Sve prodajne cene i stvarna placanja prikazuju se iskljucivo u dinarima.
  // Stara EUR preferencija se ne ucitava; efekat iznad je zamenjuje sa RSD.
  const formatPrice = useCallback((value: number) => prikazIznosa(value) + " RSD", []);
  const formatEur = useCallback((_value: number) => "", []);
  // Zaglavlje i donja navigacija pisu "Registruj se" dok korisnik nije prijavljen.
  useEffect(() => {
    const client = getClient();
    if (!client) {
      setSignedIn(false);
      return;
    }
    let live = true;
    client.auth
      .getSession()
      .then(({ data }) => live && setSignedIn(Boolean(data.session)))
      .catch(() => live && setSignedIn(false));
    const { data } = client.auth.onAuthStateChange((_event, session) =>
      setSignedIn(Boolean(session)),
    );
    return () => {
      live = false;
      data.subscription.unsubscribe();
    };
  }, []);
  // Katalog nosi jednu osnovnu cenu za sve; popust zavisi od toga ko gleda.
  // Cita se tek kad se zna stanje prijave, da cena ne trepne dva puta.
  // Isti odgovor nosi kontakt prodavnice, pa se kratak prekid veze ponavlja (tri
  // pokusaja) umesto da podrska i ponuda za firme ostanu bez kontakta.
  useEffect(() => {
    if (signedIn === null) return;
    let live = true;
    (async () => {
      for (let pokusaj = 0; pokusaj < 3 && live; pokusaj++) {
        if (pokusaj > 0) await new Promise((kraj) => setTimeout(kraj, pokusaj * 1500));
        if (!live) return;
        try {
          const client = getClient();
          const token = client
            ? (await client.auth.getSession()).data.session?.access_token
            : null;
          const odgovor = await fetch("/api/pricing", {
            ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
            signal: AbortSignal.timeout(10000),
          });
          if (!odgovor.ok) continue;
          const podaci = await odgovor.json();
          if (!live) return;
          if (typeof podaci.discountPercent !== "number") continue;
          setPopust(podaci.discountPercent);
          setVrstaKupca(podaci.buyer === "company" || podaci.buyer === "person" ? podaci.buyer : "guest");
          if (podaci.shop && typeof podaci.shop === "object") {
            setProdavnica({ ...PRAZNA_PRODAVNICA, ...podaci.shop });
          }
          setProdavnicaStanje("spremno");
          return;
        } catch {}
      }
      // Vec ucitan kontakt (npr. pre prijave) ostaje vazeci i kad novi zahtev ne uspe.
      if (live) setProdavnicaStanje((stanje) => (stanje === "spremno" ? stanje : "greska"));
    })();
    return () => {
      live = false;
    };
  }, [signedIn]);
  const cena = useCallback(
    (osnovna: number) => cenaZaKupca(osnovna, popust),
    [popust],
  );
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("volt-store-v1") || "{}");
      setCart(
        Array.isArray(raw.cart)
          ? raw.cart.filter(
              (x: Line) =>
                x && typeof x.productId === "string" &&
                Number.isInteger(x.quantity) &&
                x.quantity > 0 &&
                x.quantity <= 20,
            )
          : [],
      );
      setFavorites(
        Array.isArray(raw.favorites)
          ? raw.favorites.filter((x: unknown) => typeof x === "string")
          : [],
      );
      setRecent(Array.isArray(raw.recent) ? raw.recent.slice(0, 8) : []);
      setDismissedSuggestions(
        Array.isArray(raw.dismissedSuggestions)
          ? raw.dismissedSuggestions.filter(
              (id: unknown) =>
                typeof id === "string",
            )
          : [],
      );
    } catch {}
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated)
      try {
        localStorage.setItem(
          "volt-store-v1",
          JSON.stringify({ cart, favorites, recent, dismissedSuggestions }),
        );
      } catch {}
  }, [cart, favorites, recent, dismissedSuggestions, hydrated]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(timer);
  }, [toast]);
  const add = useCallback((id: string, quantity = 1) => {
    if (preparationMode !== false) return;
    const product = poznati.current.get(id);
    if (!product || !Number.isFinite(quantity)) return;
    const limit = productLimit(product);
    if (!limit) { setToast("Trenutno nije moguće dodati ovaj artikal. Proveri dostupnost."); return; }
    const requested = Math.max(1, Math.floor(quantity));
    setCart((c) =>
      c.some((l) => l.productId === id)
        ? c.map((l) =>
            l.productId === id
              ? { ...l, quantity: Math.min(limit, l.quantity + requested) }
              : l,
          )
        : [
            ...c,
            { productId: id, quantity: Math.min(limit, requested) },
          ],
    );
    setToast("Dodato u tvoju korpu");
  }, [preparationMode]);
  const setQuantity = useCallback((id: string, q: number) => {
    if (!Number.isFinite(q)) return;
    const product = poznati.current.get(id);
    const limit = product ? productLimit(product) : 0;
    setCart((c) => {
      const current = c.find((line) => line.productId === id)?.quantity || 0;
      if (q > current && (!limit || q > limit)) return c;
      return q <= 0
        ? c.filter((l) => l.productId !== id)
        : c.map((l) =>
            l.productId === id
              ? { ...l, quantity: Math.max(1, Math.min(20, Math.floor(q))) }
              : l,
          );
    });
  }, []);
  const toggleFavorite = useCallback(
    (id: string) =>
      setFavorites((f) => (f.includes(id) ? f.filter((v) => v !== id) : [...f, id])),
    [],
  );
  const clear = useCallback(() => setCart([]), []);
  const dismissSuggestion = useCallback(
    (id: string) =>
      setDismissedSuggestions((ids) => (ids.includes(id) ? ids : [...ids, id])),
    [],
  );
  const view = useCallback(
    (id: string) =>
      setRecent((r) => [id, ...r.filter((x) => x !== id)].slice(0, 8)),
    [],
  );
  // Nova vrednost konteksta pri svakom renderu naterala bi svakog potrosaca da
  // se ponovo iscrta, pa se pamti dok se nesto u njoj stvarno ne promeni.
  const vrednost = useMemo<Store>(
    () => ({
      products,
      meta,
      catalogEpoch,
      ensureProducts,
      mergeProducts,
      catalogLoading,
      catalogComplete,
      catalogTotal: meta?.total ?? null,
      catalogError,
      refreshCatalog,
      cart,
      favorites,
      recent,
      dismissedSuggestions,
      dismissSuggestion,
      add,
      setQuantity,
      toggleFavorite,
      view,
      clear,
      toast,
      cartOpen,
      setCartOpen,
      notify: setToast,
      hydrated,
      signedIn,
      currency,
      setCurrency,
      language,
      setLanguage,
      t,
      taxonomy,
      formatPrice,
      formatEur,
      cena,
      popust,
      vrstaKupca,
      prodavnica,
      prodavnicaStanje,
      preparationMode,
      refreshPreparationMode,
    }),
    [
      products, meta, catalogEpoch, ensureProducts, mergeProducts, catalogLoading, catalogComplete,
      catalogError, refreshCatalog, cart, favorites, recent, dismissedSuggestions,
      dismissSuggestion, add, setQuantity, toggleFavorite, view, clear, toast, cartOpen,
      hydrated, signedIn, currency, language, t, taxonomy, formatPrice, formatEur, cena, popust, vrstaKupca,
      prodavnica, prodavnicaStanje, preparationMode, refreshPreparationMode,
    ],
  );
  return <Context.Provider value={vrednost}>{children}</Context.Provider>;
}

// ---------------------------------------------------------------------------
// Prikaz kataloga: jedan zahtev po prikazu, bez ijednog artikla viska.
// ---------------------------------------------------------------------------

export type CatalogUpit = {
  q?: string;
  kategorija?: string;
  podkategorija?: string;
  brendUredjaja?: string;
  model?: string;
  brend?: string;
  minCena?: number | null;
  maxCena?: number | null;
  sort?: string;
  strana?: number;
  velicina?: number;
  faseti?: boolean;
  // Zadrzano za kompatibilnost; sledeca strana cita se samo na izricit zahtev.
  prefetch?: boolean;
  // Izabrana svojstva po imenu parametra adrese: {snaga: ["65 W", "90 W"], napon: ["19 V"]}.
  // ILI unutar jednog kljuca, I izmedju kljuceva. Kljucevi van SPEC_KEYS se ne salju.
  spec?: Record<string, string[]>;
  // Prikaz koji jos nema sta da pita (prazno polje pretrage, artikal koji se
  // tek ucitava) ne salje zahtev.
  preskoci?: boolean;
};

// Redosled parametara je uvek isti, da isti prikaz uvek da isti kljuc kesa.
export const catalogQuery = (upit: CatalogUpit) => {
  const trazeno = new URLSearchParams();
  const dodaj = (kljuc: string, vrednost: string | number | null | undefined) => {
    const zapis =
      typeof vrednost === "number"
        ? Number.isFinite(vrednost) && vrednost > 0
          ? String(vrednost)
          : ""
        : (vrednost || "").trim();
    if (zapis) trazeno.set(kljuc, zapis);
  };
  dodaj("q", upit.q);
  dodaj("kategorija", upit.kategorija);
  dodaj("podkategorija", upit.podkategorija);
  dodaj("brendUredjaja", upit.brendUredjaja);
  dodaj("model", upit.model);
  dodaj("brend", upit.brend);
  dodaj("minCena", upit.minCena);
  dodaj("maxCena", upit.maxCena);
  dodaj("sort", upit.sort);
  if (upit.strana && upit.strana > 1) dodaj("strana", upit.strana);
  dodaj("velicina", upit.velicina);
  if (upit.faseti) trazeno.set("faseti", "1");
  // Svojstva idu iza svih ostalih parametara, pa kljucevi bez njih ostaju isti kao ranije.
  // Fiksan redosled kljuceva i sortirane vrednosti: isti izbor uvek daje isti kljuc kesa.
  for (const ime of SPEC_KEYS) {
    const vrednosti = Array.from(new Set((upit.spec?.[ime] ?? []).map((v) => v.trim()).filter(Boolean))).sort();
    for (const vrednost of vrednosti) trazeno.append(ime, vrednost);
  }
  return trazeno.toString();
};

// Alias odgovora mora da pripada uhvacenom zahtevu, nikad novom izboru tokom debounce-a.
export const catalogQueryWithoutFacets = (capturedQuery: string) => {
  const params = new URLSearchParams(capturedQuery);
  params.delete("faseti");
  return params.toString();
};

type CatalogOdgovor = {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  sort: string;
  approximate: boolean;
  facets: CatalogFacets | null;
  catalogRevision?: string;
  facetsUnavailable?: boolean;
};

// Vec videni prikazi se pamte, pa povratak unazad i ponovni klik na isti filter
// nemaju nijedan zahtev.
const KES_PRIKAZA = new CatalogViewCache<CatalogOdgovor>(48);
const prihvatiReviziju = (revision: unknown, generation: number) => {
  if (generation !== KES_PRIKAZA.generation) return false;
  return !KES_PRIKAZA.observeRevision(revision);
};
const PRAZAN_PRIKAZ: CatalogOdgovor = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 48,
  pages: 1,
  sort: "newest",
  approximate: false,
  facets: null,
};

// Odgovor 400 znaci da je sam izbor filtera neispravan (na primer previse vrednosti
// svojstva): ponavljanje zahteva ne pomaze, pa se razlikuje od privremene greske servera.
const greskaOdgovora = (status: number) => Object.assign(new Error("katalog"), { status });

const upisiPrikaz = (kljuc: string, podaci: CatalogOdgovor, generation: number) =>
  KES_PRIKAZA.commit(kljuc, podaci, generation);

// Samo izricito trazena strana se cita; drugi argument ostaje za postojece pozive.
export async function dovuciPrikaz(upit: CatalogUpit, _unapred = true): Promise<CatalogOdgovor> {
  const generation = KES_PRIKAZA.generation;
  const kljuc = catalogQuery({ ...upit, faseti: false });
  let telo = KES_PRIKAZA.get(kljuc);
  if (!telo) {
    const odgovor = await fetch("/api/catalog?" + kljuc, { signal: AbortSignal.timeout(20000) });
    if (!odgovor.ok) throw greskaOdgovora(odgovor.status);
    const primljeno = (await odgovor.json()) as CatalogOdgovor;
    if (!Array.isArray(primljeno.items)) throw new Error("katalog");
    if (!prihvatiReviziju(primljeno.catalogRevision, generation) || !upisiPrikaz(kljuc, primljeno, generation))
      throw new Error("CATALOG_CHANGED");
    telo = primljeno;
  }
  if (generation !== KES_PRIKAZA.generation) throw new Error("CATALOG_CHANGED");
  return telo;
}

// Kljuc izbora filtera: adresa upita bez strane i faseta (isto sto i
// catalogQuery({ ...upit, strana: 1, faseti: false })).
const bazaIzbora = (adresa: string) => {
  const trazeno = new URLSearchParams(adresa);
  trazeno.delete("strana");
  trazeno.delete("faseti");
  return trazeno.toString();
};

export function useCatalog(upit: CatalogUpit) {
  const { mergeProducts, catalogEpoch } = useStore();
  const preskoci = upit.preskoci === true;
  const trazimFasete = upit.faseti === true && !preskoci;
  const osnovaKljuca = catalogQuery({ ...upit, strana: 1, faseti: false });
  const zadrzaniFaseti = useRef<{ kljuc: string; epoch: number; vrednost: CatalogFacets | null }>({
    kljuc: "", epoch: catalogEpoch, vrednost: null,
  });
  const imamFasete = zadrzaniFaseti.current.epoch === catalogEpoch &&
    zadrzaniFaseti.current.kljuc === osnovaKljuca && zadrzaniFaseti.current.vrednost !== null;
  const adresa = catalogQuery({ ...upit, faseti: trazimFasete && !imamFasete });
  const tekstualna = Boolean((upit.q || "").trim());
  const [poslata, setPoslata] = useState(adresa);
  useEffect(() => {
    if (!tekstualna) { setPoslata(adresa); return; }
    const odlaganje = setTimeout(() => setPoslata(adresa), 220);
    return () => clearTimeout(odlaganje);
  }, [adresa, tekstualna]);
  const podaciBaza = useRef(bazaIzbora(adresa));
  const podaciEpoch = useRef(catalogEpoch);
  const [podaci, setPodaci] = useState<CatalogOdgovor | null>(() => KES_PRIKAZA.get(adresa) ?? null);
  const [greska, setGreska] = useState(false);
  const [greskaFilter, setGreskaFilter] = useState(false);
  const errorEpoch = useRef(catalogEpoch);
  const errorScope = useRef("");
  const [ucitava, setUcitava] = useState(!preskoci && !KES_PRIKAZA.has(adresa));
  const [pokusaj, setPokusaj] = useState(0);
  useEffect(() => {
    if (preskoci) { setUcitava(false); return; }
    // Activation/filter changes must wait for the current debounced query, never send the previous scope.
    if (poslata !== adresa) return;
    const generation = catalogEpoch;
    if (generation !== KES_PRIKAZA.generation) return;
    const izKesa = KES_PRIKAZA.get(poslata);
    if (izKesa) {
      podaciBaza.current = bazaIzbora(poslata);
      podaciEpoch.current = generation;
      setPodaci(izKesa);
      setGreska(false); setGreskaFilter(false); setUcitava(false);
      return;
    }
    const kontrola = new AbortController();
    setUcitava(true);
    void (async () => {
      try {
        const odgovor = await fetch("/api/catalog" + (poslata ? "?" + poslata : ""), {
          signal: AbortSignal.any([kontrola.signal, AbortSignal.timeout(20000)]),
        });
        if (!odgovor.ok) throw greskaOdgovora(odgovor.status);
        const telo = (await odgovor.json()) as CatalogOdgovor;
        if (!Array.isArray(telo.items)) throw new Error("katalog");
        if (kontrola.signal.aborted || !prihvatiReviziju(telo.catalogRevision, generation)) return;
        if (!upisiPrikaz(poslata, telo, generation)) return;
        mergeProducts(telo.items);
        podaciBaza.current = bazaIzbora(poslata);
        podaciEpoch.current = generation;
        setPodaci(telo); setGreska(false); setGreskaFilter(false);
        if (telo.facets)
          upisiPrikaz(catalogQueryWithoutFacets(poslata), telo, generation);
      } catch (neuspeh) {
        if (kontrola.signal.aborted || generation !== KES_PRIKAZA.generation) return;
        errorEpoch.current = generation;
        errorScope.current = bazaIzbora(poslata);
        setGreskaFilter((neuspeh as { status?: number } | null)?.status === 400);
        setGreska(true);
      } finally {
        if (!kontrola.signal.aborted && generation === KES_PRIKAZA.generation) setUcitava(false);
      }
    })();
    return () => kontrola.abort();
  }, [poslata, pokusaj, preskoci, mergeProducts, catalogEpoch]);
  const current = podaciEpoch.current === catalogEpoch && catalogEpoch === KES_PRIKAZA.generation;
  const scope = bazaIzbora(adresa);
  const currentScope = current && podaciBaza.current === scope;
  const currentError = errorEpoch.current === catalogEpoch && catalogEpoch === KES_PRIKAZA.generation && errorScope.current === scope && greska;
  if (current && podaci?.facets)
    zadrzaniFaseti.current = { kljuc: podaciBaza.current, epoch: catalogEpoch, vrednost: podaci.facets };
  const ponovi = useCallback(() => { KES_PRIKAZA.delete(poslata); setPokusaj((n) => n + 1); }, [poslata]);
  // Poznata nova revizija odmah uklanja stare rezultate i brojace iz prikaza.
  // Neuspeo request ih ne brise iz product cache-a niti glumi potvrdu nestanka.
  const prikaz = preskoci || !currentScope ? PRAZAN_PRIKAZ : (podaci ?? PRAZAN_PRIKAZ);
  const nijeOdgovor = currentError && greskaFilter && !ucitava && !preskoci;
  return {
    ...prikaz,
    ...(nijeOdgovor ? { items: [], total: 0, pages: 1, page: 1 } : null),
    facets: !currentScope ? null : trazimFasete
      ? zadrzaniFaseti.current.epoch === catalogEpoch && zadrzaniFaseti.current.kljuc === scope ? zadrzaniFaseti.current.vrednost : null
      : prikaz.facets,
    ucitava: !preskoci && (((!currentScope || !podaci) && !currentError) || ucitava || poslata !== adresa),
    greska: currentError && !preskoci,
    greskaFilter: currentError && greskaFilter && !preskoci,
    ponovi,
  };
}

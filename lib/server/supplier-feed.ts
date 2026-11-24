// Citac dobavljackog JSON feeda.
//
// Zasto ovako: tacna sema feeda se ne zna unapred. Dobavljac ga opisuje recima
// ("naziv, kolicina, barcode, nabavna cena, slika"), a imena polja i oblik dokumenta
// vidimo tek kad URL stigne. Zato citac SAM prepoznaje polja po nazivu, a rucno
// mapiranje postoji kao nadjacavanje kada prepoznavanje ne uspe.
//
// Feed je vezan za konkretnu radnju i gasi se kad se promeni firma, pa URL zivi u
// bazi (supplier_sources) i menja se bez izmene koda i bez novog deploya.

export type FeedItem = {
  supplier_sku: string;
  name: string;
  product_type: string | null;
  barcode: string | null;
  brand: string;
  price_excl_vat: number;
  stock: number | null;
  stock_status?: "available" | "unavailable" | "unknown";
  image_url: string | null;
  supplier_category: string | null;
  source_payload: Record<string, unknown>;
};

export type SupplierSource = {
  supplier: string;
  label: string;
  url: string | null;
  auth_header_name: string | null;
  auth_header_value: string | null;
  items_path: string;
  field_map: Record<string, string>;
  enabled: boolean;
  kind?: string;
  price_field?: string | null;
};

export type FieldMapping = {
  barcode: string | null;
  sku: string | null;
  name: string | null;
  brand: string | null;
  price: string | null;
  stock: string | null;
  image: string | null;
  category: string | null;
};

export class FeedError extends Error {}

import {
  FormatError, brendIzNaziva, cookieHeader, dvRecords, mergeCookies, msRecords, nopAntiforgeryToken, readZipXml,
} from "./supplier-feed-formats";

const AGENT = `MyHomeStore-SupplierSync/1.0 (+${process.env.NEXT_PUBLIC_SITE_URL || "https://my-home-gray-nine.vercel.app"})`;

// Poredjenje imena polja bez dijakritika, razmaka, donjih crta i velicine slova.
const norm = (value: string) =>
  value
    .toLowerCase()
    .replace(/đ/g, "dj")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

// Redosled je vazan: specificniji kandidat pobedjuje opstijeg.
// "cenanabavna" mora pre "cena", jer feed moze imati i maloprodajnu cenu.
// Redosled kljuceva je i redosled prepoznavanja: barkod ide PRE sifre, jer bi inace
// polje "barcode" bilo pojedeno kao sifra preko kandidata "code".
const CANDIDATES: Record<keyof FieldMapping, string[]> = {
  barcode: ["barkod", "barcode", "ean", "eankod", "ean13", "gtin", "upc"],
  sku: ["sifraartikla", "sifra", "sku", "artikalid", "idartikla", "sifrarobe",
        "identifier", "kataloskibroj", "productcode", "productid", "itemid", "code", "id"],
  name: ["nazivartikla", "naziv", "name", "title", "productname", "artikal"],
  brand: ["brend", "brand", "proizvodjac", "marka", "manufacturer", "vendor"],
  price: ["cenanabavna", "nabavnacena", "nabavna", "vpcena", "cenabezpdv", "cenabezpdva",
          "netprice", "purchaseprice", "wholesaleprice", "cost", "cena", "price"],
  stock: ["kolicinanastanju", "kolicina", "stanje", "lager", "raspolozivo", "dostupno",
          "stock", "stocklevel", "quantity", "qty", "available", "availablequantity"],
  image: ["urlslike", "slikaurl", "slika", "slike", "imageurl", "image", "imgurl", "img",
          "imagepath", "photo", "picture", "thumbnail", "images"],
  category: ["kategorije", "kategorija", "kategorijaputanja", "categorypath", "category",
             "categories", "grupa", "grupaartikla", "group"],
};

// Ujednacavanje naziva vrste artikla. Dobavljaci istu stvar zovu razlicito
// (torbica, futrola, maskica), pa se iz naziva izvlaci jedna vrednost radi
// grupisanja i filtriranja. IZVORNI NAZIV SE NE MENJA.
// Redosled je vazan: specificnije pravilo ide pre opstijeg.
const VRSTE: [RegExp, string][] = [
  [/staklo|glass|zastitno staklo|folija|privacy/, "STAKLO"],
  // Torba za laptop nije maska za telefon, pa ide pre opsteg pravila.
  [/(torb|ranac|backpack)[a-z]* za (laptop|notebook|racunar)|laptop (torb|ranac)/, "TORBA"],
  [/torbic|futrol|maskic|\bmaska\b|\bmaske\b|preklop|silikon|\bcase\b|cover/, "MASKA"],
  [/\bdect\b|fiksni tel|bezicni tel|\bsim\b|prepaid|smartfon|\btablet\b/, "TELEFONIJA"],
  [/usb \d+ ?gb|\d+gb (dtx|usb)|usb fles|flash drive/, "MEMORIJA"],
  [/powerbank|power bank|eksterna baterij/, "EKSTERNA BATERIJA"],
  [/baterij/, "BATERIJA"],
  [/punjac|charger|adapter za struju/, "PUNJAC"],
  [/\bkabl\b|\bkabal\b|kablov|cable|type-?c|lightning|micro ?usb/, "KABL"],
  [/slusalic|headset|earbud|bubice|handsfree/, "SLUSALICE"],
  [/zvucnik|speaker|soundbar/, "ZVUCNIK"],
  [/tastatur|keyboard/, "TASTATURA"],
  [/\bmis\b|\bmisa\b|mouse/, "MIS"],
  [/drzac|holder|stalak|tripod|selfie/, "DRZAC"],
  [/memorijsk|sd kartic|micro ?sd|fles|flash|usb stick/, "MEMORIJA"],
  [/\bsat\b|smartwatch|narukvic|\bband\b/, "PAMETNI SAT"],
  [/lemilic|mikroskop|rework|pinceta|odvijac|separator/, "ALAT"],
];

export const odrediVrstu = (naziv: string): string | null => {
  const tekst = norm(naziv).replace(/([a-z])([0-9])/g, "$1 $2");
  const meko = naziv
    .toLowerCase()
    .replace(/đ/g, "dj")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  for (const [uzorak, vrsta] of VRSTE) {
    if (uzorak.test(meko) || uzorak.test(tekst)) return vrsta;
  }
  return null;
};

// Neki zapisi u BTM feedu su dvostruko kodirani UTF-8: bajtovi slova "c" (c48d)
// procitani su kao Latin-1 pa ponovo upisani kao UTF-8 (c384 c28d). Posledica je
// "ZvuA,ATnici" umesto "Zvucnici". Pogadja 58 putanja kategorija; nazivi i brendovi
// su cisti, ali lecimo sva tri polja jer se kvar moze prosiriti.
// Vidi fixes/UTF8_MOJIBAKE_SHARED_DRIVE_STATIC_SITE.md
const SUMNJIVO = /[\u00C2-\u00DF][\u0080-\u00BF]/;

export const popraviMojibake = (tekst: string): string => {
  if (!tekst || !SUMNJIVO.test(tekst)) return tekst;
  try {
    const nazad = Buffer.from(tekst, "latin1").toString("utf8");
    // Ako prevod proizvede zamenski znak, original je bio ispravan - ne diramo ga.
    return nazad.includes("\uFFFD") ? tekst : nazad;
  } catch {
    return tekst;
  }
};

export const parsePrice = (raw: unknown): number | null => {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw * 100) / 100 : null;
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;
  // "2.200,00" srpski zapis, "2200.00" engleski, "2200" go broj.
  const srpski = /^\d{1,3}(\.\d{3})*(,\d+)?$/.test(text);
  const cleaned = srpski ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
};

export const parseStock = (raw: unknown): number | null => {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : null;
  if (typeof raw === "boolean") return raw ? 1 : 0;
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;
  // Cist broj. Opisne vrednosti tipa "Vise od 5" namerno ostaju NULL:
  // izmisljen broj je gori od priznanja da broj nije poznat.
  const value = Number.parseInt(text.replace(/\s/g, ""), 10);
  return Number.isFinite(value) && /^\d+$/.test(text.replace(/\s/g, "")) ? Math.max(0, value) : null;
};

const firstUrl = (raw: unknown): string | null => {
  if (typeof raw === "string") return raw.trim() ? raw.trim() : null;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const found = firstUrl(entry);
      if (found) return found;
    }
    return null;
  }
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    for (const key of ["url", "src", "link", "path", "slika", "image"]) {
      const found = firstUrl(record[key]);
      if (found) return found;
    }
  }
  return null;
};

// Nalazi niz artikala. Ako je putanja zadata, koristi nju; inace trazi najveci
// niz objekata u dokumentu, jer feedovi umeju da ga stave pod razlicite kljuceve.
export const locateItems = (
  document: unknown,
  itemsPath = "",
): { items: Record<string, unknown>[]; path: string } => {
  const isItemArray = (value: unknown): value is Record<string, unknown>[] =>
    Array.isArray(value) && value.length > 0 &&
    value.every((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry));

  if (itemsPath) {
    let cursor: unknown = document;
    for (const part of itemsPath.split(".")) {
      if (!cursor || typeof cursor !== "object") {
        throw new FeedError(`Putanja "${itemsPath}" ne postoji u feedu.`);
      }
      cursor = (cursor as Record<string, unknown>)[part];
    }
    if (!isItemArray(cursor)) throw new FeedError(`Putanja "${itemsPath}" nije niz artikala.`);
    return { items: cursor, path: itemsPath };
  }

  if (isItemArray(document)) return { items: document, path: "" };

  let best: { items: Record<string, unknown>[]; path: string } | null = null;
  const walk = (value: unknown, path: string, depth: number) => {
    if (depth > 4 || !value || typeof value !== "object") return;
    if (isItemArray(value)) {
      if (!best || value.length > best.items.length) best = { items: value, path };
      return;
    }
    if (Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      walk(child, path ? `${path}.${key}` : key, depth + 1);
    }
  };
  walk(document, "", 0);
  if (!best) throw new FeedError("U feedu nije pronadjen nijedan niz artikala.");
  return best;
};

// Prepoznaje koje polje nosi koju informaciju. Rucno mapiranje uvek pobedjuje.
export const detectMapping = (
  sample: Record<string, unknown>[],
  override: Record<string, string> = {},
): { mapping: FieldMapping; unmapped: string[] } => {
  const keys = [...new Set(sample.flatMap((item) => Object.keys(item)))];
  const byNorm = new Map(keys.map((key) => [norm(key), key]));
  const mapping = {} as FieldMapping;
  const used = new Set<string>();

  for (const field of Object.keys(CANDIDATES) as (keyof FieldMapping)[]) {
    const manual = override[field];
    if (manual && keys.includes(manual)) {
      mapping[field] = manual;
      used.add(manual);
      continue;
    }
    let found: string | null = null;
    for (const candidate of CANDIDATES[field]) {
      const key = byNorm.get(candidate);
      if (key && !used.has(key)) { found = key; break; }
    }
    if (!found) {
      // Labavo poklapanje samo za kandidate od najmanje 5 znakova: kratki kao "id" ili
      // "code" bi se hvatali usred tudjih imena ("barcode" -> "code").
      for (const key of keys) {
        if (used.has(key)) continue;
        if (CANDIDATES[field].some((candidate) =>
          candidate.length >= 5 && norm(key).includes(candidate))) { found = key; break; }
      }
    }
    mapping[field] = found;
    if (found) used.add(found);
  }
  return { mapping, unmapped: keys.filter((key) => !used.has(key)) };
};

export const mapItems = (
  raw: Record<string, unknown>[],
  mapping: FieldMapping,
  strictBarcode = false,
): { items: FeedItem[]; skipped: number; reasons: Record<string, number> } => {
  const items: FeedItem[] = [];
  const reasons: Record<string, number> = {};
  const seen = new Set<string>();
  let skipped = 0;
  const fail = (why: string) => { reasons[why] = (reasons[why] ?? 0) + 1; skipped += 1; };

  for (const entry of raw) {
    const text = (key: string | null) => {
      if (!key) return "";
      const value = entry[key];
      return value === null || value === undefined ? "" : String(value).trim();
    };

    const name = popraviMojibake(text(mapping.name));
    const price = parsePrice(mapping.price ? entry[mapping.price] : null);
    // Sifra je primarni kljuc; ako je feed nema, barkod je jedini stabilan zamenik.
    let sku = text(mapping.sku);
    if (!sku) sku = text(mapping.barcode);
    if (!sku) { fail("nema sifru ni barkod"); continue; }
    if (!name) { fail("nema naziv"); continue; }
    if (price === null || price < 0) { fail("nema upotrebljivu cenu"); continue; }
    if (seen.has(sku)) { fail("duplirana sifra u feedu"); continue; }
    seen.add(sku);

    // Barkod iz izvora ume da nosi sufiks ili dve vrednosti spojene tacka-zarezom.
    const sirovBarkod = text(mapping.barcode).split(";")[0].replace(/-\d+$/, "").trim();
    // MS Mobile ume da posalje "8600835032003,00" ili besmislenu vrednost ("19"): samo 8-14 cifara je barkod.
    const rawBarcode = strictBarcode ? (/^\d{8,14}$/.exec(sirovBarkod.replace(/,\d+$/, ""))?.[0] ?? "") : sirovBarkod;

    items.push({
      supplier_sku: sku,
      name,
      product_type: odrediVrstu(name),
      barcode: rawBarcode || null,
      brand: popraviMojibake(text(mapping.brand)),
      price_excl_vat: price,
      stock: parseStock(mapping.stock ? entry[mapping.stock] : null),
      image_url: firstUrl(mapping.image ? entry[mapping.image] : null),
      supplier_category: popraviMojibake(text(mapping.category)) || null,
      source_payload: entry,
    });
  }
  return { items, skipped, reasons };
};

// Rok vazi dok se telo ne procita: inace zaglavljen odgovor drzi ceo cron do
// ogranicenja funkcije, a run ostaje u stanju "running".
const withTimeoutBody = async <T>(url: string, init: RequestInit, ms: number, read: (response: Response) => Promise<T>) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { response, body: await read(response) };
  } catch (error) {
    if (controller.signal.aborted) throw new FeedError(`Feed nije odgovorio u ${ms} ms.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

// MS Mobile (nopCommerce): datoteke su iza prijave, a sajt radi samo preko HTTP. Kolacici
// vaze za host www, pa se uvek koristi on. Nalog dolazi iz okruzenja, nikad iz baze.
const MS_HOST = "www.msmobile.rs";

const fetchMsMobile = async (source: SupplierSource) => {
  const url = new URL(source.url!);
  if (!["msmobile.rs", MS_HOST].includes(url.hostname.toLowerCase()) || !["http:", "https:"].includes(url.protocol)) {
    throw new FeedError("MS Mobile adresa nije dozvoljena.");
  }
  const email = process.env.MSMOBILE_EMAIL, password = process.env.MSMOBILE_PASSWORD;
  if (!email || !password) throw new FeedError("Pristupni podaci za MS Mobile nisu podešeni (MSMOBILE_EMAIL, MSMOBILE_PASSWORD).");
  const origin = `${url.protocol}//${MS_HOST}`;
  const jar = new Map<string, string>();
  const call = async (path: string, init: RequestInit, ms: number) => {
    const headers: Record<string, string> = { "User-Agent": AGENT, ...(init.headers as Record<string, string> | undefined) };
    if (jar.size) headers.Cookie = cookieHeader(jar);
    const { response, body } = await withTimeoutBody(origin + path, { ...init, headers, redirect: "manual", cache: "no-store" }, ms, (r) => r.text());
    mergeCookies(jar, response.headers.getSetCookie());
    return { status: response.status, text: body };
  };

  const forma = await call("/login?returnUrl=%2F", {}, 20000);
  const token = nopAntiforgeryToken(forma.text);
  if (forma.status !== 200 || !token) throw new FeedError("MS Mobile stranica za prijavu nije u očekivanom obliku.");
  await call("/login?returnUrl=%2F", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ Email: email, Password: password, RememberMe: "false", __RequestVerificationToken: token }).toString(),
  }, 20000);
  if (![...jar.keys()].some((name) => name.startsWith(".Nop.Authentication"))) {
    throw new FeedError("MS Mobile je odbio prijavu. Proverite nalog u podešavanjima okruženja.");
  }

  const jsonDatoteka = async (putanja: string) => {
    const response = await call(putanja, { headers: { Accept: "application/json" } }, 60000);
    const body = response.text;
    if (response.status !== 200) throw new FeedError(`MS Mobile je vratio status ${response.status} za ${putanja.slice(1)}.`);
    try { return { value: JSON.parse(body.replace(/^﻿/, "")) as unknown, bytes: body.length }; }
    catch { throw new FeedError(`MS Mobile nije vratio ispravan JSON za ${putanja.slice(1)}. Nalog možda nema pristup datoteci.`); }
  };
  const proizvodi = await jsonDatoteka("/GetProductsAsJsonFile");
  const kategorije = await jsonDatoteka("/GetCategoriesAsJsonFile");
  try {
    return { document: msRecords(proizvodi.value, kategorije.value) as unknown, bytes: proizvodi.bytes + kategorije.bytes };
  } catch (error) {
    if (error instanceof FormatError) throw new FeedError(error.message);
    throw error;
  }
};

// Digital Vision: ZIP sa jednim XML-om na https, bez prijave.
const MAKSIMUM_ZIP = 60 * 1024 * 1024;
const preuzmiDigitalVision = async (source: SupplierSource) => {
  const url = new URL(source.url!);
  if (url.protocol !== "https:" || !["digitalvision.rs", "www.digitalvision.rs"].includes(url.hostname.toLowerCase())) {
    throw new FeedError("Digital Vision adresa nije dozvoljena.");
  }
  // Sirovi odgovor se ne cita ako status nije 200 ili je zaglavlje preveliko; rok vazi i za telo.
  const { response, body } = await withTimeoutBody(url.toString(), {
    headers: { "User-Agent": AGENT, Accept: "application/zip" }, redirect: "error", cache: "no-store",
  }, 90000, async (r) => {
    if (r.status !== 200 || Number(r.headers.get("content-length")) > MAKSIMUM_ZIP) return null;
    return new Uint8Array(await r.arrayBuffer());
  });
  if (response.status !== 200) throw new FeedError(`Digital Vision je vratio status ${response.status}.`);
  if (!body) throw new FeedError("Arhiva Digital Vision je veća od dozvoljenog.");
  const zip = body;
  if (zip.length > MAKSIMUM_ZIP) throw new FeedError("Arhiva Digital Vision je veća od dozvoljenog.");
  try {
    return { document: dvRecords(readZipXml(zip)) as unknown, bytes: zip.length };
  } catch (error) {
    if (error instanceof FormatError) throw new FeedError(error.message);
    throw error;
  }
};
// Digital Vision povremeno odmah vrati nepotpunu arhivu (17.10.2026: "XML nema nijedan <artikal>"
// posle 0,3 s, verovatno dok se datoteka pravi). Brz neuspeh se ponavlja jednom posle kratke pauze;
// spor (rok od 90 s), prevelika arhiva i nedozvoljena adresa se ne ponavljaju.
const fetchDigitalVision = async (source: SupplierSource) => {
  for (let pokusaj = 1; ; pokusaj++) {
    const pocetak = Date.now();
    try {
      return await preuzmiDigitalVision(source);
    } catch (error) {
      const konacno = error instanceof FeedError && /veća od dozvoljenog|nije dozvoljena/.test(error.message);
      if (pokusaj >= 2 || konacno || Date.now() - pocetak > 15000) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }
};

// Genericki JSON (BTM i 3G): ogranicenje vazi i kada nema Content-Length
// ili kada server salje kompresovan odgovor. Ne ucitavamo neograniceno telo u RAM.
export const MAX_JSON_FEED_BYTES = 64 * 1024 * 1024;

const readJSONFeedBody = async (response: Response) => {
  if (response.status !== 200) {
    void response.body?.cancel().catch(() => {});
    throw new FeedError(`Feed vratio HTTP ${response.status}. Proverite pristup u podešavanjima dobavljača.`);
  }
  if (Number(response.headers.get("content-length")) > MAX_JSON_FEED_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new FeedError("JSON feed je veći od dozvoljenog.");
  }
  const reader = response.body?.getReader();
  if (!reader) return { text: "", bytes: 0 };
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_JSON_FEED_BYTES) {
        void reader.cancel().catch(() => {});
        throw new FeedError("JSON feed je veći od dozvoljenog.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return { text: new TextDecoder().decode(Buffer.concat(chunks, bytes)), bytes };
};

export const fetchFeedDocument = async (source: SupplierSource, timeoutMs = 45000) => {
  if (!source.url) throw new FeedError(`Izvor "${source.supplier}" nema podesen URL feeda.`);
  if (source.supplier === "msmobile") return fetchMsMobile(source);
  if (source.supplier === "dv") return fetchDigitalVision(source);
  const headers: Record<string, string> = { "User-Agent": AGENT, Accept: "application/json" };
  if (source.auth_header_name && source.auth_header_value) {
    headers[source.auth_header_name] = source.auth_header_value;
  }
  const url = new URL(source.url);
  if (source.supplier === "trig") {
    if (url.hostname.toLowerCase() !== "rstrig-api-kzczjbhb7d44s.azurewebsites.net" || url.protocol !== "https:") {
      throw new FeedError("3G API adresa nije dozvoljena.");
    }
    const key = process.env.TRIG_API_KEY || source.auth_header_value;
    if (!key) throw new FeedError("3G API ključ nije podešen.");
    url.searchParams.set("apiKey", key);
    if (source.auth_header_name) delete headers[source.auth_header_name];
  }
  const { body } = await withTimeoutBody(url.toString(), { headers, redirect: "error", cache: "no-store" }, timeoutMs, readJSONFeedBody);
  try {
    return { document: JSON.parse(body.text) as unknown, bytes: body.bytes };
  } catch {
    // Najcesci uzrok: URL je istekao ili je ugasen, pa vraca HTML stranicu sa statusom 200.
    throw new FeedError(
      "Feed nije vratio ispravan JSON dokument.",
    );
  }
};

export type FeedProbe = {
  ok: boolean;
  bytes: number;
  itemsPath: string;
  totalItems: number;
  mapping: FieldMapping;
  unmappedFields: string[];
  mappedItems: number;
  skipped: number;
  skipReasons: Record<string, number>;
  withStock: number;
  withImage: number;
  withBarcode: number;
  sampleRaw: Record<string, unknown> | null;
  sampleMapped: FeedItem | null;
  warnings: string[];
  error?: string;
};

// Dijagnostika izvora. Sluzi da se u trenutku kad URL stigne za minut vidi
// sta je feed zapravo dao i da li je mapiranje pogodjeno.
export const probeFeed = async (source: SupplierSource): Promise<FeedProbe> => {
  const prazno: FeedProbe = {
    ok: false, bytes: 0, itemsPath: "", totalItems: 0,
    mapping: { barcode: null, sku: null, name: null, brand: null, price: null, stock: null, image: null, category: null },
    unmappedFields: [], mappedItems: 0, skipped: 0, skipReasons: {},
    withStock: 0, withImage: 0, withBarcode: 0, sampleRaw: null, sampleMapped: null, warnings: [],
  };
  try {
    const { document, bytes } = await fetchFeedDocument(source);
    const { items: raw, path } = locateItems(document, source.items_path);
    const { unmapped } = detectMapping(raw.slice(0, 50), source.field_map ?? {});
    const { items, skipped, reasons, mapping } = normalizeFeed(raw, source);

    const warnings: string[] = [];
    if (source.supplier === "trig") warnings.push("3G šalje dostupnost bez garantovane količine. Potvrdite polje cene, valutu i PDV pre objavljivanja.");
    if (source.supplier === "msmobile") warnings.push("MS Mobile šalje samo da li artikal ima (količina je uvek 1). Potvrdite valutu i PDV pre objavljivanja; cena u izvoru je bez PDV-a.");
    if (source.supplier === "dv") warnings.push("Digital Vision ne šalje lager ni brend: svaki artikal iz fajla se smatra dostupnim. Potvrdite valutu i PDV pre objavljivanja.");
    if (!mapping.sku) warnings.push("Nije prepoznata sifra artikla — kao kljuc se koristi barkod.");
    if (!mapping.stock) warnings.push("Nije prepoznato polje sa kolicinom.");
    if (!mapping.image) warnings.push("Nije prepoznato polje sa slikom.");
    if (!mapping.brand) warnings.push("Nije prepoznat brend.");
    if (!mapping.category) warnings.push("Nije prepoznata kategorija.");
    const withStock = items.filter((item) => item.stock !== null).length;
    const withImage = items.filter((item) => item.image_url !== null).length;
    if (mapping.stock && withStock === 0) {
      warnings.push("Polje sa kolicinom je prepoznato, ali nijedna vrednost nije broj — verovatno je opisna.");
    }
    if (skipped > items.length * 0.1) {
      warnings.push(`Preskoceno ${skipped} zapisa, vise od 10% — proveri mapiranje.`);
    }

    return {
      ok: items.length > 0,
      bytes, itemsPath: path, totalItems: raw.length, mapping, unmappedFields: unmapped,
      mappedItems: items.length, skipped, skipReasons: reasons,
      withStock, withImage,
      withBarcode: items.filter((item) => item.barcode !== null).length,
      sampleRaw: raw[0] ?? null, sampleMapped: items[0] ?? null, warnings,
    };
  } catch (error) {
    return { ...prazno, error: error instanceof Error ? error.message : String(error) };
  }
};

export const readFeed = async (source: SupplierSource, timeoutMs?: number) => {
  const { document } = await fetchFeedDocument(source, timeoutMs);
  const { items: raw } = locateItems(document, source.items_path);
  const { items, skipped, mapping } = normalizeFeed(raw, source);
  if (items.length === 0) throw new FeedError("Feed nema nijedan upotrebljiv artikal.");
  return { items, skipped, mapping };
};

/** 3G Qty is a boolean string in the actual feed, never an invented quantity. */
export const normalizeFeed = (raw: Record<string, unknown>[], source: SupplierSource) => {
  const trig = source.supplier === "trig";
  const ms = source.supplier === "msmobile", dv = source.supplier === "dv";
  const records = trig ? raw.map((row) => ({ ...row,
    CategoryPath: [row.GroupLevel1, row.GroupLevel2, row.GroupLevel3].filter(Boolean).join(" / "),
  })) : raw;
  const { mapping } = detectMapping(records.slice(0, 50), trig ? {
    sku: "Identifier", name: "Name", brand: "Brand", barcode: "Barcode",
    price: source.price_field === "ClientPrice" ? "ClientPrice" : "Price",
    stock: "Qty", image: "ImagePath", category: "CategoryPath",
  } : ms ? {
    // Price je cena bez PDV-a, PriceWithWat sa PDV-om; osnovu potvrdjuje admin.
    sku: "Sku", name: "Name", barcode: "Barcode", price: "Price",
    stock: "StockQuantity", image: "Images", category: "CategoryPath",
  } : dv ? {
    sku: "sifra", name: "naziv", price: "vpCena", image: "slike", category: "kategorija",
  } : source.field_map ?? {});
  const result = mapItems(records, mapping, ms);
  for (const item of result.items) {
    const value = mapping.stock ? item.source_payload[mapping.stock] : null;
    const booleanValue = String(value).toLowerCase();
    if (trig && ["true", "false"].includes(booleanValue)) {
      item.stock = null;
      item.stock_status = booleanValue === "true" ? "available" : "unavailable";
    } else if (ms) {
      // Svaki artikal ima StockQuantity "1": to je znak dostupnosti, ne broj komada.
      item.stock = null;
      item.stock_status = Number(value) > 0 ? "available" : "unavailable";
    } else if (dv) {
      // Feed nema lager; artikal u fajlu je ponuda. Tacnu dostupnost potvrdjuje nabavka.
      item.stock = null;
      item.stock_status = "available";
    } else {
      item.stock_status = item.stock === null ? "unknown" : item.stock > 0 ? "available" : "unavailable";
    }
    if ((ms || dv) && !item.brand) item.brand = brendIzNaziva(item.name);
    // 3G u "ImagePath" salje sicusan pregled (w270), a pune fotografije u
    // "ImagePaths". Prodavnica prikazuje veliku sliku, pa uzimamo nju.
    if (trig) {
      const sve = item.source_payload.ImagePaths;
      const puna = Array.isArray(sve) ? sve.find((v) => typeof v === "string" && v.startsWith("https://")) : null;
      if (puna) item.image_url = puna as string;
    }
  }
  return { ...result, mapping };
};

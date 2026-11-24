// NE KORISTI SE. Zadrzano samo kao zapis kako je radio raniji put preko izvoza
// /exportProducts.php (UTF-16 TSV pod .xls ekstenzijom).
//
// Napusteno 15.09.2026. posle poziva sa Milanom iz BTM-a: izvoz nema lager, sliku,
// kategoriju ni nasu nabavnu cenu, a dobavljac ima pravi JSON feed koji sve to nosi.
// Aktivni put je lib/server/supplier-feed.ts.
//
// Ovaj fajl nije uvezen nigde u aplikaciji. Obrisati kad JSON feed proradi u produkciji.

// Klijent za dobavljaca BTM (Blue Tech Media d.o.o.), https://btm.rs
//
// Koristi iskljucivo kanal koji je dobavljac ponudio: prijava obicnom formom i
// preuzimanje izvoza sa /exportProducts.php. Nema brauzera, nema lazno
// predstavljanje klijenta i nema citanja stranica koje nisu ponudjene za masinski
// pristup. Zato ceo tok radi kao obican HTTP poziv i moze da se izvrsava u
// serverless okruzenju aplikacije.
//
// Izvor i granice: docs/SUPPLIER_BTM.md

const OSNOVA = "https://btm.rs";
const PRIJAVA = `${OSNOVA}/signin/`;
const PRIJAVA_POST = `${OSNOVA}/signin-process/`;
const IZVOZ = `${OSNOVA}/exportProducts.php`;

// Predstavljamo se istinito. Ime aplikacije i kontakt olaksavaju dobavljacu da
// prepozna saobracaj i javi nam se ako mu nesto smeta.
const AGENT = `MyHomeStore-SupplierSync/1.0 (+${process.env.NEXT_PUBLIC_SITE_URL || "https://my-home-gray-nine.vercel.app"})`;

export type SupplierItem = {
  supplier_sku: string;
  name: string;
  barcode: string | null;
  brand: string;
  price_excl_vat: number;
};

export type ParsedExport = {
  items: SupplierItem[];
  skipped: number;
  bytes: number;
};

class CookieJar {
  private jar = new Map<string, string>();

  absorb(response: Response) {
    const raw = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean) as string[];
    for (const cookie of raw) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      if (index > 0) this.jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }

  header() {
    return [...this.jar].map(([key, value]) => `${key}=${value}`).join("; ");
  }

  get size() {
    return this.jar.size;
  }
}

export class SupplierError extends Error {}

const withTimeout = async (url: string, init: RequestInit, ms: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new SupplierError(`Dobavljac nije odgovorio u ${ms} ms: ${url}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const parsePrice = (raw: string) => {
  const value = Number.parseFloat(String(raw).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
};

// Izvoz je UTF-16LE, tab-separated, polja pod navodnicima, uprkos .xls ekstenziji.
export const parseExport = (buffer: Buffer | ArrayBuffer): ParsedExport => {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(new Uint8Array(buffer));
  const text = bytes.toString("utf16le").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new SupplierError("Izvoz je prazan ili u neprepoznatom formatu.");

  const cells = (line: string) => line.split("\t").map((cell) => cell.replace(/^"|"$/g, "").trim());
  const header = cells(lines[0]);
  const wanted = ["Naziv", "Sifra", "Cena", "Barkod", "Brend"] as const;
  const at: Record<string, number> = {};
  for (const column of wanted) {
    const index = header.findIndex(
      (name) => name.replace(/[^A-Za-z]/g, "").toLowerCase() === column.toLowerCase(),
    );
    if (index < 0) {
      throw new SupplierError(
        `Izvoz nema ocekivanu kolonu "${column}". Zaglavlje: ${header.join(" | ")}`,
      );
    }
    at[column] = index;
  }

  const seen = new Map<string, SupplierItem>();
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const cell = cells(line);
    const sku = cell[at.Sifra];
    const name = cell[at.Naziv];
    const price = parsePrice(cell[at.Cena]);
    if (!sku || !name || price === null || price < 0) {
      skipped += 1;
      continue;
    }
    if (seen.has(sku)) skipped += 1;
    const barcode = (cell[at.Barkod] ?? "").trim();
    seen.set(sku, {
      supplier_sku: sku,
      name,
      barcode: barcode.length > 0 ? barcode : null,
      brand: (cell[at.Brend] ?? "").trim(),
      price_excl_vat: price,
    });
  }

  return { items: [...seen.values()], skipped, bytes: bytes.byteLength };
};

export const fetchSupplierExport = async (
  email: string,
  password: string,
  timeoutMs = 45000,
): Promise<ParsedExport> => {
  if (!email || !password) throw new SupplierError("Pristupni podaci dobavljaca nisu podeseni.");
  const jar = new CookieJar();

  const session = await withTimeout(PRIJAVA, {
    redirect: "manual",
    headers: { "User-Agent": AGENT },
  }, timeoutMs);
  jar.absorb(session);
  if (jar.size === 0) throw new SupplierError("Dobavljac nije otvorio sesiju.");

  const login = await withTimeout(PRIJAVA_POST, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": AGENT,
      Cookie: jar.header(),
      Referer: PRIJAVA,
    },
    body: new URLSearchParams({ lemail: email, lpassword: password, rememberme: "" }),
  }, timeoutMs);
  jar.absorb(login);

  const response = await withTimeout(IZVOZ, {
    redirect: "manual",
    headers: { "User-Agent": AGENT, Cookie: jar.header(), Referer: `${OSNOVA}/` },
  }, timeoutMs);

  if (response.status !== 200) {
    throw new SupplierError(`Izvoz nije dostupan, HTTP ${response.status}.`);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const type = response.headers.get("content-type") ?? "";
  // Kad prijava ne prodje, portal vrati HTML stranicu sa statusom 200 umesto fajla.
  if (!/attachment/i.test(disposition) && !/excel|octet-stream/i.test(type)) {
    throw new SupplierError(
      "Prijava na portal dobavljaca nije uspela: umesto izvoza je vracena stranica. " +
      "Proveri BTM_EMAIL i BTM_PASSWORD.",
    );
  }

  return parseExport(await response.arrayBuffer());
};

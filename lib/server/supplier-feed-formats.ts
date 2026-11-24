// Citaci formata za dobavljace koji ne salju gotov JSON (Digital Vision: ZIP sa XML-om,
// MS Mobile: dva JSON-a iza prijave). Sve su ciste funkcije bez mreze, da se mogu
// proveriti nad pravim uzorcima. Biblioteke se namerno ne dodaju: oba formata su mala i
// stabilna, a dodatna zavisnost je dodatna povrsina za nepoverljiv ulaz.
import { inflateRawSync } from "node:zlib";

export class FormatError extends Error {}

// Opisi su HTML od vise KB, a objava iz njih uzima najvise 4000 znakova. Cuvanje celog
// teksta u source_payload samo bi napunilo bazu, pa se rez pravi ovde, pre upisa.
const NAJVISE_OPISA = 6000;
const NAJVISE_SLIKA = 12;

export const skratiOpis = (html: unknown): string => {
  if (typeof html !== "string" || !html.trim()) return "";
  // Odsecen tag na kraju ("<stro") bi se prikazao kao tekst.
  return html.slice(0, NAJVISE_OPISA).replace(/<[^>]*$/, "");
};

/** Cita prvi XML fajl iz ZIP arhive. Gornja granica velicine stiti od ZIP bombe. */
// MS Mobile i Digital Vision ne salju marku, pa se prepoznaje iz naziva. Samo proizvodjaci opreme i
// dodataka koji su stvarno u njihovim nazivima; marke telefona (Samsung, Xiaomi, Apple...) su namerno
// izostavljene jer u nazivu oznacavaju uredjaj za koji je dodatak, ne proizvodjaca.
const BRENDOVI = [
  "Nillkin", "Hanman", "Mercury", "Moxom", "Deji", "GKK", "Comicell", "Fantech", "Teracell", "Nanobit",
  "Guess", "Karl Lagerfeld", "Xmart", "Ihave", "Superior", "Baseus", "Remax", "Hoco", "Borofone", "Ugreen",
  "Joyroom", "Anker", "Spigen", "Ringke", "Usams", "Wiwu", "Choetech", "Vention", "Devia", "Havit",
  "Edifier", "JBL", "Logitech", "Redragon", "Rampage", "Genesis", "Gigatech", "Mcdodo", "Proda", "Awei",
];
const BREND_REGEX = new RegExp(String.raw`(?<![\p{L}\d])(${BRENDOVI.map((b) => b.replace(/ /g, String.raw`\s+`)).join("|")})(?![\p{L}\d])`, "iu");
const BREND_IME = new Map(BRENDOVI.map((b) => [b.toLowerCase().replace(/\s+/g, " "), b]));
export const brendIzNaziva = (naziv: string): string => {
  const m = BREND_REGEX.exec(naziv);
  return m ? (BREND_IME.get(m[1].toLowerCase().replace(/\s+/g, " ")) ?? "") : "";
};

export const readZipXml = (zip: Uint8Array, maxBytes = 120 * 1024 * 1024): string => {
  const data = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  if (data.length < 22 || data.readUInt32LE(0) !== 0x04034b50) {
    throw new FormatError("Odgovor nije ZIP arhiva.");
  }
  // Kraj centralnog direktorijuma (EOCD): potpis 0x06054b50 u poslednjih 64 KB.
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65535); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new FormatError("ZIP arhiva je oštećena (nema kraja direktorijuma).");
  const entries = data.readUInt16LE(eocd + 10);
  let cursor = data.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cursor === 0xffffffff) throw new FormatError("ZIP64 arhive nisu podržane.");

  for (let n = 0; n < entries; n++) {
    if (cursor + 46 > data.length || data.readUInt32LE(cursor) !== 0x02014b50) {
      throw new FormatError("ZIP arhiva je oštećena (centralni direktorijum).");
    }
    const flags = data.readUInt16LE(cursor + 8);
    const method = data.readUInt16LE(cursor + 10);
    const compressedSize = data.readUInt32LE(cursor + 20);
    const size = data.readUInt32LE(cursor + 24);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const localOffset = data.readUInt32LE(cursor + 42);
    const name = data.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    if (!/\.xml$/i.test(name) || name.endsWith("/")) continue;
    if (flags & 1) throw new FormatError("ZIP arhiva je zaštićena lozinkom.");
    if (size > maxBytes) throw new FormatError("XML u arhivi je veći od dozvoljenog.");
    if (localOffset + 30 > data.length || data.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new FormatError("ZIP arhiva je oštećena (lokalno zaglavlje).");
    }
    const start = localOffset + 30 + data.readUInt16LE(localOffset + 26) + data.readUInt16LE(localOffset + 28);
    const body = data.subarray(start, start + compressedSize);
    if (body.length !== compressedSize) throw new FormatError("ZIP arhiva je odsečena.");
    let raw: Buffer;
    if (method === 0) raw = body;
    else if (method === 8) {
      try { raw = inflateRawSync(body, { maxOutputLength: maxBytes }); }
      catch { throw new FormatError("XML u arhivi se ne može raspakovati."); }
    } else throw new FormatError(`Metod kompresije ${method} nije podržan.`);
    return raw.toString("utf8").replace(/^﻿/, "");
  }
  throw new FormatError("U arhivi nema XML fajla.");
};

const ENTITETI: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const iz = (tekst: string) => tekst.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (ceo, kod: string) => {
  if (kod[0] !== "#") return ENTITETI[kod.toLowerCase()] ?? ceo;
  const broj = kod[1] === "x" || kod[1] === "X" ? parseInt(kod.slice(2), 16) : Number(kod.slice(1));
  return broj > 0 && broj < 0x110000 ? String.fromCodePoint(broj) : ceo;
});

// Vrednost lisnog elementa: ili CDATA (bez ikakvog tumacenja) ili obican tekst sa entitetima.
// Belina ispred CDATA je u grani, a tekst grana hvata i beline pa se one skidaju trim-om: tako ni
// jedan par kvantifikatora ne moze da podeli iste znakove (prethodni oblik je imao kubno
// vracanje nad dugackim nizom belina).
const LIST = /<([A-Za-z][\w-]*)>(?:\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*|([^<]*))<\/\1>/g;
const vrednost = (m: RegExpMatchArray) => (m[2] !== undefined ? m[2] : iz((m[3] ?? "").trim()));

/**
 * Digital Vision XML: <artikli><artikal> sa id, sifra, naziv, kategorija, vpCena, opis i
 * <slike><slika>. Vraca zapise kakvi su u izvoru (slike kao niz), bez tumacenja polja.
 */
export const parseDvXml = (xml: string): Record<string, unknown>[] => {
  const out: Record<string, unknown>[] = [];
  for (const blok of xml.matchAll(/<artikal>([\s\S]*?)<\/artikal>/g)) {
    const telo = blok[1];
    const slikeBlok = /<slike>([\s\S]*?)<\/slike>/.exec(telo);
    // Slike se skidaju pre citanja polja: <slika> ne sme da se pomesa sa ostalim elementima.
    const bezSlika = slikeBlok ? telo.replace(slikeBlok[0], "") : telo;
    const zapis: Record<string, unknown> = {};
    for (const polje of bezSlika.matchAll(LIST)) zapis[polje[1]] = vrednost(polje);
    zapis.slike = slikeBlok
      ? [...slikeBlok[1].matchAll(LIST)].filter((m) => m[1] === "slika")
          .map((m) => vrednost(m).trim()).filter(Boolean).slice(0, NAJVISE_SLIKA)
      : [];
    if ("opis" in zapis) zapis.opis = skratiOpis(zapis.opis);
    out.push(zapis);
  }
  if (out.length === 0) throw new FormatError("XML nema nijedan <artikal>.");
  return out;
};
const kategorijaDv = (tekst: unknown) =>
  typeof tekst === "string" ? tekst.split(">").map((deo) => deo.trim()).filter(Boolean).join(" > ") : "";

/** Digital Vision: putanja kategorije se sredjuje, ostalo ostaje kako je stiglo. */
export const dvRecords = (xml: string) =>
  parseDvXml(xml).map((zapis) => ({ ...zapis, kategorija: kategorijaDv(zapis.kategorija) }));

type MsKategorija = { Id: number; Name: string; TreeId: number; TreeParentId: number };

/**
 * MS Mobile: artikal nosi CategoryId (Id kategorije), a stablo se gradi preko
 * TreeId/TreeParentId. Putanja je od korena ka listu. Ciklus ili nepoznata kategorija
 * daje prazan tekst (artikal se objavljuje po nazivu, ne po kategoriji).
 */
export const msCategoryPaths = (kategorije: unknown): ((categoryId: unknown) => string) => {
  if (!Array.isArray(kategorije)) throw new FormatError("Spisak kategorija nije niz.");
  const poId = new Map<number, MsKategorija>();
  const poStablu = new Map<number, MsKategorija>();
  for (const k of kategorije as MsKategorija[]) {
    if (k && typeof k === "object") { poId.set(Number(k.Id), k); poStablu.set(Number(k.TreeId), k); }
  }
  const kes = new Map<number, string>();
  return (categoryId) => {
    const id = Number(categoryId);
    const poznata = kes.get(id);
    if (poznata !== undefined) return poznata;
    const delovi: string[] = [];
    const videno = new Set<number>();
    let cvor = poId.get(id);
    while (cvor && !videno.has(Number(cvor.TreeId))) {
      videno.add(Number(cvor.TreeId));
      const ime = String(cvor.Name ?? "").trim();
      if (ime) delovi.unshift(ime);
      cvor = poStablu.get(Number(cvor.TreeParentId));
    }
    const putanja = delovi.join(" > ");
    kes.set(id, putanja);
    return putanja;
  };
};

/** MS Mobile: artikli sa spojenom putanjom kategorije; teski tekstovi se skracuju. */
export const msRecords = (proizvodi: unknown, kategorije: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(proizvodi)) throw new FormatError("Spisak artikala nije niz.");
  const putanja = msCategoryPaths(kategorije);
  return (proizvodi as Record<string, unknown>[]).map((artikal) => ({
    ...artikal,
    Description: skratiOpis(artikal.Description),
    Images: Array.isArray(artikal.Images) ? artikal.Images.filter((s) => typeof s === "string").slice(0, NAJVISE_SLIKA) : [],
    CategoryPath: putanja(artikal.CategoryId),
  }));
};

/** Skriveni antiforgery token sa nopCommerce forme za prijavu. */
export const nopAntiforgeryToken = (html: string): string | null => {
  const tag = /<input\b[^>]*name="__RequestVerificationToken"[^>]*>/i.exec(html);
  const v = tag ? /value="([^"]+)"/i.exec(tag[0]) : null;
  return v ? iz(v[1]) : null;
};

/** Spaja Set-Cookie zaglavlja u "ime=vrednost" parove; kasniji istog imena pobedjuje. */
export const mergeCookies = (jar: Map<string, string>, setCookie: string[]) => {
  for (const linija of setCookie) {
    const par = linija.split(";")[0];
    const i = par.indexOf("=");
    if (i <= 0) continue;
    const ime = par.slice(0, i).trim();
    const v = par.slice(i + 1).trim();
    // Prazna vrednost ili istek u proslosti je brisanje kolacica.
    if (!v || /expires=Thu, 01 Jan 1970/i.test(linija)) jar.delete(ime);
    else jar.set(ime, v);
  }
  return jar;
};
export const cookieHeader = (jar: Map<string, string>) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

// Pomocne funkcije za plocice brendova i modela u katalogu (telefoni i laptopovi).
// Cist TypeScript bez React-a, da ga dele katalog i birac modela.

export type TileKind = "phone" | "laptop";

// Podgrupe koje u katalogu dobijaju plocice brendova pa modela. Ostale podgrupe
// nemaju plocice, a stari izbor uredjaja u bocnoj traci ostaje za njih.
export const TILE_SUBS: Record<string, TileKind> = {
  telefoni: "phone",
  maske: "phone",
  stakla: "phone",
  "stakla-kamere": "phone",
  "baterije-telefoni": "phone",
  "laptop-baterije": "laptop",
  "laptop-punjaci": "laptop",
  "laptop-tastature": "laptop",
};

export const tileKind = (subcategory: string): TileKind | null => TILE_SUBS[subcategory] ?? null;

// Natpis na plocici brenda: "Maske za iPhone", "Zaštita kamere za iPhone", "Punjači za Dell".
// Imenica sa predlogom je kljuc za prevod, pa naslov ostaje "<imenica> <brend>" na oba jezika.
const TILE_NOUNS: Record<string, string> = {
  maske: "Maske za",
  stakla: "Zaštitna stakla za",
  "stakla-kamere": "Zaštita kamere za",
  "baterije-telefoni": "Baterije za",
  "laptop-baterije": "Baterije za",
  "laptop-punjaci": "Punjači za",
  "laptop-tastature": "Tastature za",
};
const TILE_NOUN_FALLBACK = "Oprema za";

// Brend iz baze se prikazuje onako kako ga kupac trazi: Apple telefoni su "iPhone",
// Apple laptopovi "Apple MacBook".
const BRAND_LABELS: Record<TileKind, Record<string, string>> = {
  phone: { Apple: "iPhone" },
  laptop: { Apple: "Apple MacBook", Microsoft: "Microsoft Surface" },
};

// Bez poznate vrste (kupac je stigao starim linkom bez kategorije) brend ostaje kakav je u bazi.
export const brandLabel = (kind: TileKind | null, brand: string) => (kind ? BRAND_LABELS[kind][brand] : undefined) ?? brand;

// tr je prevod imenice (useT); bez njega naslov ostaje na srpskom.
export const brandTileTitle = (
  subcategory: string,
  kind: TileKind,
  brand: string,
  tr: (tekst: string) => string = (tekst) => tekst,
) => subcategory === "telefoni" ? brand : `${tr(TILE_NOUNS[subcategory] ?? TILE_NOUN_FALLBACK)} ${brandLabel(kind, brand)}`;

// Urednicki redosled: prvo brendovi koje kupci najcesce traze, ostali po broju artikala.
const BRAND_ORDER: Record<TileKind, string[]> = {
  phone: ["Apple", "Samsung", "Xiaomi", "Huawei"],
  laptop: ["Acer", "Asus", "Apple", "Dell", "HP", "Lenovo", "Samsung", "Sony", "Microsoft", "MSI", "Fujitsu"],
};

export function sortBrandTiles(kind: TileKind, brands: readonly [string, number][]): [string, number][] {
  const order = BRAND_ORDER[kind];
  const rank = (brand: string) => {
    const index = order.indexOf(brand);
    return index < 0 ? order.length : index;
  };
  return brands
    .filter(([, count]) => count > 0)
    .sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0], "sr-Latn-RS"));
}

// Samsung modeli se prikazuju sa "Galaxy": ime modela (S25 Ultra) dobija prefiks,
// tehnicki kod serije A novijih generacija (A546B) se prikazuje uz ime (Galaxy A54).
// Ostali kodovi (S938B) ostaju kakvi jesu, jer im ime ne znamo.
const SAMSUNG_CODE = /^[A-Z]\d{3,4}[A-Z0-9]{0,2}(?:\/DS)?$/i;
// Kod serije A ima oblik A + dve cifre modela + cifra izvedbe + slova. Do 2018. godine
// izvedba je bila 0 (A500F je Galaxy A5 2015, A520F A5 2017, A730F A7+ 2018), a prve dve
// cifre su bile godina i velicina, ne model: "A52" bi bio pogresno ime. Isto vazi za A260F
// (A2 Core) i za A605 (A6+ 2018). Od 2019. (A105, A305, A546...) izvedba nije 0.
const SAMSUNG_A_LEGACY = /^A(?:\d{2}0|605)/i;
const SAMSUNG_A_MODERN = /^A(\d{2})\d[A-Z](?:\/DS)?$/i;

// Marke ciji kljuc modela moze biti samo broj ili broj sa dodatkom ("400", "9I", "12 Pro"):
// bez marke takav naziv na plocici ne znaci nista. Samsung i Apple imaju svoja pravila.
const BROJ_BEZ_IMENA = /^\d/;
export function modelLabel(brand: string, model: string, kind: TileKind = "phone"): string {
  if (kind !== "phone") return model;
  if (brand === "Samsung") {
    const aSeries = SAMSUNG_A_MODERN.exec(model);
    if (aSeries && !SAMSUNG_A_LEGACY.test(model)) return `Galaxy A${aSeries[1]} (${model})`;
    if (SAMSUNG_CODE.test(model) || /^galaxy\b/i.test(model)) return model;
    return `Galaxy ${model}`;
  }
  // Realme oznacava izvedbu malim slovom: 9i, 8i, 5s (baza ih cuva velikim).
  if (brand === "Realme" && /^\d+[IS]$/.test(model)) return `Realme ${model.toLowerCase()}`;
  if (brand && brand !== "Apple" && BROJ_BEZ_IMENA.test(model)) return `${brand} ${model}`;
  return model;
}

// Redosled modela na plocicama telefona: od najnovijeg ka najstarijem, a unutar istog modela
// od najjace varijante ka osnovnoj (Pro Max, Pro, osnovni, Lite). Kljuc svakog modela se racuna
// jednom, pa poredjenje samo uporedjuje brojeve. Bez poznatog brenda (ili za laptopove)
// ostaje stari redosled: vise artikala prvo, pa abecedno.
const MODEL_COLLATOR = new Intl.Collator("sr-Latn-RS", { numeric: true });
const KEY_SIZE = 5;
type SortKey = number[];
const sortKey = (...parts: number[]): SortKey => {
  const key = new Array<number>(KEY_SIZE).fill(0);
  parts.forEach((part, index) => {
    key[index] = part;
  });
  return key;
};
const compareKeys = (a: SortKey, b: SortKey): number => {
  for (let i = 0; i < KEY_SIZE; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

// Oznaka mreze (4G/5G) ne menja model, pa se pri razvrstavanju izbacuje.
const withoutNetwork = (text: string) => text.replace(/\s+[45]G\b/gi, "").trim();
const wordsOf = (text: string | undefined) => new Set(text ? text.split(" ") : []);

// iPhone: generacija opadajuce (18, 17 ... 11, pa X familija, pa 8 ... 5), unutar generacije
// Pro Max, Pro, Plus, Air, osnovni, e, mini. SE modeli idu posle svih brojeva, najnoviji prvo,
// a ostali Apple uredjaji (iPad, Watch ...) na kraj.
function appleKey(model: string): SortKey {
  const match = /^iphone\s+(.+)$/i.exec(model.trim());
  if (!match) return sortKey(2);
  const rest = match[1].toUpperCase().replace(/\s+/g, " ").trim();
  const se = /^SE(?:\s+(.*))?$/.exec(rest);
  if (se) {
    const tail = se[1] ?? "";
    const year = /20\d\d/.exec(tail);
    // "SE 3" je izdanje iz 2022, "SE 2" iz 2020, goli "SE" je prvi iz 2016.
    return sortKey(1, -(year ? Number(year[0]) : tail === "3" ? 2022 : tail === "2" ? 2020 : 2016));
  }
  // X familija je izmedju 11 i 8: XS Max, XS, XR, X.
  const x = /^X([RS]?)(?:\s+(.*))?$/.exec(rest);
  if (x) {
    const words = wordsOf(x[2]);
    const rank = x[1] === "S" ? (words.has("MAX") ? 0 : 1) : x[1] === "R" ? 2 : 3;
    return sortKey(0, -10, rank);
  }
  const num = /^(\d+)([A-Z]?)(?:\s+(.*))?$/.exec(rest);
  if (!num) return sortKey(2);
  // 6S i 5S su izmedju svoje i sledece generacije (6S Plus, 6S, 6 Plus, 6), 5C uz 5S.
  const generation = Number(num[1]) + (num[2] === "S" ? 0.5 : num[2] === "C" ? 0.4 : 0);
  const words = wordsOf(num[3]);
  const variant = words.has("PRO")
    ? words.has("MAX") ? 0 : 1
    : words.has("PLUS") ? 2 : words.has("AIR") ? 3 : words.has("MINI") ? 6 : words.size ? 7 : num[2] === "E" ? 5 : 4;
  return sortKey(0, -generation, variant);
}

// Samsung varijanta unutar istog modela: Ultra, Edge, Plus, osnovni, FE, Lite, ostalo.
function samsungVariant(rest: string | undefined, glued = ""): number {
  const words = wordsOf(rest);
  if (words.has("ULTRA")) return 0;
  if (words.has("EDGE")) return 1;
  if (words.has("PLUS")) return words.has("FE") ? 3 : 2;
  if (words.has("FE")) return 5;
  if (words.has("LITE")) return 6;
  if (words.size) return 7;
  return glued === "E" ? 5 : 4;
}

// Samsung S galaksije posle S29 nisu pravi modeli (dobavljac je S20/S21 pogresno uneo kao S30),
// pa idu u poslednju grupu da ne preskoce S26 na vrhu.
const SAMSUNG_S_LAST = 29;

// Serija A pocinje od A57 (trenutno najnoviji); stari brojevi iznad toga (A91, A80, A70, A60,
// modeli iz 2019-2022) idu posle cele A serije, takodje opadajuce, da ne preskoce A57 na vrhu.
const SAMSUNG_A_FIRST_MAX = 57;
const aKey = (num: number, variant: number, extra: number): SortKey =>
  sortKey(1, num > SAMSUNG_A_FIRST_MAX ? 1 : 0, -num, variant, extra);

// Samsung: S serija (Ultra, Edge, Plus, osnovni, FE), pa A serija po broju (od A57), Z Fold, Z Flip,
// M, Note, Tab, a sve ostalo (J, Xcover, nepoznate sifre) na kraj. Sifre se citaju istom
// logikom kao u modelLabel: A546B je A54, A520F je A5 (2017).
function samsungKey(model: string): SortKey {
  const name = withoutNetwork(model.trim().toUpperCase().replace(/\+/g, " PLUS ").replace(/\s+/g, " "))
    .replace(/^GALAXY\s+/, "");
  const fold = /^(?:Z\s*)?FOLD\s*(\d*)(?:\s+(.*))?$/.exec(name);
  if (fold) return sortKey(2, -Number(fold[1] || 0), samsungVariant(fold[2]));
  const flip = /^(?:Z\s*)?FLIP\s*(\d*)(?:\s+(.*))?$/.exec(name);
  if (flip) return sortKey(3, -Number(flip[1] || 0), samsungVariant(flip[2]));
  const s = /^S(\d{1,2})([A-Z]?)(?:\s+(.*))?$/.exec(name);
  if (s && Number(s[1]) <= SAMSUNG_S_LAST) return sortKey(0, -Number(s[1]), samsungVariant(s[3], s[2]));
  // Sifre S901B-S938B: druga cifra je generacija (S22-S25), treca varijanta (1 osnovni, 6 Plus, 8 Ultra).
  const sCode = /^S9([0-3])(\d)[A-Z]/.exec(name);
  if (sCode) return sortKey(0, -(22 + Number(sCode[1])), sCode[2] === "8" ? 0 : sCode[2] === "6" ? 2 : sCode[2] === "1" ? 4 : 7);
  if (/^A\d{3}/.test(name) && SAMSUNG_A_LEGACY.test(name)) {
    // Stari kodovi (A500F, A750F): prva cifra je model (A5, A7), posle novih istog broja.
    return aKey(Number(name[1]), 1, 0);
  }
  const aCode = SAMSUNG_A_MODERN.exec(name);
  if (aCode) return aKey(Number(aCode[1]), 0, 0);
  const a = /^A(\d{1,2})([A-Z]{0,2})(?:\s+(.*))?$/.exec(name);
  if (a) return aKey(Number(a[1]), 0, a[2] || a[3] ? 1 : 0);
  const m = /^M(\d{1,3})([A-Z]{0,2})(?:\s+(.*))?$/.exec(name);
  if (m) return sortKey(4, -Number(m[1]), m[2] || m[3] ? 1 : 0);
  const note = /^NOTE\s*(\d+)([A-Z]?)(?:\s+(.*))?$/.exec(name);
  if (note) return sortKey(5, -Number(note[1]), samsungVariant(note[3], note[2]));
  const tab = /^TAB\s+(?:([SA])(\d+)|(\d+))(?:\s+(.*))?$/.exec(name);
  if (tab) {
    const family = tab[1] === "S" ? 0 : tab[1] === "A" ? 1 : 2;
    return sortKey(6, family, -Number(tab[2] ?? tab[3]), samsungVariant(tab[4]));
  }
  return sortKey(7);
}

// Ostali brendovi: serija (tekst pre prvog broja: "Redmi Note", "Poco X", prazno za gole
// brojeve poput Xiaomi 13) sa vise artikala ide prva, unutar serije broj opadajuce, pa
// varijanta Ultra, Pro+, Pro Max, Pro, Plus, osnovni, Lite/FE/e/s/ostalo. Slova uz broj
// (13T, X9B) idu po abecedi unazad, osnovni model pre njih.
type GenericModel = { series: string; num: number; variant: number; glue: number };
function parseGeneric(model: string): GenericModel | null {
  const name = withoutNetwork(model.trim().replace(/\s+/g, " "));
  if (!name || /^[45]G$/i.test(name)) return null;
  const match = /^(.*?)(\d+(?:\.\d+)?)([A-Za-z]*)(?:\s+(.*))?$/.exec(name);
  if (!match) return null;
  const glued = match[3].toUpperCase();
  const words = wordsOf(match[4]?.toUpperCase());
  let variant = 6;
  if (words.has("ULTRA")) variant = 0;
  else if (words.has("PRO")) variant = words.has("PLUS") ? 1 : words.has("MAX") ? 2 : 3;
  else if (words.has("MAX")) variant = 2;
  else if (words.has("PLUS")) variant = 4;
  else if (!words.size) variant = glued === "E" || glued === "S" || glued === "SE" ? 6 : 5;
  let glue = 0;
  if (glued) {
    glue = 1;
    for (let i = 0; i < Math.min(glued.length, 3); i++) glue += (91 - glued.charCodeAt(i)) / Math.pow(100, i + 1);
  }
  return { series: match[1].trim().toLowerCase(), num: Number(match[2]), variant, glue };
}

function genericKeys(visible: readonly [string, number][]): SortKey[] {
  const parsed = visible.map(([model]) => parseGeneric(model));
  const totals = new Map<string, number>();
  visible.forEach(([, count], index) => {
    const item = parsed[index];
    if (item) totals.set(item.series, (totals.get(item.series) ?? 0) + count);
  });
  const order = Array.from(totals.keys()).sort((a, b) => totals.get(b)! - totals.get(a)! || MODEL_COLLATOR.compare(a, b));
  const seriesIndex = new Map(order.map((series, index) => [series, index] as const));
  return parsed.map((item) =>
    item ? sortKey(0, seriesIndex.get(item.series)!, -item.num, item.variant, item.glue) : sortKey(1),
  );
}

export function sortModelTiles(
  models: readonly [string, number][],
  brand = "",
  kind: TileKind = "phone",
): [string, number][] {
  const visible = models.filter(([, count]) => count > 0);
  const byCount = (a: [string, number], b: [string, number]) => b[1] - a[1] || MODEL_COLLATOR.compare(a[0], b[0]);
  const brandKey = brand.trim().toLowerCase();
  if (kind !== "phone" || !brandKey) return visible.sort(byCount);
  const keys =
    brandKey === "apple"
      ? visible.map(([model]) => appleKey(model))
      : brandKey === "samsung"
        ? visible.map(([model]) => samsungKey(model))
        : genericKeys(visible);
  return visible
    .map((entry, index) => ({ entry, key: keys[index] }))
    .sort((a, b) => compareKeys(a.key, b.key) || byCount(a.entry, b.entry))
    .map(({ entry }) => entry);
}

// 1 proizvod, 2-4 proizvoda, 5-20 proizvoda, 21 proizvod, 22-24 proizvoda.
export function pluralSr(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(Math.trunc(count));
  const last = n % 10;
  const lastTwo = n % 100;
  if (last === 1 && lastTwo !== 11) return one;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
}

export const productCountLabel = (count: number) =>
  `${count.toLocaleString("sr-Latn-RS")} ${pluralSr(count, "proizvod", "proizvoda", "proizvoda")}`;

export const modelCountLabel = (count: number) =>
  `${count.toLocaleString("sr-Latn-RS")} ${pluralSr(count, "model", "modela", "modela")}`;

// Citanje novih brojaca iz odgovora kataloga. Polja su opciona, pa nedostajuce ili
// neocekivane vrednosti znace prazan spisak, nikad gresku u prikazu.
const zapis = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export function facetEntries(source: unknown): [string, number][] {
  return Object.entries(zapis(source)).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0,
  );
}

export type SpecOption = { value: string; count: number };
export function facetSpecs(source: unknown): Record<string, SpecOption[]> {
  const result: Record<string, SpecOption[]> = {};
  for (const [key, list] of Object.entries(zapis(source))) {
    if (!Array.isArray(list)) continue;
    result[key] = list.filter(
      (item): item is SpecOption =>
        Boolean(item) && typeof item.value === "string" && typeof item.count === "number",
    );
  }
  return result;
}

// Svojstva punjaca laptopa: naziv u bazi i parametar u adresi stranice.
export const SPEC_GROUPS = [
  { key: "Snaga", param: "snaga" },
  { key: "Napon", param: "napon" },
  { key: "Struja", param: "struja" },
  { key: "Konektor", param: "konektor" },
] as const;
export { SPEC_SUBS } from "@/lib/catalog-specs";

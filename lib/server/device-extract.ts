// Iz naziva artikla izvlaci za koji uredjaj ide: marka + tacan naziv modela.
// Sluzi filteru "Za tvoj uredjaj" i plocicama marki/modela u prodavnici
// (maske, stakla, stakla za kamere, baterije telefona, delovi za laptopove).
//
// Ulazi:
//   - izvuciUredjaj(naziv)         stara pravila maski i stakala (poslednja marka, Samsung kodovi)
//   - izvuciUredjajImena(naziv)    ime modela umesto Samsung koda, prva marka vazi
//   - izvuciUredjajBaterije(naziv) baterije telefona i tableta ("Baterija X za ...")
//   - izvuciLaptopMarku(naziv)     marka laptopa za baterije, punjace i tastature
//   - izvuciUredjajZaArtikal(a)    jedan ulaz za objavu kataloga; bira pravilo po
//                                  doradjenoj podkategoriji (posle refineStoreCategory)
//   - bezStarihModelaZaMaske(sub, u) maske za iPhone i Samsung bez starih modela (feedback 02.11.2026, 03.11.2026)
//
// Pravilo: radije nista nego pogresno. Nepoznat ili dvosmislen oblik vraca
// prazno, jer artikal prikazan uz pogresan model kupcu salje pogresnu robu.

export type Uredjaj = { deviceBrand: string | null; devices: string[] };

// Boje i nacin nosenja nisu deo modela.
const BOJE =
  /\b(crna|crni|crno|bela|beli|belo|plava|plavi|crvena|crveni|zelena|zeleni|roze|ljubicasta|teget|silver|gold|zlatna|siva|sivi|narandzasta|zuta|pink|braon|bordo|tirkiz|providna|providan|providno|mint|lila|sarena|transparent|clear|black|white|blue|red|green|magsafe)\b/gi;

// Kapacitet, snaga i dijagonala nisu deo modela, a lako se zamene za broj modela
// ("Honor X7c 8/128GB" bi inace dao model "128GB").
const MERE = /\b\d+(?:[.,]\d+)?\s*(?:gb|tb|mb|mah|mm|cm|inch|hz|w)\b|\b\d+(?:[.,]\d+)?\s*"/gi;

const bezDijakritika = (v: string) =>
  v
    .replace(/đ/g, "dj")
    .replace(/Đ/g, "Dj")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

type Pravilo = {
  marka: string;
  kljuc: RegExp; // po cemu se marka prepoznaje u nazivu
  model: RegExp; // sta se iz ostatka uzima kao model
  prefiks?: string; // ime koje se dopisuje ispred modela
  ukloni?: RegExp; // dokle se preskace pre trazenja modela (podrazumevano `kljuc`)
  preskoci?: (prva: string | null) => boolean; // v2: pravilo se ne primenjuje u tom kontekstu
  // v3: samo uz `imena`; umesto `model` deo naziva cita ovo pravilo (Samsung, Apple,
  // Xiaomi). `ostatak` je tekst iza marke, `deo` ceo deo, `ceo` ceo naziv, `n` imena
  // iz ranijih delova iste marke (deo bez marke moze samo da nastavi model).
  deo?: (ostatak: string, deo: string, ceo: string, n: Nastavak) => Pogodak;
};

// v3: sta je pravilo nasao u jednom delu naziva.
type Pogodak = {
  // kod: oznaka modela (A546B), ne ime; rezervni: kod koji ostaje i kad naziv ima
  // imena, jer ime iz istog dela nije prihvaceno; ocek: ime koje kod oznacava.
  modeli: { m: string; kod: boolean; rezervni?: boolean; ocek?: string | null }[];
  odbijeno?: boolean; // model postoji, ali nije tacno prepoznat: marka ostaje, model ne
  // Za sledeci deo bez imena marke. nasledi: ceo procitan model (i kad ga je kod iz
  // istog dela odbio); sidro: model procitan iz samog dela, ne iz nastavka, i kad
  // dodatak iza njega nije prepoznat (sluzi samo za seriju: Redmi, Redmi Note, Z Fold).
  nasledi?: string;
  sidro?: string;
};

// v3: deo bez imena marke koji nastavlja raniji model ("iPhone 17 Pro/Pro Max",
// "Redmi Note 14 Pro 4G/5G", "Redmi 9C/10A", "Z Flip 6/7 FE"). prethodni: model iz
// dela neposredno ispred; sidro: model iz poslednjeg dela koji ga je sam naveo.
type Nastavak = { prethodni: string | null; sidro: string | null };
const BEZ_NASTAVKA: Nastavak = { prethodni: null, sidro: null };

// ---------------------------------------------------------------------------
// Postojeca pravila (nepromenjena).
// ---------------------------------------------------------------------------
const PRAVILA: Pravilo[] = [
  {
    marka: "Apple",
    kljuc: /\bi\s?phone\b/i,
    prefiks: "iPhone ",
    model:
      /\b(?:(?:1[0-9]|[5-9])|X[SsRr]?|SE)\s*(?:Pro\s*Max|Plus|Pro|Max|Air|Mini|e)?\b/i,
  },
  {
    marka: "Samsung",
    kljuc: /\b(?:samsung|galaxy)\b/i,
    model:
      /\b(?:Z\s*(?:Fold|Flip)\s*\d{1,2}|Note\s*\d{1,2}|Tab\s*[A-Z]?\d{1,2}|[ASMFJ]\d{2,3}[A-Za-z]{0,2})\s*(?:Ultra|Plus|\+|FE|Edge|Lite|5G)?\b/i,
  },
  {
    marka: "Xiaomi",
    kljuc: /\b(?:redmi|poco|xiaomi)\b/i,
    ukloni: /\bxiaomi\b/i,
    model:
      /\b(?:Redmi\s*(?:Note\s*|Pad\s*)?[A-Z]?\d{1,2}[A-Za-z]{0,2}|Poco\s*[A-Z]\d{1,2}[A-Za-z]{0,2}|Mi\s*\d{1,2}[A-Za-z]{0,2}|\d{2}[A-Za-z]?)\s*(?:Pro\+?|Plus|Lite|5G|4G|Ultra|T)?\b/i,
  },
  {
    marka: "Honor",
    kljuc: /\bhonor\b/i,
    model:
      /\b(?:Magic\s*|Pad\s*|Tab\s*)?[A-Z]?\d{1,3}[A-Za-z]{0,2}\s*(?:Pro|Lite|Plus|5G)?\b/i,
  },
  {
    marka: "Huawei",
    kljuc: /\bhuawei\b/i,
    model: /\b(?:Mate|Nova|P|Y)\s*\d{1,3}[A-Za-z]{0,2}\s*(?:Pro|Lite|Plus|5G|i)?\b/i,
  },
  {
    marka: "Motorola",
    kljuc: /\bmotorola\b/i,
    prefiks: "Moto ",
    model: /\b(?:Moto\s*)?[GEX]\s*\d{1,3}\s*(?:Power|Play|Plus|Pro|5G)?\b/i,
  },
  { marka: "Nokia", kljuc: /\bnokia\b/i, model: /\b[CGX]?\d{1,3}(?:\.\d)?\s*(?:Plus|5G)?\b/i },
  {
    marka: "Realme",
    kljuc: /\brealme\b/i,
    model: /\b(?:C|GT|Note)?\s*\d{1,2}[A-Za-z]{0,2}\s*(?:Pro\+?|Lite|5G)?\b/i,
  },
  {
    marka: "Oppo",
    kljuc: /\boppo\b/i,
    model: /\b(?:Reno|A|Find)\s*\d{1,3}[A-Za-z]{0,2}\s*(?:Pro|Lite|5G)?\b/i,
  },
  {
    marka: "OnePlus",
    kljuc: /\boneplus\b/i,
    model: /\b(?:Nord\s*)?[A-Z]?\d{1,2}[A-Za-z]{0,2}\s*(?:Pro|Lite|T)?\b/i,
  },
  {
    marka: "ZTE",
    kljuc: /\b(?:zte|blade)\b/i,
    ukloni: /\bzte\b/i,
    model: /\b(?:Blade\s*)?[AVL]?\d{1,3}[A-Za-z]{0,2}\b/i,
  },
  {
    marka: "Tecno",
    kljuc: /\btecno\b/i,
    model: /\b(?:Spark|Camon|Pova|Pop)\s*\d{1,2}[A-Za-z]{0,2}\s*(?:Pro)?\b/i,
  },
  {
    marka: "Infinix",
    kljuc: /\binfinix\b/i,
    model: /\b(?:Hot|Note|Smart|Zero)\s*\d{1,2}[A-Za-z]{0,2}\s*(?:Pro)?\b/i,
  },
  { marka: "Vivo", kljuc: /\bvivo\b/i, model: /\b[XYVT]\d{1,3}[A-Za-z]{0,2}\s*(?:Pro|Lite|5G)?\b/i },
];

// Isti telefon mora dobiti isti zapis, inace se u filteru pojavi dva puta
// ("iPhone 16 PRO" i "iPhone 16 Pro" su jedan model, ne dva).
const RECI: Record<string, string> = {
  pro: "Pro", max: "Max", plus: "Plus", mini: "Mini", air: "Air",
  ultra: "Ultra", lite: "Lite", fe: "FE", edge: "Edge", note: "Note",
  fold: "Fold", flip: "Flip", tab: "Tab", pad: "Pad", magic: "Magic",
  redmi: "Redmi", poco: "Poco", mi: "Mi", mate: "Mate", nova: "Nova",
  moto: "Moto", nord: "Nord", blade: "Blade", spark: "Spark",
  camon: "Camon", pova: "Pova", pop: "Pop", hot: "Hot", smart: "Smart",
  zero: "Zero", reno: "Reno", find: "Find", gt: "GT", se: "SE",
  iphone: "iPhone", "5g": "5G", "4g": "4G", e: "e", t: "T", z: "Z", i: "i",
};

const uredi = (v: string) =>
  v
    .replace(/\s+/g, " ")
    .trim()
    // "13PRO" i "18 PROMAX" su isti telefoni kao "13 Pro" i "18 Pro Max".
    .replace(/(\d)\s*(pro\s*max|pro|plus|max|mini|air|ultra|lite)/i, "$1 $2")
    .replace(/\bpro\s*max\b/i, "Pro Max")
    .replace(/^Moto\s+Moto\b/i, "Moto")
    // "S24FE" i "S24 FE" su isti telefon; isto i "Z FOLD8" i "Z Fold 8".
    .replace(/\b([ASMFJ]\d{2,3})FE\b/i, "$1 FE")
    .replace(/\b(Fold|Flip)\s*(\d)/i, "$1 $2")
    .replace(/\s*\+\s*$/, "+")
    .split(" ")
    .map((rec) => {
      const mala = rec.toLowerCase();
      if (RECI[mala]) return RECI[mala];
      if (/^\d{1,2}e$/.test(mala)) return mala; // iPhone 16e
      return mala.toUpperCase(); // oznake tipa A06, S24, 12C, X7B
    })
    .join(" ");

// ---------------------------------------------------------------------------
// Zajednicki motor. Podrazumevane opcije = tacno staro ponasanje.
// ---------------------------------------------------------------------------
type Opcije = {
  // Deo bez imena marke nasledjuje: staro = prvo pravilo iste marke,
  // "pravilo" = tacno ono pravilo koje je poslednje prepoznato (iPad vs iPhone).
  naslednik?: "marka" | "pravilo";
  // Staro: poslednja prepoznata marka pobedjuje. Ovde: prva marka u nazivu,
  // modeli drugih marki se odbacuju (jedna kolona device_brand po artiklu).
  prvaMarka?: boolean;
  // Uz `prvaMarka`: ako prva marka nema nijedan prepoznat model, vazi prva marka
  // koja ga ima ("Huawei P smart Z/Honor 9X" -> Honor 9X). Ne ide ispod "brend
  // nije prepoznat": isto kao staro pravilo, artikal ostaje pod nekom markom.
  rezervnaMarka?: boolean;
  // Ako deo ima vise kljuceva, uzmi onaj koji je prvi u tekstu ("Huawei Honor 8C").
  najranije?: boolean;
  // Samsung: "S938B Galaxy S25 Ultra" -> "S25 Ultra"; kodovi se odbacuju cim
  // naziv ima bar jedno ime modela.
  imena?: boolean;
  // Marka je poznata, a model nije: vrati marku sa praznim modelima.
  bezModela?: boolean;
  // Jednocifreni modeli su dozvoljeni (Nokia 1, Nokia 8).
  kratki?: boolean;
  najvise?: number;
  doradi?: (model: string) => string;
  // v3 (baterije): rec iza modela koju pravilo ne pokriva ("Xperia 10 II",
  // "Honor 8X Max", godina) znaci nepoznat model -> samo marka.
  mreza?: boolean;
};

const SAMSUNG_KOD = /^[ASMFJ]\d{3}/i;

// v3: "SE 2020/2022" su dva telefona; "A546B/DS" je jedan kod, ne dva dela naziva;
// "A36 + gratis" i "A06 +staklo" nisu A36 Plus i A06 Plus.
const predImena = (v: string) =>
  v
    .replace(/\bSE\s*\(?\s*(20\d\d)\s*\)?\s*\/\s*\(?\s*(20\d\d)\b\)?/gi, "SE $1/SE $2")
    .replace(/(\d[A-Za-z]{0,2})\/DS\b/gi, "$1")
    .replace(/\+\s*(gratis|silikon|staklo)\b/gi, " $1");

const izvuci = (naziv: string, pravila: Pravilo[], o: Opcije = {}): Uredjaj => {
  const cist0 = bezDijakritika(naziv).replace(MERE, " ").replace(BOJE, " ");
  const cist = o.imena ? predImena(cist0) : cist0;
  const delovi = cist.split(/[/,]|\s+i\s+/);
  let marka: string | null = null;
  let prva: string | null = null;
  let poslednje: Pravilo | null = null;
  const modeli: { m: string; kod: boolean; rezervni?: boolean; ocek?: string | null; marka: string; tudja: boolean }[] = [];
  const odbijene: string[] = []; // marke ciji je model prepoznat kao nepotpun (v3)
  // v3: modeli iz ranijih delova za nastavke; deo koji ne prodje kroz `deo` prekida niz.
  let zadnji: { p: Pravilo; ime?: string } | null = null;
  let sidro: { p: Pravilo; ime?: string } | null = null;

  for (const deo of delovi) {
    const pre = zadnji;
    zadnji = null;
    let pravilo: Pravilo | undefined;
    if (o.najranije) {
      let najbolje = Infinity;
      for (const p of pravila) {
        if (p.preskoci?.(prva)) continue;
        const i = deo.search(p.kljuc);
        if (i >= 0 && i < najbolje) { najbolje = i; pravilo = p; }
      }
    } else {
      pravilo = pravila.find((p) => !p.preskoci?.(prva) && p.kljuc.test(deo));
    }
    if (pravilo) {
      marka = pravilo.marka;
      poslednje = pravilo;
      prva ??= marka;
      sidro = null;
    }
    if (!marka) continue;
    const tudja = !!o.prvaMarka && marka !== prva;
    if (tudja && !o.rezervnaMarka) continue;

    const vazi =
      pravilo ??
      (o.naslednik === "pravilo" ? poslednje! : pravila.find((p) => p.marka === marka)!);
    // Trazi se tek iza imena marke, da broj ispred njega ne bude uzet za model
    // ("LITO 3D glass Honor 200 Lite" ne sme da da model "3D").
    const granica = pravilo ? deo.match(vazi.ukloni ?? vazi.kljuc) : null;
    const ostatak = granica ? deo.slice((granica.index ?? 0) + granica[0].length) : deo;

    // v3: pravilo koje samo cita deo naziva (Samsung, Apple, Xiaomi uz `imena`).
    if (o.imena && vazi.deo) {
      // Samo deo bez imena marke nastavlja raniji model iste marke.
      const n: Nastavak = pravilo
        ? BEZ_NASTAVKA
        : {
            prethodni: pre?.p === vazi ? pre.ime ?? null : null,
            sidro: sidro?.p === vazi ? sidro.ime ?? null : null,
          };
      const p = vazi.deo(ostatak, deo, cist, n);
      zadnji = { p: vazi, ime: p.nasledi };
      if (pravilo || p.sidro) sidro = { p: vazi, ime: p.sidro };
      if (p.odbijeno && !odbijene.includes(marka)) odbijene.push(marka);
      for (const x of p.modeli) {
        const model = o.doradi ? o.doradi(x.m) : x.m;
        if (model.length >= (o.kratki ? 1 : 2) && !modeli.some((y) => y.m === model)) {
          modeli.push({ m: model, kod: x.kod, rezervni: x.rezervni, ocek: x.ocek, marka, tudja });
        }
      }
      continue;
    }

    // Samsung uz `imena` ima svoje pravilo (`deo`, iznad); ovde je uvek ime modela.
    const nadjen = ostatak.match(vazi.model);
    if (!nadjen) continue;

    // v3 (baterije): nepokriven dodatak iza modela ili decimalni broj ("8.0")
    // znaci da tacan model nije poznat; marka ostaje.
    if (o.mreza) {
      const iza = ostatak.slice((nadjen.index ?? 0) + nadjen[0].length);
      if (/^[.,]\d/.test(iza) || neuhvacen(iza, true)) {
        if (!odbijene.includes(marka)) odbijene.push(marka);
        continue;
      }
    }

    // v3: "Y6 Pro(2017)" i "Y6 Pro 2017" su isti zapis.
    const tekst = o.imena ? nadjen[0].replace(/\(\s*(\d{4})\s*\)?/g, " $1") : nadjen[0];
    let model = uredi((vazi.prefiks ?? "") + tekst);
    if (o.doradi) model = o.doradi(model);
    if (model.length >= (o.kratki ? 1 : 2) && !modeli.some((x) => x.m === model)) modeli.push({ m: model, kod: false, marka, tudja });
  }

  let izabrana = o.prvaMarka ? prva : marka;
  let pool = modeli;
  if (o.prvaMarka) {
    pool = modeli.filter((x) => !x.tudja);
    if (!pool.length && modeli.length) {
      izabrana = modeli[0].marka;
      pool = modeli.filter((x) => x.marka === izabrana);
    }
  }
  let lista = pool.map((x) => x.m);
  // Ime pobedjuje kod. Rezervni kod (ime iz njegovog dela nije prihvaceno) ostaje,
  // osim ako ime koje oznacava vec postoji u listi. Bez imena ostaju svi kodovi.
  const imena = o.imena ? pool.filter((x) => !x.kod).map((x) => x.m) : [];
  if (imena.length) {
    lista = pool.filter((x) => !x.kod || (x.rezervni && !(x.ocek && imena.includes(x.ocek)))).map((x) => x.m);
  }

  if (!lista.length) {
    if (o.bezModela && izabrana) return { deviceBrand: izabrana, devices: [] };
    // v3: model postoji, ali nije tacno prepoznat -> artikal ostaje pod markom.
    const odbijena = izabrana && odbijene.includes(izabrana) ? izabrana : odbijene[0] ?? null;
    return { deviceBrand: odbijena, devices: [] };
  }
  return { deviceBrand: izabrana, devices: lista.slice(0, o.najvise ?? 4) };
};

// ---------------------------------------------------------------------------
// v3 (COBi 11.10): imena modela za maske, stakla i baterije.
// Ime vazi samo kad je ceo zapis prepoznat. Dodatak iza imena koji pravilo ne
// pokriva ("iPhone 18 Duo", "Galaxy S5 Active", "Tab 3" bez velicine) znaci da
// tacan model nije poznat: ostaje kod iz istog dela naziva ili samo marka.
// ---------------------------------------------------------------------------
const NISTA: Pogodak = { modeli: [] };
const ODBIJENO: Pogodak = { modeli: [], odbijeno: true };

// Reci koje menjaju model. Ako ih pravilo ne uhvati, model nije tacno prepoznat.
const NEUHVACENO =
  /^\s*(?:\+|(?:prime|pro|ace|core|mini|compact|se|plus|lite|max|neo|ii|iii|iv|power|play|edge|ultra|fe|duo|star|active|alpha|trend|grand|quantum|young|youth|pocket|advance|fame|mega|zoom|style|fusion|turbo|fold|flip|gen|\d+(?:st|nd|rd|th))\b)/i;
const GODINA = /^\s*\(?\s*20[0-2]\d\s*\)?(?![0-9])/;

// 4G/5G/LTE ne menjaju odluku; godina samo gde je pravilo ne zanemaruje.
const neuhvacen = (iza: string, godina: boolean) => {
  const t = iza.replace(/^\s*(?:4g|5g|lte)\b/i, "");
  return NEUHVACENO.test(t) || (godina && GODINA.test(t));
};

// Samsung: 5G/4G nije deo imena kad je kuciste isto (A54 5G = A54, S20 Plus 5G =
// S20 Plus). Ovi modeli imaju razlicito 4G i 5G kuciste (ili nije sigurno da je
// isto), pa 5G ostaje u imenu.
const ZADRZI_5G = new Set(["A07", "A13", "A14", "A17", "A22", "A23", "A32", "A51", "A71", "M13", "M14", "M32", "F14", "S10"]);

const kanon5G = (m: string) => {
  const bez = m.replace(/\s+[45]G\b/gi, "").trim();
  return /\s5G\b/i.test(m) && ZADRZI_5G.has(bez) ? `${bez} 5G` : bez;
};

// Ime modela koje Samsung kod oznacava; null = nepoznato (tada se ime ne proverava).
// A-serija: treca cifra 5 = osnovni model, 6 = 5G; ostalo samo iz tabele.
const A_IME: Record<string, string> = {
  A013: "A01 Core", A022: "A02", A025: "A02S", A032: "A03 Core", A037: "A03S", A042: "A04E",
  A047: "A04S", A057: "A05S", A107: "A10S", A127: "A12", A137: "A13", A202: "A20E", A207: "A20S",
  A217: "A21S", A307: "A30S", A507: "A50S", A528: "A52S", A707: "A70S", A908: "A90",
};
const F_IME: Record<string, string> = {
  F700: "Z Flip", F707: "Z Flip", F711: "Z Flip 3", F721: "Z Flip 4", F731: "Z Flip 5", F741: "Z Flip 6",
  F900: "Z Fold", F907: "Z Fold", F916: "Z Fold 2", F926: "Z Fold 3", F936: "Z Fold 4", F946: "Z Fold 5",
  F956: "Z Fold 6", F966: "Z Fold 7",
};
const S9_NIVO: Record<string, string> = { "1": "", "6": " Plus", "8": " Ultra" };

export const imeIzKoda = (kod: string): string | null => {
  const k = kod.toUpperCase();
  const a = k.match(/^A(\d{2})(\d)(?![0-9])/);
  if (a) {
    if (/^A(?:\d{2}0|605|260)/.test(k)) return null; // stare A serije (A520 = A5 2017)
    const t = A_IME[k.slice(0, 4)];
    if (t) return t;
    if (a[2] === "5") return `A${a[1]}`;
    if (a[2] === "6") return kanon5G(`A${a[1]} 5G`);
    return null;
  }
  const s9 = k.match(/^S9([0-4])([1678])(?![0-9])/);
  if (s9) {
    if (s9[2] === "7") return s9[1] === "3" ? "S25 Edge" : null;
    return `S${22 + Number(s9[1])}${S9_NIVO[s9[2]]}`;
  }
  const s7 = k.match(/^S7([1-3])1(?![0-9])/);
  if (s7) return `S${22 + Number(s7[1])} FE`;
  const f = k.match(/^F\d{3}(?![0-9])/);
  if (f) return F_IME[f[0]] ?? null;
  return null;
};

// "S24+" = "S24 Plus"; "A01 CORE" -> "A01 Core"; 5G po pravilu iznad.
const SAMSUNG_RECI: Record<string, string> = { CORE: "Core", PRIME: "Prime", ACE: "Ace", NEO: "Neo" };
const kanonSamsung = (sirovo: string) =>
  kanon5G(
    uredi(sirovo.replace(/\s*\+/g, " Plus "))
      .split(" ")
      .map((r) => SAMSUNG_RECI[r] ?? r)
      .join(" "),
  );

// Svaki kod u delu naziva (A546B, S906B, G985, N5100), za proveru imena.
const SAMSUNG_KODOVI = /\b[ASMFJGNTXPCE]\d{3,4}[A-Z]{0,3}\b/gi;

// Iza osnove: ne decimalni broj ("Note 8.0" je tablet, ne Note 8), pa poznati dodaci.
const SAMSUNG_SUFIKSI = String.raw`(?![.,]\d)(?:\s*(?:Ultra|Plus|FE|Edge|Lite|Core|5G|4G|Prime|Ace|Neo|Pro|Mini)\b|\s*\+)*(?![A-Za-z0-9])`;
const SAMSUNG_IME = new RegExp(
  String.raw`\b(?:Z\s*(?:Fold|Flip)\s*\d{1,2}|Note\s*\d{1,2}|Tab\s*[A-Z]?\d{1,2}|[ASMFJ]\d{2,3}[A-Za-z]{0,2})` + SAMSUNG_SUFIKSI,
  "gi",
);
const SAMSUNG_IME_BATERIJE = new RegExp(
  String.raw`\b(?:Z\s*(?:Fold|Flip)\s*\d{1,2}|Note\s*\d{1,2}|Tab\s*[A-Z]?\d{1,2}|[ASMFJC]\d{1,3}[A-Za-z]{0,2})` + SAMSUNG_SUFIKSI,
  "gi",
);

type SamsungCfg = {
  ime: RegExp; // globalni regex imena
  jeKod: RegExp; // pogodak koji je kod, ne ime
  staro: RegExp; // ranije pravilo: ako ono nesto nalazi, a novo ne, marka ostaje
  kod: (deo: string) => string | null; // kod iz dela naziva, kad imena nema ili nije prihvaceno
  godinaAJ?: boolean; // baterije: "A5 2016" i "J7 (2017)" nisu isto sto i "A5" i "J7"
};

// Procitan zapis modela (`h`) i tekst iza njega (`iza`).
type Citanje = { h: string; iza: string };

// Velicine starih tableta (Tab 2/3/4, Tab S2, Tab A6 iz 2016).
const TAB_VELICINE: Record<string, string[]> = {
  "2": ["7.0", "10.1"],
  "3": ["7.0", "8.0", "10.1"],
  "4": ["7.0", "8.0", "10.1"],
  S2: ["8.0", "9.7"],
  A6: ["7.0", "10.1"],
};

// Nastavci bez imena marke (v3): "A14 4G/5G", "S24/Plus", "Z Flip 6/7 FE", "TAB A11/A9".
const SAMSUNG_DODATAK = new RegExp("^" + SAMSUNG_SUFIKSI, "i");
const SAMSUNG_DODACI = /(?:\s+(?:Ultra|Plus|FE|Edge|Lite|Core|Prime|Ace|Neo|Pro|Mini|5G|4G))+$/i;
const SAMSUNG_BROJ = new RegExp(String.raw`^\s*\d{1,2}[A-Za-z]{0,2}` + SAMSUNG_SUFIKSI, "i");
const SAMSUNG_TAB = new RegExp(String.raw`^\s*([AS])(\d{1,2})[A-Za-z]{0,2}` + SAMSUNG_SUFIKSI, "i");

// Iza tableta "A9" je tablet ("TAB A11/A9" = Tab A11 i Tab A9), ne telefon A9.
// Drugo slovo ili broj koji nije tablet: model se odbacuje.
const nastavakTab = (t: string, sidro: string | null): Citanje | "odbij" | null => {
  const s = sidro?.match(/^Tab ([AS])\d/);
  const h = s ? t.match(SAMSUNG_TAB) : null;
  if (!s || !h) return null;
  if (h[1].toUpperCase() !== s[1] || Number(h[2]) > 12) return "odbij";
  return { h: `Tab ${h[0].trim()}`, iza: t.slice(h[0].length) };
};

// Deo samo sa mrezom ili dodatkom nastavlja prethodni model ("A14 4G/5G" = A14 4G i
// A14 5G, "S24/Plus"); broj nastavlja samo seriju Z Fold, Z Flip i Note iz sidra.
const nastavakSamsung = (t: string, n: Nastavak): Citanje | null => {
  if (n.prethodni) {
    const mr = t.match(/^\s*([45]G)\b/i);
    if (mr) return { h: `${n.prethodni.replace(/\s+[45]G$/i, "")} ${mr[1]}`, iza: t.slice(mr[0].length) };
    const d = t.match(SAMSUNG_DODATAK);
    if (d?.[0].trim()) return { h: `${n.prethodni.replace(SAMSUNG_DODACI, "")} ${d[0].trim()}`, iza: t.slice(d[0].length) };
  }
  const serija = n.sidro?.match(/^(?:Z Fold|Z Flip|Note) (?=\d)/);
  const b = serija ? t.match(SAMSUNG_BROJ) : null;
  return serija && b ? { h: serija[0] + b[0].trim(), iza: t.slice(b[0].length) } : null;
};

const samsungDeo = (c: SamsungCfg) => (ostatak: string, deo: string, ceo: string, n: Nastavak): Pogodak => {
  const kod = c.kod(deo);
  const nadji = (t: string): Citanje | null => {
    for (const h of t.matchAll(c.ime)) {
      if (!c.jeKod.test(h[0].trim())) return { h: h[0], iza: t.slice((h.index ?? 0) + h[0].length) };
    }
    return null;
  };
  const tab = nastavakTab(ostatak, n.sidro);
  // Ime iza "Galaxy" ima prednost ("A546B Galaxy A54 5G"), inace bilo gde iza marke.
  const g = ostatak.match(/gal(?:a|al)xy/i);
  const direkt = tab ? null : (g ? nadji(ostatak.slice((g.index ?? 0) + g[0].length)) : null) ?? nadji(ostatak);
  const sidro = direkt ? kanonSamsung(direkt.h) : undefined;
  // Ime nije prihvaceno: ostaje kod iz istog dela ili samo marka.
  const odbij = (nasledi?: string): Pogodak => ({
    ...(kod ? { modeli: [{ m: kod, kod: true, rezervni: true, ocek: imeIzKoda(kod) }] } : { modeli: [], odbijeno: true }),
    nasledi,
    sidro,
  });
  if (tab === "odbij") return odbij();
  const p = tab ?? direkt ?? nastavakSamsung(ostatak, n);
  if (!p) {
    if (kod) return { modeli: [{ m: kod, kod: true }] };
    return c.staro.test(ostatak) ? ODBIJENO : NISTA;
  }

  let ime = kanonSamsung(p.h);
  let iza = p.iza;
  const vel = iza.match(/^\s*(\d{1,2})[.,](\d)(?![0-9])/);
  if (vel) iza = iza.slice(vel[0].length);
  const god = iza.match(GODINA);
  if (god) iza = iza.slice(god[0].length);
  const godina = god ? god[0].replace(/\D/g, "") : null;

  let dodato = false; // velicina ili godina u imenu: takav model se ne nastavlja
  const tabM = ime.match(/^Tab ([A-Z]?)(\d{1,2})\b/);
  if (tabM) {
    // Stari tableti postoje u vise velicina (Tab 3 7.0 / 8.0 / 10.1): bez poznate
    // velicine nema modela ("Tab 3 7.1" ne postoji).
    const velicine = TAB_VELICINE[tabM[1] + tabM[2]];
    if (!tabM[1] || velicine) {
      const v = vel ? `${vel[1]}.${vel[2]}` : null;
      if (!v || !velicine?.includes(v)) return odbij();
      ime += ` ${v}`;
      dodato = true;
    } else if (tabM[1] === "A" && godina && Number(godina) < 2020) {
      ime += ` ${godina}`; // "Tab A8 2019" (8.0) nije "Tab A8" (2021)
      dodato = true;
    }
  } else if (c.godinaAJ && godina && /^[AJ]\d(?:\s|$)/.test(ime)) {
    ime += ` ${godina}`;
    dodato = true;
  }
  if (neuhvacen(iza, false)) return odbij();
  const nasledi = dodato ? undefined : ime;

  // Kod iz istog dela mora da oznacava isto ime ("A013F Galaxy A01" je A01 Core, ne A01),
  // osim ako ime potvrdjuje neki drugi kod u nazivu.
  const ocek = [...deo.matchAll(SAMSUNG_KODOVI)].map((k) => imeIzKoda(k[0])).filter((x): x is string => !!x);
  if (ocek.length && !ocek.includes(ime) && ![...ceo.matchAll(SAMSUNG_KODOVI)].some((k) => imeIzKoda(k[0]) === ime)) {
    return odbij(nasledi);
  }
  return { modeli: [{ m: ime, kod: false }], nasledi, sidro };
};

const kodImena = (deo: string) => {
  const k = deo.match(/\b[ASMFJ]\d{3}[A-Za-z]{0,2}\b/i);
  return k ? uredi(k[0]) : null;
};

// Apple: "iPhone 15+" = "iPhone 15 Plus", "11 Max Pro" = "11 Pro Max", "SE2" = "SE 2020".
const APPLE_SUFIKSI = String.raw`(?![.,]\d)(?:\s*(?:Pro\s*Max|Max\s*Pro|Plus|Pro|Max|Air|Mini|e)\b|\s*\+)?(?![A-Za-z0-9])`;
const APPLE_IME = new RegExp(
  String.raw`\b(?:SE\s*\(?\s*20\d\d\s*\)?|SE\s*[23](?![0-9])|SE|1[0-9]|[56][Ss]|5[Cc]|[5-9]|X[SsRr]?)` + APPLE_SUFIKSI,
  "i",
);
const APPLE_IME_BATERIJE = new RegExp(
  String.raw`\b(?:SE\s*[23]?\s*\(?\s*20\d\d\s*\)?|SE\s*[23](?![0-9])|SE|X[SsRr]?|[4-9][SsCc]?|1[0-9])` + APPLE_SUFIKSI,
  "i",
);

const kanonApple = (m: string) =>
  m
    .replace(/^iPhone SE\s*[23]?\s*\(?\s*(20\d\d)\s*\)?$/i, "iPhone SE $1")
    .replace(/^iPhone SE\s*2$/i, "iPhone SE 2020")
    .replace(/^iPhone SE\s*3$/i, "iPhone SE 2022");

// "iPhone 17 Pro/Pro Max": deo samo sa dodatkom nastavlja prethodni iPhone sa brojem.
// Golo "Max" i "Air" ne nastavljaju (nema "iPhone 15 Max"; iPhone Air nema broj).
const APPLE_DODATAK = /^\s*(?:Pro\s*Max|Max\s*Pro|Plus|Pro|Mini|\+)(?![A-Za-z0-9])/i;

const appleDeo = (ime: RegExp, staro: RegExp) => (ostatak: string, _deo: string, _ceo: string, n: Nastavak): Pogodak => {
  const osnova = n.prethodni?.match(/^iPhone (1[0-9]|[4-9][SC]?)(?= |$)/)?.[1];
  const d = osnova ? ostatak.match(APPLE_DODATAK) : null;
  let sirovo: string;
  let iza: string;
  if (osnova && d) {
    sirovo = `${osnova} ${d[0].trim()}`;
    iza = ostatak.slice(d[0].length);
  } else {
    const h = ostatak.match(ime);
    if (!h) return staro.test(ostatak) ? ODBIJENO : NISTA;
    iza = ostatak.slice((h.index ?? 0) + h[0].length);
    // Golo "SE" iza kog stoji broj ("SE 2nd gen") nije prepoznato.
    if (/^SE$/i.test(h[0].trim()) && /^\s*\d/.test(iza)) return ODBIJENO;
    sirovo = h[0];
  }
  if (neuhvacen(iza, false)) return ODBIJENO;
  const m = kanonApple(uredi("iPhone " + sirovo.replace(/\s*\+/g, " Plus ").replace(/\bmax\s*pro\b/i, "Pro Max")));
  return { modeli: [{ m, kod: false }], nasledi: m };
};

// Xiaomi: "Pro+" = "Pro Plus", "Redmi A1+" = "Redmi A1 Plus"; 5G ostaje (4G i 5G
// izdanja Redmi Note modela imaju razlicita kucista).
const XIAOMI_SUFIKSI = String.raw`(?![.,]\d)(?:\s*(?:Pro|Max|Plus|Lite|Ultra|5G|4G|T|Prime|Power|SE)\b|\s*\+)*(?![A-Za-z0-9])`;
const XIAOMI_OSNOVA = String.raw`Redmi\s*(?:Note\s*|Pad\s*)?[A-Z]?\d{1,2}[A-Za-z]{0,2}|Poco\s*[A-Z]\d{1,2}[A-Za-z]{0,2}|Mi\s*Note\s*\d{1,2}[A-Za-z]{0,2}|Mi\s*\d{1,2}[A-Za-z]{0,2}|\d{2}[A-Za-z]?`;
const XIAOMI_IME = new RegExp(String.raw`\b(?:${XIAOMI_OSNOVA})` + XIAOMI_SUFIKSI, "i");
const XIAOMI_IME_BATERIJE = new RegExp(
  String.raw`\b(?:Mi\s*(?:Max|Mix)(?:\s*\d)?|Mi\s*A\d|Pocophone\s*F\d|Redmi\s*Go|${XIAOMI_OSNOVA})` + XIAOMI_SUFIKSI,
  "i",
);
const XIAOMI_RECI: Record<string, string> = { PRIME: "Prime", POWER: "Power", POCOPHONE: "Pocophone", GO: "Go", MIX: "Mix" };

const kanonXiaomi = (sirovo: string) =>
  uredi(sirovo.replace(/\s*\+/g, " Plus ").replace(/\b(Redmi|Poco|Pocophone|Mi|Note|Pad)\s*(?=[A-Z]?\d)/gi, "$1 "))
    .split(" ")
    .map((r) => XIAOMI_RECI[r] ?? r)
    .join(" ")
    // Pro+ postoji samo kao 5G: "Redmi Note 15 Pro+ 5G" i "Redmi Note 15 Pro+" su isti telefon.
    .replace(/ Pro Plus 5G$/, " Pro Plus");

// Nastavci bez imena marke (v3): "Redmi Note 14 Pro 4G/5G/Pro Plus", "Redmi 9C/10A",
// "Redmi 9T/Note 9 4G/9 Power", "Poco X3/X3 Pro", "Redmi 14C/A4".
const XIAOMI_DODATAK = new RegExp("^" + XIAOMI_SUFIKSI, "i");
const XIAOMI_DODACI = /(?:\s+(?:Pro|Max|Plus|Lite|Ultra|5G|4G|T|Prime|Power|SE))+$/i;
const XIAOMI_NOTE = new RegExp(String.raw`^\s*Note\s*(\d{1,2})[A-Za-z]{0,2}` + XIAOMI_SUFIKSI, "i");
const XIAOMI_BROJ = new RegExp(String.raw`^\s*(\d{1,2})[A-Za-z]{0,2}` + XIAOMI_SUFIKSI, "i");
const XIAOMI_SLOVO = new RegExp(String.raw`^\s*([A-Z])\d{1,2}[A-Za-z]{0,2}` + XIAOMI_SUFIKSI, "i");

// Serija iz sidra za deo koji pocinje brojem. isti: broj mora biti isti kao u sidru,
// jer "Redmi Note 9/10X" moze biti i Redmi 10X, a "Mi 10/11" i Xiaomi 11.
const serijaXiaomi = (sidro: string): { prefiks: string; isti: string | null } | null => {
  const m = sidro.match(/^(Redmi Note |Mi Note |Mi |)(\d+)/);
  if (m) return { prefiks: m[1], isti: m[2] };
  return /^Redmi \d/.test(sidro) ? { prefiks: "Redmi ", isti: null } : null;
};

const nastavakXiaomi = (t: string, n: Nastavak): Citanje | "odbij" | null => {
  if (!n.prethodni && !n.sidro) return null;
  if (n.prethodni) {
    const mr = t.match(/^\s*([45]G)\b/i);
    if (mr) return { h: `${n.prethodni.replace(/\s+[45]G$/i, "")} ${mr[1]}`, iza: t.slice(mr[0].length) };
    const d = t.match(XIAOMI_DODATAK);
    if (d?.[0].trim()) return { h: `${n.prethodni.replace(XIAOMI_DODACI, "")} ${d[0].trim()}`, iza: t.slice(d[0].length) };
  }
  // "Note 9 4G" iza Redmi modela je Redmi Note; Mi Note samo iza Mi Note; inace samo
  // Note 11 i noviji (Mi Note postoji do 10).
  const note = t.match(XIAOMI_NOTE);
  if (note) {
    const c: Citanje = { h: note[0].trim().replace(/^Note\s*/i, "Note "), iza: t.slice(note[0].length) };
    if (n.sidro && /^Redmi /.test(n.sidro)) return { ...c, h: `Redmi ${c.h}` };
    if (n.sidro && /^Mi Note /.test(n.sidro)) return { ...c, h: `Mi ${c.h}` };
    return Number(note[1]) >= 11 ? { ...c, h: `Redmi ${c.h}` } : "odbij";
  }
  if (!n.sidro) return null;
  const broj = t.match(XIAOMI_BROJ);
  if (broj) {
    const s = serijaXiaomi(n.sidro);
    if (!s || (s.isti && s.isti !== broj[1])) return "odbij";
    return { h: s.prefiks + broj[0].trim(), iza: t.slice(broj[0].length) };
  }
  // Slovo: Poco F/X/M/C iza Poco modela, Redmi A i K iza Redmi (ne Note/Pad) modela.
  const slovo = t.match(XIAOMI_SLOVO);
  if (slovo) {
    const telo = slovo[0].trim();
    const iza = t.slice(slovo[0].length);
    if (/^Poco [A-Z]\d/.test(n.sidro) && /^[FXMC]/i.test(telo)) return { h: `Poco ${telo}`, iza };
    if (/^Redmi (?!Note|Pad)/.test(n.sidro) && /^(?:A\d(?!\d)|K\d{2})/i.test(telo)) return { h: `Redmi ${telo}`, iza };
    return "odbij";
  }
  return null;
};

const xiaomiDeo = (ime: RegExp, staro: RegExp) => (ostatak: string, _deo: string, _ceo: string, n: Nastavak): Pogodak => {
  const nas = nastavakXiaomi(ostatak, n);
  if (nas === "odbij") return ODBIJENO;
  let p = nas;
  let direkt = false;
  if (!p) {
    const h = ostatak.match(ime);
    if (!h) return staro.test(ostatak) ? ODBIJENO : NISTA;
    const pred = ostatak.slice(0, h.index);
    let telo = h[0];
    if (!/^\s*redmi/i.test(h[0]) && /\bnote\s*$/i.test(pred)) {
      // "Mi Note 10" nije "10" (Xiaomi 10); "Xiaomi Note 14 Pro" je Redmi Note 14 Pro,
      // jer Mi Note postoji samo do 10.
      const broj = h[0].match(/^\s*(\d{2})/);
      if (!broj || Number(broj[1]) < 11 || /\bmi\s*note\s*$/i.test(pred)) return ODBIJENO;
      telo = `Redmi Note ${h[0].trim()}`;
    }
    p = { h: telo, iza: ostatak.slice((h.index ?? 0) + h[0].length) };
    direkt = true;
  }
  const m = kanonXiaomi(p.h);
  // Sidro je i model sa nepoznatim dodatkom ("Xiaomi 10 Youth 5G/10 Lite 5G").
  const sidro = direkt ? m : undefined;
  if (neuhvacen(p.iza, false)) return { modeli: [], odbijeno: true, sidro };
  return { modeli: [{ m, kod: false }], nasledi: m, sidro };
};

// Maske, stakla i stakla za kamere: stara pravila, osim Samsung, Apple i Xiaomi (v3).
const PRAVILA_IMENA: Pravilo[] = PRAVILA.map((p) => {
  if (p.marka === "Samsung") {
    return { ...p, deo: samsungDeo({ ime: SAMSUNG_IME, jeKod: SAMSUNG_KOD, staro: p.model, kod: kodImena }) };
  }
  if (p.marka === "Apple") return { ...p, deo: appleDeo(APPLE_IME, p.model) };
  if (p.marka === "Xiaomi") return { ...p, deo: xiaomiDeo(XIAOMI_IME, p.model) };
  return p;
});

/** Stara pravila maski i stakala (zadrzana radi poredjenja i kompatibilnosti). */
export const izvuciUredjaj = (naziv: string): Uredjaj => izvuci(naziv, PRAVILA);

/**
 * Isto kao izvuciUredjaj, ali Samsung dobija ime modela umesto koda, a prva marka vazi (rezerva: prva marka sa modelom).
 * v3: Samsung, iPhone i Xiaomi citaju ceo zapis modela; nepotpun ili neslozan zapis daje kod iz istog dela ili samo marku.
 */
export const izvuciUredjajImena = (naziv: string): Uredjaj =>
  izvuci(naziv, PRAVILA_IMENA, { imena: true, prvaMarka: true, rezervnaMarka: true });

// ---------------------------------------------------------------------------
// Baterije telefona i tableta: "Baterija Deji za Samsung G985 Galaxy S20 PLUS 5G(4500mAh)EB-BG985ABY".
// Posle "za" dolazi uredjaj, a posle njega oznake baterije (BL-4S, EB-BG985ABY)
// koje ne smeju postati model. Marke bez cistog oblika modela (HTC, Alcatel,
// Lenovo, Sony Ericsson, Meizu, Wiko, Tesla, BlackBerry, Asus) dobijaju samo
// marku: artikal se nalazi pod markom, ali ne pod pogresnim modelom.
// ---------------------------------------------------------------------------
const bezModela = (marka: string, kljuc: RegExp): Pravilo => ({ marka, kljuc, model: /(?!)/ });

// Ranija pravila baterija za Samsung, iPhone i Xiaomi: sluze samo kao provera
// "ovde postoji model" kad v3 pravilo ne prepozna ceo zapis (tada ostaje marka).
const IPHONE_BATERIJA =
  /\b(?:SE\s*[23]?\s*20\d\d|SE|X[SsRr]?(?:\s*Max)?|(?:[4-9][SsCc]?|1[0-9])\s*(?:Pro\s*Max|Plus|Pro|Max|Mini|e)?)\b/i;
const SAMSUNG_BATERIJA =
  /\b(?:Z\s*(?:Fold|Flip)\s*\d{1,2}|Note\s*\d{1,2}|Tab\s*[A-Z]?\d{1,2}|[ASMFJC]\d{1,3}[A-Za-z]{0,2})(?:\s*(?:Ultra|Plus|\+|FE|Edge|Lite|5G|Mini))*\b/i;
const XIAOMI_BATERIJA =
  /\b(?:Mi\s*(?:Max|Mix)(?:\s*\d)?|Mi\s*A\d|Pocophone\s*F\d|Redmi\s*Go|Redmi\s*(?:Note\s*|Pad\s*)?[A-Z]?\d{1,2}[A-Za-z]{0,2}|Poco\s*[A-Z]\d{1,2}[A-Za-z]{0,2}|Mi\s*\d{1,2}[A-Za-z]{0,2}|\d{2}[A-Za-z]?)(?:\s*(?:Pro\+?|Plus|Lite|5G|4G|Ultra|T))*\b/i;

// Oznaka Samsung telefona u nazivu baterije (G930F, N5100, I9295), kad imena nema
// ili nije prihvaceno.
const kodBaterije = (deo: string) => {
  const k = deo.match(/\b[A-Za-z]\d{3,5}[A-Za-z]{0,2}\b/);
  return k ? uredi(k[0]) : null;
};

// Godina izdanja ("K4 (2017)"), ali ne kapacitet ("2000 mAh").
const GOD_IZDANJA = String.raw`\(?20[0-2]\d\)?(?!\s*m?Ah)`;

const PRAVILA_BATERIJE: Pravilo[] = [
  // Starije generacije iPhone-a (4, 5C, 6S Plus, SE 2020) koje maske ne pokrivaju.
  {
    marka: "Apple",
    kljuc: /\bi\s?phone\b/i,
    prefiks: "iPhone ",
    model: IPHONE_BATERIJA,
    deo: appleDeo(APPLE_IME_BATERIJE, IPHONE_BATERIJA),
  },
  {
    marka: "Apple",
    kljuc: /\bipad\b/i,
    prefiks: "iPad ",
    model:
      /\b(?:Pro\s*\d{1,2}(?:\.\d)?(?:\s*Gen\s*\d(?:\s*20\d\d)?)?|Air\s*\d?|Mini\s*\d?|\d{1,2}(?:\.\d)?(?:\s*20\d\d)?)\b/i,
  },
  // Samsung: ime modela (S7, S20 Plus, A20) ispred oznake (G930, EB-...); bez imena oznaka.
  {
    marka: "Samsung",
    kljuc: /\b(?:samsung|galaxy)\b/i,
    model: SAMSUNG_BATERIJA,
    deo: samsungDeo({
      ime: SAMSUNG_IME_BATERIJE,
      jeKod: /^[ASMFJC]\d{3}/i,
      staro: SAMSUNG_BATERIJA,
      kod: kodBaterije,
      godinaAJ: true,
    }),
  },
  {
    marka: "Xiaomi",
    kljuc: /\b(?:redmi|poco|pocophone|xiaomi)\b/i,
    ukloni: /\bxiaomi\b/i,
    model: XIAOMI_BATERIJA,
    deo: xiaomiDeo(XIAOMI_IME_BATERIJE, XIAOMI_BATERIJA),
  },
  // Honor kao samostalna marka, osim kad naziv pocinje sa "Huawei" (tada su Honor modeli deo Huawei liste).
  { ...PRAVILA.find((p) => p.marka === "Honor")!, preskoci: (prva) => prva === "Huawei" },
  {
    marka: "Huawei",
    kljuc: /\bhuawei\b/i,
    model: new RegExp(
      String.raw`\b(?:Honor\s*(?:X\s*)?\d{1,2}[A-Za-z]?|(?:Mate|Nova|P|Y|G)\s*\d{1,3}[A-Za-z]{0,2}|Tab\s*[A-Z]\d)` +
        String.raw`(?:\s*(?:Pro|Lite|Plus|5G|i|Prime|II|Mini|Compact|${GOD_IZDANJA}))*(?![A-Za-z0-9])`,
      "i",
    ),
  },
  {
    marka: "Motorola",
    kljuc: /\bmotorola\b/i,
    prefiks: "Moto ",
    model:
      /\b(?:Moto\s*)?(?:[GEXZC]\s*\d{1,3}[A-Za-z]{0,2}|C|Edge\s*\d{1,2})(?:\s*(?:Power|Play|Plus|Pro|5G|Lite|Fusion))*\b/i,
  },
  // Nokia: 4-cifreni modeli (6500c), N/E/C serije, "1", "5.4", "5.1 Plus", godina izdanja ("105 2023").
  {
    marka: "Nokia",
    kljuc: /\bnokia\b/i,
    model: new RegExp(
      String.raw`\b(?:[CEGNX]\d{1,3}[A-Za-z]{0,2}|\d{3,4}[A-Za-z]?|\d(?:\.\d)?)` +
        String.raw`(?:\s*(?:Plus|5G|4G|Mini|${GOD_IZDANJA}))*(?![A-Za-z0-9])`,
      "i",
    ),
  },
  ...PRAVILA.filter((p) => !["Apple", "Samsung", "Xiaomi", "Honor", "Huawei", "Motorola", "Nokia"].includes(p.marka)),
  {
    marka: "LG",
    kljuc: /\blg\b/i,
    model: new RegExp(
      String.raw`\b(?:Flex\s*\d|[GKQVX]\d{1,2}[A-Za-z]{0,2}|P\d{3})(?:\s*(?:Mini|Plus|Pro|Prime|${GOD_IZDANJA}))*(?![A-Za-z0-9])`,
      "i",
    ),
  },
  {
    marka: "Sony",
    kljuc: /\bsony\b(?![\s-]*ericsson)/i,
    ukloni: /\bsony\b/i,
    // v3: "Xperia M2 Aqua" je poseban telefon, ne Xperia M2.
    model: /\bXperia\s*[A-Z]{0,2}\d{1,2}[A-Za-z]{0,3}(?:\s*(?:Compact|Mini|Plus|Premium|Ultra|Aqua|III|II|IV|VI|V))*\b/i,
  },
  {
    marka: "Microsoft",
    kljuc: /\bmicrosoft\b|\blumia\b/i,
    ukloni: /\bmicrosoft\b/i,
    model: /\bLumia\s*\d{3,4}(?:\s*XL)?\b/i,
  },
  bezModela("Sony Ericsson", /\bsony[\s-]*ericsson\b/i),
  bezModela("HTC", /\bhtc\b/i),
  bezModela("Alcatel", /\balcatel\b/i),
  bezModela("Lenovo", /\blenovo\b|\bvibe\b/i),
  bezModela("Meizu", /\bmeizu\b/i),
  bezModela("Wiko", /\bwiko\b/i),
  bezModela("Tesla", /\btesla\b/i),
  bezModela("BlackBerry", /\bblackberry\b/i),
  bezModela("Asus", /\basus\b/i),
];

// "Mate9" i "Mate 9" su isti telefon.
const doradiBateriju = (m: string) =>
  m
    .replace(/^(Mate|Nova|Redmi|Poco|Reno|Find|Magic|Spark|Camon|Pova|Hot|Moto)(\d)/i, "$1 $2")
    .replace(/\bHonor(\d)/i, "Honor $1")
    .replace(/\bXPERIA\b/, "Xperia")
    .replace(/\bLUMIA\b/, "Lumia")
    .replace(/\bHONOR\b/, "Honor")
    // v3: reci koje postoje samo u kljucevima baterija ("iPad Pro 12.9 Gen 3", "Y6 II Compact").
    .replace(/^IPAD\b/, "iPad")
    .replace(/\bGEN\b/, "Gen")
    .replace(/\bCOMPACT\b/, "Compact")
    .replace(/\bAQUA\b/, "Aqua")
    .replace(/\bPRIME\b/, "Prime")
    // iPhone SE 2. i 3. generacije: "SE2 2020" i "SE 2020" su isti telefon.
    .replace(/^iPhone SE\s*[23]?\s*(20\d\d)$/i, "iPhone SE $1");

export const izvuciUredjajBaterije = (naziv: string): Uredjaj => {
  // Samo deo posle "za": ispred je ime proizvodjaca baterije (Deji, Teracell, Standard...).
  const posle = naziv.match(/\bza\b\s+([\s\S]*)/i);
  return izvuci(posle ? posle[1] : naziv, PRAVILA_BATERIJE, {
    naslednik: "pravilo",
    prvaMarka: true,
    najranije: true,
    imena: true,
    bezModela: true,
    kratki: true,
    najvise: 8,
    doradi: doradiBateriju,
    mreza: true,
  });
};

// ---------------------------------------------------------------------------
// Laptop marka (baterije, punjaci, tastature, ostali delovi za laptop).
// Nazivi su pravilni: "<Deo> za laptop <Marka> <model/delovi>". Redosled:
//   1. marka kao prva rec posle "za laptop" (ili posle "za")
//   2. inace tacno jedna eksplicitna marka bilo gde u nazivu
//   3. inace tacno jedna serija (ThinkPad, Macbook, Latitude...) -> njena marka
//   4. u svemu ostalom nema marke (univerzalni punjaci, konektori, kablovi)
// Dve razlicite marke u istom nazivu = nema marke (nejasno).
// ---------------------------------------------------------------------------
type LaptopMarka = { marka: string; kljuc: RegExp; serije?: RegExp };

export const LAPTOP_MARKE: LaptopMarka[] = [
  { marka: "Acer", kljuc: /\bacer\b/, serije: /\b(?:aspire|travelmate|extensa|swift|nitro|predator|veriton)\b/ },
  { marka: "Apple", kljuc: /\bapple\b/, serije: /\b(?:mac\s?book|imac)\b/ },
  { marka: "Asus", kljuc: /\basus\b/, serije: /\b(?:zenbook|vivobook|eee\s?pc|republic of gamers)\b/ },
  { marka: "Dell", kljuc: /\bdell\b/, serije: /\b(?:latitude|inspiron|xps|vostro|precision|alienware)\b/ },
  { marka: "HP", kljuc: /\b(?:hp|hewlett[\s-]*packard)\b/, serije: /\b(?:pavilion|elitebook|probook|compaq|presario|zbook|omen)\b/ },
  { marka: "Lenovo", kljuc: /\blenovo\b/, serije: /\b(?:thinkpad|ideapad|thinkbook|legion|yoga)\b/ },
  { marka: "Samsung", kljuc: /\bsamsung\b/ },
  { marka: "Sony", kljuc: /\bsony\b/, serije: /\bvaio\b/ },
  { marka: "Toshiba", kljuc: /\btoshiba\b/, serije: /\b(?:satellite|tecra|portege)\b/ },
  { marka: "MSI", kljuc: /\bmsi\b/ },
  { marka: "Fujitsu", kljuc: /\bfujitsu(?:[\s-]*siemens)?\b/, serije: /\blifebook\b/ },
  { marka: "Microsoft", kljuc: /\bmicrosoft\b/, serije: /\bsurface\b/ },
  { marka: "Gateway", kljuc: /\bgateway\b/ },
  { marka: "Packard Bell", kljuc: /\bpackard[\s-]*bell\b/ },
  { marka: "IBM", kljuc: /\bibm\b/ }, // odluka: IBM ostaje svoja marka, ne Lenovo
  { marka: "Huawei", kljuc: /\bhuawei\b/, serije: /\bmatebook\b/ },
  { marka: "Honor", kljuc: /\bhonor\b/, serije: /\bmagicbook\b/ },
  { marka: "LG", kljuc: /\blg\b/ },
  { marka: "Xiaomi", kljuc: /\bxiaomi\b/, serije: /\bredmibook\b/ },
  { marka: "Razer", kljuc: /\brazer\b/ },
  { marka: "Gigabyte", kljuc: /\bgigabyte\b/ },
  { marka: "Medion", kljuc: /\bmedion\b/ },
];

// Poznata greska u izvoru: "Del Latitude 7370" je Dell.
const DEL_TYPO = /^del\s+(?:latitude|inspiron|xps|vostro|precision)\b/;

export type LaptopMarkaRez = {
  marka: string | null;
  izvor: "prva-rec" | "eksplicitna" | "serija" | "typo" | "nejasno" | "nema";
};

export const izvuciLaptopMarkuDetalji = (naziv: string): LaptopMarkaRez => {
  const n = bezDijakritika(naziv).toLowerCase().replace(/\s+/g, " ").trim();
  // Deo iza "za [laptop] [za]"; bez "za" ide "laptop"; bez oba ceo naziv.
  let region = n;
  const za = n.match(/\bza\s+(?:laptop\w*\s+)?(?:za\s+)?(.*)$/);
  const lap = n.match(/\blaptop\w*\s+(?:za\s+)?(.*)$/);
  if (za) region = za[1];
  else if (lap) region = lap[1];

  if (DEL_TYPO.test(region)) return { marka: "Dell", izvor: "typo" };
  const prvi = LAPTOP_MARKE.find((m) => {
    const t = region.match(m.kljuc);
    return t?.index === 0;
  });
  if (prvi) {
    // Druga eksplicitna marka u istom nazivu ("Dell ... HP kompatibilno") je nejasno.
    const druge = LAPTOP_MARKE.filter((m) => m !== prvi && m.kljuc.test(n));
    if (druge.length) return { marka: null, izvor: "nejasno" };
    return { marka: prvi.marka, izvor: "prva-rec" };
  }

  const eksplicitne = LAPTOP_MARKE.filter((m) => m.kljuc.test(n));
  if (eksplicitne.length === 1) return { marka: eksplicitne[0].marka, izvor: "eksplicitna" };
  if (eksplicitne.length > 1) return { marka: null, izvor: "nejasno" };

  const serije = LAPTOP_MARKE.filter((m) => m.serije?.test(n));
  if (serije.length === 1) return { marka: serije[0].marka, izvor: "serija" };
  if (serije.length > 1) return { marka: null, izvor: "nejasno" };
  return { marka: null, izvor: "nema" };
};

export const izvuciLaptopMarku = (naziv: string): string | null => izvuciLaptopMarkuDetalji(naziv).marka;

// ---------------------------------------------------------------------------
// Jedan ulaz za objavu kataloga. `subcategory` je vec doradjena
// (refineStoreCategory), `productType` je supplier_products.product_type.
// ---------------------------------------------------------------------------
export type ArtikalZaUredjaj = { name: string; brand?: string | null; subcategory?: string; productType?: string | null };

// Stvarni telefoni imaju jedan model na početku naziva, ispred specifikacija.
// Marka ili model na kraju naziva može da bude poređenje (npr. XS19 iPhone 17).
const MODELI_TELEFONA: Record<string, RegExp> = {
  Apple: /^iPhone\s*(?:Duo|(?:[5-9]|[12]\d)(?:e|s|c)?(?:\s+(?:Pro\s+Max|Pro|Plus|Mini|Air))?|XS\s+Max|XS|XR|X|SE(?:\s+20\d{2})?)(?=\s|[,(/]|$)/i,
  Samsung: /^(?:Galaxy\s+)?((?:Z\s*)?(?:Fold|Flip)\s*\d{1,2}(?:\s+(?:Ultra|FE))?|(?:[ASMFJ]\d{2,3}[A-Z0-9]{0,2}|Note\s*\d{1,2})(?:\s*(?:Ultra|Plus|FE|Lite|5G|4G|\+))?)(?=\s|[,(/]|$)/i,
  Xiaomi: /^(?:(?:Redmi\s*(?:Note\s*)?[AK]?\d{1,2}[A-Z]{0,2}|Poco\s*[CFMX]\d{1,2}[A-Z]{0,2}|Mi\s*(?:Note\s*)?\d{1,2}[A-Z]{0,2}|\d{2}[A-Z]?)\s*(?:Pro\s+Max|Pro\s*\+|Pro|Ultra|Plus|Lite|Max)?(?:\s+[45]G)?)(?=\s|[,(/]|$)/i,
  Honor: /^(?:Magic\s*)?[A-Z]?\d{1,3}[A-Z]{0,2}\+?(?:\s+(?:Pro|Lite|Plus|[45]G))?(?=\s|[,(/]|$)/i,
  Huawei: /^(?:Pura|Mate|Nova|P|Y)\s*\d{1,3}[A-Z]{0,2}(?:\s+(?:Pro\s+Max|Pro|Ultra|Lite|Plus|[45]G))?(?=\s|[,(/]|$)/i,
  Motorola: /^(?:Edge\s*\d{1,3}(?:\s+(?:Fusion|Pro|Ultra))?|Moto\s*[GEX]\s*\d{1,3}(?:\s+(?:Power|Play|Plus|Pro|[45]G))?|Razr\s*(?:Fold|\d{1,3}(?:\s+Ultra)?))(?=\s|[,(/]|$)/i,
  Nokia: /^[CGX]?\d{1,3}(?:\.\d)?(?:\s+(?:Ai|Plus))?(?:\s+[245]G)?(?:\s+DS)?(?:\s+\(?20\d{2}\)?)?(?=\s|[,(/]|$)/i,
  IPRO: /^(?:Shark\s+II|Flip\s+V\d+|(?:Senior\s+(?:II\s+)?)?[AF]\d+(?:\s+Mini)?)(?=\s|[,(/]|$)/i,
  Fulmova: /^(?:Senior\s+)?[MS]\d+(?=\s|[,(/]|$)/i,
  Doogee: /^(?:Blade|S|V)\s*\d+[A-Z]{0,2}(?=\s|[,(/]|$)/i,
  Denver: /^FAS-\d+[A-Z]{0,3}(?=\s|[,(/]|$)/i,
  Gigaset: /^GL\d+(?=\s|[,(/]|$)/i,
  Hammer: /^(?:Iron\s+\d+(?:\s+[45]G)?|Rock(?:\s+[45]G)?)(?=\s|[,(/]|$)/i,
  Maxcom: /^MM\d+(?:\s+[45]G)?(?=\s|[,(/]|$)/i,
  Tecno: /^(?:Spark|Camon|Pova|Pop)\s*\d{1,2}[A-Z]{0,2}(?:\s+Pro)?(?=\s|[,(/]|$)/i,
  Terabyte: /^(?:\d{4}|Flip|Senior)(?=\s|[,(/]|$)/i,
  ZTE: /^(?:Blade\s*[A-Z]?\d{1,3}[A-Z]{0,2}|Nubia\s+Neo\s*\d+(?:\s+[45]G)?)(?=\s|[,(/]|$)/i,
};
const MARKA_TELEFONA = new Map(Object.entries(MODELI_TELEFONA).map(([brand, model]) => [brand.toLowerCase(), { brand, model }]));
const NADIMCI_TELEFONA = new Map([["iphone", "Apple"], ["galaxy", "Samsung"], ["redmi", "Xiaomi"], ["poco", "Xiaomi"]]);

export function izvuciTelefon(naziv: string, markaDobavljaca?: string | null): Uredjaj {
  const title = bezDijakritika(naziv).trim()
    .replace(/^(?:mobilni\s+telefon|mob\.?\s*tel\.?)\s+(?:zasticeni\s+)?/i, "")
    .replace(/^HMD\s+(?=Nokia\b)/i, "");
  const first = title.match(/^\w+/)?.[0].toLowerCase() ?? "";
  const explicit = MARKA_TELEFONA.get(first);
  const supplied = markaDobavljaca?.trim();
  const brand = explicit?.brand ?? NADIMCI_TELEFONA.get(first) ?? (supplied && !/^ostalo$/i.test(supplied)
    ? MARKA_TELEFONA.get(supplied.toLowerCase())?.brand ?? supplied : null);
  if (!brand) return { deviceBrand: null, devices: [] };

  const modelText = explicit ? title.slice(first.length).trimStart() : title;
  const match = MARKA_TELEFONA.get(brand.toLowerCase())?.model.exec(modelText);
  if (!match) return { deviceBrand: brand, devices: [] };
  const model = uredi((match[1] ?? match[0])
    .replace(/\bDS\b|[()]/gi, "")
    .replace(/\bPro\s*\+(?=\s|$)/i, "Pro Plus")
    .replace(/\+$/, brand === "Samsung" ? " Plus" : "+"))
    .replace(/\b(DUO|PURA|FUSION|RAZR|POWER|PLAY|AI|SENIOR|SHARK|ROCK|IRON|NUBIA|NEO)\b/g,
      (word) => word[0] + word.slice(1).toLowerCase());
  return { deviceBrand: brand, devices: [model] };
}

export const LAPTOP_PODKATEGORIJE = ["laptop-baterije", "laptop-punjaci", "laptop-tastature"] as const;

export const izvuciUredjajZaArtikal = (a: ArtikalZaUredjaj): Uredjaj => {
  const sub = a.subcategory ?? "";
  if ((LAPTOP_PODKATEGORIJE as readonly string[]).includes(sub)) {
    return { deviceBrand: izvuciLaptopMarku(a.name), devices: [] };
  }
  if (sub === "telefoni") return izvuciTelefon(a.name, a.brand);
  // Baterije za tablete su od 01.11.2026. posebna podgrupa (video 62) i zadrzavaju pravilo baterija.
  if (sub === "baterije-telefoni" || sub === "baterije-tableti") return izvuciUredjajBaterije(a.name);
  // Maske, stakla i stakla za kamere dele pravilo imena: isti telefon dobija isti
  // kljuc u sva tri (Samsung "S25 Ultra", ne kod "S938B"). Maske i stakla za
  // tablete (feedback 20.10.2026) zadrzavaju isto pravilo koje su imale u maskama.
  if (sub === "maske" || sub === "stakla" || sub === "stakla-kamere" || sub === "maske-tableti" || sub === "stakla-tableti"
    || (!sub && ["MASKA", "STAKLO"].includes(a.productType ?? ""))) {
    return izvuciUredjajImena(a.name);
  }
  // Staro ponasanje objave: artikal sa tipom MASKA/STAKLO koji je doradjen u drugu
  // podkategoriju (tablet sa futrolom, kalup za iPhone) zadrzava stari zapis.
  if (["MASKA", "STAKLO"].includes(a.productType ?? "")) return izvuciUredjaj(a.name);
  return { deviceBrand: null, devices: [] };
};

// Feedback 02.11.2026 (fotografija stranice Maske za iPhone): klijent je oznacio stare
// modele koje ne zeli medju maskama. iPhone SE 2020/2022 nisu oznaceni (bili su iza
// "Prikazi jos 2 modela") i ostaju, kao i iPhone 12 i noviji. Stakla, stakla za kamere
// i baterije za iste modele nisu deo zahteva.
export const STARI_IPHONE_ZA_MASKE: ReadonlySet<string> = new Set([
  "iPhone 5", "iPhone 5C", "iPhone 5S", "iPhone 6", "iPhone 6 Plus", "iPhone 6S", "iPhone 6S Plus",
  "iPhone 7", "iPhone 7 Plus", "iPhone 8", "iPhone 8 Plus",
  "iPhone X", "iPhone XR", "iPhone XS", "iPhone XS Max",
  "iPhone 11", "iPhone 11 Pro", "iPhone 11 Pro Max", "iPhone 12 Mini",
]);

// Feedback 02.11.2026 (fotografije stranice Maske za Samsung, poruke 56352, 56353, 56357):
// klijent je izbrisao sve ploce sa sifrom modela (J serija, S941B, S948B, S30 Plus) i sve
// ploce oznacene crvenom tackom (stariji A, M, Note i Z Fold 2-4 modeli). Kljucevi su
// naziv modela bez prefiksa "Galaxy", kao u plocicama marke. Novije A modele (A13-A18,
// A22 5G-A27, A30 i A30S, A31, A07, A07S), S, Z Flip i Z Fold 5+ klijent nije oznacio i
// oni ostaju. Stakla, stakla za kamere i baterije za iste modele nisu deo zahteva.
export const STARI_SAMSUNG_ZA_MASKE: ReadonlySet<string> = new Set([
  // fotografija 122: sve vidljive ploce (J serija i sifre)
  "S30 Plus", "S941B", "S948B",
  "J100", "J105F", "J120", "J120F", "J200", "J250", "J260F", "J320F", "J327", "J330F",
  "J400", "J400F", "J415", "J415FN", "J500", "J500F", "J510F", "J527", "J527F", "J530F",
  "J600F", "J610", "J610F", "J610FN", "J700F", "J710F", "J727", "J730", "J730F", "J810F",
  // fotografija 123: oznacene ploce
  "A510F", "A520F", "A530F", "A04", "A04S", "A04E", "A03", "A03S", "A03 Core",
  "A310", "A300", "A320F", "A310F", "A320", "A02", "A02S", "A01", "A01 Core",
  "A91", "A90", "A81", "A80", "A73", "A72", "A71", "A70", "A60",
  "Z Fold 4", "Z Fold 3", "Z Fold 2", "M52", "M30", "M20", "M14", "M10",
  "Note 10 Plus", "Note 10", "Note 10 Lite", "Note 9", "Note 8", "Note 5", "Note 4", "Note 3",
  // fotografija 124: oznacene ploce
  "A22", "A21", "A21S", "A20", "A20S", "A20E", "A165F", "A11", "A12", "A10", "A10S",
  "A920F", "A08", "A08 Mini", "A800", "A800F", "A730", "A750FN", "A730F", "A700",
  "A710", "A710F", "A720", "A750F", "A06", "A605G", "A600F", "A05", "A05S", "A500", "A500F",
]);

const STARI_MODELI_ZA_MASKE: Readonly<Record<string, ReadonlySet<string>>> = {
  Apple: STARI_IPHONE_ZA_MASKE,
  Samsung: STARI_SAMSUNG_ZA_MASKE,
};

// Maska zadrzava samo modele koji nisu stari. null znaci da su svi modeli iz naziva stari,
// pa se maska ne objavljuje; maska bez prepoznatog modela ostaje kakva je.
export const bezStarihModelaZaMaske = (sub: string, u: Uredjaj): Uredjaj | null => {
  const stari = u.deviceBrand ? STARI_MODELI_ZA_MASKE[u.deviceBrand] : undefined;
  if (sub !== "maske" || !stari || !u.devices.length) return u;
  const devices = u.devices.filter((d) => !stari.has(d));
  return devices.length ? { deviceBrand: u.deviceBrand, devices } : null;
};

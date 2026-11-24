// Iz naziva punjaca za laptop izvlaci javne specifikacije: Snaga, Napon, Struja, Konektor.
// Sluzi filterima u bocnoj traci kategorije Racunari > Punjaci za laptopove.
//
// Pravilo: radije nista nego pogresno. Vrednost se uzima samo kad je naziv navodi
// jasno (broj + jedinica); dvosmislen oblik vraca prazno i upisuje se u `flags`.
// Nista se ne izmislja iz opsteg znanja o brendu ili modelu.
//
// Specifikacije dobijaju SAMO pravi punjaci/strujni adapteri. Konektori (nastavci),
// kablovi i adapteri-nastavci ne dobijaju nista: inace bi filter "Konektor 5.5 x 2.5"
// kupcu pokazao nastavak umesto punjaca.
//
// Kod je bez TS-only sintakse koja se ne brise (enum, namespace), pa radi i kroz
// `node --experimental-strip-types`.

export type ChargerKind = "punjac" | "konektor" | "kabl" | "adapter-nastavak" | "ostalo";

export type ChargerParse = {
  kind: ChargerKind;
  watts: number | null;
  wattsSource: "naziv" | "izvedeno" | null; // "izvedeno" = V x A zaokruzeno na standardnu snagu
  volts: number | null;
  amps: number | null;
  connector: string | null; // "4.5x3" za dimenzije, inace tekst ("USB Type-C", "MagSafe 2", ...)
  flags: string[]; // zasto je nesto izostavljeno ili sumnjivo
};

export type ChargerSpecOptions = {
  // Snaga iz V x A kad naziv ne navodi W. Samo ako proizvod padne u 1% od standardne snage.
  deriveWatts?: boolean; // podrazumevano true
  // Decimalni zarez u prikazu ("19,5 V") umesto tacke.
  decimalComma?: boolean; // podrazumevano false
};

// Standardne snage laptop punjaca. Izvedena snaga se prihvata samo ako V x A padne
// u 1% od neke od njih; inace (npr. 12V 3.6A = 43.2W) snaga ostaje nepoznata.
export const NOMINAL_WATTS = [
  10, 12, 15, 18, 20, 24, 25, 30, 33, 36, 40, 45, 48, 50, 60, 65, 70, 75, 90, 95, 96, 100,
  120, 130, 135, 140, 150, 170, 180, 200, 230, 240, 280, 300,
];
const DERIVE_TOLERANCE = 0.01;
// Granice u kojima se broj prihvata kao snaga (W), napon (V) i struja (A) punjaca, i
// dimenzija nastavka (spoljni x unutrasnji precnik u mm). Iste za naziv i za dobavljaca.
const OPSEG = { w: [5, 400], v: [3, 24], a: [0.3, 20] } as const;
const uOpsegu = (jedinica: "w" | "v" | "a", n: number) => n >= OPSEG[jedinica][0] && n <= OPSEG[jedinica][1];
const dimenzijaNastavka = (outer: number, inner: number) => outer >= 1.5 && outer <= 9 && inner >= 0.5 && inner <= 6 && outer > inner;

const normalize = (value: string) =>
  value
    .replace(/đ/g, "dj")
    .replace(/Đ/g, "Dj")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const num = (raw: string) => parseFloat(raw.replace(",", "."));

function kindOf(title: string): ChargerKind {
  if (/^(kabl|kabal)\b/.test(title)) return "kabl";
  if (/^konektor\b/.test(title)) return "konektor";
  if (/^adapter\b/.test(title)) return "adapter-nastavak";
  if (/^(punjac|strujni adapter)\b/.test(title) || /^univerzaln\w*\s.*punjac\b/.test(title)) return "punjac";
  return "ostalo";
}

// Prikaz broja: bez nepotrebnih nula ("19.0" -> "19", "4.50" -> "4.5").
function fmt(value: number, comma: boolean) {
  const text = String(Math.round(value * 1000) / 1000);
  return comma ? text.replace(".", ",") : text;
}
// Dimenzija nastavka uvek sa jednom decimalom ("4" -> "4.0", "5.00" -> "5.0", "1.35" ostaje).
function fmtDim(value: number, comma: boolean) {
  const text = Number.isInteger(value) ? value.toFixed(1) : String(Math.round(value * 100) / 100);
  return comma ? text.replace(".", ",") : text;
}

const unique = (values: number[]) => Array.from(new Set(values));

export function parseChargerName(name: string): ChargerParse {
  const title = normalize(name).replace(/\s+/g, " ").trim();
  const out: ChargerParse = { kind: kindOf(title), watts: null, wattsSource: null, volts: null, amps: null, connector: null, flags: [] };
  if (out.kind !== "punjac") return out;

  // 1) Dimenzije nastavka; izbacuju se iz teksta da ne smetaju ostalim brojevima.
  const dims: Array<[number, number]> = [];
  const rest = title.replace(/(\d{1,2}(?:[.,]\d{1,2})?)\s*[*x×]\s*(\d{1,2}(?:[.,]\d{1,2})?)/g, (_all, a: string, b: string) => {
    const outer = num(a);
    const inner = num(b);
    if (dimenzijaNastavka(outer, inner)) dims.push([outer, inner]);
    return " ";
  });

  // 2) Snaga, napon, struja: broj + jedinica, bez slova/cifara uz broj ("TR65W" nije 65 W).
  const wattTokens = unique(Array.from(rest.matchAll(/(?<![a-z0-9.,])(\d{1,3}(?:[.,]\d+)?)\s*w(?![a-z0-9])/g), (m) => num(m[1])));
  const voltTokens = unique(Array.from(rest.matchAll(/(?<![a-z0-9.,])(\d{1,2}(?:[.,]\d{1,2})?)\s*v(?![a-z0-9])/g), (m) => num(m[1])));
  const ampTokens = unique(Array.from(rest.matchAll(/(?<![a-z0-9.,])(\d{1,2}(?:[.,]\d{1,3})?)\s*a(?![a-z0-9])/g), (m) => num(m[1])));

  if (wattTokens.length === 1) {
    if (uOpsegu("w", wattTokens[0])) {
      out.watts = wattTokens[0];
      out.wattsSource = "naziv";
    } else out.flags.push("snaga-van-opsega");
  } else if (wattTokens.length > 1) out.flags.push("vise-snaga");

  if (voltTokens.length === 1) {
    if (uOpsegu("v", voltTokens[0])) out.volts = voltTokens[0];
    else out.flags.push("napon-van-opsega");
  } else if (voltTokens.length > 1) out.flags.push("vise-napona");

  if (ampTokens.length === 1) {
    if (uOpsegu("a", ampTokens[0])) out.amps = ampTokens[0];
    else out.flags.push("struja-van-opsega");
  } else if (ampTokens.length > 1) out.flags.push("vise-struja");

  // Struja bez napona je dvosmislena ("3A, 30W" univerzalnog punjaca: pri kom naponu?).
  if (out.amps !== null && out.volts === null) {
    out.flags.push("struja-bez-napona");
    out.amps = null;
  }

  // Decimalni broj bez jedinice (van zagrada i van "PD 3.0"/"QC 3.0"/"USB 3.0"): ne pogadja se,
  // samo se prijavljuje. "19.5 3.33A" = napon bez jedinice; "10.5V 2.9" = struja bez jedinice.
  const withoutNoise = rest.replace(/\([^)]*\)/g, " ").replace(/\b(?:pd|qc|usb)\s*\d[.,]\d\b/g, " ");
  const bare = Array.from(withoutNoise.matchAll(/(?<![a-z0-9.,])(\d{1,2}[.,]\d{1,3})(?![\d.,]*\s*(?:[vwa]\b|mm\b|mah\b|\*))/g), (m) => num(m[1]));
  if (bare.length) {
    if (out.volts !== null && ampTokens.length === 0) out.flags.push("struja-bez-jedinice");
    else if (out.volts === null && ampTokens.length > 0) out.flags.push("napon-bez-jedinice");
    else out.flags.push("broj-bez-jedinice");
  }

  // 3) Konektor.
  const types: string[] = [];
  if (/\b(?:usb[ -]?)?type[ -]?c\b|\busb[ -]?c\b/.test(rest)) types.push("USB Type-C");
  const magsafe = rest.match(/\bmagsafe\s*([23])?\b/);
  if (magsafe) types.push(magsafe[1] ? `MagSafe ${magsafe[1]}` : "MagSafe");
  // "USB type" bez C (Lenovo, Sony), "40 pin" i "micro pin" ne kazu koji je nastavak:
  // kupac iz te vrednosti ne bi znao da li mu odgovara, pa se Konektor ne upisuje. Takav
  // pomen se ipak broji kao konektor, da uz dimenziju ne ostane samo jedan od dva.
  const nejasan = /\busb[ -]?type\b(?![ -]?c\b)/.test(rest) || /\b(?:\d{1,2}|micro)\s*pin\b/.test(rest);

  const uniqueDims = Array.from(new Set(dims.map(([a, b]) => `${a}x${b}`)));
  if (uniqueDims.length + types.length + (nejasan ? 1 : 0) > 1) out.flags.push("vise-konektora");
  else if (uniqueDims.length === 1) out.connector = uniqueDims[0];
  else if (types.length === 1) out.connector = types[0];
  else if (nejasan) out.flags.push("konektor-nejasan");
  else if (/\busb\b/.test(rest)) out.flags.push("usb-bez-tipa");

  // 4) Snaga iz V x A, samo uz standardnu snagu u 1%.
  if (out.volts !== null && out.amps !== null) {
    const product = out.volts * out.amps;
    const nominal = NOMINAL_WATTS.find((w) => Math.abs(product - w) / w <= DERIVE_TOLERANCE);
    if (out.watts === null) {
      if (nominal !== undefined) {
        out.watts = nominal;
        out.wattsSource = "izvedeno";
      } else out.flags.push("snaga-nije-standardna");
    } else if (Math.abs(product - out.watts) / out.watts > 0.03) {
      out.flags.push("snaga-protivrecna-V-x-A");
    }
  }
  return out;
}

export function chargerSpecs(name: string, options: ChargerSpecOptions = {}): Record<string, string> {
  const { deriveWatts = true, decimalComma = false } = options;
  const parsed = parseChargerName(name);
  const specs: Record<string, string> = {};
  if (parsed.kind !== "punjac") return specs;
  if (parsed.watts !== null && (parsed.wattsSource === "naziv" || deriveWatts)) specs.Snaga = `${fmt(parsed.watts, decimalComma)} W`;
  if (parsed.volts !== null) specs.Napon = `${fmt(parsed.volts, decimalComma)} V`;
  if (parsed.amps !== null) specs.Struja = `${fmt(parsed.amps, decimalComma)} A`;
  if (parsed.connector !== null) {
    const dim = parsed.connector.match(/^([\d.]+)x([\d.]+)$/);
    specs.Konektor = dim ? `${fmtDim(Number(dim[1]), decimalComma)} x ${fmtDim(Number(dim[2]), decimalComma)} mm` : parsed.connector;
  }
  return specs;
}

// Vrednost dobavljaca za jedan od cetiri kljuca filtera (Snaga, Napon, Struja, Konektor),
// svedena na oblik vrednosti iz naziva ("90W" -> "90 W", "19,5V" -> "19.5 V", "4.5*3.0mm"
// -> "4.5 x 3.0 mm", "USB-C" -> "USB Type-C"), da filter ne dobije dve stavke za istu
// stvar. Sve ostalo je null, pa vazi vrednost iz naziva: "100-240V" je ulazni napon a ne
// izlazni, "65 W" nije napon, a "USB type" bez C ili "40 pin" ne kazu koji je nastavak
// (isto pravilo kao za naziv). Drugi kljuc je uvek null.
export function chargerSpecValue(key: string, value: string): string | null {
  const v = normalize(value).replace(/\s+/g, " ").trim();
  if (key === "Konektor") {
    const dim = v.match(/^(?:dc )?(\d{1,2}(?:[.,]\d{1,2})?) ?(?:mm)? ?[*x×] ?(\d{1,2}(?:[.,]\d{1,2})?) ?(?:mm)?$/);
    if (dim) {
      const outer = num(dim[1]);
      const inner = num(dim[2]);
      return dimenzijaNastavka(outer, inner) ? `${fmtDim(outer, false)} x ${fmtDim(inner, false)} mm` : null;
    }
    if (/^(?:usb[ -]?)?type[ -]?c$|^usb[ -]?c$/.test(v)) return "USB Type-C";
    const magsafe = v.match(/^magsafe ?([23])?$/);
    if (magsafe) return magsafe[1] ? `MagSafe ${magsafe[1]}` : "MagSafe";
    return null;
  }
  const jedinica = key === "Snaga" ? "w" : key === "Napon" ? "v" : key === "Struja" ? "a" : null;
  const broj = v.match(/^(\d{1,3}(?:[.,]\d{1,3})?) ?([wva])$/);
  if (!jedinica || !broj || broj[2] !== jedinica) return null;
  const n = num(broj[1]);
  return uOpsegu(jedinica, n) ? `${fmt(n, false)} ${jedinica.toUpperCase()}` : null;
}

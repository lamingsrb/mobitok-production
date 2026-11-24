// Iz naziva tableta i telefona izvlaci javne specifikacije: Ekran, RAM, Virtuelni RAM,
// Interna memorija, Baterija, Povezivanje, U pakovanju. Dobavljac (BTM) salje samo naziv,
// marku, barkod, sifru, cenu, lager i sliku, pa je naziv jedini izvor.
//
// Pravilo: radije nista nego pogresno (kao u charger-attributes.ts). Vrednost se uzima samo
// kad je naziv navodi jasno; dvosmislen ili nemoguc oblik ne daje nista za to polje.
// Nista se ne izmislja iz opsteg znanja o marki ili modelu: procesor, sistem, rezolucija i
// kamere nisu u podacima dobavljaca pa ih ovde nema. Boje i oznake modela (OT11, Pad 2, A16)
// nisu ni dijagonala ni sadrzaj pakovanja.

import { DEVICE_SPEC_KEYS } from "../public-specs";
export { DEVICE_SPEC_KEYS };

const normalize = (value: string) => (value || "").toLowerCase().replace(/đ/g, "dj").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[”“″]|''/g, "\"").replace(/\s+/g, " ").trim();

// Dozvoljene vrednosti: RAM u GB, interna memorija u GB (1 i 2 TB posebno).
const RAM_GB = new Set([1, 1.5, 2, 3, 4, 6, 8, 12, 16, 18, 24]);
const MEMORIJA_GB = new Set([8, 16, 32, 64, 128, 256, 512]);
// Sam broj bez jedinice ili bez para vise od RAM-a moze samo da bude memorija.
const SAMO_MEMORIJA_GB = new Set([64, 128, 256, 512]);
const broj = (tekst: string) => Number(tekst.replace(",", "."));
const gbTekst = (gb: number) => `${String(gb).replace(".", ",")} GB`;
const memorijaTekst = (gb: number) => (gb >= 1024 ? `${gb / 1024} TB` : `${gb} GB`);
const memorijaGb = (tekst: string, jedinica: string | undefined) => {
  const vrednost = Number(tekst);
  if (jedinica === "tb") return vrednost === 1 || vrednost === 2 ? vrednost * 1024 : null;
  if (!MEMORIJA_GB.has(vrednost)) return null;
  // Bez jedinice ("12/256") samo prave velicine memorije, da "8/16" ne bude par.
  return jedinica || vrednost >= 32 ? vrednost : null;
};

function ekran(t: string, tablet: boolean) {
  const nadjeno = new Set<number>();
  for (const m of t.matchAll(/(?<![\w.,])(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:"|inc(?:a|h|ha)\b)/g)) {
    const dijagonala = broj(m[1]);
    if (tablet ? dijagonala >= 7 && dijagonala <= 14.6 : dijagonala >= 4 && dijagonala <= 7.6) nadjeno.add(dijagonala);
  }
  if (nadjeno.size !== 1) return null;
  return `${String([...nadjeno][0]).replace(".", ",")}"`;
}

// "4+12GB/128GB", "4GB+12GB/128GB", "4+12GB / 64GB": stvarni + virtuelni RAM / memorija.
const RAM_VIRTUELNI = /(?<![\w.,/+])(\d+(?:[.,]5)?)\s*(?:gb)?\s*\+\s*(\d+(?:[.,]5)?)\s*(?:gb)?\s*\/\s*(\d+)\s*(gb|tb)?(?!\w)/g;
// "4/128GB", "8GB/256GB", "12/512", "8/1TB".
const RAM_MEMORIJA = /(?<![\w.,/+])(\d+(?:[.,]5)?)\s*(?:gb)?\s*\/\s*(\d+)\s*(gb|tb)?(?!\w)/g;

function memorija(t: string) {
  const kandidati = new Map<string, { ram: number | null; virtuelni: number | null; memorija: number }>();
  const dodaj = (ram: number, virtuelni: number | null, memorijaTxt: string, jedinica: string | undefined) => {
    const gb = memorijaGb(memorijaTxt, jedinica);
    if (gb === null || !RAM_GB.has(ram) || (virtuelni !== null && !RAM_GB.has(virtuelni)) || gb <= ram) return;
    kandidati.set(`${ram}|${virtuelni}|${gb}`, { ram, virtuelni, memorija: gb });
  };
  for (const m of t.matchAll(RAM_VIRTUELNI)) dodaj(broj(m[1]), broj(m[2]), m[3], m[4]);
  for (const m of t.matchAll(RAM_MEMORIJA)) dodaj(broj(m[1]), null, m[2], m[3]);
  if (kandidati.size === 1) return [...kandidati.values()][0];
  if (kandidati.size > 1) return null;
  // Sam "256GB" bez para: memorija, ali samo kad je jedini takav podatak i nije uz / ili +.
  const sami = [...t.matchAll(/(?<![\w.,])(\d+)\s*(gb|tb)(?!\w)/g)];
  if (sami.length !== 1) return null;
  const [m] = sami, pre = t.slice(0, m.index).trimEnd().slice(-1), posle = t.slice((m.index ?? 0) + m[0].length).trimStart()[0] ?? "";
  if ("/+".includes(pre || "x") || "/+".includes(posle || "x") || /^ram\b/.test(t.slice((m.index ?? 0) + m[0].length).trimStart())) return null;
  const vrednost = Number(m[1]), gb = m[2] === "tb" ? (vrednost === 1 || vrednost === 2 ? vrednost * 1024 : null) : SAMO_MEMORIJA_GB.has(vrednost) ? vrednost : null;
  return gb === null ? null : { ram: null, virtuelni: null, memorija: gb };
}

function baterija(t: string) {
  const nadjeno = new Set<number>();
  for (const m of t.matchAll(/(?<![\w.,])(\d{4,5})\s*mah(?!\w)/g)) {
    const vrednost = Number(m[1]);
    if (vrednost >= 1000 && vrednost <= 30000) nadjeno.add(vrednost);
  }
  return nadjeno.size === 1 ? `${[...nadjeno][0]} mAh` : null;
}

// Samo ono sto naziv eksplicitno kaze, ovim redom. "2G/GSM", "LTE" bez 4G i slicno nije ovde.
const VEZE: [string, RegExp][] = [
  ["5G", /(?<![\w.])5g(?!\w)/],
  ["4G LTE", /(?<![\w.])4g(?!\w)|(?<![\w.])lte(?!\w)/],
  ["Wi-Fi", /(?<![\w.])wi-?fi(?!\w)|(?<![\w.])wlan(?!\w)/],
  ["Bluetooth", /(?<![\w.])bt(?!\w)|bluetooth/],
  ["GPS", /(?<![\w.])gps(?!\w)/],
  ["NFC", /(?<![\w.])nfc(?!\w)/],
  ["Dual SIM", /(?<![\w.])dual ?sim(?!\w)|(?<![\w.])ds(?!\w)/],
];

// U pakovanju: samo "+ stavka", "/stavka", "sa [boja] stavka", "uz stavka". "bez punjaca" i sve u zagradama
// (npr. "(kabl Type A na Type C/slusalice)") ne racuna se. Boje se ne ispisuju.
const PAKOVANJE = /(?<![a-z0-9])(?:(or(?:i)?ginal\w*|org\.?|preklopn\w*|preklop\.?)\s*)?(futrol\w*|olovk\w*|stylus|punjac\w*|slusalic\w*|mask\w*|folij\w*)/g;
const PRE_STAVKE = /(?:[+/]|\b(?:sa|uz)(?:\s+\S+)?)\s*$/;
function pakovanje(t: string) {
  const bezZagrada = t.replace(/\([^)]*\)/g, " ");
  const nadjeno: string[] = [];
  let krajPrethodne = -1;
  for (const m of bezZagrada.matchAll(PAKOVANJE)) {
    const pre = bezZagrada.slice(0, m.index);
    // "sa olovkom i futrolom": stavka odmah iza prihvacene stavke, spojena sa "i" ili zarezom.
    const nastavak = krajPrethodne >= 0 && /^\s*(?:,|i)\s*$/.test(bezZagrada.slice(krajPrethodne, m.index));
    if ((!PRE_STAVKE.test(pre) && !nastavak) || /\bbez\b[^+,;(]*$/.test(pre)) continue;
    const original = /^(?:or|org)/.test(m[1] ?? ""), preklop = /^preklop/.test(m[1] ?? "");
    const koren = m[2];
    const stavka = /^futrol/.test(koren) ? (preklop ? "preklopna futrola" : original ? "originalna futrola" : "futrola")
      : /^(olovk|stylus)/.test(koren) ? (original ? "originalna olovka" : "olovka")
      : /^punjac/.test(koren) ? (original ? "originalni punjač" : "punjač")
      : /^slusalic/.test(koren) ? (original ? "originalne slušalice" : "slušalice")
      : /^mask/.test(koren) ? (original ? "originalna maska" : "maska")
      : (original ? "originalna folija" : "folija");
    // "preklopna" uz punjac/slusalice ne znaci nista; takav oblik se preskace.
    if (preklop && !/^futrol/.test(koren)) continue;
    if (!nadjeno.includes(stavka)) nadjeno.push(stavka);
    krajPrethodne = (m.index ?? 0) + m[0].length;
  }
  return nadjeno.join(", ");
}

/** Specifikacije tableta i telefona iz naziva; za druge podkategorije prazno. */
export function deviceSpecs(name: string, subcategory: string): Record<string, string> {
  if (subcategory !== "tableti" && subcategory !== "telefoni") return {};
  const t = normalize(name);
  // Maketa, dodatak ili deo koji je dobavljac svrstao medju uredjaje nije uredjaj: "256GB" ili "5G"
  // iz naziva maske nisu njena svojstva. Pravi nazivi pocinju markom, "Mobilni telefon" ili "Tablet".
  if (/^(maketa|dummy|mask|futrol|torbic|folij|staklo|zastitn|punjac|kabl|adapter|baterij|slusalic|tastatur|olovk|drzac|stalak|lcd|displej|ekran|poklopac|kucist)/.test(t)) return {};
  const rezultat: Record<string, string> = {};
  const dijagonala = ekran(t, subcategory === "tableti");
  if (dijagonala) rezultat.Ekran = dijagonala;
  const mem = memorija(t);
  if (mem?.ram != null) rezultat.RAM = gbTekst(mem.ram);
  if (mem?.virtuelni != null) rezultat["Virtuelni RAM"] = gbTekst(mem.virtuelni);
  if (mem) rezultat["Interna memorija"] = memorijaTekst(mem.memorija);
  const kapacitet = baterija(t);
  if (kapacitet) rezultat.Baterija = kapacitet;
  const veze = VEZE.filter(([, izraz]) => izraz.test(t)).map(([naziv]) => naziv);
  if (veze.length) rezultat.Povezivanje = veze.join(", ");
  const sadrzaj = pakovanje(t);
  if (sadrzaj) rezultat["U pakovanju"] = sadrzaj;
  // Redosled kljuceva je redosled prikaza.
  return Object.fromEntries(DEVICE_SPEC_KEYS.filter((k) => k in rezultat).map((k) => [k, rezultat[k]]));
}

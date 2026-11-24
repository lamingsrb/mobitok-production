// Svojstva artikla po kojima se filtrira u bocnoj traci (punjaci za laptop).
// Zajednicko za adresu stranice, API rutu i bazu, pa je u malom fajlu bez uvoza:
// ruta i pregledac ga uvoze bez lib/catalog.ts (koji vuce ceo snimak kataloga).
//
// Ime parametra u adresi je malim slovima, a kljuc u bazi (products.specs) je isto
// ime sa velikim pocetnim slovom, kako ga i prikazuje stranica artikla.

export const SPEC_KEYS = ["snaga", "napon", "struja", "konektor"] as const;
export type SpecKey = (typeof SPEC_KEYS)[number];

export const SPEC_LABELS: Record<SpecKey, string> = {
  snaga: "Snaga",
  napon: "Napon",
  struja: "Struja",
  konektor: "Konektor",
};

export const SPEC_MAX_VALUES = 12;
// Podkategorije u kojima prodavnica crta grupe svojstava; samo za njih ruta trazi brojace.
export const SPEC_SUBS = new Set(["laptop-punjaci"]);
// Vrednosti dolaze iz kataloga ("19.5 V", "4.5 x 3.0 mm", "USB Type-C", "MagSafe 2").
const SPEC_VALUE = /^[\p{L}\p{N} .,x×/+()-]{1,40}$/u;

// Isto pravilo za izbor iz adrese i za vrednost dobavljaca pri objavi: u bazu ne sme
// vrednost koju adresa posle odbija, jer bi njen klik u filteru davao gresku.
export const isValidSpecValue = (vrednost: string) => SPEC_VALUE.test(vrednost);

export type SpecSelection = Record<string, string[]>;
// Greska kaze koje svojstvo i, kad je izabrano previse, koja je granica.
export type SpecParamsError = { error: string; spec: SpecKey; maxValues?: number };

// Parametri adrese -> izbor po kljucu baze, npr. {Snaga: ["65 W", "90 W"], Napon: ["19 V"]}.
// Ponovljen parametar je ILI unutar grupe, razliciti parametri su I izmedju grupa. Ostali
// parametri adrese se ne diraju. Losa vrednost je greska, a ne tiho odbacen filter koji bi
// vratio pogresan skup. Vrednost koje u katalogu nema nije greska: daje 0 artikala.
export function readSpecParams(
  trazeno: Pick<URLSearchParams, "getAll">,
): { specs: SpecSelection | null } | SpecParamsError {
  const specs: SpecSelection = {};
  for (const ime of SPEC_KEYS) {
    const vrednosti = Array.from(new Set(trazeno.getAll(ime).map((v) => v.trim()).filter(Boolean)));
    if (vrednosti.length > SPEC_MAX_VALUES)
      return {
        error: `Previše izabranih vrednosti za svojstvo ${SPEC_LABELS[ime]}: izabrano ${vrednosti.length}, dozvoljeno najviše ${SPEC_MAX_VALUES}.`,
        spec: ime,
        maxValues: SPEC_MAX_VALUES,
      };
    if (vrednosti.some((v) => !isValidSpecValue(v)))
      return { error: `Vrednost svojstva ${SPEC_LABELS[ime]} nije ispravna.`, spec: ime };
    if (vrednosti.length) specs[SPEC_LABELS[ime]] = vrednosti;
  }
  return { specs: Object.keys(specs).length ? specs : null };
}

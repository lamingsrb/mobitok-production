// Formiranje cene: od nabavne cene dobavljaca do cene koju kupac vidi.
//
// Dva odvojena pojma, oba podesiva iz admin panela:
//
//   MARZA    - od nabavne cene sa PDV-om do osnovne prodajne cene sa PDV-om.
//              Zavisi od nabavne cene, po tabeli pragova: jeftin artikal nosi
//              vecu marzu, skup manju (feedback 05.10.2026). Fantech artikli
//              su izuzetak i prodaju se po cenovniku dobavljaca, bez rabata.
//   POPUST   - koliko se skida sa te osnovne cene, prema vrsti kupca: opsti
//              procenat za gosta, registrovano fizicko lice i firmu, a odobrena
//              firma moze imati i pojedinacni rabat. Opsti procenti su
//              podrazumevano 0 (zahtev klijenta 20.10.2026).
//
// Sve cene su u dinarima. Osnovna prodajna cena UKLJUCUJE PDV.
//
// Ovaj modul uvozi i kod prodavnice koji ide u pregledac, pa u njemu nema
// nijednog broja iz tabele marze. Podrazumevana podesavanja su samo na
// serveru, u lib/server/pricing-defaults.ts.

/**
 * Jedan prag marze: nabavna cena sa PDV-om do `up_to` dinara, ukljucivo,
 * dobija `percent` marze. Poslednji prag nema gornju granicu (`up_to: null`).
 */
export type MarginTier = { up_to: number | null; percent: number };

export type ShopSettings = {
  margin_tiers: MarginTier[];
  vat_percent: number;
  discount_guest_percent: number;
  discount_person_percent: number;
  discount_company_percent: number;
  round_to: number;
  publish_supplier_catalog: boolean;
};

export type Buyer = "guest" | "person" | "company";

// Granice tabele marze. Tu su da omaska u unosu ne obori prodaju.
export const NAJVISE_PRAGOVA = 40;
export const NAJVECA_MARZA = 500;
export const NAJVECA_GRANICA = 10000000;

const naPare = (iznos: number) => Math.round(iznos * 100) / 100;

const zaokruzi = (iznos: number, korak: number) => {
  // Prvo na pare, da sitna greska u racunu sa decimalama ne podigne cenu za ceo korak.
  const tacno = naPare(iznos);
  if (!korak || korak <= 0) return tacno;
  // Navise, da marza nikad ne padne ispod zadate.
  return Math.ceil(tacno / korak) * korak;
};

/** Pragovi rastu, poslednji je bez gornje granice, a marze su u dozvoljenim granicama. */
export const ispravnaTabelaMarze = (tabela: unknown): tabela is MarginTier[] => {
  if (!Array.isArray(tabela) || tabela.length < 1 || tabela.length > NAJVISE_PRAGOVA) return false;
  let prethodni = 0;
  return tabela.every((prag, i) => {
    if (!prag || typeof prag !== "object") return false;
    const { up_to, percent } = prag as MarginTier;
    if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > NAJVECA_MARZA) return false;
    if (i === tabela.length - 1) return up_to === null;
    if (typeof up_to !== "number" || !Number.isFinite(up_to) || up_to <= prethodni || up_to > NAJVECA_GRANICA) return false;
    prethodni = up_to;
    return true;
  });
};

/** Redni broj praga u koji upada nabavna cena sa PDV-om. */
export const indeksPraga = (nabavnaSaPdv: number, tabela: MarginTier[]): number => {
  const i = tabela.findIndex((prag) => prag.up_to === null || nabavnaSaPdv <= prag.up_to);
  return i === -1 ? tabela.length - 1 : i;
};

/** Marza u procentima za nabavnu cenu sa PDV-om. */
export const marzaZaNabavnu = (nabavnaSaPdv: number, tabela: MarginTier[]): number =>
  tabela[indeksPraga(nabavnaSaPdv, tabela)]?.percent ?? 0;

/** Nabavna cena sa PDV-om -> osnovna prodajna cena sa PDV-om, po tabeli marze. */
export const cenaPoTabeli = (
  nabavnaSaPdv: number,
  s: Pick<ShopSettings, "margin_tiers" | "round_to">,
): number => {
  if (!Number.isFinite(nabavnaSaPdv) || nabavnaSaPdv <= 0) return 0;
  const marza = marzaZaNabavnu(nabavnaSaPdv, s.margin_tiers);
  return zaokruzi(nabavnaSaPdv * (1 + marza / 100), s.round_to);
};

/** Nabavna neto cena dobavljaca -> osnovna prodajna cena sa PDV-om. */
export const osnovnaProdajnaCena = (
  nabavnaNeto: number,
  s: Pick<ShopSettings, "margin_tiers" | "vat_percent" | "round_to">,
): number => {
  if (!Number.isFinite(nabavnaNeto) || nabavnaNeto <= 0) return 0;
  // Prag se trazi po ceni sa PDV-om na pare, kako je dobavljac prikazuje ("Moja cena sa PDV").
  return cenaPoTabeli(naPare(nabavnaNeto * (1 + s.vat_percent / 100)), s);
};

/** Fantech artikal. Klijent ga prepoznaje po nazivu: "gde god ima naziv Fantech". */
export const jeFantech = (...tekstovi: (string | null | undefined)[]): boolean =>
  tekstovi.some((tekst) => /fantech/i.test(tekst ?? ""));

/**
 * Prodajna cena sa PDV-om za jedan artikal dobavljaca.
 * Fantech ide po cenovniku dobavljaca bez rabata, sa PDV-om (na sajtu 3G to
 * je "Cena"), tacno na pare i bez marze iz tabele. Kada cenovnik nije poznat
 * ili je nizi od nabavne cene, i Fantech ide po tabeli.
 */
export const prodajnaCenaArtikla = (
  artikal: { nabavnaNeto: number; cenovnikNeto?: number | null; fantech?: boolean },
  s: Pick<ShopSettings, "margin_tiers" | "vat_percent" | "round_to">,
): number => {
  const { nabavnaNeto, cenovnikNeto, fantech } = artikal;
  if (!Number.isFinite(nabavnaNeto) || nabavnaNeto <= 0) return 0;
  if (fantech && typeof cenovnikNeto === "number" && Number.isFinite(cenovnikNeto) && cenovnikNeto >= nabavnaNeto)
    return naPare(cenovnikNeto * (1 + s.vat_percent / 100));
  return osnovnaProdajnaCena(nabavnaNeto, s);
};

/** Iznos za prikaz: ceo broj bez decimala, inace uvek sa dve (4.791,60). */
export const prikazIznosa = (iznos: number): string => {
  const tacno = naPare(iznos);
  return new Intl.NumberFormat("sr-Latn-RS", {
    minimumFractionDigits: Number.isInteger(tacno) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(tacno);
};

/**
 * Popust za kupca, u procentima.
 * Firma dobija veci od dva: opsti popust za firme i njen pojedinacni rabat
 * koji administrator unosi pri odobrenju. Tako pojedinacni dogovor nikad ne
 * moze da bude losiji od opsteg pravila.
 */
export const popustZaKupca = (
  buyer: Buyer,
  s: Pick<ShopSettings, "discount_guest_percent" | "discount_person_percent" | "discount_company_percent">,
  pojedinacniRabat = 0,
): number => {
  const p =
    buyer === "guest"
      ? s.discount_guest_percent
      : buyer === "person"
        ? s.discount_person_percent
        : Math.max(s.discount_company_percent, pojedinacniRabat || 0);
  return Math.min(60, Math.max(0, p));
};

/** Osnovna cena umanjena za popust kupca. */
export const cenaZaKupca = (osnovna: number, popustProcenat: number): number => {
  const p = Math.min(60, Math.max(0, popustProcenat || 0));
  return Math.round(osnovna * (1 - p / 100) * 100) / 100;
};

import { ispravnaTabelaMarze, type MarginTier, type ShopSettings } from "../pricing";

export const PODRAZUMEVANA_PODESAVANJA: ShopSettings = {
  margin_tiers: [],
  vat_percent: 20,
  discount_guest_percent: 0,
  discount_person_percent: 0,
  discount_company_percent: 0,
  round_to: 10,
  publish_supplier_catalog: false,
};

let rezervnaTabela: MarginTier[] | undefined;

export function vazecaTabelaMarze(tabela: unknown): MarginTier[] {
  if (ispravnaTabelaMarze(tabela)) return tabela;
  if (rezervnaTabela) return rezervnaTabela;

  const raw = process.env.MOBITOK_PRICING_FALLBACK_TIERS;
  let vrednost: unknown;
  try {
    vrednost = raw ? JSON.parse(raw) : undefined;
  } catch {
    throw new Error("Rezervna tabela marže nije ispravno podešena.");
  }
  if (!ispravnaTabelaMarze(vrednost)) {
    throw new Error("Rezervna tabela marže nije ispravno podešena.");
  }
  rezervnaTabela = vrednost;
  return rezervnaTabela;
}

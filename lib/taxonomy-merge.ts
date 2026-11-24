import { resolveCatalogLocation, type CatalogLayout } from "./catalog-layout";
// Admin 03.11: taksonomija prodavnice = grupe i podgrupe iz koda + redovi tabele catalog_taxonomy
// (novi nazivi i nove grupe iz alata "Katalog"). Cist modul bez React-a i servera: koriste ga
// prodavnica (store-context) i admin API. Bez redova daje tacno danasnje nazive i redosled.
import type { Taxonomy, TaxonomyGroup, TaxonomyRow } from "./catalog-admin-types";
import { categories } from "./catalog";
import {
  categorySubcategoryOrder,
  menuSubcategories as menuIzKoda,
  sortSubcategories,
  subcategoryNames,
} from "./catalog-taxonomy";

// Procitan i proveren red tabele.
interface Cvor {
  slug: string;
  parent: string;
  sr: string;
  en: string | null;
  hidden: boolean;
  sort: number;
}

const ima = (objekat: object, kljuc: string) => Object.prototype.hasOwnProperty.call(objekat, kljuc);

// Isto pravilo kao u bazi. Ime iz Object.prototype (npr. "constructor") mape u kodu bi procitale
// kao postojecu vrednost, pa se takav red preskace.
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ispravanSlug = (vrednost: unknown, granica: number): vrednost is string =>
  typeof vrednost === "string" && vrednost.length <= granica && SLUG.test(vrednost) && !(vrednost in Object.prototype);

const UGRADJENE_GRUPE: ReadonlySet<string> = new Set(categories.map((c) => c.id));

// Danasnji naziv podgrupe iz koda (subcategoryName iz lib/catalog-taxonomy.ts).
const nazivIzKoda = (key: string) =>
  typeof key === "string" ? (ima(subcategoryNames, key) && subcategoryNames[key]) || key.replaceAll("-", " ") : "";

// Lista reda iz koda, samo za stvarne kljuceve grupa.
const listaReda = (category: string) => (ima(categorySubcategoryOrder, category) ? categorySubcategoryOrder[category] : undefined);

// Podgrupa je ugradjena kada je kljuc u kodu (naziv u subcategoryNames ili lista reda grupe), kao u
// admin API-ju. Red tabele sa kljucem van koda je korisnicka podgrupa (i preimenovana nasledjena).
const ugradjenaPodgrupa = (category: string, key: string) => ima(subcategoryNames, key) || Boolean(listaReda(category)?.includes(key));

// Korisnicki cvorovi: sort_order, pa srpski naziv (isti redosled u oba jezika), pa kljuc.
const poRedu = (a: Cvor, b: Cvor) =>
  a.sort - b.sort || a.sr.localeCompare(b.sr, "sr") || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

// Neispravan red (prazan kljuc ili naziv, nepoznat kind, los roditelj) vraca null, bez bacanja.
function procitaj(row: unknown, kind: "group" | "sub"): Cvor | null {
  if (!row || typeof row !== "object") return null;
  const { kind: vrsta, slug, parent, label_sr, label_en, hidden, sort_order } = row as { [K in keyof TaxonomyRow]?: unknown };
  if (vrsta !== kind || !ispravanSlug(slug, kind === "group" ? 40 : 60)) return null;
  let roditelj = "";
  if (kind === "sub") {
    if (!ispravanSlug(parent, 40)) return null;
    roditelj = parent;
  } else if (parent != null && parent !== "") return null;
  const sr = typeof label_sr === "string" ? label_sr.trim() : "";
  if (!sr) return null;
  const en = typeof label_en === "string" ? label_en.trim() : "";
  const sort = typeof sort_order === "number" && Number.isFinite(sort_order) ? sort_order : 1000;
  return { slug, parent: roditelj, sr, en: en || null, hidden: hidden === true, sort };
}

// present: parovi (grupa, podgrupa) sa aktivnim proizvodima; za grupe bez liste reda oni su spisak
// ugradjenih podgrupa. Funkcije vracaju nove nizove (pozivalac sme da ih menja).
function baseTaxonomy(
  rows: readonly TaxonomyRow[],
  language: "sr" | "en",
  present?: readonly { category: string; key: string }[],
): Taxonomy {
  const en = language === "en";
  const ulaz: readonly unknown[] = Array.isArray(rows) ? rows : [];

  // Redovi grupa; za isti kljuc vazi prvi. Ugradjena grupa je uvek vidljiva (hidden se ignorise).
  const redGrupe = new Map<string, Cvor>();
  for (const row of ulaz) {
    const cvor = procitaj(row, "group");
    if (cvor && !redGrupe.has(cvor.slug)) redGrupe.set(cvor.slug, cvor);
  }
  const vidljiva = (id: string) => UGRADJENE_GRUPE.has(id) || redGrupe.get(id)?.hidden === false;

  // Redovi podgrupa samo za postojece i vidljive grupe.
  const redPodgrupe = new Map<string, Map<string, Cvor>>();
  for (const row of ulaz) {
    const cvor = procitaj(row, "sub");
    if (!cvor || !vidljiva(cvor.parent)) continue;
    const grupa = redPodgrupe.get(cvor.parent) ?? new Map<string, Cvor>();
    if (!grupa.has(cvor.slug)) grupa.set(cvor.slug, cvor);
    redPodgrupe.set(cvor.parent, grupa);
  }

  // sr: label_sr. en: label_en, a bez njega ugradjeni cvor zadrzava naziv iz koda (t() ga
  // prevodi), korisnicki label_sr.
  const naziv = (cvor: Cvor, izKoda?: string) => (en ? cvor.en ?? izKoda ?? cvor.sr : cvor.sr);

  const groups: TaxonomyGroup[] = categories.map((c) => {
    const cvor = redGrupe.get(c.id);
    return { id: c.id, name: cvor ? naziv(cvor, c.name) : c.name, short: c.short, description: c.description, icon: c.icon, builtin: true };
  });
  const korisnickeGrupe = [...redGrupe.values()].filter((cvor) => !UGRADJENE_GRUPE.has(cvor.slug)).sort(poRedu);
  for (const cvor of korisnickeGrupe) {
    if (!cvor.hidden) groups.push({ id: cvor.slug, name: naziv(cvor), description: "", icon: "package", builtin: false });
  }
  // Sakrivena korisnicka grupa nije u groups, ali njen naziv vazi (npr. za admin pregled).
  const naziviGrupa = new Map<string, string>(korisnickeGrupe.map((cvor): [string, string] => [cvor.slug, naziv(cvor)]));
  for (const g of groups) naziviGrupa.set(g.id, g.name);

  // Korisnicke podgrupe po grupi: sve (i sakrivene) se izbacuju iz spiska iz koda, a dodaju se
  // samo nesakrivene (sort_order, pa naziv).
  const korisnicke = new Map<string, string[]>();
  const iskljucene = new Map<string, Set<string>>();
  for (const [category, grupa] of redPodgrupe) {
    const cvorovi = [...grupa.values()].filter((cvor) => !ugradjenaPodgrupa(category, cvor.slug)).sort(poRedu);
    iskljucene.set(category, new Set(cvorovi.map((cvor) => cvor.slug)));
    korisnicke.set(category, cvorovi.filter((cvor) => !cvor.hidden).map((cvor) => cvor.slug));
  }

  // Prisutne podgrupe po grupi, bez ponavljanja.
  const prisutne = new Map<string, string[]>();
  for (const par of Array.isArray(present) ? present : []) {
    if (!par || typeof par.category !== "string" || typeof par.key !== "string" || !par.key) continue;
    const kljucevi = prisutne.get(par.category) ?? [];
    if (!kljucevi.includes(par.key)) kljucevi.push(par.key);
    prisutne.set(par.category, kljucevi);
  }

  const subcategories = (category: string): string[] => {
    if (!vidljiva(category)) return [];
    const izbaci = iskljucene.get(category);
    const prisutni = (prisutne.get(category) ?? []).filter((key) => !izbaci?.has(key));
    const red = listaReda(category) ?? sortSubcategories(category, prisutni);
    return [...new Set([...red, ...prisutni, ...(korisnicke.get(category) ?? [])])];
  };

  // Za kljuceve iz koda tacno danasnji meni; korisnicke podgrupe samo kada imaju proizvoda.
  const menuSubcategories = (category: string, available: readonly string[]): string[] => {
    if (redGrupe.has(category) && !vidljiva(category)) return [];
    const dostupno: readonly string[] = Array.isArray(available) ? available : [];
    const izbaci = iskljucene.get(category);
    const osnova = menuIzKoda(listaReda(category) ? category : "", izbaci ? dostupno.filter((key) => !izbaci.has(key)) : dostupno);
    const dodatak = (korisnicke.get(category) ?? []).filter((key) => dostupno.includes(key));
    return [...new Set([...osnova, ...dodatak])];
  };

  return {
    groups,
    // Admin 03.11 (D3): nepoznata grupa (npr. uklonjena) se prikazuje citljivo, a ne kao sirov kljuc
    categoryName: (id: string) => naziviGrupa.get(id) ?? (typeof id === "string" ? id.replaceAll("-", " ") : ""),
    subcategoryName: (category: string, key: string) => {
      const cvor = redPodgrupe.get(category)?.get(key);
      if (!cvor) return nazivIzKoda(key);
      return naziv(cvor, ugradjenaPodgrupa(category, key) ? nazivIzKoda(key) : undefined);
    },
    menuSubcategories,
    subcategories,
  };
}

/** Empty public placeholders use catalog-wide metadata; admin destinations stay complete. */
function withoutEmptySubcategories(taxonomy: Taxonomy, present: readonly { category: string; key: string }[] | undefined, layout: CatalogLayout | null | undefined, enabled: boolean): Taxonomy {
  if (!enabled || present === undefined) return taxonomy;
  const populated = new Set(present.map(({ category, key }) => resolveCatalogLocation(layout, category, key).join("/")));
  const keep = (category: string, keys: string[]) => keys.filter((key) => populated.has(category + "/" + key));
  return { ...taxonomy, subcategories: (category) => keep(category, taxonomy.subcategories(category)),
    menuSubcategories: (category, available) => keep(category, taxonomy.menuSubcategories(category, available)) };
}

/** Project each existing node before ordering; the registry alone never resurrects a hidden/removed node. */
export function mergeTaxonomy(rows: readonly TaxonomyRow[], language: "sr" | "en", present?: readonly { category: string; key: string }[], layout?: CatalogLayout | null, options: { hideEmptySubcategories?: boolean } = {}): Taxonomy {
  const base = baseTaxonomy(rows, language, present);
  if (!layout || (layout.revision === 0 && !layout.nodes.length)) return withoutEmptySubcategories(base, present, layout, options.hideEmptySubcategories === true);
  const visibleGroups = new Set(base.groups.map((group) => group.id));
  const order = (category: string, values: string[]) => values.map((key, index) => ({ key, index,
    rank: layout.nodes.find((node) => node.parent === category && node.slug === key)?.sortOrder ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index).map(({ key }) => key);
  const project = (category: string, available?: readonly string[]) => {
    if (!visibleGroups.has(category)) return [];
    const keys = new Set<string>();
    for (const group of base.groups) {
      const source = available ? base.menuSubcategories(group.id, available) : base.subcategories(group.id);
      for (const key of source) {
        const alias = layout.aliases.find((row) => row.parent === group.id && row.slug === key);
        const node = alias && layout.nodes.find((row) => row.id === alias.nodeId);
        // Missing public code aliases mean the canonical destination is hidden/removed.
        if ((node && (!node.live || !node.visible)) || (!node && categorySubcategoryOrder[group.id]?.includes(key))) continue;
        const [parent, slug] = resolveCatalogLocation(layout, group.id, key);
        if (parent === category) keys.add(slug);
      }
    }
    return order(category, [...keys]);
  };
  return withoutEmptySubcategories({ ...base, subcategories: (category) => project(category), menuSubcategories: (category, available) => project(category, available) }, present, layout, options.hideEmptySubcategories === true);
}

// Odrediste za premestanje: vidljiva grupa (i prazna); "" (bez podgrupe) uvek vazi za takvu
// grupu; inace podgrupa sa spiska grupe (nova prazna korisnicka podgrupa je vazece odrediste).
export function isValidLocation(t: Taxonomy, category: string, subcategory: string): boolean {
  if (typeof category !== "string" || typeof subcategory !== "string") return false;
  if (!t.groups.some((g) => g.id === category)) return false;
  return subcategory === "" || t.subcategories(category).includes(subcategory);
}

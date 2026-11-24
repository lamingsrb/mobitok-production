import type { CatalogLayout } from "./catalog-layout";
import type { TaxonomyRow } from "./catalog-admin-types";

export type Product = {
  id: string;
  slug: string;
  name: string;
  category: string;
  subcategory: string;
  brand: string;
  deviceBrand: string | null;
  devices: string[];
  price: number;
  image: string;
  images: string[];
  description: string;
  specs: Record<string, string>;
  stock: number;
  isDemo: boolean;
  sourceUrl?: string;
  tags: string[];
  supplier?: string;
  stockUpdatedAt?: string;
  availability?: "available" | "unavailable" | "check";
  leadTimeDays?: number | null;
  // Lista sa servera ne nosi opis i specifikaciju, jer bi to na 24 artikla bilo
  // vise podataka nego same kartice. Zapis sa punim podacima je oznacen, pa
  // stranica artikla zna da li sme da ga prikaze ili mora jos da pita.
  detailed?: boolean;
};

// Jedna vrednost svojstva sa brojem artikala ("65 W": 12).
export type CatalogSpecValue = { value: string; count: number };

// Brojaci uz svaki filter: koliko artikala ostaje ako se bas on izabere.
export type CatalogFacets = {
  categories: Record<string, number>;
  subcategories: Record<string, number>;
  deviceBrands: Record<string, number>;
  brands: Record<string, number>;
  priceRange: { min: number | null; max: number | null };
  // Modeli izabranog brenda uredjaja u izabranoj kategoriji i podkategoriji; prazno
  // dok brend nije izabran. Baza vraca JSON objekat, pa redosled nije garantovan:
  // prikaz sortira sam (po broju, pa po imenu). Opciono dok je stara baza u upotrebi.
  deviceModels?: Record<string, number>;
  // Vrednosti svojstava (Snaga, Napon, Struja, Konektor) po grupi, vec poredjane po
  // numerickom prefiksu ("5 V" pre "12 V"). Samo grupe za koje su trazeni brojaci.
  specs?: Record<string, CatalogSpecValue[]>;
};

export type CatalogSearch = {
  catalogRevision?: string;
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  sort: string;
  // Tacna pretraga nije nasla nista, pa je odgovor sastavljen po slicnosti.
  approximate: boolean;
  facets: CatalogFacets | null;
};

// Kategorije, vrste opreme i modeli telefona za navigaciju i biranje uredjaja.
export type CatalogMeta = {
  catalogRevision?: string;
  total: number;
  priceMax: number | null;
  categories: { key: string; count: number }[];
  subcategories: { category: string; key: string; count: number }[];
  deviceBrands: { key: string; count: number }[];
  devices: { brand: string; key: string; count: number }[];
  // Admin 03.11: vidljivi redovi catalog_taxonomy (nazivi i nove grupe); bez tabele prazno.
  taxonomy?: TaxonomyRow[];
  layout?: CatalogLayout;
};
// Feedback 01.11: redosled kategorija je klijentov spisak; Tableti i oprema i Sport i fitnes su nove kategorije.
export const categories = [
  {
    id: "mobilni",
    name: "Mobilna oprema",
    short: "Za telefon",
    description: "Mali detalji. Velika razlika.",
    icon: "smartphone",
  },
  {
    id: "tableti",
    name: "Tableti i oprema",
    short: "Za tablet",
    description: "Veći ekran, ista sloboda.",
    icon: "tablet",
  },
  {
    id: "racunari",
    name: "Računari i oprema",
    short: "Za računar",
    description: "Tvoj prostor za velike ideje.",
    icon: "laptop",
  },
  // Feedback 03.11: nova kategorija odmah iza racunara.
  {
    id: "laptop",
    name: "Laptop i oprema",
    short: "Za laptop",
    description: "Laptopovi, baterije, punjači i dodaci.",
    icon: "laptop",
  },
  {
    id: "audio",
    name: "Slušalice i zvučnici",
    short: "Za dobar zvuk",
    description: "Tvoj svet, tvoj ritam.",
    icon: "headphones",
  },
  {
    id: "gejming",
    name: "Gejming",
    short: "Za igru",
    description: "Svaki potez se računa.",
    icon: "gamepad",
  },
  {
    id: "konzole",
    name: "Konzole i oprema",
    short: "Za konzole",
    description: "Konzole, džojstici i dodaci.",
    icon: "joystick",
  },
  {
    id: "auto",
    name: "Auto oprema",
    short: "Za vožnju",
    description: "Praktični dodaci za svaki put.",
    icon: "car",
  },
  {
    id: "stalci",
    name: "Stalci i nosači",
    short: "Za snimanje",
    description: "Stabilan kadar, slobodne ruke.",
    icon: "camera",
  },
  {
    id: "satovi",
    name: "Pametni satovi i narukvice",
    short: "Na tvom zglobu",
    description: "Prati svoj ritam.",
    icon: "watch",
  },
  {
    id: "alati",
    name: "Servisni alati",
    short: "Za majstore",
    description: "Preciznost u tvojim rukama.",
    icon: "wrench",
  },
  {
    id: "kucni",
    name: "Kućni aparati",
    short: "Za dom",
    description: "Sitnice koje dan čine lakšim.",
    icon: "home",
  },
  {
    id: "tv",
    name: "TV i multimedija",
    short: "Za dnevnu sobu",
    description: "Velika slika, ceo dom.",
    icon: "tv",
  },
  {
    id: "fitnes",
    name: "Sport i fitnes",
    short: "Za aktivan dan",
    description: "Spremno za svaki izlazak.",
    icon: "dumbbell",
  },
  {
    id: "sport",
    name: "Bicikli i trotineti",
    short: "Za pokret",
    description: "Grad ti je bliži nego što misliš.",
    icon: "bike",
  },
];
export const money = (value: number) =>
  new Intl.NumberFormat("sr-RS", { maximumFractionDigits: 0 }).format(value);
export const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/đ/g, "dj")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
export const categoryName = (id: string) =>
  categories.find((c) => c.id === id)?.name || id;

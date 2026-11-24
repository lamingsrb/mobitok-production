// Admin 03.11: kljuc (slug) za novu grupu ili podgrupu iz alata "Katalog". Cist modul,
// bez React-a i servera: kljuc pravi API, a ista pravila proveravaju i testovi.

// Kljucevi koje nova grupa ili podgrupa ne sme da dobije: prvi delovi adresa i folderi
// aplikacije, sistemske adrese i stari kljucevi koje relocatedCategory preusmerava (stari
// linkovi bi inace otvorili pogresnu grupu). Ugradjene grupe i podgrupe nisu ovde: njih
// pozivalac stavlja u `taken`.
export const RESERVED_SLUGS: readonly string[] = Object.freeze([
  // Strane iz app/[...slug]/page.tsx (routes i naslovi) i stranica artikla.
  "katalog", "proizvod", "favoriti", "korpa", "placanje", "nalog", "b2b", "admin", "o-nama",
  "podrska", "dostava", "privatnost", "uslovi", "vodic", "povrat-i-reklamacije",
  // Folderi u app/ i app/api/, sistemske adrese i folderi iz public/.
  "api", "catalog", "cron", "health", "orders", "payments", "pricing", "shop-mode",
  "sitemap", "robots", "_next", "images", "products",
  // Tab "Za tvoj ritam" na pocetnoj.
  "sve",
  // Stari kljucevi i sve sto relocatedCategory (lib/catalog-taxonomy.ts) prepoznaje.
  "delovi", "delovi-racunari", "delovi-baterije", "satovi", "auto", "fm-transmiteri", "drzaci",
  "razno", "baterije", "adapteri", "mobilni", "alati", "racunari", "konzole", "gejming", "audio",
  "sport", "maske-tableti", "stakla-tableti", "tableti", "folije", "punjaci", "kablovi", "mrezna",
  "laptop-delovi", "komponente", "oprema", "periferije", "dzojstici-ps", "oprema-ps", "slusalice",
  "slusalice-bezicne", "fitness", "koferi", "mobilnost", "laptop",
  // Jedini kljuc objekta (Object.prototype) koji prolazi pravilo za slug; mape u kodu bi ga
  // procitale kao postojecu vrednost.
  "constructor",
]);

const REZERVISANO: ReadonlySet<string> = new Set(RESERVED_SLUGS);

// Srpska cirilica u latinicu; kvacice zatim skida NFD, a dj se pise pre NFD (kao normalize).
const CIRILICA: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "đ", е: "e", ж: "ž", з: "z", и: "i",
  ј: "j", к: "k", л: "l", љ: "lj", м: "m", н: "n", њ: "nj", о: "o", п: "p", р: "r",
  с: "s", т: "t", ћ: "ć", у: "u", ф: "f", х: "h", ц: "c", ч: "č", џ: "dž", ш: "š",
};

export function slugifyLabel(label: string, max = 60): string {
  const granica = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 60;
  const latinica = Array.from((typeof label === "string" ? label : "").toLowerCase(), (slovo) => CIRILICA[slovo] ?? slovo).join("");
  return latinica
    .replace(/đ/g, "dj")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, granica)
    .replace(/-+$/, "");
}

// Grupa ide u adresu kao `kategorija` (do 40 znakova), podgrupa kao `podkategorija` (do 60).
export function uniqueSlug(label: string, kind: "group" | "sub", taken: ReadonlySet<string>): string {
  const granica = kind === "group" ? 40 : 60;
  const osnova = slugifyLabel(label, granica) || (kind === "group" ? "grupa" : "podgrupa");
  const zauzet = (slug: string) => taken.has(slug) || REZERVISANO.has(slug);
  if (!zauzet(osnova)) return osnova;
  for (let broj = 2; ; broj++) {
    const sufiks = "-" + broj;
    const slug = osnova.slice(0, granica - sufiks.length).replace(/-+$/, "") + sufiks;
    if (!zauzet(slug)) return slug;
  }
}

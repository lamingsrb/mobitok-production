// Dobavljački metapodaci služe internom uvozu, ne opisu proizvoda za kupca.
export function publicSpecKey(key: string) {
  const normalized = key.trim().toLocaleLowerCase("sr-Latn-RS");
  return !/^(uvoznik|importer|distributer|dobavljač|dobavljac|barcode|osnovni artikal|l\d+_name)$/.test(normalized);
}

// Redosled svojstava tableta i telefona u prikazu (izvlaci ih lib/server/device-specs.ts iz naziva).
// Lista zivi ovde jer je koristi i klijentski kod; server je samo uvozi odavde.
export const DEVICE_SPEC_KEYS: readonly string[] = ["Ekran", "RAM", "Virtuelni RAM", "Interna memorija", "Baterija", "Povezivanje", "U pakovanju"];

// Stabilan redosled: kljucevi uredjaja (bez obzira na velika slova i razmake) idu prvi, tim redom;
// svi ostali ostaju iza njih u izvornom redosledu.
export function orderPublicSpecs(entries: [string, string][]): [string, string][] {
  const mesto = new Map(DEVICE_SPEC_KEYS.map((key, index) => [key.trim().toLocaleLowerCase("sr-Latn-RS"), index]));
  return entries
    .map((entry, index) => ({ entry, index, rank: mesto.get(entry[0].trim().toLocaleLowerCase("sr-Latn-RS")) ?? DEVICE_SPEC_KEYS.length }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ entry }) => entry);
}

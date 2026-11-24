import type { Product } from "./catalog";

// Samo uspesan, potpun items odgovor sme da izbaci zapis. Korpa zadrzava svoju stavku radi poruke o nedostupnosti.
export function evictMissingProducts(
  products: Map<string, Product>,
  slugs: Map<string, string>,
  requested: readonly string[],
  received: readonly Product[],
): Set<string> {
  const present = new Set(received.flatMap((item) => [item.id, item.slug]));
  const removed = new Set<string>();
  for (const key of requested) {
    if (present.has(key)) continue;
    // Nepoznat ID iz sacuvanih takodje treba ukloniti, cak i kada nije bio u kesu ove posete.
    const id = products.has(key) ? key : slugs.get(key) ?? key;
    if (present.has(id)) continue;
    const old = products.get(id);
    products.delete(id);
    if (old?.slug) slugs.delete(old.slug);
    slugs.delete(key);
    removed.add(id);
  }
  return removed;
}

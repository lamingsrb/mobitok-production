import type { MetadataRoute } from "next";
import { getAdminClient } from "@/lib/server/supabase";

const SAJT = (process.env.NEXT_PUBLIC_SITE_URL || "https://mobitok.rs").replace(/\/+$/, "");

// Javne strane. Korpa, placanje, nalog, favoriti i admin su licne i ne idu u
// mapu (isto pise u robots.ts).
const STRANE = ["/", "/katalog", "/b2b", "/o-nama", "/podrska", "/dostava", "/privatnost", "/uslovi", "/vodic", "/povrat-i-reklamacije"];

// Jedan sitemap prima najvise 50.000 adresa. Katalog sada ima oko 25.000
// aktivnih artikala; pre nego sto predje granicu, mapu treba podeliti
// (generateSitemaps).
const NAJVISE_ARTIKALA = 50000 - STRANE.length;
const PO_UPITU = 1000;

// Mapa se pravi pri buildu i obnavlja jednom dnevno, sto prati dnevnu
// sinhronizaciju kataloga.
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const strane = STRANE.map((putanja) => ({ url: `${SAJT}${putanja}` }));
  let admin: ReturnType<typeof getAdminClient>;
  try {
    admin = getAdminClient();
  } catch {
    // Build bez pristupa bazi (lokalna provera) dobija samo stalne strane.
    return strane;
  }
  const artikli: MetadataRoute.Sitemap = [];
  for (let od = 0; od < NAJVISE_ARTIKALA; od += PO_UPITU) {
    const doReda = Math.min(od + PO_UPITU, NAJVISE_ARTIKALA) - 1;
    const { data, error } = await admin
      .from("catalog_visible_products")
      .select("slug")
      .eq("active", true)
      .order("id")
      .range(od, doReda);
    if (error) {
      // Ne vracaj zastarele bootstrap adrese: artikal je mozda u medjuvremenu obrisan.
      return strane;
    }
    const redovi = data ?? [];
    for (const red of redovi) artikli.push({ url: `${SAJT}/proizvod/${red.slug}` });
    if (redovi.length < doReda - od + 1) break;
  }
  if (artikli.length >= NAJVISE_ARTIKALA)
    console.warn("Sitemap je pun: deo artikala nije u mapi, podeli je.");
  return [...strane, ...artikli];
}

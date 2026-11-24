import { getAdminClient, HttpError } from "@/lib/server/supabase";
import { catalogItems } from "@/lib/server/catalog-search";
import { apiError, rateLimit } from "@/lib/server/http";
import { preparationMode } from "@/lib/server/shop-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NE_KESIRAJ = { "Cache-Control": "no-store" };

// Korpa, sacuvano i stranica artikla traze tacno odredjene artikle. Odgovor se
// nikad ne kesira: kolicina i dostupnost su jedino sto kupac mora da vidi
// sveze, jer o njima zavisi da li uopste sme da naruci.
export async function GET(request: Request) {
  try {
    const trazeno = new URL(request.url).searchParams.get("ids") ?? "";
    const kljucevi = trazeno
      .split(",")
      .map((kljuc) => kljuc.trim())
      .filter(Boolean)
      .slice(0, 60);
    if (!kljucevi.length)
      return Response.json({ error: "Nije naveden nijedan artikal." }, { status: 400, headers: NE_KESIRAJ });
    if (kljucevi.some((kljuc) => kljuc.length > 180))
      return Response.json({ error: "Oznaka artikla nije ispravna." }, { status: 400, headers: NE_KESIRAJ });
    await rateLimit(request, "catalog-items", 900);
    const [items, uPripremi] = await Promise.all([catalogItems(getAdminClient(), kljucevi), preparationMode()]);
    return Response.json({ items: uPripremi ? items.map((item) => ({ ...item, price: 0 })) : items, updatedAt: new Date().toISOString() }, { headers: NE_KESIRAJ });
  } catch (error) {
    if (error instanceof HttpError) return apiError(error);
    return Response.json({ error: "Katalog trenutno nije dostupan." }, { status: 503, headers: NE_KESIRAJ });
  }
}

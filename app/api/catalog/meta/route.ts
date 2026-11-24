import { getAdminClient } from "@/lib/server/supabase";
import { catalogMeta } from "@/lib/server/catalog-search";
import { preparationMode } from "@/lib/server/shop-mode";
import { catalogTimings } from "@/lib/server/catalog-timing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Kategorije, vrste opreme i modeli telefona za navigaciju.
// Trenutno se citaju sveze zajedno sa rezimom pripreme, bez HTTP kesa.
export async function GET(request: Request) {
  const timings = catalogTimings();
  try {
    const navigation = request.headers.get("X-Catalog-View") === "navigation";
    const [meta, uPripremi] = await Promise.all([
      timings.measure("meta", () => catalogMeta(getAdminClient(), navigation)), timings.measure("mode", preparationMode),
    ]);
    // Navigacija koristi modele iz trenutnih faseta. Puni odgovor ostaje za ostale potrosace.
    return Response.json(
      { ...meta, ...(navigation ? { devices: [] } : {}), priceMax: uPripremi ? null : meta.priceMax, updatedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store", "Server-Timing": timings.header() } },
    );
  } catch (error) {
    timings.failure(error);
    return Response.json(
      { error: "Katalog trenutno nije dostupan." },
      { status: 503, headers: { "Cache-Control": "no-store", "Server-Timing": timings.header() } },
    );
  }
}

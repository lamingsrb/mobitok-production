import { apiError, parseBody, rateLimit } from "@/lib/server/http";
import { getAdminClient, HttpError, requireAdmin } from "@/lib/server/supabase";
import { getProcurementOverview, parseSupplierStatsFlag, procurementActionSchema, procurementError } from "@/lib/server/procurement";
import { publishSupplierCatalog } from "@/lib/server/catalog-publish";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const user = await requireAdmin(request);
    // Pregled nabavke cita katalog dobavljaca sa pomerajem do milion, pa i
    // prijavljen admin sme da ga zatrazi ogranicen broj puta.
    await rateLimit(request, "admin-procurement-read", 240, user.id);
    const url = new URL(request.url);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000000) throw new HttpError(400, "Stranica nabavke nije ispravna.");
    return Response.json(await getProcurementOverview(url.searchParams.get("supplier") ?? undefined, url.searchParams.get("catalogQuery") ?? "", offset, parseSupplierStatsFlag(url.searchParams.get("supplierStats"))), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAdmin(request);
    const body = await parseBody(request, procurementActionSchema);
    await rateLimit(request, "admin-procurement", 120, user.id);
    const admin = getAdminClient();
    const { data, error } = body.action === "update_procurement"
      ? await admin.rpc("admin_update_procurement", {
          p_actor_id: user.id, p_id: body.id, p_version: body.version, p_status: body.status,
          p_supplier_reference: body.supplierReference ?? null, p_note: body.note ?? null,
          p_items: body.items ?? null,
        })
      : await admin.rpc("admin_update_supplier_settings", {
          p_actor_id: user.id, p_supplier: body.supplier,
          p_settings: {
            priceCurrency: body.priceCurrency, priceIncludesVat: body.priceIncludesVat, priceField: body.priceField,
            catalogEnabled: body.catalogEnabled, stockMaxAgeHours: body.stockMaxAgeHours,
            safetyStock: body.safetyStock, leadTimeDays: body.leadTimeDays, priority: body.priority,
          },
        });
    if (error) procurementError(error.message);
    let result = data;
    if (body.action === "update_supplier_settings") {
      try {
        const publication = await publishSupplierCatalog(admin, body.supplier,{deadline:Date.now()+240_000});
        const pending=["sync_required","in_progress","busy","capacity"].includes(publication.reason??"");
        result = { ...data, publication, catalogPublishRequired: pending,
          ...(pending?{warning:publication.reason==="sync_required"?"Podešavanja su sačuvana. Pre objave je potrebno osvežavanje izvora.":"Podešavanja su sačuvana. Objava kataloga nastavlja se automatski u manjim delovima."}:{}) };
      } catch {
        result = { ...data, catalogPublishRequired: true, warning: "Podešavanja su sačuvana, ali osvežavanje kataloga nije završeno. Ponovite sinhronizaciju dobavljača." };
      }
    }
    return Response.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

import { apiError, rateLimit } from "@/lib/server/http";
import { getAdminClient, requireAdmin } from "@/lib/server/supabase";
import { readCatalogUpdatesStatus } from "@/lib/server/catalog-update-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await requireAdmin(request);
    await rateLimit(request, "admin-catalog-updates", 240, user.id);
    return Response.json(await readCatalogUpdatesStatus(getAdminClient(), user.id),
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

import { apiError, parseBody, rateLimit } from "@/lib/server/http";
import { getAdminClient, HttpError, requireAdmin } from "@/lib/server/supabase";
import { assertSourceOrigin, readSourceSettings, saveSourceSettings, supplierSourcePatchSchema, supplierSourceQuerySchema } from "@/lib/server/supplier-source-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    const user = await requireAdmin(request);
    await rateLimit(request, "admin-supplier-sources-read", 240, user.id);
    const parsed = supplierSourceQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new HttpError(400, "Izaberite postojećeg dobavljača.");
    return Response.json({ settings: await readSourceSettings(getAdminClient(), parsed.data.supplier) }, { headers });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAdmin(request);
    assertSourceOrigin(request);
    await rateLimit(request, "admin-supplier-sources-write", 60, user.id);
    const input = await parseBody(request, supplierSourcePatchSchema, 16000);
    return Response.json(await saveSourceSettings(getAdminClient(), user.id, input), { headers });
  } catch (error) { return apiError(error); }
}

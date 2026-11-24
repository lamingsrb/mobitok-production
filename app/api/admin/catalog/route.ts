import { revalidatePath } from "next/cache";
import { parseBody, rateLimit } from "@/lib/server/http";
import { getAdminClient, requireAdmin } from "@/lib/server/supabase";
import {
  assertSameOrigin,
  CATALOG_RATE_LIMITS,
  catalogActionSchema,
  catalogError,
  parseCatalogQuery,
  rateScopeFor,
  readCatalogView,
  runCatalogAction,
} from "@/lib/server/catalog-admin";

// Admin 03.11: alat "Katalog" u admin centru (DESIGN 7). Jedna ruta: GET prikazi, POST radnje.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// Admin 03.11: posle izmene osvezi stranice prodavnice (DESIGN 5.2); greska kesa ne obara odgovor.
function revalidateCatalog(): void {
  try {
    revalidatePath("/[...slug]", "page");
    revalidatePath("/sitemap.xml");
  } catch (error) {
    console.error("Admin catalog: revalidatePath", error);
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireAdmin(request);
    await rateLimit(request, "admin-catalog-read", CATALOG_RATE_LIMITS["admin-catalog-read"], user.id);
    const query = parseCatalogQuery(new URL(request.url).searchParams);
    const view = await readCatalogView(getAdminClient(), user.id, query);
    return Response.json(view, { headers: NO_STORE });
  } catch (error) {
    return catalogError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    assertSameOrigin(request.headers);
    const action = await parseBody(request, catalogActionSchema, 65_536);
    const scope = rateScopeFor(action);
    await rateLimit(request, scope, CATALOG_RATE_LIMITS[scope], user.id);
    const result = await runCatalogAction(getAdminClient(), user.id, action, revalidateCatalog);
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    return catalogError(error);
  }
}

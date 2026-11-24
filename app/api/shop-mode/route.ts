import { apiError } from "@/lib/server/http";
import { preparationMode } from "@/lib/server/shop-mode";
import { catalogPublicRevision } from "@/lib/server/catalog-revision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [mode, catalogRevision] = await Promise.all([preparationMode(), catalogPublicRevision()]);
    return Response.json(
      { preparationMode: mode, catalogRevision },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

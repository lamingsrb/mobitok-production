import { getAdminClient } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const version = {
  release: "2026-11-26.3",
  commit: process.env.APP_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
};

export async function GET() {
  try {
    const { error } = await getAdminClient()
      .from("products")
      .select("id", { head: true })
      .limit(1);
    if (error) throw new Error("Unavailable");
    return Response.json(
      { status: "ok", mode: "live", database: "connected", ...version },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable", mode: "live", ...version },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

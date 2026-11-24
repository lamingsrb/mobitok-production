// All automatic triggers share one DB-time gated daily cycle. Existing work recovers
// at any hour; a new scheduled cycle starts only at 03:00–06:59 Europe/Belgrade.
import { timingSafeEqual } from "node:crypto";
import { apiError, rateLimit } from "@/lib/server/http";
import { HttpError, requireAdmin } from "@/lib/server/supabase";
import { probeSupplier } from "@/lib/server/supplier-sync";
import { runCatalogUpdateWorker } from "@/lib/server/catalog-nightly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const sameSecret = (given: string, expected: string) => {
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};
const authorize = async (request: Request) => {
  const secrets = [process.env.CRON_SECRET, process.env.SUPPLIER_SYNC_TOKEN].filter((value): value is string => Boolean(value));
  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Bearer ") && secrets.some((secret) => sameSecret(header.slice(7), secret)))
    return { kind: "cron" as const, actor: null };
  if (!header) throw new HttpError(401, "Ova operacija zahteva prijavu.");
  const user = await requireAdmin(request);
  await rateLimit(request, "supplier-sync", 20, user.id);
  return { kind: "admin" as const, actor: user.id };
};
const safeSupplier = (value: string | null) => value && /^[a-z0-9_-]{1,40}$/.test(value) ? value : null;

const handle = async (request: Request) => {
  try {
    const auth = await authorize(request);
    const params = new URL(request.url).searchParams;
    const probe = safeSupplier(params.get("probe"));
    if (probe) return Response.json({ triggeredBy: auth.kind, mode: "probe", ...(await probeSupplier(probe)) }, { headers: { "Cache-Control": "no-store" } });
    if (auth.kind === "admin" && request.method !== "POST") throw new HttpError(405, "Ručno ažuriranje pokrenite dugmetom u admin centru.");
    const supplier = safeSupplier(params.get("supplier"));
    if (params.has("supplier") && !supplier) throw new HttpError(400, "Dobavljač nije ispravno izabran.");
    // rotate/stale/supplier query flags can never bypass the automatic window.
    const result = await runCatalogUpdateWorker({ actor: auth.actor, supplier: auth.kind === "admin" ? supplier : null });
    const failed = result.reports.filter((item) => item.status === "failed").length;
    const ok = result.reports.filter((item) => item.status === "ok").length;
    const terminalFailure = result.batch?.status === "failed" || result.batch?.status === "partial";
    return Response.json({ triggeredBy: auth.kind, mode: "nightly", ...result, ok, failed, rebuild: "Katalog se objavljuje direktno; nastavak prati trajan noćni ciklus." }, { status: terminalFailure ? 502 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
};
export const GET = handle;
export const POST = handle;

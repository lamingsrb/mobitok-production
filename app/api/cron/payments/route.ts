import { timingSafeEqual } from "node:crypto";
import { apiError } from "@/lib/server/http";
import { getAdminClient, HttpError, requireAdmin } from "@/lib/server/supabase";
import { processPaymentNotifications } from "@/lib/server/payment-notifications";
import { paymentHeaders } from "@/lib/server/payments";
export const runtime = "nodejs";
export const maxDuration = 60;
const equal = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
async function handle(request: Request) {
  try {
    const expected = process.env.CRON_SECRET;
    const given = request.headers.get("authorization") ?? "";
    if (!expected || !equal(given, `Bearer ${expected}`)) {
      if (request.method !== "POST") throw new HttpError(401, "Pristup nije dozvoljen.");
      await requireAdmin(request);
    }
    const { data: expired, error } = await getAdminClient(AbortSignal.timeout(12_000)).rpc("expire_checkout_payments", { p_limit: 50 });
    if (error) throw new HttpError(503, "Obrada plaćanja trenutno nije dostupna.");
    const notifications = await processPaymentNotifications();
    return Response.json({ expired, notifications }, { headers: paymentHeaders });
  } catch (error) { return apiError(error); }
}
export const GET = handle;
export const POST = handle;

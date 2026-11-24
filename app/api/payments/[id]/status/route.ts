import { apiError } from "@/lib/server/http";
import { getAdminClient, HttpError } from "@/lib/server/supabase";
import { ownedPaymentAttempt, paymentHeaders, paymentStatusSnapshot, restoreOwnerPaymentCookie } from "@/lib/server/payments";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    let row = await ownedPaymentAttempt(request, id);
    if (row.status === "pending" && Date.parse(row.expires_at) <= Date.now()) {
      const { error } = await getAdminClient(AbortSignal.timeout(8000)).rpc("expire_checkout_payments", { p_limit: 50 });
      if (error) throw new HttpError(503, "Provera plaćanja trenutno nije dostupna. Ne ponavljajte uplatu.");
      row = await ownedPaymentAttempt(request, id);
    }
    const response = Response.json(await paymentStatusSnapshot(row), { headers: paymentHeaders });
    restoreOwnerPaymentCookie(request, response, row);
    return response;
  } catch (error) { return apiError(error); }
}

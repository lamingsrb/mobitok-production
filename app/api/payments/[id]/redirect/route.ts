import { apiError } from "@/lib/server/http";
import { assertPaymentOrderOpen, ownedPaymentAttempt, paymentFormResponse } from "@/lib/server/payments";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const row = await ownedPaymentAttempt(request, (await context.params).id); await assertPaymentOrderOpen(row); return paymentFormResponse(row); }
  catch (error) { return apiError(error); }
}

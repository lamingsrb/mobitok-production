import { apiError } from "@/lib/server/http";
import { checkoutPaymentMethods, paymentHeaders } from "@/lib/server/payments";
export const runtime = "nodejs";
export async function GET() {
  try { return Response.json({ methods: await checkoutPaymentMethods() }, { headers: paymentHeaders }); }
  catch (error) { return apiError(error); }
}

import { z } from "zod";
import { apiError, parseBody, rateLimit } from "@/lib/server/http";
import { getAdminClient, HttpError, requireAdmin } from "@/lib/server/supabase";
import { normalizeBankAccount, paymentHeaders, readPaymentSettings } from "@/lib/server/payments";
import { buildBankTransferQrPayload } from "@/lib/server/bank-transfer-qr";
import { loadPaymentAccessSecret } from "@/lib/server/payment-config";
export const runtime = "nodejs";
const settingsSchema = z.object({ cardEnabled: z.boolean(), ipsQrEnabled: z.boolean(), bankAccount: z.string().trim().max(40).nullable() }).strict();
async function snapshot() {
  const [state, orders] = await Promise.all([
    readPaymentSettings(),
    getAdminClient(AbortSignal.timeout(8000)).from("orders")
      .select("id,reference,payment_method,payment_status,payable_total")
      .eq("demo", false).neq("payment_method", "cod")
      .in("payment_status", ["pending", "expired", "authorized", "review_required", "paid", "refund_pending"])
      .order("created_at", { ascending: false }).limit(50),
  ]);
  if (orders.error) throw new HttpError(503, "Pregled uplata trenutno nije dostupan.");
  const operationsEligible = (orders.data ?? []).filter(order => order.payment_method === "card"
    ? ["authorized", "review_required", "paid", "refund_pending"].includes(order.payment_status)
    : order.payment_method === "ips_qr" && ["pending", "expired", "review_required", "paid"].includes(order.payment_status))
    .map(order => ({ id: order.id, reference: order.reference, method: order.payment_method,
      paymentStatus: order.payment_status, payableTotal: order.payable_total === null ? null : Number(order.payable_total) }));
  return { ...state, operationsEligible,
    portalUrl: state.readiness.environment === "test" ? "https://ecg.test.upc.ua/rbrs/merchant/" : state.readiness.environment === "production" ? "https://ecommerce.raiffeisenbank.rs/rbrs/merchant/" : null };
}
export async function GET(request: Request) {
  try { await requireAdmin(request); return Response.json(await snapshot(), { headers: paymentHeaders }); }
  catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try {
    const user = await requireAdmin(request);
    const body = await parseBody(request, settingsSchema, 2048);
    await rateLimit(request, "payment-settings", 30, user.id);
    const state = await readPaymentSettings();
    const bankAccount = normalizeBankAccount(body.bankAccount);
    if (body.cardEnabled && !state.readiness.productionReady)
      throw new HttpError(409, "Banka još nije potvrdila produkciono kartično plaćanje.");
    if ((body.cardEnabled || body.ipsQrEnabled) && !state.deliveryConfigured)
      throw new HttpError(409, "Prvo unesite konačnu cenu dostave u podešavanjima prodavnice.");
    if (body.ipsQrEnabled) {
      try {
        loadPaymentAccessSecret();
        if (!state.recipientAddress) throw new Error();
        buildBankTransferQrPayload({ accountNumber: bankAccount ?? "", recipientName: state.recipientName ?? "", amountMinor: 1, reference: "MH-SETUP" });
      } catch { throw new HttpError(409, "Najpre unesite ispravan poslovni račun, naziv i adresu firme. Pristup plaćanju mora biti podešen na serveru."); }
    }
    const { error } = await getAdminClient(AbortSignal.timeout(8000)).from("payment_settings")
      .update({ card_enabled: body.cardEnabled, ips_qr_enabled: body.ipsQrEnabled, bank_account: bankAccount,
        updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", true);
    if (error) throw new HttpError(503, "Podešavanje plaćanja nije sačuvano.");
    return Response.json(await snapshot(), { headers: paymentHeaders });
  } catch (error) { return apiError(error); }
}

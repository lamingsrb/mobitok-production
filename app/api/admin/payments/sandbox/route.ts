import { createHash } from "node:crypto";
import { z } from "zod";
import { apiError, parseBody, rateLimit } from "@/lib/server/http";
import { getAdminClient, HttpError, requireAdmin } from "@/lib/server/supabase";
import { loadRaiffeisenConfig, paymentReadiness } from "@/lib/server/payment-config";
import { capabilityForCheckout, newPaymentNonce, paymentDatabaseError, paymentHeaders, setPaymentCookie } from "@/lib/server/payments";
export const runtime = "nodejs";
const sandboxSchema = z.object({ idempotencyKey: z.uuid(), amountMinor: z.number().int().min(1).max(100_000), testMode: z.literal(true) }).strict();
export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const body = await parseBody(request, sandboxSchema, 2048);
    await rateLimit(request, "payment-sandbox", 12, user.id);
    if (!paymentReadiness().sandboxReady) throw new HttpError(409, "Test je dostupan nakon što procesor potvrdi registraciju javnog sertifikata.");
    const config = loadRaiffeisenConfig();
    if (config.environment !== "test") throw new HttpError(409, "Probno plaćanje nije dostupno u produkcionom okruženju.");
    const requestHash = createHash("sha256").update(JSON.stringify({ actor: user.id, amountMinor: body.amountMinor, testMode: true })).digest("hex");
    const capability = capabilityForCheckout(body.idempotencyKey, requestHash, config);
    const { data, error } = await getAdminClient(AbortSignal.timeout(12_000)).rpc("prepare_checkout_sandbox", {
      p_actor_id: user.id, p_request_key: body.idempotencyKey, p_request_hash: requestHash,
      p_amount_minor: body.amountMinor, p_token_hash: capability.tokenHash,
      p_nonce: newPaymentNonce(capability!.token), p_merchant_id: config.merchantId,
      p_terminal_id: config.terminalId, p_test_mode: true,
    });
    if (error) paymentDatabaseError(error.message);
    if (!data?.attempt?.id) throw new HttpError(503, "Probno plaćanje trenutno nije dostupno.");
    const response = Response.json({ attemptId: data.attempt.id, payment: {
      method: "card", status: data.attempt.status, payableTotal: Number(data.attempt.amountMinor) / 100,
      currency: "RSD", continueUrl: `/placanje/${data.attempt.id}?nastavi=1`,
    } }, { status: data.idempotent ? 200 : 201, headers: paymentHeaders });
    setPaymentCookie(response, data.attempt.id, capability.token);
    return response;
  } catch (error) { return apiError(error); }
}

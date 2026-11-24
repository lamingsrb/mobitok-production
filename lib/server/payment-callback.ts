import { loadRaiffeisenVerificationConfig } from "./payment-config";
import { getAdminClient, HttpError } from "./supabase";
import { expectedRaiffeisenAttempt, paymentEventDigest, type PaymentAttemptRow } from "./payments";
import { createRaiffeisenNotifyResponse, parseRaiffeisenNotification, raiffeisenNotificationSignatureData, verifyRaiffeisenNotification } from "./raiffeisen-protocol";

/** Browser success URLs are never accepted here; only the signed bank notification changes state. */
export async function applyRaiffeisenNotification(body: Uint8Array, contentType: string): Promise<string> {
  const message = parseRaiffeisenNotification(body, contentType);
  const db = getAdminClient(AbortSignal.timeout(12_000));
  const { data: attempt, error: lookupError } = await db.from("payment_attempts").select("*")
    .eq("nonce", message.SD).eq("gateway_order_id", message.OrderID)
    .eq("merchant_id", message.MerchantID).eq("terminal_id", message.TerminalID).maybeSingle();
  if (lookupError) throw new HttpError(503, "Payment service unavailable");
  if (!attempt) throw new HttpError(400, "Invalid notification");
  const row = attempt as PaymentAttemptRow;
  const config = loadRaiffeisenVerificationConfig(row.environment);
  if (row.merchant_id !== config.merchantId || row.terminal_id !== config.terminalId) throw new HttpError(503, "Payment verification unavailable");
  const verified = verifyRaiffeisenNotification(message, expectedRaiffeisenAttempt(row), config.gatewayCertificatePem);
  const signedData = raiffeisenNotificationSignatureData(message);
  const { data: applied, error } = await db.rpc("apply_card_payment_notification", {
    p_attempt_id: row.id, p_nonce: row.nonce,
    p_event_key: paymentEventDigest(signedData),
    p_outcome: verified.status === "authorized" ? "authorized" : "failed",
    p_amount_minor: verified.amountMinor, p_currency: "RSD",
    p_gateway_order_id: verified.orderId, p_merchant_id: verified.merchantId,
    p_terminal_id: verified.terminalId, p_provider_reference: verified.xid,
    p_response_digest: paymentEventDigest(signedData + "\n" + message.Signature),
    p_bank_status_code: verified.tranCode, p_approval_code: verified.approvalCode || null,
  });
  // Never acknowledge success on a timeout or failed commit. The gateway must retry.
  if (error || !applied || typeof applied.reversalRequired !== "boolean")
    throw new HttpError(503, "Payment confirmation unavailable");
  return createRaiffeisenNotifyResponse(verified, applied.reversalRequired ? "reverse" : "approve",
    applied.reversalRequired ? "Order no longer payable" : "ok");
}

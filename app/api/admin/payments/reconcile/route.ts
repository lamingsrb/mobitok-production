import { z } from "zod";
import { after } from "next/server";
import { apiError, parseBody, rateLimit } from "@/lib/server/http";
import { getAdminClient, HttpError, requireAdmin } from "@/lib/server/supabase";
import { paymentHeaders } from "@/lib/server/payments";
import { mejlPodesen, posalji } from "@/lib/server/mail";
import { paymentOperationReceipt } from "@/lib/server/payment-operation-mail";
export const runtime = "nodejs";
const schema = z.object({ orderId: z.uuid(), operation: z.enum(["captured", "voided", "refunded", "received"]),
  reference: z.string().trim().min(1).max(128).refine(v => !/[\r\n]/.test(v)),
  amountMinor: z.number().int().positive().max(999_999_999_999), occurredAtISO: z.iso.datetime(),
  note: z.string().trim().min(3).max(1000), dispatched: z.boolean(), bankConfirmed: z.literal(true), idempotencyKey: z.uuid(),
}).strict();
export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const body = await parseBody(request, schema, 4096);
    await rateLimit(request, "payment-reconciliation", 30, user.id);
    if (Date.parse(body.occurredAtISO) > Date.now() + 60_000) throw new HttpError(400, "Vreme bankarske operacije ne može biti u budućnosti.");
    if (body.operation === "captured" && !body.dispatched) throw new HttpError(400, "Naplata se evidentira tek nakon slanja robe i potvrde u banci.");
    const db = getAdminClient(AbortSignal.timeout(12_000));
    const orderKind = await db.from("orders").select("payment_method").eq("id", body.orderId).single();
    if (orderKind.error || !orderKind.data) throw new HttpError(404, "Porudžbina nije pronađena.");
    const transfer = orderKind.data.payment_method === "ips_qr";
    if (transfer ? !["received", "refunded"].includes(body.operation) : orderKind.data.payment_method !== "card" || body.operation === "received")
      throw new HttpError(409, "Ova bankarska operacija ne odgovara načinu plaćanja porudžbine.");
    const common = { p_actor_id: user.id, p_order_id: body.orderId, p_reference: body.reference,
      p_amount_minor: body.amountMinor, p_occurred_at: body.occurredAtISO, p_note: body.note,
      p_bank_confirmed: true, p_request_key: body.idempotencyKey };
    const { data, error } = transfer
      ? await db.rpc(body.operation === "received" ? "record_bank_transfer_receipt" : "record_bank_transfer_refund", common)
      : await db.rpc("record_card_portal_operation", { ...common, p_operation: body.operation, p_dispatched: body.dispatched });
    if (error) {
      const conflicts: Record<string, string> = {
        PAYMENT_ALREADY_RECORDED: "Bankarska operacija je već evidentirana. Osvežite pregled.",
        PAYMENT_IDEMPOTENCY_CONFLICT: "Podaci potvrde su promenjeni. Osvežite prikaz pre novog evidentiranja.",
        PAYMENT_CONTEXT_MISMATCH: "Iznos ili vreme potvrde ne odgovaraju ovoj porudžbini. Proverite bankarski izvod.",
        PAYMENT_OPERATION_STATE: "Ova operacija nije dostupna za trenutno stanje plaćanja.",
        PAYMENT_ACTIVE_PROCUREMENT: "Najpre razrešite aktivne nabavke ove porudžbine.",
        PAYMENT_INVALID_INPUT: "Proverite potvrdu banke, vreme, iznos i obavezne podatke.",
      };
      for (const [code, message] of Object.entries(conflicts)) if (error.message.includes(code)) throw new HttpError(409, message);
      throw new HttpError(503, "Bankarska potvrda nije evidentirana. Proverite status pre ponovnog unosa.");
    }
    if (!data?.idempotent && mejlPodesen()) {
      after(async () => {
        try {
          const admin = getAdminClient(AbortSignal.timeout(8000));
          const [order, settings] = await Promise.all([
            admin.from("orders").select("reference,customer,payment_status,payable_total").eq("id", body.orderId).single(),
            admin.from("shop_settings").select("contact_email").eq("id", true).single(),
          ]);
          if (order.error || !order.data?.customer?.email) throw new Error();
          const result = await posalji({ to: String(order.data.customer.email), replyTo: settings.data?.contact_email || undefined,
            ...paymentOperationReceipt({ reference: order.data.reference, fullName: String(order.data.customer.fullName ?? ""),
              amount: body.amountMinor / 100, operation: body.operation, method: transfer ? "ips_qr" : "card", reviewRequired: order.data.payment_status === "review_required" }),
          }, { idempotencyKey: `payment-operation/${body.idempotencyKey}` });
          if (!result.sent) console.error("payment_operation_receipt_failed");
        } catch { console.error("payment_operation_receipt_failed"); }
      });
    }
    return Response.json({ result: data }, { headers: paymentHeaders });
  } catch (error) { return apiError(error); }
}

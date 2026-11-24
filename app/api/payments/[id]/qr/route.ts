import { apiError } from "@/lib/server/http";
import { HttpError } from "@/lib/server/supabase";
import { assertPaymentOrderOpen, ownedPaymentAttempt, paymentHeaders } from "@/lib/server/payments";
import { renderBankTransferQr } from "@/lib/server/bank-transfer-qr";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const row = await ownedPaymentAttempt(request, (await context.params).id);
    if (row.kind !== "bank_transfer" || row.status !== "pending" || Date.parse(row.expires_at) <= Date.now())
      throw new HttpError(409, "Ovaj nalog za uplatu više nije dostupan. Proverite status porudžbine pre plaćanja.");
    await assertPaymentOrderOpen(row);
    const { dataUrl } = await renderBankTransferQr({ accountNumber: row.account_snapshot,
      recipientName: row.recipient_name, recipientAddress: row.recipient_address,
      amountMinor: Number(row.amount_minor), reference: row.reference });
    return new Response(Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64"), {
      headers: { ...paymentHeaders, "Content-Type": "image/png", "Content-Disposition": `inline; filename="MOBITOK-uplata-${row.id}.png"`, "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" },
    });
  } catch (error) { return apiError(error); }
}

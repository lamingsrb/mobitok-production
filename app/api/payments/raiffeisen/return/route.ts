import { readPaymentBody } from "@/lib/server/payment-body";
import { publicPaymentOrigin } from "@/lib/server/payment-config";
import { paymentHeaders, paymentIdValid } from "@/lib/server/payments";
import { getAdminClient } from "@/lib/server/supabase";
export const runtime = "nodejs";
async function handle(request: Request) {
  let destination = "/placanje/provera";
  try {
    let params: URLSearchParams;
    if (request.method === "POST") {
      if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) throw new Error();
      params = new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(await readPaymentBody(request)));
    } else {
      if (request.url.length > 8192) throw new Error();
      params = new URL(request.url).searchParams;
    }
    const single = (name: string) => params.getAll(name).length === 1 ? params.get(name) : null;
    const order = single("OrderID"), merchant = single("MerchantID"), terminal = single("TerminalID"), nonce = single("SD");
    if (!order || !/^[A-Za-z0-9._~-]{1,20}$/.test(order) || !merchant || !/^[A-Za-z0-9]{1,15}$/.test(merchant) || !terminal || !/^[A-Za-z0-9]{8}$/.test(terminal)) throw new Error();
    let lookup = getAdminClient(AbortSignal.timeout(8000)).from("payment_attempts").select("id")
      .eq("gateway_order_id", order).eq("merchant_id", merchant).eq("terminal_id", terminal);
    if (nonce) { if (!paymentIdValid(nonce)) throw new Error(); lookup = lookup.eq("nonce", nonce); }
    const { data, error } = await lookup.maybeSingle();
    if (!error && data && paymentIdValid(data.id)) destination = `/placanje/${data.id}`;
    // The browser's result is routing metadata only. It cannot set payment/order state,
    // mint an access cookie or expose an order. The status page still checks ownership.
  } catch { /* A safe recovery page handles malformed or delayed bank returns. */ }
  return new Response(null, { status: 303, headers: { ...paymentHeaders, Location: publicPaymentOrigin() + destination } });
}
export const GET = handle;
export const POST = handle;

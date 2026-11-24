import { after } from "next/server";
import { readPaymentBody } from "@/lib/server/payment-body";
import { applyRaiffeisenNotification } from "@/lib/server/payment-callback";
import { paymentHeaders } from "@/lib/server/payments";
import { HttpError } from "@/lib/server/supabase";
import { RaiffeisenProtocolError } from "@/lib/server/raiffeisen-protocol";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const result = await applyRaiffeisenNotification(await readPaymentBody(request), request.headers.get("content-type") ?? "");
    after(async () => {
      try {
        const { processPaymentNotifications } = await import("@/lib/server/payment-notifications");
        await processPaymentNotifications();
      } catch { console.error("payment_notification_worker_failed"); }
    });
    return new Response(result, { headers: { ...paymentHeaders, "Content-Type": "text/plain; charset=utf-8" } });
  } catch (error) {
    const status = error instanceof RaiffeisenProtocolError ? 400 : error instanceof HttpError ? error.status : 503;
    return new Response(status >= 500 ? "Notification unavailable" : "Invalid notification", {
      status, headers: { ...paymentHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

import { createHash } from "node:crypto";
import { after } from "next/server";
import { apiError, parseBody, rateLimit } from "@/lib/server/http";
import {
  mejlPodesen,
  novaPorudzbina,
  posalji,
  potvrdaPorudzbine,
} from "@/lib/server/mail";
import {
  getAdminClient,
  getRequestUser,
  HttpError,
} from "@/lib/server/supabase";
import { orderSchema } from "@/lib/server/validation";
import { loadPaymentAccessSecret, loadRaiffeisenConfig } from "@/lib/server/payment-config";
import { capabilityForCheckout, checkoutPaymentMethods, newPaymentNonce, PAYMENT_TERMS_VERSION, paymentDatabaseError, setPaymentCookie } from "@/lib/server/payments";
import type { CheckoutPayment } from "@/lib/payment-types";
import { preparationMode } from "@/lib/server/shop-mode";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getRequestUser(request);
    const { data, error } = await getAdminClient()
      .from("orders")
      .select(
        "id,reference,total,subtotal,discount_percent,currency,status,demo,created_at,payment_method,payment_status,delivery_fee_snapshot,payable_total,payment_confirmation_source,order_items(product_id,name,quantity,unit_price,line_total)",
      )
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new HttpError(503, "Porudžbine trenutno nisu dostupne.");
    return Response.json(
      { orders: data ?? [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseBody(request, orderSchema);
    const user = await getRequestUser(request, false);
    await rateLimit(request, "orders", 8, user?.id);
    const items = [...body.items].sort((a, b) =>
      a.productId.localeCompare(b.productId),
    );
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          customer: body.customer,
          items,
          userId: user?.id ?? null,
          ...(body.paymentMethod !== "cod" || body.termsAccepted ? { paymentMethod: body.paymentMethod, termsVersion: body.termsAccepted ? PAYMENT_TERMS_VERSION : null } : {}),
        }),
      )
      .digest("hex");
    const online = body.paymentMethod !== "cod";
    if (online && !body.termsAccepted) throw new HttpError(400, "Potvrdite da prihvatate uslove kupovine.");
    // Recover only an exact, previously accepted request before checking current admission settings.
    // This lets a lost response recover its HttpOnly capability even after checkout is paused.
    const db = getAdminClient(AbortSignal.timeout(8000));
    const prior = await db.from("orders").select("id,request_hash,user_id,payment_method")
      .eq("request_key", body.idempotencyKey).maybeSingle();
    if (prior.error) throw new HttpError(503, "Provera porudžbine trenutno nije dostupna. Ne ponavljajte uplatu.");
    const existing = prior.data;
    if (existing && (existing.request_hash !== requestHash || existing.user_id !== (user?.id ?? null) || existing.payment_method !== body.paymentMethod))
      throw new HttpError(409, "Korpa ili način plaćanja su promenjeni. Proverite prethodnu porudžbinu.");
    if (!existing) {
      if (await preparationMode()) throw new HttpError(409, "Prodavnica je u pripremi. Poručivanje još nije dostupno.");
      if (online && !(await checkoutPaymentMethods()).some(method => method.id === body.paymentMethod && method.available))
        throw new HttpError(409, "Izabrani način plaćanja trenutno nije dostupan.");
    }
    const capability = online ? capabilityForCheckout(body.idempotencyKey, requestHash, { accessSecret: loadPaymentAccessSecret() }) : null;
    let merchantId: string | null = null, terminalId: string | null = null;
    if (body.paymentMethod === "card") {
      if (existing) {
        const saved = await db.from("payment_attempts").select("merchant_id,terminal_id").eq("order_id", existing.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (saved.error || !saved.data) throw new HttpError(503, "Potvrda plaćanja trenutno nije dostupna.");
        merchantId = saved.data.merchant_id; terminalId = saved.data.terminal_id;
      } else {
        const config = loadRaiffeisenConfig(); merchantId = config.merchantId; terminalId = config.terminalId;
      }
    }
    const { data, error } = await getAdminClient(AbortSignal.timeout(15_000)).rpc("prepare_checkout_order", {
      p_request_key: body.idempotencyKey,
      p_request_hash: requestHash,
      p_customer: body.customer,
      p_items: items,
      p_user_id: user?.id ?? null,
      p_payment_method: body.paymentMethod,
      p_token_hash: capability?.tokenHash ?? null,
      p_nonce: capability ? newPaymentNonce(capability.token) : null,
      p_merchant_id: merchantId,
      p_terminal_id: terminalId,
      p_terms_version: body.termsAccepted ? PAYMENT_TERMS_VERSION : null,
    });
    if (error) {
      if (body.paymentMethod === "ips_qr" && error.message.includes("PAYMENT_INVALID_AMOUNT")) throw new HttpError(400, "QR uplata podržava iznose do 300.000 RSD. Izaberite drugi dostupan način plaćanja.");
      paymentDatabaseError(error.message);
    }
    if (!data?.reference || (online && !data.attempt?.id))
      throw new HttpError(503, "Potvrda porudžbine trenutno nije dostupna. Proverite status pre novog pokušaja.");
    const payment: CheckoutPayment = {
      method: body.paymentMethod, status: data.paymentStatus,
      payableTotal: data.payableTotal === null ? null : Number(data.payableTotal), currency: "RSD",
      ...(online ? { continueUrl: `/placanje/${data.attempt.id}?nastavi=1` } : {}),
    };
    const paymentMail = { method: payment.method, status: payment.status,
      payableTotal: payment.payableTotal, deliveryFee: data.deliveryFeeSnapshot === null ? null : Number(data.deliveryFeeSnapshot) };
    // Posle odgovora idu dva mejla: potvrda kupcu i obavestenje prodavnici na
    // kontakt adresu iz podesavanja. Odgovor na potvrdu stize prodavnici, a
    // odgovor na obavestenje kupcu. Cekanje na mejl ne usporava potvrdu
    // porudzbine, ponovljen (idempotentan) zahtev ne salje nove mejlove, a
    // neuspeh slanja se belezi u log i ne obara vec sacuvanu porudzbinu.
    // Mejlovi idu jedan za drugim, da dva istovremena zahteva ne udare u
    // Resend ogranicenje broja zahteva u sekundi.
    if (!data.idempotent && mejlPodesen()) {
      const referenca = String(data.reference);
      const kupac = body.customer;
      const iznos = Number(data.total);
      const zbir = Number(data.subtotal);
      const popust = Number(data.discountPercent ?? 0);
      const valuta = String(data.currency);
      const prijavljen = Boolean(user);
      after(async () => {
        try {
          const admin = getAdminClient();
          const [{ data: red }, { data: podesavanja, error: greskaPodesavanja }] =
            await Promise.all([
              admin
                .from("orders")
                .select("order_items(name,quantity,line_total)")
                .eq("reference", referenca)
                .maybeSingle(),
              admin
                .from("shop_settings")
                .select("contact_email,company_name,company_address,delivery_fee,delivery_free_over,delivery_time,preparation_mode")
                .eq("id", true)
                .maybeSingle(),
            ]);
          if (greskaPodesavanja)
            console.error("Kontakt prodavnice nije procitan", { referenca });
          const stavke = red?.order_items ?? [];
          const kontakt =
            String(podesavanja?.contact_email ?? "").trim() || undefined;
          // Cena i prag dostave po istom pravilu kao /api/pricing: u pripremi
          // se ne navode, pa mejl ne obecava vise od sajta.
          const broj = (v: unknown) =>
            podesavanja?.preparation_mode || v === null || v === undefined || v === "" ? null : Number(v);
          const potvrda = await posalji({
            to: kupac.email,
            replyTo: kontakt,
            ...potvrdaPorudzbine({
              reference: referenca,
              placanje: paymentMail,
              total: iznos,
              currency: valuta,
              fullName: kupac.fullName,
              items: stavke,
              kontakt,
              prodavac: {
                naziv: String(podesavanja?.company_name ?? "").trim() || undefined,
                adresa: String(podesavanja?.company_address ?? "").trim() || undefined,
              },
              dostava: {
                cena: broj(podesavanja?.delivery_fee),
                besplatnaOd: broj(podesavanja?.delivery_free_over),
                rok: String(podesavanja?.delivery_time ?? "").trim() || undefined,
              },
            }),
          });
          if (!potvrda.sent)
            console.error("Potvrda porudzbine nije poslata", {
              referenca,
              razlog: potvrda.reason,
            });
          if (!kontakt) return;
          const sajt = (
            process.env.NEXT_PUBLIC_SITE_URL || "https://mobitok.rs"
          ).replace(/\/+$/, "");
          const obavestenje = await posalji({
            to: kontakt,
            replyTo: kupac.email,
            ...novaPorudzbina({
              reference: referenca,
              placanje: paymentMail,
              subtotal: zbir,
              discountPercent: popust,
              total: iznos,
              currency: valuta,
              prijavljen,
              kupac,
              items: stavke,
              adminUrl: `${sajt}/admin`,
            }),
          });
          if (!obavestenje.sent)
            console.error("Obavestenje prodavnici nije poslato", {
              referenca,
              razlog: obavestenje.reason,
            });
        } catch (greska) {
          console.error("Mejlovi porudzbine nisu poslati", {
            referenca,
            razlog: greska instanceof Error ? greska.name : "greska",
          });
        }
      });
    }
    const response = Response.json({
      reference: data.reference, total: data.total, subtotal: data.subtotal,
      discountPercent: data.discountPercent, currency: data.currency, demo: data.demo,
      idempotent: data.idempotent, payment,
      deliveryFeeSnapshot: data.deliveryFeeSnapshot, payableTotal: data.payableTotal,
    }, {
      status: data.idempotent ? 200 : 201,
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
    if (capability) setPaymentCookie(response, data.attempt.id, capability.token);
    return response;
  } catch (error) {
    return apiError(error);
  }
}

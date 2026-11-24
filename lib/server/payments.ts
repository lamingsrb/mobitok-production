import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PaymentMethodOption, PaymentStatusSnapshot } from "../payment-types";
import { getAdminClient, getRequestUser, HttpError } from "./supabase";
import { buildBankTransferQrPayload, isValidBankTransferAccount } from "./bank-transfer-qr";
import { checkoutCapability, loadPaymentAccessSecret, loadRaiffeisenConfig, paymentCookieName, paymentReadiness, paymentTokenHash, type RaiffeisenConfig } from "./payment-config";
import { createRaiffeisenPaymentForm, type RaiffeisenExpectedAttempt } from "./raiffeisen-protocol";

export const PAYMENT_TERMS_VERSION = "2026-11-19";
export const paymentHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
export const paymentIdValid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export type PaymentAttemptRow = {
  kind?: "card"; request_key?: string; request_hash?: string; id: string; order_id: string | null; owner_id: string | null; token_hash: string; nonce: string;
  gateway_order_id: string; merchant_id: string; terminal_id: string; amount_minor: number | string;
  currency: string; purchase_time: string; expires_at: string; status: PaymentStatusSnapshot["status"];
  environment: "test" | "production"; test_mode: boolean; provider_reference: string | null;
  response_digest: string | null; reversal_required: boolean; bank_status_code?: string | null;
};
export function paymentDatabaseError(message: string): never {
  const errors: Record<string, [number, string]> = {
    IDEMPOTENCY_CONFLICT: [409, "Korpa ili način plaćanja su promenjeni. Proverite porudžbinu i pokušajte ponovo."],
    SHOP_IN_PREPARATION: [409, "Prodavnica je u pripremi. Poručivanje još nije dostupno."],
    SHIPPING_NOT_CONFIGURED: [409, "Cena dostave još nije potvrđena. Izaberite plaćanje pouzećem."],
    METHOD_UNAVAILABLE: [409, "Izabrani način plaćanja trenutno nije dostupan."],
    PAYMENT_METHOD_UNAVAILABLE: [409, "Izabrani način plaćanja trenutno nije dostupan."],
    BANK_ACCOUNT_NOT_CONFIGURED: [409, "Poslovni račun za QR uplatu još nije potvrđen."],
    BANK_RECIPIENT_NOT_CONFIGURED: [409, "Podaci primaoca QR uplate još nisu potvrđeni."],
    PAYMENT_REFERENCE_INVALID: [409, "Nalog za uplatu trenutno nije moguće pripremiti."],
    TERMS_REQUIRED: [400, "Potvrdite da prihvatate uslove kupovine."],
    INVALID_CART: [400, "Neki artikli više nisu dostupni. Osvežite korpu."],
    STALE_SUPPLIER_STOCK: [409, "Proveravamo aktuelnu dostupnost artikala. Pokušajte ponovo kasnije."],
    STOCK_UNAVAILABLE: [409, "Tražena količina više nije dostupna. Osvežite korpu."],
    SUPPLIER_NOT_READY: [409, "Dostupnost jednog artikla još nije potvrđena. Osvežite korpu."],
    PAYMENT_REVERSAL_REQUIRED: [409, "Najpre proverite rezervaciju ili povraćaj sredstava u banci. Plaćena porudžbina se ne otkazuje kao pouzeće."],
    PAYMENT_NOT_AUTHORIZED: [409, "Sačekajte potvrđenu rezervaciju sredstava pre nastavka nabavke."],
    PAYMENT_CAPTURE_REQUIRED: [409, "Najpre potvrdite konačnu naplatu u banci."],
    PAYMENT_REQUIRED: [409, "Sačekajte potvrđenu rezervaciju sredstava pre nastavka nabavke."],
  };
  for (const [code, [status, text]] of Object.entries(errors)) if (message.includes(code)) throw new HttpError(status, text);
  throw new HttpError(503, "Plaćanje trenutno nije dostupno. Proverite status pre novog pokušaja.");
}

export type BankTransferRow = {
  kind: "bank_transfer"; request_key?: string; request_hash?: string; id: string; order_id: string; owner_id: string | null; token_hash: string;
  account_snapshot: string; recipient_name: string; recipient_address: string; purpose: string; reference: string;
  amount_minor: number | string; currency: string; expires_at: string; status: PaymentStatusSnapshot["status"];
};
export type OwnedPayment = PaymentAttemptRow | BankTransferRow;
export function normalizeBankAccount(value: string | null): string | null {
  const raw = (value ?? "").trim().replace(/\s/g, "");
  if (!raw) return null;
  const parts = /^(\d{3})-(\d{1,13})-(\d{2})$/.exec(raw);
  const normalized = parts ? parts[1] + parts[2].padStart(13, "0") + parts[3] : raw;
  if (!isValidBankTransferAccount(normalized)) throw new HttpError(400, "Unesite ispravan poslovni račun sa kontrolnim brojem.");
  return normalized;
}
export async function readPaymentSettings() {
  const db = getAdminClient(AbortSignal.timeout(8000));
  const [flags, shipping] = await Promise.all([
    db.from("payment_settings").select("card_enabled,ips_qr_enabled,bank_account").eq("id", true).maybeSingle(),
    db.from("shop_settings").select("delivery_fee,company_name,company_short_name,company_address").eq("id", true).maybeSingle(),
  ]);
  if (flags.error || shipping.error || !flags.data || !shipping.data) throw new HttpError(503, "Podešavanja plaćanja trenutno nisu dostupna.");
  const readiness = paymentReadiness();
  const deliveryConfigured = shipping.data.delivery_fee !== null && Number.isFinite(Number(shipping.data.delivery_fee));
  const fullName = String(shipping.data.company_name ?? "").trim();
  const recipientName = Array.from(fullName).length <= 70 && fullName ? fullName : String(shipping.data.company_short_name ?? "").trim();
  const recipientAddress = String(shipping.data.company_address ?? "").trim();
  let qrConfigured = false;
  try {
    loadPaymentAccessSecret();
    buildBankTransferQrPayload({ accountNumber: flags.data.bank_account, recipientName, amountMinor: 1, reference: "MH-SETUP" });
    qrConfigured = Boolean(recipientAddress);
  } catch { /* Missing account, recipient or access configuration never becomes a payable QR. */ }
  const cardAvailable = flags.data.card_enabled === true && readiness.productionReady && deliveryConfigured;
  const qrAvailable = flags.data.ips_qr_enabled === true && qrConfigured && deliveryConfigured;
  const methods: PaymentMethodOption[] = [
    { id: "cod", label: "Pouzećem", description: "Plaćanje prilikom preuzimanja pošiljke.", available: true },
    { id: "card", label: "Karticom", description: "Sredstva se rezervišu na sigurnoj stranici banke, a naplata potvrđuje nakon slanja robe.", available: cardAvailable,
      ...(!cardAvailable ? { unavailableReason: readiness.productionReady && !deliveryConfigured ? "Cena dostave još nije potvrđena." : "Kartično plaćanje uskoro." } : {}) },
    { id: "ips_qr", label: "QR uplata na račun", description: "Skeniraj nalog za uplatu. Porudžbinu potvrđujemo po proveri priliva.", available: qrAvailable,
      ...(!qrAvailable ? { unavailableReason: "QR uplata biće dostupna nakon potvrde poslovnog računa i dostave." } : {}) },
  ];
  return { settings: { cardEnabled: flags.data.card_enabled === true, ipsQrEnabled: flags.data.ips_qr_enabled === true, bankAccount: flags.data.bank_account ?? null },
    readiness, deliveryConfigured, qrConfigured, recipientName: recipientName || null, recipientAddress: recipientAddress || null, methods };
}
export async function checkoutPaymentMethods(): Promise<PaymentMethodOption[]> { return (await readPaymentSettings()).methods; }

export function capabilityForCheckout(requestKey: string, requestHash: string, config: Pick<RaiffeisenConfig, "accessSecret">) {
  const token = checkoutCapability(requestKey, requestHash, config.accessSecret);
  return { token, tokenHash: paymentTokenHash(token) };
}
export function setPaymentCookie(response: Response, attemptId: string, token: string): void {
  paymentTokenHash(token);
  const secure = process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development" ? "" : "; Secure";
  response.headers.append("Set-Cookie", `${paymentCookieName(attemptId)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1209600${secure}`);
}
function readCapability(request: Request, id: string): string | null {
  const name = paymentCookieName(id);
  const matches = (request.headers.get("cookie") ?? "").split(";").map(part => part.trim()).filter(part => part.startsWith(name + "="));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(name.length + 1);
  return /^[0-9a-f]{64}$/.test(token) ? token : null;
}
export async function ownedPaymentAttempt(request: Request, id: string): Promise<OwnedPayment> {
  if (!paymentIdValid(id)) throw new HttpError(404, "Plaćanje nije pronađeno.");
  const token = readCapability(request, id);
  const user = token ? null : await getRequestUser(request, false);
  if (!token && !user) throw new HttpError(404, "Otvorite plaćanje iz iste korpe ili se prijavite na svoj nalog.");
  let query = getAdminClient(AbortSignal.timeout(8000)).from("payment_attempts").select("*").eq("id", id);
  if (token) query = query.eq("token_hash", paymentTokenHash(token));
  else query = query.eq("owner_id", user!.id);
  const { data, error } = await query.maybeSingle();
  if (error) throw new HttpError(503, "Status plaćanja trenutno nije dostupan. Ne ponavljajte uplatu pre provere.");
  if (data) return { ...data, kind: "card" } as PaymentAttemptRow;
  let transferQuery = getAdminClient(AbortSignal.timeout(8000)).from("bank_transfer_payments").select("*").eq("id", id);
  if (token) transferQuery = transferQuery.eq("token_hash", paymentTokenHash(token));
  else transferQuery = transferQuery.eq("owner_id", user!.id);
  const transfer = await transferQuery.maybeSingle();
  if (transfer.error) throw new HttpError(503, "Status uplate trenutno nije dostupan.");
  if (!transfer.data) throw new HttpError(404, "Plaćanje nije pronađeno.");
  return { ...transfer.data, kind: "bank_transfer" } as BankTransferRow;
}
export function gatewayPurchaseTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new HttpError(503, "Podaci plaćanja nisu dostupni.");
  return date.toISOString().slice(2, 19).replace(/[-:T]/g, "");
}
export function expectedRaiffeisenAttempt(row: PaymentAttemptRow): RaiffeisenExpectedAttempt {
  if (row.currency !== "RSD" || !paymentIdValid(row.nonce)) throw new HttpError(503, "Podaci plaćanja nisu dostupni.");
  return { merchantId: row.merchant_id, terminalId: row.terminal_id, orderId: row.gateway_order_id,
    purchaseTime: gatewayPurchaseTime(row.purchase_time), amountMinor: Number(row.amount_minor), sessionData: row.nonce };
}
export function matchingPaymentConfig(row: PaymentAttemptRow): RaiffeisenConfig {
  const config = loadRaiffeisenConfig();
  if (row.environment !== config.environment || row.merchant_id !== config.merchantId || row.terminal_id !== config.terminalId ||
      row.test_mode !== (config.environment === "test")) throw new HttpError(503, "Ovo plaćanje trenutno nije moguće nastaviti.");
  return config;
}
export async function paymentStatusSnapshot(row: OwnedPayment): Promise<PaymentStatusSnapshot> {
  let reference: string | undefined;
  let orderCancelled = false;
  let confirmationSource: "bank_notification" | "admin_portal" | "admin_bank_statement" | undefined;
  if (row.order_id) {
    const { data, error } = await getAdminClient(AbortSignal.timeout(8000)).from("orders").select("reference,payment_confirmation_source,status,payment_status").eq("id", row.order_id).maybeSingle();
    if (error) throw new HttpError(503, "Status porudžbine trenutno nije dostupan.");
    reference = data?.reference;
    orderCancelled = data?.status === "cancelled";
    confirmationSource = data?.payment_confirmation_source ?? undefined;
  }
  const expired = row.status === "pending" && Date.parse(row.expires_at) <= Date.now();
  const effectiveStatus = row.status === "pending" && orderCancelled ? "cancelled" : expired ? "expired" : row.status;
  if (row.kind === "bank_transfer") {
    return { reference, confirmationSource, method: "ips_qr", status: effectiveStatus, payableTotal: Number(row.amount_minor) / 100,
      currency: "RSD", testMode: false, canRetry: false,
      bankTransfer: { recipientName: row.recipient_name, recipientAddress: row.recipient_address,
        accountNumber: row.account_snapshot, reference: row.reference, purpose: row.purpose, expiresAt: row.expires_at,
        ...(effectiveStatus === "pending" ? { qrUrl: `/api/payments/${row.id}/qr` } : {}) } };
  }
  const stillPending = effectiveStatus === "pending";
  const ready = paymentReadiness();
  const mayContinue = stillPending && (row.test_mode ? ready.sandboxReady : ready.productionReady);
  return { reference, confirmationSource, method: "card", status: effectiveStatus, payableTotal: Number(row.amount_minor) / 100,
    currency: "RSD", testMode: row.test_mode, canRetry: false,
    ...(mayContinue ? { continueUrl: `/api/payments/${row.id}/redirect` } : {}) };
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function paymentFormResponse(row: OwnedPayment): Response {
  if (row.kind === "bank_transfer") throw new HttpError(409, "Ova porudžbina koristi QR nalog za uplatu.");
  const config = matchingPaymentConfig(row);
  if (!config.certificateRegistered || (!row.test_mode && !config.productionApproved)) throw new HttpError(503, "Kartično plaćanje još nije aktivirano.");
  if (row.status !== "pending" || Date.parse(row.expires_at) <= Date.now()) throw new HttpError(409, "Proverite trenutni status ovog plaćanja.");
  const fields = createRaiffeisenPaymentForm(expectedRaiffeisenAttempt(row), config.privateKeyPem);
  const nonce = randomBytes(20).toString("base64url");
  const body = `<!doctype html><html lang="sr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sigurno plaćanje · MOBITOK</title><style nonce="${nonce}">body{margin:0;min-height:100svh;display:grid;place-items:center;background:#f7f5fa;color:#392849;font:16px system-ui,sans-serif}.card{max-width:440px;margin:24px;padding:40px;border:1px solid #ddd2e9;border-radius:24px;background:white;box-shadow:0 18px 70px #3928490e}h1{font-size:28px;line-height:1.2}p{line-height:1.6}button{border:0;border-radius:14px;background:#463157;color:white;padding:16px 22px;font:inherit;cursor:pointer}.note{color:#70647d;font-size:14px}</style></head><body><main class="card"><p>MOBITOK${row.test_mode ? " · TESTNO PLAĆANJE" : ""}</p><h1>Prelazimo na sigurnu stranicu banke</h1><p>Podatke kartice unosite isključivo kod banke. MOBITOK ih ne prima niti čuva.</p><form id="bank-payment" action="${escapeHtml(config.gatewayUrl)}" method="post">${Object.entries(fields).map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`).join("")}<button type="submit">Nastavi na banku</button></form><p class="note">Sredstva se rezervišu. Naplata se potvrđuje nakon slanja robe.</p></main><script nonce="${nonce}">document.getElementById('bank-payment').submit();</script></body></html>`;
  return new Response(body, { headers: { ...paymentHeaders, "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; form-action ${new URL(config.gatewayUrl).origin}; base-uri 'none'; frame-ancestors 'none'` } });
}
export const paymentEventDigest = (value: string) => createHash("sha256").update(value).digest("hex");
export function newPaymentNonce(token?: string): string {
  if (!token) return randomUUID();
  paymentTokenHash(token);
  const bytes = createHash("sha256").update("mobitok-nonce-v1:" + token).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** After owner authentication, restore image/download access on another device without exposing the bearer token. */
export function restoreOwnerPaymentCookie(request: Request, response: Response, row: OwnedPayment): void {
  if (readCapability(request, row.id) || !request.headers.get("authorization") || !row.owner_id || !row.request_key || !row.request_hash) return;
  const token = checkoutCapability(row.request_key, row.request_hash, loadPaymentAccessSecret());
  if (paymentTokenHash(token) !== row.token_hash) throw new HttpError(503, "Pristup ovoj uplati zahteva proveru. Obratite se podršci.");
  setPaymentCookie(response, row.id, token);
}

export async function assertPaymentOrderOpen(row: OwnedPayment): Promise<void> {
  if (row.status !== "pending" || Date.parse(row.expires_at) <= Date.now()) throw new HttpError(409, "Ovaj pokušaj plaćanja više nije dostupan. Proverite status.");
  if (!row.order_id) { if (row.kind !== "bank_transfer" && row.test_mode) return; throw new HttpError(409, "Porudžbina nije dostupna."); }
  const { data, error } = await getAdminClient(AbortSignal.timeout(8000)).from("orders").select("status,payment_status").eq("id", row.order_id).single();
  if (error) throw new HttpError(503, "Provera porudžbine trenutno nije dostupna.");
  if (!data || !["received", "reviewing"].includes(data.status) || data.payment_status !== "pending")
    throw new HttpError(409, "Porudžbina više ne čeka plaćanje. Proverite njen status pre uplate.");
}

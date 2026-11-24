"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, Clock3, CreditCard, Download, LoaderCircle, QrCode, RefreshCw, ShieldCheck } from "lucide-react";
import { requestWithDeadline } from "@/lib/request-deadline";
import { getClient } from "@/lib/supabase-browser";
import type { Language } from "@/lib/i18n";
import type { BankTransferInstructions, PaymentMethod, PaymentStatus, PaymentStatusSnapshot } from "@/lib/payment-types";
import "./payment-return-panel.css";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTEMPT_KEY = "mobitok-checkout-attempt-v1";
export type CheckoutAttempt = {
  key: string;
  signatureHash: string;
  paymentMethod: PaymentMethod;
  cart: { productId: string; quantity: number }[];
  continueUrl?: string;
  reference?: string;
};

export function safePaymentPagePath(value: unknown, origin: string): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value, origin);
    const id = url.pathname.split("/")[2];
    if (url.origin !== origin || url.username || url.password || url.hash || !/^\/placanje\/[^/]+$/.test(url.pathname) || !UUID.test(id)) return null;
    const keys = [...url.searchParams.keys()];
    if (keys.length && (keys.length !== 1 || keys[0] !== "nastavi" || url.searchParams.get("nastavi") !== "1")) return null;
    return url.pathname + url.search;
  } catch { return null; }
}
function bankTransitionPath(value: unknown, paymentId: string): string | null {
  if (typeof value !== "string" || !UUID.test(paymentId)) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin && !url.username && !url.password && !url.search && !url.hash
      && url.pathname.toLowerCase() === `/api/payments/${paymentId.toLowerCase()}/redirect` ? url.pathname : null;
  } catch { return null; }
}
function qrImagePath(value: unknown, paymentId: string): string | null {
  if (typeof value !== "string" || !UUID.test(paymentId)) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin && !url.username && !url.password && !url.search && !url.hash
      && url.pathname.toLowerCase() === `/api/payments/${paymentId.toLowerCase()}/qr` ? url.pathname : null;
  } catch { return null; }
}
export function readCheckoutAttempt(): CheckoutAttempt | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) || "null");
    if (!value || !UUID.test(value.key) || !/^[0-9a-f]{64}$/i.test(value.signatureHash)
      || !["cod", "card", "ips_qr"].includes(value.paymentMethod) || !Array.isArray(value.cart)
      || value.cart.length > 50 || value.cart.some((line: { productId?: unknown; quantity?: unknown }) => !line
        || typeof line.productId !== "string" || !line.productId || line.productId.length > 100
        || !Number.isInteger(line.quantity) || Number(line.quantity) < 1 || Number(line.quantity) > 20)) return null;
    const continueUrl = safePaymentPagePath(value.continueUrl, window.location.origin);
    return { key: value.key, signatureHash: value.signatureHash, paymentMethod: value.paymentMethod,
      cart: value.cart.map((line: { productId: string; quantity: number }) => ({ productId: line.productId, quantity: line.quantity })),
      ...(continueUrl ? { continueUrl } : {}), ...(typeof value.reference === "string" ? { reference: value.reference.slice(0, 100) } : {}) };
  } catch { return null; }
}
export function saveCheckoutAttempt(attempt: CheckoutAttempt): void {
  try { sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt)); } catch { /* The in-memory resume link remains available. */ }
}
export function clearCheckoutAttempt(key: string): void {
  try { if (readCheckoutAttempt()?.key === key) sessionStorage.removeItem(ATTEMPT_KEY); } catch {}
}

const labels: Record<Language, Record<PaymentStatus, [string, string]>> = {
  sr: {
    unpaid: ["Plaćanje čeka potvrdu", "Porudžbina je sačuvana. Plaćanje još nije potvrđeno."],
    pending: ["Tvoja porudžbina je sačuvana.", "Plaćanje još čeka potvrdu banke. Ako ga nisi završio, možeš da nastaviš na stranici banke."],
    authorized: ["Sredstva su rezervisana.", "Banka je potvrdila rezervaciju sredstava. Naplata sledi nakon slanja porudžbine."],
    paid: ["Plaćanje je potvrđeno.", "Uplata za ovu porudžbinu je potvrđena."],
    failed: ["Plaćanje nije uspelo.", "Artikle možeš da vratiš u korpu i ponovo proveriš cene i dostupnost pre nove porudžbine."],
    cancelled: ["Plaćanje je otkazano.", "Za novi pokušaj vrati artikle u korpu i proveri aktuelne cene i dostupnost."],
    expired: ["Vreme za plaćanje je isteklo.", "Za novu porudžbinu vrati artikle u korpu i proveri njihovu trenutnu dostupnost."],
    review_required: ["Potrebna je provera uplate.", "Plaćanje još ne možemo da potvrdimo. Sačuvaj broj porudžbine i obrati nam se preko Podrške."],
    refund_pending: ["Povraćaj je u obradi.", "Status će biti ažuriran kada banka potvrdi obradu povraćaja."],
    refunded: ["Povraćaj je potvrđen.", "Banka je potvrdila povraćaj za ovu porudžbinu."],
  },
  en: {
    unpaid: ["Payment awaits confirmation", "Your order is saved. Payment has not been confirmed yet."],
    pending: ["Your order is saved.", "Payment is awaiting confirmation from the bank. You can continue on the bank’s page if you have not finished."],
    authorized: ["Funds have been reserved.", "The bank confirmed the reservation. You are charged after your order is dispatched."],
    paid: ["Payment confirmed.", "Payment for this order has been confirmed."],
    failed: ["Payment was unsuccessful.", "Restore your items to the cart and review current prices and availability before placing a new order."],
    cancelled: ["Payment was cancelled.", "For a new attempt, restore your items and review their current prices and availability."],
    expired: ["The payment session expired.", "Restore your items and review their current availability before placing a new order."],
    review_required: ["Payment needs a review.", "We cannot confirm payment yet. Keep your order reference and contact Support."],
    refund_pending: ["Your refund is being processed.", "The status will update when the bank confirms the refund."],
    refunded: ["Refund confirmed.", "The bank confirmed a refund for this order."],
  },
};

function parseSnapshot(value: unknown): PaymentStatusSnapshot {
  if (!value || typeof value !== "object") throw new Error("invalid_payment_status");
  const row = value as Record<string, unknown>;
  if (typeof row.status !== "string" || !Object.prototype.hasOwnProperty.call(labels.sr, row.status)
    || !["cod", "card", "ips_qr"].includes(String(row.method)) || row.currency !== "RSD"
    || typeof row.testMode !== "boolean" || typeof row.canRetry !== "boolean"
    || (row.payableTotal !== null && (typeof row.payableTotal !== "number" || !Number.isFinite(row.payableTotal) || row.payableTotal < 0))) {
    throw new Error("invalid_payment_status");
  }
  let bankTransfer: BankTransferInstructions | undefined;
  if (row.bankTransfer !== undefined) {
    const transfer = row.bankTransfer as Partial<BankTransferInstructions> | null;
    if (!transfer || row.method !== "ips_qr" || typeof transfer.recipientName !== "string" || !transfer.recipientName.trim() || transfer.recipientName.length > 300
      || !(transfer.recipientAddress === null || typeof transfer.recipientAddress === "string")
      || typeof transfer.accountNumber !== "string" || !/^\d{18}$/.test(transfer.accountNumber)
      || typeof transfer.reference !== "string" || !transfer.reference.trim() || transfer.reference.length > 128
      || typeof transfer.purpose !== "string" || !transfer.purpose.trim() || transfer.purpose.length > 300
      || typeof row.payableTotal !== "number" || row.payableTotal <= 0
      || typeof transfer.expiresAt !== "string" || !Number.isFinite(Date.parse(transfer.expiresAt))
      || (transfer.qrUrl !== undefined && typeof transfer.qrUrl !== "string")) throw new Error("invalid_bank_transfer");
    bankTransfer = transfer as BankTransferInstructions;
  }
  return { method: row.method as PaymentMethod, status: row.status as PaymentStatus, currency: "RSD",
    payableTotal: row.payableTotal as number | null, testMode: row.testMode, canRetry: row.canRetry,
    ...(typeof row.reference === "string" ? { reference: row.reference.slice(0, 100) } : {}),
    ...(typeof row.continueUrl === "string" ? { continueUrl: row.continueUrl } : {}),
    ...(typeof row.confirmationSource === "string" ? { confirmationSource: row.confirmationSource } : {}),
    ...(bankTransfer ? { bankTransfer } : {}) };
}

export default function PaymentReturnPanel({ paymentId, autoStart = false, language }: {
  paymentId: string; autoStart?: boolean; language?: Language;
}) {
  const [localLanguage, setLocalLanguage] = useState<Language>("sr");
  const locale = language || localLanguage;
  const en = locale === "en";
  const [snapshot, setSnapshot] = useState<{ id: string; value: PaymentStatusSnapshot } | null>(null);
  const current = snapshot?.id === paymentId ? snapshot.value : null;
  const [refresh, setRefresh] = useState(0);
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState("");
  const [pollingStopped, setPollingStopped] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [recoverable, setRecoverable] = useState(false);
  const [qrFailed, setQrFailed] = useState(false);
  const autoStarted = useRef<string | null>(null);
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try { const stored = localStorage.getItem("phonex-language"); if (stored === "sr" || stored === "en") setLocalLanguage(stored); } catch {}
    const attempt = readCheckoutAttempt();
    setRecoverable(Boolean(attempt?.cart.length && attempt.continueUrl?.split("?")[0].toLowerCase() === `/placanje/${paymentId.toLowerCase()}`));
    return () => { if (navigationTimer.current) clearTimeout(navigationTimer.current); };
  }, [paymentId]);

  function navigate(path: string) {
    setNavigating(true);
    try { sessionStorage.setItem(`mobitok-payment-autostart:${paymentId}`, "started"); } catch {}
    if (navigationTimer.current) clearTimeout(navigationTimer.current);
    navigationTimer.current = setTimeout(() => setNavigating(false), 4000);
    try { window.location.assign(path); }
    catch { setNavigating(false); setError(en ? "The bank page did not open. Use the continue button to try again." : "Stranica banke nije otvorena. Pokušaj ponovo preko dugmeta za nastavak."); }
  }

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let inFlight = false;
    let resumeRequested = false;
    let latest: PaymentStatusSnapshot | null = null;
    const until = Date.now() + 120000;
    setError("");
    setPollingStopped(false);
    const unavailable = en ? "Payment status is temporarily unavailable. Refresh to check again." : "Status plaćanja trenutno nije dostupan. Osveži ga da proveriš ponovo.";
    async function read() {
      if (!active || document.hidden || inFlight) return;
      if (!UUID.test(paymentId)) { setError(unavailable); setRefreshing(false); return; }
      inFlight = true;
      setRefreshing(true);
      setPollingStopped(false);
      controller = new AbortController();
      let allowPoll = true;
      try {
        const value = await requestWithDeadline(async signal => {
          const session = await getClient()?.auth.getSession().catch(() => null);
          signal.throwIfAborted();
          const token = session?.data.session?.access_token;
          const response = await fetch(`/api/payments/${paymentId}/status`, { credentials: "same-origin", cache: "no-store", signal,
            headers: token ? { Authorization: `Bearer ${token}` } : {} });
          if (!response.ok) {
            if ([401, 403, 404].includes(response.status)) allowPoll = false;
            throw new Error("payment_status_unavailable");
          }
          return parseSnapshot(await response.json());
        }, { timeoutMs: 12000, signal: controller.signal });
        if (!active) return;
        latest = value;
        setSnapshot({ id: paymentId, value });
        setError("");
        if (["authorized", "paid", "refunded"].includes(value.status)) {
          const attempt = readCheckoutAttempt();
          if (attempt?.continueUrl?.split("?")[0].toLowerCase() === `/placanje/${paymentId.toLowerCase()}`) clearCheckoutAttempt(attempt.key);
        }
        if (autoStart && value.method === "card" && value.status === "pending" && autoStarted.current !== paymentId) {
          const path = bankTransitionPath(value.continueUrl, paymentId);
          let consumed = false;
          try { consumed = sessionStorage.getItem(`mobitok-payment-autostart:${paymentId}`) === "started"; } catch {}
          if (path && !consumed) { autoStarted.current = paymentId; navigate(path); }
        }
      } catch {
        if (active && !document.hidden) setError(unavailable);
      } finally {
        inFlight = false;
        controller = null;
        if (active) {
          setRefreshing(false);
          if (resumeRequested && !document.hidden && Date.now() < until) { resumeRequested = false; void read(); }
          else if (allowPoll && latest?.status === "pending" && !document.hidden && Date.now() < until) timer = setTimeout(() => void read(), 2500);
          else if (latest?.status === "pending" && !document.hidden) setPollingStopped(true);
        }
      }
    }
    const visible = () => {
      clearTimeout(timer);
      if (document.hidden) controller?.abort();
      else if ((!latest || latest.status === "pending") && Date.now() < until) { if (inFlight) resumeRequested = true; else void read(); }
      else if (latest?.status === "pending") setPollingStopped(true);
    };
    document.addEventListener("visibilitychange", visible);
    void read();
    return () => { active = false; clearTimeout(timer); controller?.abort(); document.removeEventListener("visibilitychange", visible); };
    // The query flag can start a bank transition only after an authenticated status read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentId, autoStart, refresh, en]);

  function restoreCart() {
    const attempt = readCheckoutAttempt();
    if (!attempt?.cart.length || attempt.continueUrl?.split("?")[0].toLowerCase() !== `/placanje/${paymentId.toLowerCase()}`) return;
    try {
      const saved = JSON.parse(localStorage.getItem("volt-store-v1") || "{}");
      const existing = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
      const cart = new Map<string, number>();
      for (const line of Array.isArray(existing.cart) ? existing.cart : []) {
        if (typeof line?.productId === "string" && line.productId.length > 0 && line.productId.length <= 100 && Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 20) cart.set(line.productId, line.quantity);
      }
      for (const line of attempt.cart) cart.set(line.productId, Math.max(cart.get(line.productId) || 0, line.quantity));
      if (cart.size > 50) { setError(en ? "Your cart can contain up to 50 different items. Make room before restoring these items." : "Korpa može da sadrži najviše 50 različitih artikala. Oslobodi mesto pre vraćanja ovih artikala."); return; }
      localStorage.setItem("volt-store-v1", JSON.stringify({ ...existing, cart: [...cart].map(([productId, quantity]) => ({ productId, quantity })) }));
      clearCheckoutAttempt(attempt.key);
      window.location.assign("/korpa");
    } catch { setError(en ? "Your browser could not restore the cart. Keep this page and contact Support with your order reference." : "Pregledač nije uspeo da vrati korpu. Sačuvaj ovu stranicu i javi se Podršci uz broj porudžbine."); }
  }

  const status = current?.status;
  const good = status && ["authorized", "paid", "refunded"].includes(status);
  const unsuccessful = status && ["failed", "cancelled", "expired"].includes(status);
  const Icon = !current ? LoaderCircle : good ? (status === "authorized" ? ShieldCheck : CheckCircle2) : unsuccessful || status === "review_required" ? CircleAlert : Clock3;
  const [title, description] = current ? labels[locale][current.status] : [en ? "Checking your payment…" : "Proveravamo tvoje plaćanje…", en ? "Please wait while we check the current status." : "Sačekaj trenutak dok proverimo trenutno stanje."];
  const continuation = current?.method === "card" && current.status === "pending" ? bankTransitionPath(current.continueUrl, paymentId) : null;
  const transfer = current?.method === "ips_qr" && current.status === "pending" ? current.bankTransfer : null;
  const qrUrl = transfer && Date.parse(transfer.expiresAt) > Date.now() ? qrImagePath(transfer.qrUrl, paymentId) : null;
  useEffect(() => { setQrFailed(false); }, [qrUrl, refresh]);
  const visibleTitle = current?.method === "ips_qr" && current.status === "pending"
    ? (en ? "Your payment order is ready." : "Tvoj nalog za uplatu je spreman.") : title;
  const visibleDescription = current?.method === "ips_qr" && current.status === "pending"
    ? (en ? "Scan the payment order in your banking app. We confirm your order after checking the incoming transfer on our bank statement." : "Skeniraj nalog u aplikaciji svoje banke. Porudžbinu potvrđujemo nakon provere priliva na bankarskom izvodu.")
    : current?.status === "pending" && !continuation
    ? (en ? "Your order is saved. We are waiting for the bank to confirm the payment status." : "Porudžbina je sačuvana. Čekamo potvrdu statusa plaćanja od banke.") : description;
  return <section className={`payment-return-panel${good ? " is-confirmed" : ""}`} aria-labelledby="payment-return-title">
    <div className="payment-return-mark" aria-hidden="true"><Icon size={32} strokeWidth={1.4} className={!current && refreshing ? "payment-return-spin" : ""} /></div>
    <span className="payment-return-eyebrow">{en ? "YOUR ORDER · PAYMENT" : "TVOJA PORUDŽBINA · PLAĆANJE"}</span>
    {current?.testMode && <span className="payment-return-test">{en ? "Bank test environment — no real charge" : "Test okruženje banke — bez stvarne naplate"}</span>}
    <div role="status" aria-live="polite" aria-atomic="true">
      <h1 id="payment-return-title">{error && !current ? (en ? "We cannot show the status yet." : "Status još ne možemo da prikažemo.") : visibleTitle}</h1>
      <p className="payment-return-description">{visibleDescription}</p>
    </div>
    {current && <dl className="payment-return-details">
      {current.reference && <div><dt>{en ? "Order reference" : "Broj porudžbine"}</dt><dd>{current.reference}</dd></div>}
      <div><dt>{en ? "Order amount" : "Iznos porudžbine"}</dt><dd>{current.payableTotal === null ? (en ? "Awaiting confirmation" : "Čeka potvrdu") : `${new Intl.NumberFormat(en ? "en-GB" : "sr-RS", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(current.payableTotal)} RSD`}</dd></div>
    </dl>}
    {transfer && <section className="payment-transfer" aria-label={en ? "Bank transfer payment order" : "Nalog za uplatu"}>
      <div className="payment-transfer-heading"><QrCode size={21} aria-hidden="true" /><div><span className="payment-transfer-format">NBS IPS QR</span><h2>{en ? "Payment order" : "Nalog za uplatu"}</h2><p>{en ? "We verify incoming transfers against our bank statement." : "Proveravamo priliv prema izvodu."}</p></div></div>
      <div className="payment-transfer-grid">
        {qrUrl && !qrFailed && <div className="payment-transfer-qr"><img src={qrUrl} width={260} height={260} onError={() => setQrFailed(true)} alt={en ? "QR code with the payment order details shown alongside it" : "QR kod sa podacima naloga za uplatu prikazanim pored"} /><a href={qrUrl} download={`MOBITOK-nalog-${paymentId}.png`}><Download size={15} aria-hidden="true" />{en ? "Save QR image" : "Sačuvaj QR sliku"}</a></div>}
        <dl className="payment-transfer-fields">
          <div><dt>{en ? "Recipient" : "Primalac"}</dt><dd>{transfer.recipientName}{transfer.recipientAddress && <small>{transfer.recipientAddress}</small>}</dd></div>
          <div><dt>{en ? "Account number" : "Račun primaoca"}</dt><dd>{transfer.accountNumber.replace(/^(\d{3})(\d{13})(\d{2})$/, "$1-$2-$3")}</dd></div>
          <div><dt>{en ? "Amount" : "Iznos"}</dt><dd>{current?.payableTotal === null ? "—" : `${new Intl.NumberFormat(en ? "en-GB" : "sr-RS", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(current!.payableTotal!)} RSD`}</dd></div>
          <div><dt>{en ? "Payment purpose" : "Svrha uplate"}</dt><dd>{transfer.purpose}</dd></div>
          <div><dt>{en ? "Model / reference" : "Model / poziv na broj"}</dt><dd>00 / {transfer.reference}</dd></div>
          <div><dt>{en ? "Payment deadline" : "Rok za uplatu"}</dt><dd>{new Date(transfer.expiresAt).toLocaleString(en ? "en-GB" : "sr-RS", { dateStyle: "medium", timeStyle: "short" })}</dd></div>
        </dl>
      </div>
      {(!qrUrl || qrFailed) && <p className="payment-return-help" role="status">{en ? "The QR code is not available. Refresh the status before making a transfer." : "QR kod trenutno nije dostupan. Osveži status pre uplate."}</p>}
      <p className="payment-return-help">{en ? "Scanning or saving this code does not confirm payment. Use the exact amount and reference shown. If you have already paid, keep the payment confirmation while we verify the incoming transfer." : "Skeniranje i čuvanje koda ne potvrđuje uplatu. Koristi prikazan tačan iznos i poziv na broj. Ako si već uplatio/la, sačuvaj potvrdu dok proveravamo priliv."}</p>
    </section>}
    {current?.confirmationSource === "admin_bank_statement" && <p className="payment-return-help">{en ? "Incoming transfer manually confirmed against the bank statement." : "Priliv je ručno potvrđen prema bankarskom izvodu."}</p>}
    {current?.confirmationSource === "admin_portal" && <p className="payment-return-help">{en ? "The bank operation was manually recorded by the store; it was not verified automatically." : "Prodavnica je ručno evidentirala potvrdu iz portala banke; operacija nije automatski proverena."}</p>}
    {error && <p className="payment-return-error" role="alert">{error}</p>}
    {pollingStopped && current?.status === "pending" && <p className="payment-return-help">{en ? "Automatic checking has paused. Refresh the status when you are ready." : "Automatska provera je zaustavljena. Osveži status kada želiš da proveriš ponovo."}</p>}
    <div className="payment-return-actions">
      {continuation && <button type="button" className="button button-dark" onClick={() => navigate(continuation)} disabled={navigating}>
        {navigating ? <LoaderCircle size={17} className="payment-return-spin" /> : <CreditCard size={17} />}
        {navigating ? (en ? "Opening the bank…" : "Otvaramo stranicu banke…") : (en ? "Continue to the bank" : "Nastavi na stranicu banke")}<ArrowRight size={17} />
      </button>}
      {unsuccessful && recoverable && <button type="button" className="button button-dark" onClick={restoreCart}><ArrowLeft size={17} />{en ? "Restore items to the cart" : "Vrati artikle u korpu"}</button>}
      <button type="button" className="button" onClick={() => setRefresh(value => value + 1)} disabled={refreshing}>
        <RefreshCw size={16} className={refreshing ? "payment-return-spin" : ""} />{en ? "Refresh status" : "Osveži status"}
      </button>
    </div>
    {unsuccessful && recoverable && <p className="payment-return-help">{en ? "Restoring the cart does not start a payment. Review current prices and stock before a new order." : "Vraćanje artikala ne pokreće plaćanje. Pre nove porudžbine proveri aktuelne cene i lager."}</p>}
    <nav className="payment-return-links" aria-label={en ? "Next steps" : "Sledeći koraci"}>
      <Link href="/katalog">{en ? "Browse the store" : "Nastavi istraživanje"}</Link>
      <Link href="/podrska">{en ? "Contact Support" : "Podrška za porudžbinu"}</Link>
    </nav>
  </section>;
}

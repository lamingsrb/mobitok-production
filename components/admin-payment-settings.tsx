"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, CreditCard, ExternalLink, FlaskConical, LoaderCircle, LockKeyhole, QrCode, RefreshCw, Truck } from "lucide-react";
import type { PaymentMethodOption, PaymentStatus } from "@/lib/payment-types";
import { safePaymentPagePath } from "./payment-return-panel";
import "./admin-payment-settings.css";

type Api = <T>(path: string, init?: RequestInit, timeoutMs?: number) => Promise<T>;
type EligibleOperation = {
  id: string;
  reference: string;
  method: "card" | "ips_qr";
  paymentStatus: PaymentStatus;
  payableTotal: number;
  providerReference?: string | null;
};
type BankOperation = "captured" | "voided" | "refunded" | "received";
type PaymentSetup = {
  settings: { cardEnabled: boolean; ipsQrEnabled: boolean; bankAccount: string | null };
  readiness: {
    environment: "disabled" | "test" | "production";
    configured: boolean;
    certificateRegistered: boolean;
    productionApproved: boolean;
    sandboxReady: boolean;
    productionReady: boolean;
  };
  deliveryConfigured: boolean;
  qrConfigured: boolean;
  recipientName: string | null;
  recipientAddress: string | null;
  portalUrl: string | null;
  methods: PaymentMethodOption[];
  operationsEligible: EligibleOperation[];
};
const SANDBOX_KEY = "mobitok-admin-sandbox-attempt-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseSetup(value: unknown): PaymentSetup {
  if (!value || typeof value !== "object") throw new Error("Podešavanja plaćanja trenutno nisu dostupna.");
  const row = value as PaymentSetup;
  if (!row.settings || typeof row.settings.cardEnabled !== "boolean" || typeof row.settings.ipsQrEnabled !== "boolean"
    || !(row.settings.bankAccount === null || typeof row.settings.bankAccount === "string")
    || !row.readiness || !["disabled", "test", "production"].includes(row.readiness.environment)
    || ["configured", "certificateRegistered", "productionApproved", "sandboxReady", "productionReady"].some(key =>
      typeof row.readiness[key as keyof PaymentSetup["readiness"]] !== "boolean")
    || typeof row.deliveryConfigured !== "boolean" || typeof row.qrConfigured !== "boolean"
    || !(row.recipientName === null || typeof row.recipientName === "string") || !(row.recipientAddress === null || typeof row.recipientAddress === "string")
    || !(row.portalUrl === null || typeof row.portalUrl === "string")
    || !Array.isArray(row.methods) || row.methods.some(method => !method || !["cod", "card", "ips_qr"].includes(method.id)
      || typeof method.label !== "string" || typeof method.description !== "string" || typeof method.available !== "boolean")
    || !Array.isArray(row.operationsEligible) || row.operationsEligible.length > 50 || row.operationsEligible.some(order =>
      !order || !UUID.test(order.id) || typeof order.reference !== "string" || !["card", "ips_qr"].includes(order.method)
      || !(order.method === "ips_qr" ? ["pending", "expired", "paid", "review_required"] : ["authorized", "review_required", "paid", "refund_pending"]).includes(order.paymentStatus)
      || typeof order.payableTotal !== "number" || !Number.isFinite(order.payableTotal) || order.payableTotal <= 0
      || (order.providerReference !== undefined && order.providerReference !== null && typeof order.providerReference !== "string"))) {
    throw new Error("Podešavanja plaćanja trenutno nisu dostupna. Pokušaj ponovo.");
  }
  return row;
}
function portalPath(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function minorAmount(value: string): number | null {
  const match = /^(\d{1,4})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  return amount >= 1 && amount <= 100000 ? amount : null;
}
function allowedOperations(status?: PaymentStatus, method?: "card" | "ips_qr"): BankOperation[] {
  if (method === "ips_qr") {
    if (status && ["pending", "expired"].includes(status)) return ["received"];
    if (status && ["paid", "review_required"].includes(status)) return ["refunded"];
    return [];
  }
  if (status === "authorized") return ["captured", "voided"];
  if (status === "review_required") return ["voided"];
  if (status === "paid" || status === "refund_pending") return ["refunded"];
  return [];
}
const operationNames: Record<BankOperation, string> = {
  captured: "Naplata potvrđena u banci",
  voided: "Rezervacija poništena u banci",
  refunded: "Povraćaj potvrđen u banci",
  received: "Priliv potvrđen na bankarskom izvodu",
};
const statusNames: Partial<Record<PaymentStatus, string>> = {
  authorized: "Sredstva rezervisana", review_required: "Potrebna provera", paid: "Plaćeno", refund_pending: "Povraćaj u obradi", pending: "Čeka proveru priliva", expired: "Rok istekao — proveri priliv",
};
function savedSandbox(): { idempotencyKey: string; amountMinor: number; continueUrl?: string } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(SANDBOX_KEY) || "null");
    if (!value || !UUID.test(value.idempotencyKey) || !Number.isInteger(value.amountMinor) || value.amountMinor < 1 || value.amountMinor > 100000) return null;
    const continueUrl = safePaymentPagePath(value.continueUrl, window.location.origin);
    return { idempotencyKey: value.idempotencyKey, amountMinor: value.amountMinor, ...(continueUrl ? { continueUrl } : {}) };
  } catch { return null; }
}

export default function AdminPaymentSettings({
  api,
  preparationMode,
  deliveryRevision = 0,
}: {
  api: Api;
  preparationMode: boolean;
  deliveryRevision?: number;
}) {
  const [setup, setSetup] = useState<PaymentSetup | null>(null);
  const [loading, setLoading] = useState(true);
  const [cardEnabled, setCardEnabled] = useState(false);
  const [qrEnabled, setQrEnabled] = useState(false);
  const [bankAccount, setBankAccount] = useState("");
  const [busy, setBusy] = useState<"save" | "sandbox" | "reconcile" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [testAmount, setTestAmount] = useState("100,00");
  const [resume, setResume] = useState<string | null>(null);
  const [orderId, setOrderId] = useState("");
  const [operation, setOperation] = useState<BankOperation | "">("");
  const [bankReference, setBankReference] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [operationNote, setOperationNote] = useState("");
  const [dispatched, setDispatched] = useState(false);
  const [bankConfirmed, setBankConfirmed] = useState(false);
  const reconcileAttempt = useRef<{ signature: string; key: string } | null>(null);
  const attempt = useRef<{ idempotencyKey: string; amountMinor: number } | null>(null);
  const mounted = useRef(false);
  const hasLoaded = useRef(false);
  const requestId = useRef(0);
  const previousDeliveryRevision = useRef(deliveryRevision);
  const load = useCallback(async (resetDraft = true) => {
    const request = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const value = parseSetup(await api("/api/admin/payments"));
      if (mounted.current && request === requestId.current) {
        setSetup(value);
        if (resetDraft || !hasLoaded.current) {
          setCardEnabled(value.settings.cardEnabled);
          setQrEnabled(value.settings.ipsQrEnabled);
          setBankAccount(value.settings.bankAccount || "");
        }
        hasLoaded.current = true;
      }
    } catch (err) {
      if (mounted.current && request === requestId.current)
        setError(err instanceof Error ? err.message : "Pregled plaćanja nije učitan.");
    } finally {
      if (mounted.current && request === requestId.current) setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    mounted.current = true;
    const saved = savedSandbox();
    if (saved) { attempt.current = saved; setResume(saved.continueUrl || null); }
    void load();
    return () => { mounted.current = false; };
  }, [load]);
  useEffect(() => {
    if (previousDeliveryRevision.current === deliveryRevision) return;
    previousDeliveryRevision.current = deliveryRevision;
    void load(false);
  }, [deliveryRevision, load]);
  const canEnable = Boolean(setup?.readiness.productionReady && setup.deliveryConfigured);
  const canEnableQr = Boolean(setup?.qrConfigured && setup.deliveryConfigured);
  const portal = portalPath(setup?.portalUrl || null);
  const selectedOrder = setup?.operationsEligible.find(order => order.id === orderId);
  const availableOperations = allowedOperations(selectedOrder?.paymentStatus, selectedOrder?.method);
  const settingsChanged = Boolean(setup && (cardEnabled !== setup.settings.cardEnabled || qrEnabled !== setup.settings.ipsQrEnabled || bankAccount.trim() !== (setup.settings.bankAccount || "")));

  function resetConfirmation() {
    setBankConfirmed(false); setDispatched(false); reconcileAttempt.current = null;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!setup || busy) return;
    if (cardEnabled && !canEnable) { setError("Za javno kartično plaćanje prvo moraju biti potvrđeni produkcioni pristup i cena dostave."); return; }
    if (qrEnabled && !canEnableQr) { setError("Prvo sačuvaj ispravan poslovni račun, naziv primaoca i cenu dostave, a zatim uključi QR uplatu."); return; }
    setBusy("save"); setError(""); setMessage("");
    try {
      const value = parseSetup(await api("/api/admin/payments", { method: "PATCH", body: JSON.stringify({ cardEnabled, ipsQrEnabled: qrEnabled, bankAccount: bankAccount.trim() || null }) }));
      if (mounted.current) {
        setSetup(value); setCardEnabled(value.settings.cardEnabled); setQrEnabled(value.settings.ipsQrEnabled); setBankAccount(value.settings.bankAccount || "");
        setMessage("Podešavanje je sačuvano. Dostupnost plaćanja zavisi od potvrđenih uslova i poznate dostave.");
      }
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "Podešavanje plaćanja nije sačuvano."); }
    finally { if (mounted.current) setBusy(null); }
  }
  async function startSandbox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!setup?.readiness.sandboxReady || busy) return;
    const amountMinor = minorAmount(testAmount);
    if (amountMinor === null) { setError("Unesi test iznos od 0,01 do 1.000,00 RSD, sa najviše dve decimale."); return; }
    if (!attempt.current || attempt.current.amountMinor !== amountMinor) attempt.current = { idempotencyKey: crypto.randomUUID(), amountMinor };
    try { sessionStorage.setItem(SANDBOX_KEY, JSON.stringify(attempt.current)); } catch {}
    setBusy("sandbox"); setError(""); setMessage("");
    try {
      const result = await api<{ attemptId: string; payment: { method: string; status: string; payableTotal: number; currency: string; continueUrl?: string } }>("/api/admin/payments/sandbox", {
        method: "POST", body: JSON.stringify({ idempotencyKey: attempt.current.idempotencyKey, amountMinor, testMode: true }),
      }, 25000);
      const path = safePaymentPagePath(result.payment?.continueUrl, window.location.origin);
      if (!UUID.test(result.attemptId) || result.payment?.method !== "card" || result.payment.status !== "pending"
        || result.payment.currency !== "RSD" || !Number.isFinite(result.payment.payableTotal) || Math.round(result.payment.payableTotal * 100) !== amountMinor
        || !path || path.split("?")[0].toLowerCase() !== `/placanje/${result.attemptId.toLowerCase()}`) {
        throw new Error("Nastavak test plaćanja nije potvrđen. Pokušaj ponovo sa istim iznosom.");
      }
      try { sessionStorage.setItem(SANDBOX_KEY, JSON.stringify({ ...attempt.current, continueUrl: path })); } catch {}
      if (!mounted.current) return;
      setResume(path);
      setMessage("Test pokušaj je sačuvan. Nastavak vodi isključivo na test okruženje banke.");
      try { window.location.assign(path); }
      catch { setError("Test stranica nije otvorena. Nastavi sačuvani test preko veze ispod."); }
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "Test pokušaj nije pokrenut."); }
    finally { if (mounted.current) setBusy(null); }
  }

  async function reconcile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !selectedOrder || !operation || !availableOperations.includes(operation)) return;
    const date = new Date(occurredAt);
    if (!bankConfirmed || (operation === "captured" && !dispatched) || !bankReference.trim() || operationNote.trim().length < 3
      || !Number.isFinite(date.getTime()) || date.getTime() > Date.now()) {
      setError("Popuni potvrdu banke, vreme koje nije u budućnosti i belešku od najmanje tri znaka. Za naplatu potvrdi i da je roba poslata."); return;
    }
    const body = {
      orderId: selectedOrder.id, operation, reference: bankReference.trim(),
      amountMinor: Math.round(selectedOrder.payableTotal * 100), occurredAtISO: date.toISOString(),
      note: operationNote.trim(), dispatched: operation === "captured" && dispatched, bankConfirmed: true,
    };
    const signature = JSON.stringify(body);
    if (reconcileAttempt.current?.signature !== signature) reconcileAttempt.current = { signature, key: crypto.randomUUID() };
    setBusy("reconcile"); setError(""); setMessage("");
    try {
      await api("/api/admin/payments/reconcile", { method: "POST", body: JSON.stringify({ ...body, idempotencyKey: reconcileAttempt.current.key }) }, 25000);
      if (!mounted.current) return;
      setMessage("Bankarska operacija je ručno evidentirana.");
      setOrderId(""); setOperation(""); setBankReference(""); setOccurredAt(""); setOperationNote(""); resetConfirmation();
      await load();
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "Bankarska potvrda nije evidentirana. Proveri stanje pre ponovnog pokušaja."); }
    finally { if (mounted.current) setBusy(null); }
  }

  return (
    <section className="panel account-admin-section admin-payment-settings" aria-labelledby="admin-payment-title">
      <header className="admin-payment-heading">
        <span className="admin-payment-heading-icon" aria-hidden="true"><CreditCard size={24} /></span>
        <div>
          <h2 id="admin-payment-title">Načini plaćanja</h2>
          <p>Podesi šta kupci mogu da izaberu pri poručivanju.</p>
        </div>
        <button
          type="button"
          className="admin-payment-refresh"
          aria-label="Osveži podešavanja plaćanja"
          onClick={() => void load()}
          disabled={loading || Boolean(busy)}
        >
          <RefreshCw size={18} className={loading ? "account-spin" : ""} />
        </button>
      </header>
      {loading && !setup && (
        <p role="status" className="admin-payment-note"><LoaderCircle size={16} className="account-spin" /> Učitavamo podešavanja plaćanja…</p>
      )}
      {error && <p className="admin-payment-message is-error" role="alert">{error}</p>}
      {message && <p className="admin-payment-message" role="status">{message}</p>}
      {setup && (
        <>
          {preparationMode && (
            <p className="admin-payment-preparation">
              <LockKeyhole size={16} aria-hidden="true" />
              <span>Prodavnica je u pripremi. Kupci mogu da poruče kada otvorite prodavnicu.</span>
            </p>
          )}
          <ul className="admin-payment-methods" aria-label="Dostupnost načina plaćanja" aria-live="polite">
            {([
              { id: "cod", label: "Pouzećem", icon: Truck, enabled: true, ready: true },
              { id: "card", label: "Karticom", icon: CreditCard, enabled: setup.settings.cardEnabled, ready: canEnable },
              { id: "ips_qr", label: "QR uplata", icon: QrCode, enabled: setup.settings.ipsQrEnabled, ready: canEnableQr },
            ] as const).map(({ id, label, icon: Icon, enabled, ready }) => {
              const available = setup.methods.some(method => method.id === id && method.available);
              const status = available
                ? preparationMode ? "Spremno za otvaranje" : "Dostupno kupcima"
                : !enabled && ready ? "Isključeno" : "Čeka podešavanje";
              return (
                <li key={id} className="admin-payment-method">
                  <Icon size={20} aria-hidden="true" />
                  <div>
                    <strong>{label}</strong>
                    <span className="admin-payment-badge" data-tone={available && !preparationMode ? "ready" : undefined}>{status}</span>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="admin-payment-readiness" aria-label="Preduslovi za kartično plaćanje">
            <div className="admin-payment-readiness-heading">
              <h3>Raiffeisen / UPC</h3>
              <span className={`admin-payment-environment is-${setup.readiness.environment}`}>
                {setup.readiness.environment === "production" ? "Produkcija" : setup.readiness.environment === "test" ? "Test okruženje banke" : "Čeka povezivanje"}
              </span>
            </div>
            <ul>
              {([
                ["Bankarska konfiguracija", setup.readiness.configured, "Čeka podatke banke"],
                ["Javni sertifikat", setup.readiness.certificateRegistered, "Čeka potvrdu UPC-a"],
                ["Kartično plaćanje u prodaji", setup.readiness.productionApproved, "Čeka odobrenje Raiffeisena"],
              ] as const).map(([label, ready, pending]) => (
                <li key={label}>
                  {ready ? <CheckCircle2 size={16} aria-hidden="true" /> : <LockKeyhole size={15} aria-hidden="true" />}
                  <span>{label}</span>
                  <strong>{ready ? "Potvrđeno" : pending}</strong>
                </li>
              ))}
              <li>
                {setup.deliveryConfigured ? <CheckCircle2 size={16} aria-hidden="true" /> : <LockKeyhole size={15} aria-hidden="true" />}
                <span>Cena dostave</span>
                {setup.deliveryConfigured ? <strong>Uneta</strong> : <a href="#admin-dostava">Otvori podešavanja dostave</a>}
              </li>
            </ul>
            {portal && <details className="admin-payment-terminal">
              <summary>Podešavanje terminala u portalu</summary>
              <p>Pri prvoj prijavi portal može da zatraži promenu početne lozinke. U delu Terminal → Podaci terminala sačuvaj ove adrese.</p>
              <dl>
                <div><dt>Uspešan URL i URL za grešku</dt><dd><code>https://mobitok.rs/api/payments/raiffeisen/return</code></dd></div>
                <div><dt>Notify URL</dt><dd><code>https://mobitok.rs/api/payments/raiffeisen/notify</code></dd></div>
              </dl>
              <a href={portal} target="_blank" rel="noopener noreferrer">Otvori trgovački portal<ExternalLink size={14} aria-hidden="true" /></a>
            </details>}
          </div>

          <form className="admin-payment-production" onSubmit={save}>
            <div className="admin-payment-grid">
              <div className="admin-payment-card-settings">
                <h3>Kartice u prodavnici</h3>
                <label className="admin-payment-toggle">
                  <input type="checkbox" checked={cardEnabled} disabled={Boolean(busy) || loading || (!cardEnabled && !canEnable)} onChange={event => setCardEnabled(event.target.checked)} />
                  <span>Omogući kartično plaćanje kupcima</span>
                </label>
                {!canEnable && (
                  <p className="admin-payment-note">
                    <LockKeyhole size={15} aria-hidden="true" />
                    <span>Za uključivanje su potrebni potvrđeni produkcioni pristup banke i cena dostave.</span>
                  </p>
                )}
              </div>
              <div className="admin-payment-qr-settings">
                <h3>QR uplata na račun</h3>
                <p>Kupac skenira nalog u aplikaciji banke. Priliv potvrđuješ prema bankarskom izvodu.</p>
                <label className="admin-payment-amount">
                  Poslovni račun MOBITOK-a
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={bankAccount}
                    onChange={event => { setBankAccount(event.target.value); if (!event.target.value.trim()) setQrEnabled(false); }}
                    maxLength={25}
                    disabled={loading || Boolean(busy)}
                    placeholder="3 cifre – broj računa – 2 cifre"
                    aria-describedby="admin-payment-account-help"
                  />
                </label>
                <small id="admin-payment-account-help">Unesi 18 cifara ili račun u bankarskom formatu sa crticama. Prazno polje isključuje QR uplatu.</small>
                <div className="admin-payment-recipient">
                  <strong>Primalac iz podataka firme</strong>
                  <span>{setup.recipientName || "Unesi naziv firme u podacima prodavnice."}</span>
                  <span>{setup.recipientAddress || "Unesi adresu firme u podacima prodavnice."}</span>
                </div>
                <label className="admin-payment-toggle">
                  <input type="checkbox" checked={qrEnabled} disabled={Boolean(busy) || loading || (!qrEnabled && !canEnableQr)} onChange={event => setQrEnabled(event.target.checked)} />
                  <span>Omogući QR uplatu na poslovni račun</span>
                </label>
                {!canEnableQr && (
                  <p className="admin-payment-note">
                    <LockKeyhole size={15} aria-hidden="true" />
                    <span>Za uključivanje prvo sačuvaj ispravan račun, podatke firme i cenu dostave.</span>
                  </p>
                )}
              </div>
            </div>
            <button type="submit" className="button button-dark" disabled={loading || Boolean(busy) || !settingsChanged || (cardEnabled && !canEnable) || (qrEnabled && !canEnableQr)}>
              {busy === "save" ? <LoaderCircle size={16} className="account-spin" /> : <Check size={16} />}
              Sačuvaj podešavanje
            </button>
          </form>

          <details className="admin-payment-disclosure">
            <summary>
              <FlaskConical size={19} aria-hidden="true" />
              <span>Test kartičnog plaćanja</span>
              <ChevronDown size={17} className="admin-payment-chevron" aria-hidden="true" />
            </summary>
            <form className="admin-payment-sandbox" onSubmit={startSandbox}>
              <p>Koristi test karticu banke. Broj kartice unosiš na testnoj stranici banke.</p>
              <label className="admin-payment-amount">
                Test iznos (RSD)
                <input type="text" inputMode="decimal" autoComplete="off" value={testAmount} onChange={event => setTestAmount(event.target.value)} maxLength={10} required disabled={loading || Boolean(busy)} aria-describedby="admin-payment-amount-help" />
              </label>
              <small id="admin-payment-amount-help">Od 0,01 do 1.000,00 RSD u test okruženju banke.</small>
              {!setup.readiness.sandboxReady && (
                <p className="admin-payment-note">
                  <LockKeyhole size={15} aria-hidden="true" />
                  <span>{setup.readiness.environment === "production" ? "Test koristi poseban testni terminal." : "Test je dostupan kada UPC potvrdi sertifikat i testna konfiguracija bude podešena."}</span>
                </p>
              )}
              <button type="submit" className="button button-dark" disabled={loading || Boolean(busy) || !setup.readiness.sandboxReady}>
                {busy === "sandbox" ? <LoaderCircle size={16} className="account-spin" /> : <FlaskConical size={16} />}
                Pokreni bankarski test
                <ChevronRight size={15} aria-hidden="true" />
              </button>
              {resume && <a className="admin-payment-resume" href={resume}>Nastavi poslednji sačuvani test</a>}
            </form>
          </details>

          <details className="admin-payment-disclosure">
            <summary>
              <ClipboardCheck size={19} aria-hidden="true" />
              <span>Evidentiranje potvrde iz banke</span>
              <ChevronDown size={17} className="admin-payment-chevron" aria-hidden="true" />
            </summary>
            <div className="admin-payment-capture">
              <p>Sredstva su rezervisana do konačne naplate. Nakon otpreme potvrdi naplatu u portalu banke. Oslobađanje rezervacije ili povraćaj evidentiraj kada banka potvrdi ishod. Za QR uplatu koristi potvrđenu stavku bankarskog izvoda.</p>
              {portal && <a href={portal} target="_blank" rel="noopener noreferrer" aria-label="Otvori portal banke (novi prozor)">Otvori portal banke<ExternalLink size={14} aria-hidden="true" /></a>}
            </div>
            <form className="admin-payment-reconcile" onSubmit={reconcile}>
              {setup.operationsEligible.length === 0 ? <p className="admin-payment-note">Trenutno nema porudžbina za ručnu bankarsku potvrdu.</p> : <>
                <div className="admin-payment-reconcile-fields">
                  <label>Porudžbina<select value={orderId} required disabled={Boolean(busy) || loading} onChange={event => {
                    setOrderId(event.target.value); setOperation(""); setBankReference(""); setOccurredAt(""); setOperationNote(""); resetConfirmation();
                  }}><option value="">Izaberi porudžbinu</option>{setup.operationsEligible.map(order => <option key={order.id} value={order.id}>{order.reference} · {order.method === "ips_qr" ? "QR uplata" : "Kartica"} · {statusNames[order.paymentStatus]}</option>)}</select></label>
                  <label>Potvrđena operacija<select value={operation} required disabled={!selectedOrder || Boolean(busy) || loading} onChange={event => { setOperation(event.target.value as BankOperation | ""); resetConfirmation(); }}><option value="">Izaberi operaciju iz banke</option>{availableOperations.map(item => <option key={item} value={item}>{operationNames[item]}</option>)}</select></label>
                  <label>Pun iznos (RSD)<input readOnly value={selectedOrder ? selectedOrder.payableTotal.toLocaleString("sr-RS", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""} aria-describedby="admin-payment-full-amount" /></label>
                  <label>{selectedOrder?.method === "ips_qr" ? "Referenca stavke bankarskog izvoda" : "Referenca potvrde banke"}<input value={bankReference} onChange={event => { setBankReference(event.target.value); setBankConfirmed(false); }} required maxLength={128} disabled={!operation || Boolean(busy) || loading} autoComplete="off" /></label>
                  <label>Datum i vreme operacije (lokalno)<input type="datetime-local" value={occurredAt} onChange={event => { setOccurredAt(event.target.value); setBankConfirmed(false); }} required disabled={!operation || Boolean(busy) || loading} /></label>
                  <label className="admin-payment-reconcile-note">Beleška uz potvrdu<textarea value={operationNote} onChange={event => { setOperationNote(event.target.value); setBankConfirmed(false); }} required minLength={3} maxLength={1000} rows={3} disabled={!operation || Boolean(busy) || loading} /></label>
                </div>
                <small id="admin-payment-full-amount">Evidentira se ceo iznos porudžbine. Delimične operacije nisu podržane. {selectedOrder?.providerReference && <>Referenca transakcije: {selectedOrder.providerReference}.</>}</small>
                {selectedOrder?.method === "ips_qr" && ["expired", "review_required"].includes(selectedOrder.paymentStatus) && <p className="admin-payment-note">Kasni ili sporni priliv zahteva ručnu proveru porudžbine. Povraćaj prvo izvrši u banci; evidentiranje ne obnavlja prethodnu rezervaciju.</p>}
                {operation === "captured" && <label className="admin-payment-toggle"><input type="checkbox" checked={dispatched} onChange={event => setDispatched(event.target.checked)} required disabled={Boolean(busy) || loading} /><span>Roba je poslata kupcu.</span></label>}
                <label className="admin-payment-toggle"><input type="checkbox" checked={bankConfirmed} onChange={event => setBankConfirmed(event.target.checked)} required disabled={!operation || Boolean(busy) || loading} /><span>{selectedOrder?.method === "ips_qr" ? operation === "refunded" ? "Proverio/la sam bankarski izvod: povraćaj za ovu porudžbinu, referencu i pun iznos je već uspešno izvršen u banci." : "Proverio/la sam bankarski izvod: priliv za ovu porudžbinu, referencu i pun iznos je stvarno primljen na račun MOBITOK-a." : "Proverio/la sam portal banke: izabrana operacija je uspešno završena za ovu porudžbinu, referencu i pun iznos."}</span></label>
                <button type="submit" className="button button-dark" disabled={Boolean(busy) || loading || !selectedOrder || !operation || !bankConfirmed || (operation === "captured" && !dispatched)}>{busy === "reconcile" ? <LoaderCircle size={16} className="account-spin" /> : <Check size={16} />}Evidentiraj potvrdu banke</button>
              </>}
            </form>
          </details>
        </>
      )}
    </section>
  );
}

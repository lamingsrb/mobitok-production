"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Eye,
  EyeOff,
  FileCheck2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Package,
  RefreshCw,
  ShieldCheck,
  Truck,
  UserRound,
  Zap,
  Percent,
  Library,
} from "lucide-react";
import { getClient } from "@/lib/supabase-browser";
import { requestWithDeadline } from "@/lib/request-deadline";
import { configuredSupabaseUrl } from "@/lib/supabase-config";
import type { PaymentMethod, PaymentStatus } from "@/lib/payment-types";
import { calculusOrderCsv, filterCalculusOrders } from "@/lib/calculus-order-report";
import { ispravnaTabelaMarze, prikazIznosa, type MarginTier } from "@/lib/pricing";
import { useT } from "./store-context";
import ProcurementPanel from "./procurement-panel";
import CatalogAdminPanel, { ApiFailure } from "./catalog-admin-panel";
import CatalogUpdatesPanel from "./catalog-updates-panel";
import MarginTiersEditor from "./margin-tiers-editor";
import AdminPaymentSettings from "./admin-payment-settings";
import AdminDeliverySettings, { type DeliverySettings } from "./admin-delivery-settings";
import { AdminCalculusSettings, type CalculusTransferSettings } from "./admin-calculus-settings";
import { CalculusOrderTools, OrderCalculusExport, type CalculusOrderFilter, type CalculusOrderTransfer } from "./order-calculus-export";
import "./account-panel.css";

type Mode = "account" | "b2b" | "admin";
const adminSections = [
  { id: "procurement", param: "nabavka", title: "Nabavka i dobavljači", icon: Truck },
  { id: "orders", param: "porudzbine", title: "Porudžbine", icon: Package },
  { id: "calculus", param: "calculus", title: "Calculus", icon: FileCheck2 },
  { id: "checkout", param: "placanje-dostava", title: "Plaćanje i dostava", icon: CreditCard },
  { id: "catalog", param: "katalog", title: "Katalog", icon: Library },
  { id: "settings", param: "cene", title: "Cene i marža", icon: Percent },
  { id: "customers", param: "kupci", title: "Poslovni kupci", icon: BriefcaseBusiness },
] as const;
type AdminSection = typeof adminSections[number];

type AuthView = "login" | "register" | "forgot" | "recover";
type Order = {
  id: string;
  reference: string;
  total: number;
  currency: string;
  payment_method?: PaymentMethod;
  payment_status?: PaymentStatus;
  payment_confirmation_source?: string | null;
  delivery_fee_snapshot?: number | null;
  payable_total?: number | null;
  status: string;
  demo: boolean;
  created_at: string;
  customer?: { fullName?: string; email?: string };
  calculus_export?: CalculusOrderTransfer | null;
  order_items?: {
    product_id: string;
    name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }[];
};
type Application = {
  id: string;
  company_name: string;
  contact_name?: string;
  pib?: string;
  phone?: string;
  city?: string;
  status: string;
  created_at: string;
  reviewed_at?: string;
};
type BusinessData = {
  application: Application | null;
  profile: { role: string; discount_percent: number } | null;
};
type ShopSettings = {
  preparation_mode: boolean;
  margin_tiers: MarginTier[];
  vat_percent: number;
  discount_guest_percent: number;
  discount_person_percent: number;
  discount_company_percent: number;
  round_to: number;
  // Podaci koje softver ne moze da zna. Prazno znaci "jos nije dogovoreno" i
  // prodavnica o tome cuti umesto da nagadja.
  contact_phone: string;
  contact_email: string;
  contact_hours: string;
  delivery_courier: string;
  delivery_fee: number | null;
  delivery_free_over: number | null;
  delivery_time: string;
  company_name: string;
  company_short_name: string;
  company_started_on: string | null;
  company_activity: string;
  company_pib: string;
  company_registration_number: string;
  company_address: string;
};
type AdminData = {
  counts: { products: number; orders: number; pendingB2b: number };
  orders: Order[];
  applications: Application[];
  settings: ShopSettings;
  demo: boolean;
  calculusEnabled?: boolean;
};
type CalculusSetup = { enabled: boolean; settings: CalculusTransferSettings };

export { getClient } from "@/lib/supabase-browser";
function authMessage(message: string) {
  if (/invalid login|invalid credentials/i.test(message))
    return "Email ili lozinka nisu ispravni. Pokušaj ponovo.";
  if (/email not confirmed/i.test(message))
    return "Potvrdi email adresu preko linka iz poruke, pa se prijavi.";
  if (/already registered|already been registered/i.test(message))
    return "Za ovu adresu već postoji nalog. Prijavi se ili obnovi lozinku.";
  if (/rate limit|too many|after \d+ seconds/i.test(message))
    return "Poslato je više zahteva u kratkom roku. Sačekaj malo, pa pokušaj ponovo.";
  if (/password.*(?:least|short|weak)/i.test(message))
    return "Izaberi lozinku od najmanje 8 znakova, sa slovima i brojem.";
  if (/fetch|network/i.test(message))
    return "Veza trenutno nije dostupna. Proveri internet i pokušaj ponovo.";
  return "Zahtev trenutno nije uspeo. Pokušaj ponovo za koji trenutak.";
}
function price(value: number) {
  return prikazIznosa(value) + " RSD";
}
function date(value: string) {
  return new Intl.DateTimeFormat("sr-Latn-RS", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
const statusNames: Record<string, string> = {
  received: "Primljena",
  reviewing: "U obradi",
  completed: "Završena",
  cancelled: "Otkazana",
  pending: "Čeka odobrenje",
  approved: "Odobreno",
  rejected: "Nije odobreno",
};

const paymentMethodNames: Record<PaymentMethod, string> = {
  cod: "Pouzećem", card: "Kartica", ips_qr: "QR uplata na račun",
};
const paymentStatusNames: Record<PaymentStatus, string> = {
  unpaid: "Nije plaćeno", pending: "Čeka potvrdu banke",
  authorized: "Sredstva rezervisana", paid: "Plaćeno", failed: "Pokušaj nije uspeo",
  cancelled: "Plaćanje otkazano", expired: "Pokušaj je istekao",
  review_required: "Potrebna provera plaćanja", refund_pending: "Povraćaj čeka potvrdu",
  refunded: "Povraćaj potvrđen",
};
function paymentState(order: Order): PaymentStatus {
  return order.payment_status || (order.payment_method && order.payment_method !== "cod" ? "review_required" : "unpaid");
}
function bankProcessingRequired(order: Order) {
  return order.payment_method && order.payment_method !== "cod" &&
    (["authorized", "paid", "refund_pending", "review_required"] as PaymentStatus[]).includes(paymentState(order));
}
function OrderPaymentInfo({ order }: { order: Order }) {
  const method = order.payment_method || "cod";
  const state = paymentState(order);
  return (
    <small data-payment-method={method} data-payment-status={state}>
      Način plaćanja: {paymentMethodNames[method] || "Potrebna provera"} ·{" "}
      {method === "cod" && state === "unpaid" ? "Plaćanje pri preuzimanju" : method === "ips_qr" && state === "pending" ? "Čeka ručnu proveru priliva prema izvodu" : paymentStatusNames[state] || "Potrebna provera"}
      {state === "authorized" && <><br />Konačna naplata još nije potvrđena.</>}
      {order.payment_confirmation_source === "admin_portal" && <><br />Potvrda banke je ručno evidentirana; nije automatski proverena.</>}
      {order.payment_confirmation_source === "admin_bank_statement" && <><br />Ručno potvrđen priliv prema bankarskom izvodu.</>}
    </small>
  );
}
function knownOrderAmount(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function OrderAmount({ order }: { order: Order }) {
  return (
    <div>
      <strong>{knownOrderAmount(order.payable_total) ? `Ukupno: ${price(order.payable_total)}` : `Artikli: ${price(order.total)}`}</strong>
      {knownOrderAmount(order.delivery_fee_snapshot) && (
        <small style={{ display: "block" }}>Dostava: {price(order.delivery_fee_snapshot)}</small>
      )}
    </div>
  );
}

function Notice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`account-notice ${error ? "is-error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
function Loading({ text = "Učitavanje naloga…" }: { text?: string }) {
  return (
    <div className="account-loading" role="status">
      <LoaderCircle size={24} className="account-spin" />
      <span>{text}</span>
    </div>
  );
}

export default function AccountPanel({ mode = "account" }: { mode?: Mode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const t = useT();
  const [view, setView] = useState<AuthView>("login");
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [business, setBusiness] = useState<BusinessData | null>(null);
  const [admin, setAdmin] = useState<AdminData | null>(null);
  const [adminTab, setAdminTab] = useState<AdminSection["id"]>("procurement");
  const [deliveryRevision, setDeliveryRevision] = useState(0);
  const [dataBusy, setDataBusy] = useState(false);
  const [dataError, setDataError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [calculusError, setCalculusError] = useState<{ orderId: string; message: string } | null>(null);
  const [calculusSetup, setCalculusSetup] = useState<CalculusSetup | null>(null);
  const [calculusSetupError, setCalculusSetupError] = useState("");
  const [calculusFilter, setCalculusFilter] = useState<CalculusOrderFilter>("all");
  const [settingsStatus, setSettingsStatus] = useState<{ error: boolean; text: string } | null>(null);
  const activeUserId = useRef<string | null>(null);
  const requestId = useRef(0);
  const calculusSettingsRevision = useRef(0);
  const client = getClient();

  useEffect(() => {
    if (mode !== "admin") return;
    function restoreAdminTab() {
      const param = new URLSearchParams(window.location.search).get("sekcija");
      setAdminTab(adminSections.find(section => section.param === param)?.id ?? "procurement");
    }
    restoreAdminTab();
    window.addEventListener("popstate", restoreAdminTab);
    return () => window.removeEventListener("popstate", restoreAdminTab);
  }, [mode]);

  function openAdminTab(section: AdminSection) {
    if (section.id === adminTab) return;
    const url = new URL(window.location.href);
    url.searchParams.set("sekcija", section.param);
    url.hash = "";
    window.history.pushState(null, "", url);
    setAdminTab(section.id);
  }

  function deliverySaved(delivery: DeliverySettings) {
    requestId.current += 1;
    setDataBusy(false);
    setAdmin(previous => previous ? {
      ...previous,
      settings: {
        ...previous.settings,
        delivery_courier: delivery.deliveryCourier,
        delivery_time: delivery.deliveryTime,
        delivery_fee: delivery.deliveryFee,
        delivery_free_over: delivery.deliveryFreeOver,
      },
    } : previous);
    setDeliveryRevision(previous => previous + 1);
  }

  useEffect(() => {
    const url = configuredSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NODE_ENV);
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!client || !url || !key) return;
    let active = true;
    fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
      .then((response) => response.ok ? response.json() : null)
      .then((settings) => { if (active) setGoogleAvailable(settings?.external?.google === true); })
      .catch(() => { if (active) setGoogleAvailable(false); });
    return () => { active = false; };
  }, [client]);

  useEffect(() => {
    if (!client) {
      setInitializing(false);
      return;
    }
    let active = true;
    const callbackParams = new URLSearchParams(window.location.hash.slice(1));
    const recoveryRequested =
      new URLSearchParams(window.location.search).get("recovery") === "1" ||
      callbackParams.get("type") === "recovery";
    const callbackFailed =
      callbackParams.has("error") ||
      new URLSearchParams(window.location.search).has("error");
    function updateSession(currentSession: Session | null) {
      const id = currentSession?.user.id ?? null;
      if (id !== activeUserId.current) {
        activeUserId.current = id;
        requestId.current += 1;
        setOrders([]);
        setBusiness(null);
        setAdmin(null);
        setDataError("");
        setDataBusy(false);
        setActionMessage("");
        setActionError("");
        setCalculusError(null);
        calculusSettingsRevision.current += 1;
        setCalculusSetup(null);
        setCalculusSetupError("");
        setCalculusFilter("all");
      }
      setSession(currentSession);
    }
    requestWithDeadline(() => client.auth.getSession(), { timeoutMs: 15000 })
      .then(({ data, error }) => {
        if (!active) return;
        updateSession(data.session);
        if (error) setAuthError(authMessage(error.message));
        if (recoveryRequested && data.session && !callbackFailed)
          setView("recover");
        else if (callbackFailed || (recoveryRequested && !data.session)) {
          setView("forgot");
          setAuthError(
            "Link za pristup nije važeći ili je istekao. Zatraži novi link za promenu lozinke.",
          );
        }
        setInitializing(false);
      })
      .catch(() => {
        if (active) {
          setAuthError(
            "Nalog trenutno nije dostupan. Osveži stranicu i pokušaj ponovo.",
          );
          setInitializing(false);
        }
      });
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, currentSession) => {
      if (!active) return;
      updateSession(currentSession);
      if (event === "PASSWORD_RECOVERY") setView("recover");
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client]);

  const api = useCallback(
    async <T,>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> => {
      try {
        return await requestWithDeadline(async (signal) => {
          const current = await client?.auth.getSession();
          if (current?.error) throw current.error;
          const token = current?.data.session?.access_token;
          if (!token) throw new ApiFailure("Prijavi se da nastavi\u0161.", 401);
          signal.throwIfAborted();
          const response = await fetch(path, {
            ...init,
            signal,
            headers: {
              ...(init?.headers || {}),
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok)
            throw new ApiFailure(
              typeof payload.error === "string" ? payload.error : "Podaci trenutno nisu dostupni. Poku\u0161aj ponovo.",
              response.status,
              typeof payload.code === "string" ? payload.code : undefined,
              typeof payload.retryAfter === "number" ? payload.retryAfter : undefined,
            );
          return payload as T;
        }, {
          // Includes auth and JSON; supplier tools keep their longer deadline.
          timeoutMs: timeoutMs ?? (path.includes("supplier-sync") ? 310000 : 20000),
          signal: init?.signal,
        });
      } catch (error) {
        if (error instanceof ApiFailure) throw error;
        throw new ApiFailure("Veza trenutno nije dostupna. Proveri internet i poku\u0161aj ponovo.", 0);
      }
    },
    [client],
  );

  const loadData = useCallback(async () => {
    if (!session) return;
    const currentRequest = ++requestId.current;
    setDataBusy(true);
    setDataError("");
    try {
      if (mode === "admin") {
        const result = await api<AdminData>("/api/admin");
        if (requestId.current === currentRequest) setAdmin(result);
      } else if (mode === "b2b") {
        const result = await api<BusinessData>("/api/b2b");
        if (requestId.current === currentRequest) setBusiness(result);
      } else {
        const result = await api<{ orders: Order[] }>("/api/orders");
        if (requestId.current === currentRequest)
          setOrders(result.orders || []);
      }
    } catch (error) {
      if (requestId.current === currentRequest)
        setDataError(
          error instanceof Error
            ? error.message
            : "Podaci trenutno nisu dostupni.",
        );
    } finally {
      if (requestId.current === currentRequest) setDataBusy(false);
    }
  }, [session, mode, api]);
  useEffect(() => {
    void loadData();
  }, [loadData]);

  const showCalculusSettings = mode === "admin" && adminTab === "calculus" && Boolean(admin);
  const loadCalculusSettings = useCallback(async (signal?: AbortSignal) => {
    const actor = activeUserId.current;
    const revision = ++calculusSettingsRevision.current;
    setCalculusSetupError("");
    try {
      const setup = await api<CalculusSetup>("/api/admin/calculus", { signal });
      if (!signal?.aborted && actor === activeUserId.current && calculusSettingsRevision.current === revision)
        setCalculusSetup(setup);
    } catch (error) {
      if (!signal?.aborted && actor === activeUserId.current && calculusSettingsRevision.current === revision)
        setCalculusSetupError(error instanceof Error ? error.message : "Podešavanja prenosa trenutno nisu dostupna.");
    }
  }, [api]);
  useEffect(() => {
    if (!showCalculusSettings) return;
    const controller = new AbortController();
    void loadCalculusSettings(controller.signal);
    return () => controller.abort();
  }, [loadCalculusSettings, showCalculusSettings]);

  const pendingCalculusOrders = mode === "admin" && adminTab === "orders" && Boolean(admin?.calculusEnabled &&
    admin.orders.some((order) => ["queued", "sending"].includes(order.calculus_export?.state ?? "")));
  useEffect(() => {
    if (!pendingCalculusOrders) return;
    const controller = new AbortController();
    let poll = 0;
    async function refreshTransfers() {
      if (document.hidden) return;
      const sequence = ++poll;
      const revision = requestId.current;
      const result = await api<AdminData>("/api/admin", { signal: controller.signal }).catch(() => null);
      if (result && !controller.signal.aborted && sequence === poll && requestId.current === revision) setAdmin(result);
    }
    const first = window.setTimeout(() => void refreshTransfers(), 6500);
    const second = window.setTimeout(() => void refreshTransfers(), 22000);
    return () => {
      controller.abort();
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, [api, pendingCalculusOrders]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    setBusy(true);
    setAuthError("");
    setMessage("");
    try {
      if (view === "forgot") {
        const { error } = await requestWithDeadline(() => client.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/nalog?recovery=1",
        }));
        if (error) throw error;
        setMessage(
          "Ako postoji nalog sa ovom adresom, stići će poruka sa linkom za novu lozinku. Proveri i folder za neželjenu poštu.",
        );
      } else if (view === "recover") {
        const { error } = await requestWithDeadline(() => client.auth.updateUser({ password }));
        if (error) throw error;
        window.history.replaceState(null, "", window.location.pathname);
        setMessage("Nova lozinka je sačuvana.");
        setView("login");
      } else if (view === "register") {
        const polje = (ime: string) => String(data.get(ime) || "").trim();
        if (password !== String(data.get("passwordConfirm") || "")) {
          throw new Error(t("Lozinke se ne poklapaju."));
        }
        const imePrezime = (polje("firstName") + " " + polje("lastName")).trim();
        const companyName = polje("companyName");
        const pib = polje("pib");
        if ((companyName && !pib) || (pib && !companyName))
          throw new Error("Za kupovinu kao firma unesi i naziv firme i PIB.");
        if (pib && !/^\d{9}$/.test(pib))
          throw new Error("PIB ima tačno 9 cifara.");

        const { data: result, error } = await requestWithDeadline(() => client.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin + window.location.pathname,
            // Opciono ime firme i PIB sluze identifikaciji kupca. Sama
            // registracija ne otvara B2B prijavu niti dodeljuje popust.
            data: { full_name: imePrezime, ...(companyName && pib ? { billing_company: { name: companyName, pib } } : {}) },
          },
        }));
        if (error) throw error;
        setMessage(result.session
          ? "Nalog je napravljen. Dobro došao!"
          : "Proveri email i potvrdi nalog preko linka iz poruke.");
      } else {
        const { error } = await requestWithDeadline(() => client.auth.signInWithPassword({
          email,
          password,
        }));
        if (error) throw error;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setAuthError(/^(Lozinke se ne poklapaju|Za kupovinu kao firma|PIB ima tačno)/.test(message) ? message : authMessage(message));
    } finally {
      setBusy(false);
    }
  }
  async function googleLogin() {
    if (!client) return;
    setBusy(true);
    setAuthError("");
    try {
      const { error } = await requestWithDeadline(() => client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin + window.location.pathname,
        },
      }));
      if (error) throw error;
    } catch (error) {
      setAuthError(authMessage(error instanceof Error ? error.message : ""));
      setBusy(false);
    }
  }
  async function logout() {
    if (!client) return;
    setBusy(true);
    setAuthError("");
    setMessage("");
    try {
      const { error } = await requestWithDeadline(() => client.auth.signOut());
      if (error) throw error;
      setOrders([]);
      setBusiness(null);
      setAdmin(null);
      setDataError("");
      setActionMessage("");
      setActionError("");
      setView("login");
    } catch {
      setAuthError("Odjava nije uspela. Pokušaj ponovo.");
    } finally {
      setBusy(false);
    }
  }
  async function submitBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!String(form.get("registrationNumber") || "").trim())
      form.delete("registrationNumber");
    setBusy(true);
    setActionError("");
    setActionMessage("");
    try {
      const result = await api<{ message?: string }>("/api/b2b", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form)),
      });
      setActionMessage(
        result.message ||
          "Prijava je poslata. Tvoj poslovni nalog čeka pregled i odobrenje.",
      );
      await loadData();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Prijava nije poslata. Pokušaj ponovo.",
      );
    } finally {
      setBusy(false);
    }
  }
  // Tabela marze, PDV i popusti se cuvaju zajedno: svi zajedno odredjuju jednu
  // cenu. Server odmah preracuna i objavi katalog, pa poruka o ishodu stoji
  // pored dugmeta, gde admin ceka.
  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const broj = (kljuc: string) => Number(data.get(kljuc) ?? 0);
    const tekst = (kljuc: string) => String(data.get(kljuc) ?? "").trim();
    let marginTiers: unknown = null;
    try {
      marginTiers = JSON.parse(tekst("marginTiers"));
    } catch {
      marginTiers = null;
    }
    setActionError("");
    setActionMessage("");
    if (!ispravnaTabelaMarze(marginTiers)) {
      setSettingsStatus({
        error: true,
        text: "Tabela marže nije potpuna: svaki red treba granicu i maržu, a granice rastu od reda do reda.",
      });
      return;
    }
    setSavingId("settings");
    setSettingsStatus(null);
    try {
      // Objava radi u malim delovima; odgovor prikazuje i preostale poslove.
      const odgovor = await api<{ result?: { published?: number; warning?: string } }>(
        "/api/admin",
        {
          method: "PATCH",
          body: JSON.stringify({
            action: "update_settings",
            marginTiers,
            vatPercent: broj("vatPercent"),
            discountGuestPercent: broj("discountGuestPercent"),
            discountPersonPercent: broj("discountPersonPercent"),
            discountCompanyPercent: broj("discountCompanyPercent"),
            roundTo: broj("roundTo"),
            contactPhone: tekst("contactPhone"),
            contactEmail: tekst("contactEmail"),
            contactHours: tekst("contactHours"),
            companyName: tekst("companyName"),
            companyShortName: tekst("companyShortName"),
            companyStartedOn: tekst("companyStartedOn"),
            companyActivity: tekst("companyActivity"),
            companyPib: tekst("companyPib"),
            companyRegistrationNumber: tekst("companyRegistrationNumber"),
            companyAddress: tekst("companyAddress"),
          }),
        },
        310000,
      );
      const objavljeno = Number(odgovor?.result?.published ?? 0);
      setSettingsStatus({
        error: false,
        text:
          odgovor?.result?.warning || (objavljeno > 0
            ? `Podešavanja su sačuvana i nove cene su objavljene. Objavljeno artikala: ${objavljeno.toLocaleString("sr-Latn-RS")}.`
            : "Podešavanja su sačuvana. Popusti važe odmah; nove prodajne cene ulaze u prodavnicu pri sledećem objavljivanju kataloga."),
      });
      await loadData();
    } catch (error) {
      setSettingsStatus({
        error: true,
        text: error instanceof Error ? error.message : "Podešavanja nisu sačuvana.",
      });
    } finally {
      setSavingId(null);
    }
  }
  async function togglePreparationMode() {
    if (!admin || savingId) return;
    setSavingId("preparation-mode");
    setActionError("");
    setActionMessage("");
    try {
      const result = await api<{ preparationMode: boolean }>("/api/admin", {
        method: "PATCH",
        body: JSON.stringify({ action: "set_preparation_mode", enabled: !admin.settings.preparation_mode }),
      });
      setAdmin((previous) => previous ? {
        ...previous,
        settings: { ...previous.settings, preparation_mode: result.preparationMode },
      } : previous);
      setActionMessage(result.preparationMode
        ? "Režim pripreme je uključen. Cene i poručivanje su sakriveni."
        : "Režim pripreme je isključen. Prodaja je dostupna.");
      window.location.reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Režim nije promenjen.");
    } finally {
      setSavingId(null);
    }
  }
  async function adminAction(
    event: FormEvent<HTMLFormElement>,
    id: string,
    action: "review_b2b" | "update_order",
  ) {
    event.preventDefault();
    if (savingId) return;
    const nativeEvent = event.nativeEvent as SubmitEvent;
    const submitter = nativeEvent.submitter as HTMLButtonElement | null;
    const data = new FormData(event.currentTarget);
    const payload =
      action === "review_b2b"
        ? {
            action,
            applicationId: id,
            status: submitter?.value || "approved",
            discountPercent: Number(data.get("discountPercent") || 0),
          }
        : { action, orderId: id, status: data.get("status") };
    setSavingId(id);
    setActionError("");
    setActionMessage("");
    try {
      await api("/api/admin", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setActionMessage("Izmena je sačuvana.");
      await loadData();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Izmena nije sačuvana.",
      );
    } finally {
      setSavingId(null);
    }
  }

  async function sendCalculusDraft(orderId: string) {
    const actorId = session?.user.id;
    if (!actorId || savingId) return;
    const savingKey = `calculus-${orderId}`;
    setSavingId(savingKey);
    setCalculusError(null);
    try {
      const result = await api<CalculusOrderTransfer>("/api/admin/calculus", {
        method: "POST",
        body: JSON.stringify({ orderId }),
      }, 100_000);
      if (!["sending", "review_required", "exported"].includes(result.state))
        throw new ApiFailure("Ishod slanja nije potvrđen. Proverite Calculus po referenci porudžbine.", 502);
      if (activeUserId.current !== actorId) return;
      requestId.current += 1;
      setDataBusy(false);
      setAdmin((previous) => previous ? {
        ...previous,
        orders: previous.orders.map((order) => order.id === orderId ? { ...order, calculus_export: result } : order),
      } : previous);
    } catch (error) {
      if (activeUserId.current !== actorId) return;
      setCalculusError({
        orderId,
        message: error instanceof ApiFailure && error.status > 0 && error.status !== 500 && error.status !== 504
          ? error.message
          : "Ishod slanja nije potvrđen. Proverite Calculus po referenci porudžbine.",
      });
      await loadData();
    } finally {
      setSavingId((current) => current === savingKey ? null : current);
    }
  }

  async function saveCalculusSettings(automaticEnabled: boolean) {
    const actor = activeUserId.current;
    if (!actor || savingId) return;
    calculusSettingsRevision.current += 1;
    setSavingId("calculus-settings");
    setCalculusSetupError("");
    try {
      const result = await api<CalculusSetup>("/api/admin/calculus", {
        method: "PUT",
        body: JSON.stringify({ automaticEnabled }),
      });
      if (actor === activeUserId.current) {
        calculusSettingsRevision.current += 1;
        setCalculusSetupError("");
        setCalculusSetup(result);
      }
    } catch (error) {
      if (actor === activeUserId.current)
        setCalculusSetupError(error instanceof Error ? error.message : "Režim prenosa nije sačuvan.");
    } finally {
      setSavingId((current) => current === "calculus-settings" ? null : current);
    }
  }

  const visibleAdminOrders = filterCalculusOrders(admin?.orders ?? [], calculusFilter);
  const downloadableOrders = visibleAdminOrders.filter((order) => !order.demo).length;
  function downloadCalculusOrders() {
    if (!downloadableOrders) return;
    const csv = new Blob([calculusOrderCsv(visibleAdminOrders)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(csv);
    const link = document.createElement("a");
    const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Belgrade" }).format();
    link.href = url;
    link.download = `MOBITOK-Calculus-${date}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const displayName =
    typeof session?.user.user_metadata?.full_name === "string"
      ? session.user.user_metadata.full_name.slice(0, 120)
      : "";
  const isAuth = !session || view === "recover";
  const title =
    mode === "b2b"
      ? t("Dobar posao počinje dobrom opremom.")
      : mode === "admin"
        ? t("Sve na jednom mestu.")
        : t("Tvoj svet. Tvoja oprema.");
  return (
    <section className={`account-panel account-shell ${mode === "admin" && admin ? "is-admin" : ""}`}>
      {mode !== "account" && <div className="account-heading">
        <span className="eyebrow">
          <span className="account-dot" />
          {mode === "b2b"
            ? t("MOBITOK ZA BIZNIS")
            : mode === "admin"
              ? t("KONTROLNI CENTAR")
              : t("MOJ MOBITOK")}
        </span>
        <h1>{title}</h1>
        <p className="muted">
          {mode === "b2b"
            ? t("Za servise, timove i ljude koji od tehnologije prave posao.")
            : mode === "admin"
              ? t("Porudžbine, dobavljači i nabavka — sve povezano u jednom radnom prostoru.")
              : t("Prijavi se i pronađi svoje porudžbine na jednom mestu.")}
        </p>
      </div>}
      {initializing ? (
        <Loading />
      ) : (
        <>
          {authError && <Notice error>{authError}</Notice>}
          {message && <Notice>{message}</Notice>}
          {isAuth ? (
            <div className="account-auth-grid">
              <div className="panel account-auth-card">
                <div className="account-icon">
                  <UserRound size={24} />
                </div>
                <h2>
                  {view === "recover"
                    ? t("Nova lozinka")
                    : view === "forgot"
                      ? t("Vrati se svom nalogu")
                      : mode === "admin"
                        ? t("Prijava administratora")
                        : t("Dobro došao u MOBITOK.")}
                </h2>
                <p className="muted">
                  {view === "forgot"
                    ? t("Poslaćemo ti link za promenu lozinke.")
                    : view === "recover"
                      ? t("Postavi novu lozinku za svoj nalog.")
                      : mode === "b2b"
                        ? t("Prijavi se ili napravi nalog, pa pošalji zahtev za poslovnu saradnju.")
                        : mode === "admin"
                          ? t("Pristup imaju samo odobreni administratorski nalozi.")
                          : t("Sve što ti treba za sledeću dobru kupovinu.")}
                </p>
                {(view === "login" || view === "register") &&
                  mode !== "admin" && (
                    <div
                      className="account-tabs"
                      role="group"
                      aria-label={t("Pristup nalogu")}
                    >
                      <button
                        type="button"
                        aria-pressed={view === "login"}
                        className={view === "login" ? "is-active" : ""}
                        onClick={() => {
                          setView("login");
                          setAuthError("");
                          setMessage("");
                        }}
                      >
                        {t("Prijavi se")}
                      </button>
                      <button
                        type="button"
                        aria-pressed={view === "register"}
                        className={view === "register" ? "is-active" : ""}
                        onClick={() => {
                          setView("register");
                          setAuthError("");
                          setMessage("");
                        }}
                      >
                        {t("Registruj se")}
                      </button>
                    </div>
                  )}
                {!client && (
                  <Notice>
                    Prijava trenutno nije dostupna. Ponuda je i dalje dostupna
                    za pregled.
                  </Notice>
                )}
                <form
                  onSubmit={submitAuth}
                  className="account-form"
                  aria-busy={busy}
                >
                  {view === "register" && (
                    <>
                      <div className="account-form-row">
                        <label>
                          {t("Ime")}
                          <input
                            className="field"
                            name="firstName"
                            autoComplete="given-name"
                            placeholder={t("Vaše ime")}
                            minLength={2}
                            maxLength={60}
                            required
                          />
                        </label>
                        <label>
                          {t("Prezime")}
                          <input
                            className="field"
                            name="lastName"
                            autoComplete="family-name"
                            placeholder={t("Vaše prezime")}
                            minLength={2}
                            maxLength={60}
                            required
                          />
                        </label>
                      </div>
                      <div className="account-company-optional">
                        <span>Podaci firme <small>(opciono, ako kupuješ za firmu)</small></span>
                        <div className="account-form-row">
                          <label>
                            Naziv firme
                            <input className="field" name="companyName" autoComplete="organization" maxLength={200} placeholder="Naziv firme" />
                          </label>
                          <label>
                            PIB
                            <input className="field" name="pib" inputMode="numeric" pattern="[0-9]{9}" maxLength={9} placeholder="9 cifara" title="PIB ima tačno 9 cifara" />
                          </label>
                        </div>
                      </div>
                    </>
                  )}
                  {view !== "recover" && (
                    <label>
                      {t("Email adresa")}
                      <input
                        className="field"
                        name="email"
                        type="email"
                        autoComplete="email"
                        placeholder={t("ime@primer.rs")}
                        maxLength={254}
                        required
                      />
                    </label>
                  )}
                  {view !== "forgot" && (
                    <div className="account-password-field">
                      <label htmlFor="account-password-input">
                        {view === "recover" ? t("Nova lozinka") : t("Lozinka")}
                      </label>
                      <span className="account-password">
                        <input
                          id="account-password-input"
                          className="field"
                          name="password"
                          type={showPassword ? "text" : "password"}
                          autoComplete={
                            view === "login"
                              ? "current-password"
                              : "new-password"
                          }
                          placeholder={
                            view === "register" || view === "recover"
                              ? t("Najmanje 8 znakova")
                              : t("Tvoja lozinka")
                          }
                          minLength={view === "login" ? 1 : 8}
                          maxLength={128}
                          required
                        />
                        <button
                          type="button"
                          className="account-eye"
                          onClick={() => setShowPassword(!showPassword)}
                          aria-label={
                            showPassword ? t("Sakrij lozinku") : t("Prikaži lozinku")
                          }
                        >
                          {showPassword ? (
                            <EyeOff size={18} />
                          ) : (
                            <Eye size={18} />
                          )}
                        </button>
                      </span>
                    </div>
                  )}
                  {view === "register" && (
                    <label>
                      {t("Potvrdite lozinku")}
                      <input
                        className="field"
                        name="passwordConfirm"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder={t("Ponovite lozinku")}
                        minLength={8}
                        maxLength={128}
                        required
                      />
                    </label>
                  )}
                  {view === "login" && (
                    <button
                      type="button"
                      className="account-text-button account-forgot"
                      onClick={() => {
                        setView("forgot");
                        setAuthError("");
                        setMessage("");
                      }}
                    >
                      {t("Zaboravljena lozinka?")}
                    </button>
                  )}
                  <button
                    className="button button-dark account-submit"
                    disabled={busy || !client}
                    type="submit"
                  >
                    {busy ? (
                      <LoaderCircle size={18} className="account-spin" />
                    ) : null}
                    {view === "forgot"
                      ? t("Pošalji link")
                      : view === "recover"
                        ? t("Sačuvaj novu lozinku")
                        : view === "register"
                          ? t("Napravi moj nalog")
                          : t("Prijavi se")}
                    {!busy && <ArrowRight size={18} />}
                  </button>
                  {(view === "forgot" || view === "recover") && (
                    <button
                      type="button"
                      className="account-text-button"
                      onClick={() => {
                        setView("login");
                        setMessage("");
                        setAuthError("");
                      }}
                    >
                      {t("Nazad na prijavu")}
                    </button>
                  )}
                </form>
                {googleAvailable &&
                  (view === "login" || view === "register") && (
                    <>
                      <div className="account-divider">
                        <span>{t("ili")}</span>
                      </div>
                      <button
                        type="button"
                        className="button account-google"
                        onClick={googleLogin}
                        disabled={busy || !client}
                      >
                        <span className="account-google-g">G</span>Nastavi uz
                        Google
                      </button>
                    </>
                  )}
                <div className="account-security">
                  <LockKeyhole size={14} />
                  <span>{t("Tvoj nalog. Tvoja istorija porudžbina.")}</span>
                </div>
              </div>
              <aside className="account-benefits">
                <span className="account-orbit" aria-hidden="true">
                  <Zap size={82} strokeWidth={1.2} />
                </span>
                <div>
                  <span className="eyebrow">
                    {mode === "b2b"
                      ? "MANJE KORAKA. VIŠE POSLA."
                      : "DOBRO JE BITI POVEZAN."}
                  </span>
                  <h2>
                    {mode === "b2b" ? (
                      <>
                        Tvoja sledeća
                        <br />
                        poslovna veza.
                      </>
                    ) : (
                      <>
                        Mesto za tvoju
                        <br />
                        sledeću ideju.
                      </>
                    )}
                  </h2>
                  <p>
                    {mode === "b2b"
                      ? t("Oprema za svakodnevni rad, uz poslovni nalog prilagođen tvojoj firmi.")
                      : t("Od radnog stola do sledećeg gaming setupa. Pronađi ono što odgovara tvom ritmu.")}
                  </p>
                </div>
                <div className="account-benefit-list">
                  {(mode === "b2b"
                    ? [
                        [
                          "01",
                          "Prijavi svoju firmu",
                          "Jedna kratka prijava sa podacima firme.",
                        ],
                        [
                          "02",
                          "Sačekaj odobrenje",
                          "Svaki poslovni nalog pregledamo zasebno.",
                        ],
                        [
                          "03",
                          "Kupi pod svojim uslovima",
                          "Odobrene pogodnosti vezuju se za tvoj nalog.",
                        ],
                      ]
                    : [
                        [
                          "01",
                          "Tvoje porudžbine",
                          "Pregled svega što poručiš sa svog naloga.",
                        ],
                        [
                          "02",
                          "Oprema koja ti odgovara",
                          "Kategorije i izbor uređaja vode te do pravog proizvoda.",
                        ],
                        [
                          "03",
                          "Treba ti više komada?",
                          "Pošalji spisak artikala za ponudu.",
                        ],
                      ]
                  ).map(([number, label, description]) => (
                    <div className="account-benefit" key={number}>
                      <span>{number}</span>
                      <div>
                        <strong>{label}</strong>
                        <p>{description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          ) : (
            <>
              <div className="account-session panel">
                <div className="account-avatar">
                  <UserRound size={22} />
                </div>
                <div>
                  <strong>{displayName || "Tvoj MOBITOK nalog"}</strong>
                  <span>{session.user.email}</span>
                </div>
                <button
                  type="button"
                  className="account-logout"
                  onClick={logout}
                  disabled={busy}
                >
                  <LogOut size={17} />
                  Odjavi se
                </button>
              </div>
              {actionError && <Notice error>{actionError}</Notice>}
              {actionMessage && <Notice>{actionMessage}</Notice>}
              {dataBusy && !admin && !business && !orders.length ? (
                <Loading text="Učitavanje podataka…" />
              ) : null}
              {dataError && (
                <div className="panel account-access-error">
                  <ShieldCheck size={32} />
                  <h2>
                    {mode === "admin"
                      ? "Pristup kontrolnom centru"
                      : "Podaci trenutno nisu dostupni"}
                  </h2>
                  <p>{dataError}</p>
                  <button
                    type="button"
                    className="button"
                    onClick={() => void loadData()}
                    disabled={dataBusy}
                  >
                    <RefreshCw
                      size={16}
                      className={dataBusy ? "account-spin" : ""}
                    />
                    Pokušaj ponovo
                  </button>
                </div>
              )}
              {mode === "account" && !dataError && (
                <div className="account-dashboard-grid">
                  <div className="panel account-orders">
                    <div className="account-section-title">
                      <div>
                        <span className="eyebrow">SVE NA JEDNOM MESTU</span>
                        <h2>Moje porudžbine</h2>
                      </div>
                      <Package size={24} />
                    </div>
                    <p className="account-preview-note">
                      Artikle poručujemo od veleprodaje po prijemu porudžbine.
                      Način i status plaćanja prikazani su uz svaku porudžbinu.
                    </p>
                    {orders.length
                      ? orders.map((order) => (
                          <div className="account-order" key={order.id}>
                            <div>
                              <strong>{order.reference}</strong>
                              <span>
                                {date(order.created_at)}
                                {order.demo ? " · Demo porudžbina" : ""}
                              </span>
                              <small>
                                {order.order_items
                                  ?.map(
                                    (item) => `${item.quantity} × ${item.name}`,
                                  )
                                  .join(" · ")}
                              </small>
                              <OrderPaymentInfo order={order} />
                            </div>
                            <div className="account-order-meta">
                              <span
                                className={`account-badge is-${order.status}`}
                              >
                                {statusNames[order.status] || order.status}
                              </span>
                              <OrderAmount order={order} />
                            </div>
                          </div>
                        ))
                      : !dataBusy && (
                          <div className="account-empty">
                            <span>
                              <Package size={34} strokeWidth={1.5} />
                            </span>
                            <h3>Tvoja priča tek počinje.</h3>
                            <p>
                              Ovde će se pojaviti porudžbine koje pošalješ dok
                              si prijavljen.
                            </p>
                            <a href="/" className="button button-dark">
                              Istraži ponudu
                              <ArrowRight size={17} />
                            </a>
                          </div>
                        )}
                  </div>
                  <a className="account-business-link" href="/b2b">
                    <BriefcaseBusiness size={30} />
                    <span className="eyebrow">VEĆE PORUDŽBINE</span>
                    <h2>
                      Treba ti više
                      <br />
                      komada?
                    </h2>
                    <p>
                      Pošalji nam artikle i količine, pa ćemo proveriti mogućnosti.
                    </p>
                    <span className="account-business-cta">
                      Zatraži ponudu
                      <ArrowUpRight size={21} />
                    </span>
                  </a>
                </div>
              )}
              {mode === "b2b" && business && !dataError && (
                <div className="account-b2b-grid">
                  <div className="panel account-b2b-card">
                    {business.application ? (
                      <>
                        <span
                          className={`account-status-icon is-${business.application.status}`}
                        >
                          {business.application.status === "approved" ? (
                            <CheckCircle2 size={30} />
                          ) : (
                            <BriefcaseBusiness size={30} />
                          )}
                        </span>
                        <span className="eyebrow">POSLOVNI NALOG</span>
                        <h2>{business.application.company_name}</h2>
                        <span
                          className={`account-badge is-${business.application.status}`}
                        >
                          {statusNames[business.application.status] ||
                            business.application.status}
                        </span>
                        <p className="muted">
                          {business.application.status === "approved"
                            ? "Tvoj poslovni nalog je odobren. Prijavi se ovim nalogom pri kupovini da bi koristio dodeljene uslove."
                            : business.application.status === "rejected"
                              ? "Ova prijava nije odobrena. Za dodatna pojašnjenja obrati se prodavnici putem kontakta na sajtu."
                              : "Prijava je uspešno sačuvana i čeka pregled administratora. Status možeš da proveriš ovde."}
                        </p>
                        {business.application.status === "approved" &&
                          business.profile &&
                          business.profile.discount_percent > 0 && (
                            <div className="account-discount">
                              <span>Odobreni rabat</span>
                              <strong>
                                {business.profile.discount_percent}%
                              </strong>
                              <small>
                                Primenjuje se prema uslovima poslovnog naloga.
                              </small>
                            </div>
                          )}
                        <p className="account-small">
                          Poslato {date(business.application.created_at)}
                        </p>
                        <button
                          type="button"
                          className="button"
                          onClick={() => void loadData()}
                          disabled={dataBusy}
                        >
                          <RefreshCw
                            size={16}
                            className={dataBusy ? "account-spin" : ""}
                          />
                          Proveri status
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="eyebrow">HAJDE DA SARAĐUJEMO</span>
                        <h2>Predstavi nam svoju firmu.</h2>
                        <p className="muted">
                          Prijava ne dodeljuje poslovne cene automatski. Uslove
                          aktiviramo nakon pregleda.
                        </p>
                        <form
                          className="account-form account-business-form"
                          onSubmit={submitBusiness}
                        >
                          <div className="form-grid">
                            <label className="account-full-field">
                              {t("Naziv firme")}
                              <input
                                name="companyName"
                                className="field"
                                autoComplete="organization"
                                placeholder="Pun naziv firme"
                                minLength={2}
                                maxLength={160}
                                required
                              />
                            </label>
                            <label>
                              {t("PIB")}
                              <input
                                name="pib"
                                className="field"
                                placeholder={t("9 cifara")}
                                inputMode="numeric"
                                pattern="[0-9]{9}"
                                title="PIB sadrži 9 cifara"
                                maxLength={9}
                                required
                              />
                            </label>
                            <label>
                              Matični broj{" "}
                              <span className="account-optional">opciono</span>
                              <input
                                name="registrationNumber"
                                className="field"
                                placeholder={t("8 cifara")}
                                inputMode="numeric"
                                pattern="[0-9]{8}"
                                title="Matični broj sadrži 8 cifara"
                                maxLength={8}
                              />
                            </label>
                            <label>
                              Kontakt osoba
                              <input
                                name="contactName"
                                className="field"
                                autoComplete="name"
                                defaultValue={displayName}
                                minLength={3}
                                maxLength={120}
                                required
                              />
                            </label>
                            <label>
                              Telefon
                              <input
                                name="phone"
                                className="field"
                                type="tel"
                                autoComplete="tel"
                                placeholder="+381"
                                minLength={7}
                                maxLength={24}
                                title="Unesi broj telefona sa 7 do 24 znaka"
                                required
                              />
                            </label>
                            <label>
                              Grad
                              <input
                                name="city"
                                className="field"
                                autoComplete="address-level2"
                                minLength={2}
                                maxLength={100}
                                required
                              />
                            </label>
                            <label>
                              {t("Adresa")}
                              <input
                                name="address"
                                className="field"
                                autoComplete="street-address"
                                minLength={5}
                                maxLength={200}
                                required
                              />
                            </label>
                          </div>
                          <button
                            className="button button-dark account-submit"
                            disabled={busy}
                            type="submit"
                          >
                            {busy ? (
                              <LoaderCircle
                                size={18}
                                className="account-spin"
                              />
                            ) : (
                              <BriefcaseBusiness size={18} />
                            )}
                            Pošalji B2B prijavu
                            <ArrowRight size={18} />
                          </button>
                        </form>
                      </>
                    )}
                  </div>
                  <aside className="account-business-aside">
                    <ShieldCheck size={34} />
                    <h3>
                      Poslovanje ima
                      <br />
                      svoj ritam.
                    </h3>
                    <p>
                      Mi smo tu da izbor opreme bude jednostavniji deo tvog
                      dana.
                    </p>
                    <ul>
                      <li>
                        <Check size={17} />
                        Ponuda za servise i timove
                      </li>
                      <li>
                        <Check size={17} />
                        Pregled porudžbina uz nalog
                      </li>
                      <li>
                        <Check size={17} />
                        Uslovi prema odobrenoj saradnji
                      </li>
                    </ul>
                    <div className="account-aside-note">
                      Jedan nalog za kupovinu i poslovnu saradnju.
                    </div>
                  </aside>
                </div>
              )}
              {mode === "admin" && admin && !dataError && (
                <div className="account-admin">
                  <nav className="account-admin-nav" aria-label="Delovi admin centra">
                    {adminSections.map(section => (
                      <button key={section.id} type="button" aria-current={adminTab === section.id ? "page" : undefined}
                        onClick={() => openAdminTab(section)}>
                        <section.icon size={19} aria-hidden="true" /><span>{section.title}</span>
                      </button>
                    ))}
                  </nav>
                  <section className="account-preparation panel" aria-label="Režim prodavnice">
                    <div>
                      <span className="account-shop-status"><span aria-hidden="true" />Status prodavnice</span>
                      <h2>{admin.settings.preparation_mode ? "Sajt je u pripremi" : "Prodaja je uključena"}</h2>
                      <p>{admin.settings.preparation_mode
                        ? "Kupci mogu da istražuju katalog, ali ne vide cene i ne mogu da poruče."
                        : "Kupci vide cene i mogu da pošalju porudžbinu."}</p>
                    </div>
                    <button type="button" className="button button-dark" onClick={() => void togglePreparationMode()} disabled={!!savingId}>
                      {savingId === "preparation-mode" ? <LoaderCircle size={17} className="account-spin" /> : <Zap size={17} />}
                      {admin.settings.preparation_mode ? "Uključi prodaju" : "Uključi režim pripreme"}
                    </button>
                  </section>
                  <div className="account-admin-top">
                    {admin.demo && <Notice>Proveri cene dobavljača, uslove dostave i načine plaćanja pre otvaranja prodaje.</Notice>}
                    {adminTab !== "orders" && <button
                      type="button"
                      className="button"
                      onClick={() => {
                        void loadData();
                        if (adminTab === "calculus") void loadCalculusSettings();
                      }}
                      disabled={dataBusy}
                    >
                      <RefreshCw
                        size={17}
                        className={dataBusy ? "account-spin" : ""}
                      />
                      Osveži
                    </button>}
                  </div>
                  <div className="account-stats">
                    {[
                      ["Artikli u katalogu", admin.counts.products],
                      ["Porudžbine", admin.counts.orders],
                      ["B2B prijave na čekanju", admin.counts.pendingB2b],
                    ].map(([label, value]) => (
                      <div className="panel" key={String(label)}>
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                  {(adminTab === "procurement" || adminTab === "catalog") && <CatalogUpdatesPanel api={api} />}
                  {adminTab === "procurement" && <ProcurementPanel api={api} />}
                  {adminTab === "catalog" && <CatalogAdminPanel api={api} />}
                  {adminTab === "calculus" && (
                    <AdminCalculusSettings
                      enabled={calculusSetup?.enabled ?? false}
                      settings={calculusSetup?.settings ?? null}
                      saving={savingId === "calculus-settings"}
                      error={calculusSetupError}
                      onSave={(automatic) => void saveCalculusSettings(automatic)}
                      onOpenOrders={() => {
                        const section = adminSections.find((option) => option.id === "orders");
                        if (section) openAdminTab(section);
                      }}
                      mappingApi={api}
                    />
                  )}
                  {adminTab === "settings" && (
                  <div className="panel account-admin-section">
                    <div className="account-section-title">
                      <h2>Cene i marža</h2>
                      <Percent size={23} />
                    </div>
                    <p className="account-hint">
                      Prodajna cena nastaje od nabavne cene dobavljača sa PDV-om: na nju se
                      dodaje marža iz tabele, prema pragu u koji cena upada, pa se zaokružuje
                      naviše. Popust se skida sa te cene, prema tome ko kupuje: neregistrovan
                      posetilac, registrovano fizičko lice ili odobrena firma. Firmi uvek važi
                      povoljniji od dva — opšti popust za firme i njen pojedinačni rabat.
                      Čuvanje odmah preračunava cene celog kataloga i traje do jednog minuta.
                    </p>
                    <form className="account-settings-form" onSubmit={(event) => void saveSettings(event)}>
                      <MarginTiersEditor
                        key={JSON.stringify(admin.settings.margin_tiers ?? [])}
                        tabela={admin.settings.margin_tiers ?? []}
                        roundTo={Number(admin.settings.round_to)}
                      />
                      <p className="account-settings-split">PDV, zaokruživanje i popusti po vrsti kupca.</p>
                      {(
                        [
                          ["vatPercent", "PDV (%)", admin.settings.vat_percent, 0, 30, 1],
                          ["roundTo", "Zaokruživanje cene (RSD)", admin.settings.round_to, 0, 1000, 1],
                          ["discountGuestPercent", "Popust — neregistrovani (%)", admin.settings.discount_guest_percent, 0, 60, 1],
                          ["discountPersonPercent", "Popust — registrovana fizička lica (%)", admin.settings.discount_person_percent, 0, 60, 1],
                          ["discountCompanyPercent", "Popust — firme (%)", admin.settings.discount_company_percent, 0, 60, 1],
                        ] as [string, string, number, number, number, number][]
                      ).map(([ime, naslov, vrednost, min, max, korak]) => (
                        <label key={ime}>
                          {naslov}
                          <input
                            className="field"
                            type="number"
                            name={ime}
                            min={min}
                            max={max}
                            step={korak}
                            defaultValue={Number(vrednost)}
                            required
                          />
                        </label>
                      ))}
                      <p className="account-settings-split">
                        Kontakt i poslovni podaci prikazani kupcima.
                      </p>
                      {(
                        [
                          ["contactPhone", "Telefon za kupce", admin.settings.contact_phone, "npr. 060 123 4567"],
                          ["contactEmail", "E-mail za kupce i porudžbine", admin.settings.contact_email, "adresa koju neko redovno čita"],
                          ["contactHours", "Radno vreme", admin.settings.contact_hours, "npr. radnim danima 9–17h"],
                          ["companyName", "Puno poslovno ime", admin.settings.company_name, "zvanično puno poslovno ime"],
                          ["companyShortName", "Skraćeno poslovno ime", admin.settings.company_short_name, "zvanično skraćeno ime"],
                          ["companyAddress", "Adresa firme", admin.settings.company_address, "ulica, broj, grad"],
                          ["companyActivity", "Pretežna delatnost", admin.settings.company_activity, "šifra i naziv delatnosti"],
                          ["companyPib", "PIB", admin.settings.company_pib, "9 cifara"],
                          ["companyRegistrationNumber", "Matični broj", admin.settings.company_registration_number, "8 cifara"],
                        ] as [string, string, string, string][]
                      ).map(([ime, naslov, vrednost, primer]) => (
                        <label key={ime}>
                          {naslov}
                          <input
                            className="field"
                            type="text"
                            name={ime}
                            defaultValue={vrednost ?? ""}
                            placeholder={primer}
                          />
                        </label>
                      ))}
                      <label>
                        Početak obavljanja delatnosti
                        <input className="field" type="date" name="companyStartedOn" defaultValue={admin.settings.company_started_on ?? ""} />
                      </label>
                      <div className="account-settings-actions">
                        <button className="button button-dark" type="submit" disabled={!!savingId}>
                          {savingId === "settings" ? (
                            <LoaderCircle size={16} className="account-spin" />
                          ) : (
                            <Check size={16} />
                          )}
                          {savingId === "settings" ? "Čuvam i objavljujem cene…" : "Sačuvaj"}
                        </button>
                        <p className={"account-settings-status" + (settingsStatus?.error ? " is-error" : "")} role="status">
                          {settingsStatus?.text}
                        </p>
                      </div>
                    </form>
                  </div>
                  )}
                  {adminTab === "checkout" && (
                    <section className="admin-checkout" aria-labelledby="admin-checkout-title">
                      <header className="admin-checkout-heading">
                        <h2 id="admin-checkout-title">Plaćanje i dostava</h2>
                        <p>Podesi uslove dostave, način uplata i dostupnost plaćanja u korpi.</p>
                      </header>
                      <AdminDeliverySettings api={api} onSaved={deliverySaved} delivery={{
                        deliveryCourier: admin.settings.delivery_courier,
                        deliveryTime: admin.settings.delivery_time,
                        deliveryFee: admin.settings.delivery_fee,
                        deliveryFreeOver: admin.settings.delivery_free_over,
                      }} />
                      <div id="admin-placanja" className="admin-checkout-payment" tabIndex={-1}>
                        <AdminPaymentSettings api={api} preparationMode={admin.settings.preparation_mode}
                          deliveryRevision={deliveryRevision} />
                      </div>
                    </section>
                  )}
                  {adminTab === "customers" && (
                  <div className="panel account-admin-section">
                    <div className="account-section-title">
                      <h2>Poslovni kupci</h2>
                      <BriefcaseBusiness size={23} />
                    </div>
                    {!admin.applications.length && (
                      <p className="muted">Još nema poslovnih prijava.</p>
                    )}
                    {admin.applications.map((application) => (
                      <div className="account-application" key={application.id}>
                        <div>
                          <strong>{application.company_name}</strong>
                          <span>
                            {application.contact_name}
                            {application.pib ? ` · PIB ${application.pib}` : ""}
                          </span>
                          <small>
                            {application.city}
                            {application.phone
                              ? ` · ${application.phone}`
                              : ""}{" "}
                            · {date(application.created_at)}
                          </small>
                          <span
                            className={`account-badge is-${application.status}`}
                          >
                            {statusNames[application.status] ||
                              application.status}
                          </span>
                        </div>
                        {application.status === "pending" && (
                          <form
                            className="account-review-form"
                            onSubmit={(event) =>
                              void adminAction(
                                event,
                                application.id,
                                "review_b2b",
                              )
                            }
                          >
                            <label>
                              Rabat (%)
                              <input
                                className="field"
                                type="number"
                                name="discountPercent"
                                min={0}
                                max={60}
                                step={1}
                                defaultValue={0}
                                required
                              />
                            </label>
                            <div>
                              <button
                                className="button button-dark"
                                name="decision"
                                value="approved"
                                type="submit"
                                disabled={!!savingId}
                              >
                                {savingId === application.id ? (
                                  <LoaderCircle
                                    size={16}
                                    className="account-spin"
                                  />
                                ) : (
                                  <Check size={16} />
                                )}
                                Odobri
                              </button>
                              <button
                                className="button"
                                name="decision"
                                value="rejected"
                                type="submit"
                                disabled={!!savingId}
                              >
                                Odbij
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    ))}
                  </div>
                  )}
                  {adminTab === "orders" && (
                  <div className="panel account-admin-section">
                    <div className="account-section-title">
                      <h2>Porudžbine</h2>
                      <Package size={23} />
                    </div>
                    <CalculusOrderTools
                      filter={calculusFilter}
                      onFilter={setCalculusFilter}
                      shown={visibleAdminOrders.length}
                      total={admin.orders.length}
                      downloadable={downloadableOrders}
                      onDownload={downloadCalculusOrders}
                      onRefresh={() => void loadData()}
                      refreshing={dataBusy}
                    />
                    {!visibleAdminOrders.length && (
                      <p className="muted">{admin.orders.length ? "Nema porudžbina sa ovim statusom prenosa." : "Još nema porudžbina."}</p>
                    )}
                    {visibleAdminOrders.map((order) => (
                      <div className="account-admin-order" key={order.id}>
                        <div className="account-admin-order-head">
                          <div>
                            <strong>{order.reference}</strong>
                            <span>
                              {order.customer?.fullName} ·{" "}
                              {date(order.created_at)}
                              {order.demo ? " · Demo" : ""}
                            </span>
                          </div>
                          <OrderAmount order={order} />
                        </div>
                        <div className="account-preview-note"><OrderPaymentInfo order={order} /></div>
                        {bankProcessingRequired(order) && (
                          <p className="account-preview-note">Otkazivanje i povraćaj sredstava zahtevaju posebnu bankarsku obradu.</p>
                        )}
                        <ul>
                          {order.order_items?.map((item) => (
                            <li key={item.product_id}>
                              <span>
                                {item.quantity} × {item.name}
                              </span>
                              <span>{price(item.line_total)}</span>
                            </li>
                          ))}
                        </ul>
                        <form
                          className="account-order-status-form"
                          onSubmit={(event) =>
                            void adminAction(event, order.id, "update_order")
                          }
                        >
                          <label>
                            Status porudžbine
                            <span className="account-select">
                              <select
                                className="field"
                                name="status"
                                defaultValue={order.status}
                                key={order.status}
                              >
                                {[
                                  "received",
                                  "reviewing",
                                  "completed",
                                  "cancelled",
                                ].map((status) => (
                                  <option value={status} key={status} disabled={status === "cancelled" && !!bankProcessingRequired(order)}>
                                    {statusNames[status]}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown size={16} />
                            </span>
                          </label>
                          <button
                            className="button button-dark"
                            type="submit"
                            disabled={!!savingId}
                          >
                            {savingId === order.id && (
                              <LoaderCircle
                                size={16}
                                className="account-spin"
                              />
                            )}
                            Sačuvaj status
                          </button>
                        </form>
                        {(admin.calculusEnabled || order.calculus_export) && (
                          <OrderCalculusExport
                            order={order}
                            enabled={Boolean(admin.calculusEnabled)}
                            savingId={savingId}
                            error={calculusError?.orderId === order.id ? calculusError.message : undefined}
                            send={() => void sendCalculusDraft(order.id)}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

// Transakcioni mejlovi prodavnice.
//
// Prodavnica radi i bez podesenog posiljaoca: dok RESEND_API_KEY i MAIL_FROM
// nisu u okruzenju, posalji() cuti i vraca { sent: false }. Tako nijedan mejl
// ne odlazi (i nista se ne naplacuje) dok vlasnik ne unese svoj kljuc, a
// porudzbina nikada ne pada zato sto mejl nije prosao.

import { prikazIznosa } from "../pricing";
import type { PaymentMethod, PaymentStatus } from "../payment-types";

const RESEND_URL = "https://api.resend.com/emails";
// Javna adresa prodavnice, za linkove u mejlu kupcu.
const SAJT = (process.env.NEXT_PUBLIC_SITE_URL || "https://mobitok.rs").replace(/\/+$/, "");

export type Mejl = {
  to: string;
  subject: string;
  text: string;
  html: string;
  // Adresa posiljaoca (MAIL_FROM) nema sanduce, pa odgovor mora da ode na
  // adresu koju neko cita.
  replyTo?: string;
};

export type IshodMejla = { sent: boolean; reason?: string; providerMessageId?: string };

// Tacan razlog zasto mejl nije poslat treba u log, ali kupcu i API odgovoru
// nikada ne sme da procuri kljuc ni adresa posiljaoca.
export function mejlPodesen() {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

async function providerIdFromResponse(response: Response): Promise<string | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 4096) { await reader.cancel(); return undefined; }
      chunks.push(part.value);
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (data && typeof data === "object" && "id" in data && typeof data.id === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.id)) return data.id;
  } catch { /* HTTP success already means accepted; a missing optional ID must not resend mail. */ }
  finally { reader.releaseLock(); }
  return undefined;
}

export async function posalji(mejl: Mejl, options?: { idempotencyKey?: string; signal?: AbortSignal }): Promise<IshodMejla> {
  if (!mejlPodesen()) return { sent: false, reason: "nije-podesen" };
  if (options?.signal?.aborted) return { sent: false, reason: "AbortError" };
  const idempotencyKey = options?.idempotencyKey;
  if (idempotencyKey !== undefined && !/^[A-Za-z0-9._~:/-]{1,256}$/.test(idempotencyKey)) {
    return { sent: false, reason: "neispravan-kljuc-ponavljanja" };
  }
  const kontrolor = new AbortController();
  const prekid = setTimeout(() => kontrolor.abort(), 10000);
  try {
    const odgovor = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: [mejl.to],
        subject: mejl.subject,
        text: mejl.text,
        html: mejl.html,
        ...(mejl.replyTo ? { reply_to: mejl.replyTo } : {}),
      }),
      signal: options?.signal ? AbortSignal.any([kontrolor.signal, options.signal]) : kontrolor.signal,
    });
    if (!odgovor.ok)
      return { sent: false, reason: `HTTP ${odgovor.status}` };
    const providerMessageId = await providerIdFromResponse(odgovor);
    return { sent: true, ...(providerMessageId ? { providerMessageId } : {}) };
  } catch (greska) {
    return {
      sent: false,
      reason: greska instanceof Error ? greska.name : "greska",
    };
  } finally {
    clearTimeout(prekid);
  }
}

function cena(vrednost: number, valuta: string) {
  return prikazIznosa(vrednost) + " " + valuta;
}

// Kupac unosi svoje ime i napomenu, pa sve sto ide u HTML mora kroz ovo.
function bez(tekst: string) {
  return tekst
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type PlacanjeMejla = {
  method: PaymentMethod;
  status: PaymentStatus;
  // RSD amounts, captured with the order. null/undefined never means zero.
  payableTotal?: number | null;
  deliveryFee?: number | null;
};

function poznatIznos(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

const naziviPlacanja: Record<PaymentMethod, string> = {
  cod: "Pouzećem", card: "Kartica", ips_qr: "IPS QR",
};
const stanjePlacanja: Record<PaymentStatus, string> = {
  unpaid: "Plaćanje još nije pokrenuto.",
  pending: "Čeka se potvrda banke.",
  authorized: "Banka je odobrila rezervaciju sredstava. Konačna naplata još nije potvrđena.",
  paid: "Plaćanje je potvrđeno.",
  failed: "Pokušaj plaćanja nije uspeo.",
  cancelled: "Pokušaj plaćanja je otkazan.",
  expired: "Rok za ovaj pokušaj plaćanja je istekao.",
  review_required: "Status plaćanja zahteva proveru prodavnice.",
  refund_pending: "Povraćaj sredstava čeka potvrdu banke.",
  refunded: "Povraćaj sredstava je potvrđen.",
};

function placanjeRecenica(p: PlacanjeMejla) {
  if (p.method === "ips_qr" && (p.status === "pending" || p.status === "unpaid")) {
    return "Način plaćanja: Uplata na račun (QR). Uplata se evidentira posle provere izvoda prodavnice.";
  }
  return p.method === "cod"
    ? "Plaća se pouzećem, kuriru pri preuzimanju."
    : `Način plaćanja: ${naziviPlacanja[p.method] || "Elektronsko plaćanje"}. ${stanjePlacanja[p.status] || "Status plaćanja čeka proveru."}`;
}

function sume(p: { total: number; placanje?: PlacanjeMejla }): [string, number][] {
  if (!p.placanje) return [["Ukupno", p.total]];
  const rows: [string, number][] = [["Artikli", p.total]];
  if (poznatIznos(p.placanje.deliveryFee)) rows.push(["Dostava", p.placanje.deliveryFee]);
  if (poznatIznos(p.placanje.payableTotal)) rows.push(["Ukupno za plaćanje", p.placanje.payableTotal]);
  return rows;
}
function sumeTekst(p: { total: number; currency: string; placanje?: PlacanjeMejla }) {
  return sume(p).map(([label, amount]) => `${label}: ${cena(amount, p.currency)}`);
}
function sumeHtml(p: { total: number; currency: string; placanje?: PlacanjeMejla }) {
  return sume(p).map(([label, amount]) =>
    `<tr><td style="padding:14px 0;font-weight:600">${label}</td><td style="padding:14px 0;text-align:right;font-weight:600;white-space:nowrap">${bez(cena(amount, p.currency))}</td></tr>`
  ).join("");
}

export type StavkaPotvrde = {
  name: string;
  quantity: number;
  line_total: number;
};

function stavkeTekst(stavke: StavkaPotvrde[], valuta: string) {
  return stavke.map(
    (s) => `${s.name} × ${s.quantity} — ${cena(s.line_total, valuta)}`,
  );
}

function stavkeHtml(stavke: StavkaPotvrde[], valuta: string) {
  return stavke
    .map(
      (s) =>
        `<tr><td style="padding:10px 0;border-bottom:1px solid #e5e5ea">${bez(s.name)}<span style="color:#6e6e73"> × ${s.quantity}</span></td><td style="padding:10px 0;border-bottom:1px solid #e5e5ea;text-align:right;white-space:nowrap">${cena(s.line_total, valuta)}</td></tr>`,
    )
    .join("");
}

export type PodaciPotvrde = {
  placanje?: PlacanjeMejla;
  reference: string;
  total: number;
  currency: string;
  fullName: string;
  items: StavkaPotvrde[];
  // Kontakt prodavnice iz podesavanja. Kad postoji, odgovor na potvrdu stize
  // prodavnici.
  kontakt?: string;
  // Poslovno ime i sediste iz podesavanja, za obrazac za odustanak. Bez njih
  // obrazac navodi MOBITOK, kao i obrazac na sajtu.
  prodavac?: { naziv?: string; adresa?: string };
  // Dostava iz podesavanja (cena i prag u RSD). Mejl navodi samo ono sto je
  // vlasnik uneo; bez toga kaze da cenu i rok javljamo pre slanja.
  dostava?: { cena?: number | null; besplatnaOd?: number | null; rok?: string };
};

// Iste recenice kao ekran potvrde porudzbine (storefront.tsx): besplatna dostava
// vazi od praga, uneta cena i rok se navode, a ostalo javljamo pre slanja.
function dostavaRecenice(p: PodaciPotvrde) {
  const iznos = p.placanje
    ? (poznatIznos(p.placanje.deliveryFee) ? p.placanje.deliveryFee : null)
    : p.dostava?.cena ?? null;
  const prag = p.placanje ? null : p.dostava?.besplatnaOd ?? null;
  const rok = (p.dostava?.rok ?? "").trim().replace(/\.+$/, "");
  const cenaDostave =
    iznos === 0
      ? "Dostava je besplatna."
      : prag !== null && p.total >= prag
        ? "Dostava je besplatna za ovaj iznos."
        : iznos !== null
          ? `Cena dostave: ${cena(iznos, "RSD")}.`
          : "";
  const javljamo =
    !cenaDostave && !rok
      ? "Cenu dostave i rok isporuke javljamo ti pre nego što pošiljka krene."
      : !cenaDostave
        ? "Cenu dostave javljamo ti pre nego što pošiljka krene."
        : !rok
          ? "Rok isporuke javljamo ti pre nego što pošiljka krene."
          : "";
  return [cenaDostave, rok ? `Uobičajen rok isporuke: ${rok}.` : "", javljamo].filter(Boolean);
}

// Isti obrazac kao na /povrat-i-reklamacije (ObrazacOdustanka u storefront.tsx),
// sa vec upisanim brojem porudzbine.
function obrazacOdustanka(p: PodaciPotvrde) {
  return [
    "IZJAVA O ODUSTANKU OD UGOVORA ZAKLJUČENOG NA DALJINU",
    "",
    "Prodavac: " + (p.prodavac?.naziv || "MOBITOK"),
    ...(p.prodavac?.adresa ? ["Sedište: " + p.prodavac.adresa] : []),
    ...(p.kontakt ? ["E-mail: " + p.kontakt] : []),
    "",
    "Obaveštavam vas da odustajem od ugovora o kupovini sledeće robe:",
    "",
    "Broj porudžbine: " + p.reference,
    "Artikli i količina:",
    "Datum porudžbine:",
    "Datum prijema robe:",
    "Ime i prezime:",
    "Adresa:",
    p.placanje?.method === "card"
      ? "Za kartično plaćanje povraćaj se obrađuje na karticu kojom je plaćeno; ne šaljite broj kartice ili sigurnosni kod."
      : "Broj tekućeg računa za povraćaj novca:",
    "Datum:",
    "Potpis (samo ako se obrazac šalje na papiru):",
  ].join("\n");
}

// Cenu dostave i rok isporuke mejl obecava samo kada ih je vlasnik uneo u
// podesavanjima (dostavaRecenice); ostalo se potvrduje posebno, kao na /dostava.
// Potvrda nosi obavestenje o pravu na odustanak i obrazac, da ih kupac ima
// sacuvane, a ne samo na stranici sajta (pregled 18.10.2026).
export function potvrdaPorudzbine(p: PodaciPotvrde): Omit<Mejl, "to"> {
  const ime = p.fullName.split(" ")[0] || p.fullName;
  const pitanje = p.kontakt ? "Ako imaš pitanje, samo odgovori na ovaj mejl." : "";
  const kanali = [
    p.kontakt ? `e-mailom na ${p.kontakt}` : "",
    p.prodavac?.adresa ? `poštom na adresu sedišta: ${p.prodavac.adresa}` : "",
  ].filter(Boolean).join(" ili ");
  const odustanak = [
    "Od kupovine možeš odustati u roku od 14 dana od prijema robe (ako porudžbina stigne u više paketa, od prijema poslednjeg), bez navođenja razloga.",
    kanali ? `Izjavu o odustanku pošalji ${kanali}; možeš koristiti obrazac na kraju ovog mejla.` : "Možeš koristiti obrazac na kraju ovog mejla.",
  ];
  const postupak = `${SAJT}/povrat-i-reklamacije`;
  const obrazac = obrazacOdustanka(p);
  const dostava = dostavaRecenice(p);
  const placanje = p.placanje && p.placanje.method !== "cod"
    ? placanjeRecenica(p.placanje)
    : "Plaća se pouzećem, kuriru pri preuzimanju.";
  const text = [
    `Zdravo ${ime},`,
    "",
    `primili smo tvoju porudžbinu ${p.reference}.`,
    "",
    ...stavkeTekst(p.items, p.currency),
    "",
    ...sumeTekst(p),
    "",
    "Artikal poručujemo od ugovorene veleprodaje čim potvrdimo dostupnost.",
    ...dostava,
    placanje,
    ...(pitanje ? ["", pitanje] : []),
    "",
    ...odustanak,
    `Postupak, povrat i reklamacije: ${postupak}`,
    "",
    "MOBITOK",
    "",
    "----",
    "",
    obrazac,
  ].join("\n");
  const html = `<!doctype html><html lang="sr"><body style="margin:0;background:#f5f5f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1d1d1f">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<p style="font-size:13px;letter-spacing:.12em;color:#6e6e73;margin:0 0 24px">MOBITOK</p>
<h1 style="font-size:24px;font-weight:600;margin:0 0 8px">Primili smo tvoju porudžbinu.</h1>
<p style="font-size:15px;color:#6e6e73;margin:0 0 24px">Broj porudžbine ${bez(p.reference)}</p>
<table style="width:100%;border-collapse:collapse;font-size:15px">
${stavkeHtml(p.items, p.currency)}
${sumeHtml(p)}
</table>
<p style="font-size:14px;line-height:1.6;color:#6e6e73;margin:24px 0 0">Artikal poručujemo od ugovorene veleprodaje čim potvrdimo dostupnost. ${bez(dostava.join(" "))} ${bez(placanje)}</p>
${pitanje ? `<p style="font-size:14px;line-height:1.6;color:#6e6e73;margin:12px 0 0">${pitanje}</p>` : ""}
<p style="font-size:14px;line-height:1.6;color:#6e6e73;margin:24px 0 0">${bez(odustanak.join(" "))} <a href="${bez(postupak)}" style="color:#0066cc">Postupak, povrat i reklamacije</a>.</p>
<pre style="font-family:inherit;font-size:13px;line-height:1.6;white-space:pre-wrap;background:#ffffff;border:1px solid #e5e5ea;border-radius:12px;padding:16px;margin:16px 0 0;color:#1d1d1f">${bez(obrazac)}</pre>
</div></body></html>`;
  return { subject: `Porudžbina ${p.reference} je primljena`, text, html };
}

export type PodaciOtkazivanja = {
  placanje?: PlacanjeMejla;
  reference: string;
  fullName: string;
  // Kontakt prodavnice iz podesavanja. Kad postoji, odgovor stize prodavnici.
  kontakt?: string;
};

// Otkazivanje porudzbine ne menja niti pretpostavlja bankarski status placanja.
export function otkazivanjePorudzbine(p: PodaciOtkazivanja): Omit<Mejl, "to"> {
  const ime = p.fullName.split(" ")[0] || p.fullName;
  const placanje = !p.placanje || p.placanje.method === "cod"
    ? "Plaćanje je pouzećem, pa za ovu porudžbinu ništa ne plaćaš."
    : placanjeRecenica(p.placanje) + (p.placanje.status === "authorized"
      ? " Oslobađanje rezervacije zahteva posebnu bankarsku obradu."
      : p.placanje.status === "paid" ? " Povraćaj sredstava zahteva posebnu bankarsku obradu." : "");
  const pitanje = p.kontakt
    ? "Ako imaš pitanje ili misliš da je došlo do greške, samo odgovori na ovaj mejl."
    : "";
  const text = [
    `Zdravo ${ime},`,
    "",
    `porudžbina ${p.reference} je otkazana.`,
    "",
    placanje,
    ...(pitanje ? ["", pitanje] : []),
    "",
    "MOBITOK",
  ].join("\n");
  const html = `<!doctype html><html lang="sr"><body style="margin:0;background:#f5f5f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1d1d1f">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<p style="font-size:13px;letter-spacing:.12em;color:#6e6e73;margin:0 0 24px">MOBITOK</p>
<h1 style="font-size:24px;font-weight:600;margin:0 0 8px">Porudžbina je otkazana.</h1>
<p style="font-size:15px;color:#6e6e73;margin:0 0 24px">Broj porudžbine ${bez(p.reference)}</p>
<p style="font-size:14px;line-height:1.6;color:#6e6e73;margin:0">${placanje}</p>
${pitanje ? `<p style="font-size:14px;line-height:1.6;color:#6e6e73;margin:12px 0 0">${pitanje}</p>` : ""}
</div></body></html>`;
  return { subject: `Porudžbina ${p.reference} je otkazana`, text, html };
}

export type PodaciObavestenja = {
  placanje?: PlacanjeMejla;
  reference: string;
  subtotal: number;
  discountPercent: number;
  total: number;
  currency: string;
  prijavljen: boolean;
  kupac: {
    fullName: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    postalCode: string;
    note: string;
  };
  items: StavkaPotvrde[];
  adminUrl: string;
};

// Obavestenje stize prodavnici na kontakt adresu iz podesavanja. Odgovor na
// njega ide pravo kupcu, pa se dostupnost, cena dostave i rok dogovaraju u
// istom razgovoru.
export function novaPorudzbina(p: PodaciObavestenja): Omit<Mejl, "to"> {
  const k = p.kupac;
  const nalog = p.prijavljen ? "registrovan kupac" : "gost";
  const adresa = `${k.address}, ${k.postalCode} ${k.city}`;
  const popust =
    p.discountPercent > 0
      ? `${new Intl.NumberFormat("sr-Latn-RS", { maximumFractionDigits: 2 }).format(p.discountPercent)}%`
      : "";
  const text = [
    `Nova porudžbina ${p.reference}`,
    "",
    `Kupac: ${k.fullName} (${nalog})`,
    `Telefon: ${k.phone}`,
    `E-mail: ${k.email}`,
    `Adresa: ${adresa}`,
    ...(k.note ? [`Napomena: ${k.note}`] : []),
    "",
    ...stavkeTekst(p.items, p.currency),
    "",
    ...(popust
      ? [`Zbir: ${cena(p.subtotal, p.currency)}`, `Popust: ${popust}`]
      : []),
    ...sumeTekst(p),
    ...(p.placanje ? [placanjeRecenica(p.placanje)] : []),
    "",
    `Porudžbina je u admin panelu: ${p.adminUrl}`,
    "Odgovor na ovaj mejl ide kupcu.",
  ].join("\n");
  const podatak = (naziv: string, vrednost: string) =>
    `<tr><td style="padding:6px 16px 6px 0;color:#6e6e73;vertical-align:top;white-space:nowrap">${naziv}</td><td style="padding:6px 0;white-space:pre-line">${bez(vrednost)}</td></tr>`;
  const html = `<!doctype html><html lang="sr"><body style="margin:0;background:#f5f5f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1d1d1f">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<p style="font-size:13px;letter-spacing:.12em;color:#6e6e73;margin:0 0 24px">MOBITOK</p>
<h1 style="font-size:24px;font-weight:600;margin:0 0 8px">Nova porudžbina ${bez(p.reference)}</h1>
<p style="font-size:15px;color:#6e6e73;margin:0 0 24px">${p.placanje && poznatIznos(p.placanje.payableTotal) ? "Ukupno za plaćanje" : p.placanje ? "Artikli" : "Ukupno"} ${cena(p.placanje && poznatIznos(p.placanje.payableTotal) ? p.placanje.payableTotal : p.total, p.currency)}</p>
${p.placanje ? `<p style="font-size:14px;line-height:1.6">${bez(placanjeRecenica(p.placanje))}</p>` : ""}
<table style="width:100%;border-collapse:collapse;font-size:15px;margin:0 0 24px">
${podatak("Kupac", `${k.fullName} (${nalog})`)}${podatak("Telefon", k.phone)}${podatak("E-mail", k.email)}${podatak("Adresa", adresa)}${k.note ? podatak("Napomena", k.note) : ""}
</table>
<table style="width:100%;border-collapse:collapse;font-size:15px">
${stavkeHtml(p.items, p.currency)}
${popust ? `<tr><td style="padding:14px 0 0;color:#6e6e73">Zbir</td><td style="padding:14px 0 0;text-align:right;color:#6e6e73;white-space:nowrap">${cena(p.subtotal, p.currency)}</td></tr><tr><td style="padding:4px 0 0;color:#6e6e73">Popust</td><td style="padding:4px 0 0;text-align:right;color:#6e6e73">${popust}</td></tr>` : ""}
${sumeHtml(p)}
</table>
<p style="font-size:14px;line-height:1.6;color:#6e6e73;margin:24px 0 0"><a href="${bez(p.adminUrl)}" style="color:#0066cc">Otvori admin panel</a>. Odgovor na ovaj mejl ide kupcu.</p>
</div></body></html>`;
  return {
    subject: `Nova porudžbina ${p.reference} — ${cena(p.placanje && poznatIznos(p.placanje.payableTotal) ? p.placanje.payableTotal : p.total, p.currency)}`,
    text,
    html,
  };
}

export type PaymentOutcomeReceiptData = {
  reference: string;
  fullName: string;
  amount: number;
  status: "authorized" | "failed";
  bankStatusCode: string;
  method?: Exclude<PaymentMethod, "cod">;
  kontakt?: string;
  reviewRequired?: boolean;
  orderCancelled?: boolean;
  currentPaymentStatus?: PaymentStatus;
};

/** Called from the durable payment outbox after authenticated, persisted bank notification.
 * Contains no PAN, CVC, gateway payload or payment credentials.
 */
export function paymentOutcomeReceipt(p: PaymentOutcomeReceiptData): Omit<Mejl, "to"> {
  if (!poznatIznos(p.amount) || p.amount <= 0 || !/^\d{3}$/.test(p.bankStatusCode) ||
      (p.status !== "authorized" && p.status !== "failed") ||
      (p.status === "authorized") !== (p.bankStatusCode === "000")) {
    throw new Error("Neispravan ishod plaćanja");
  }
  const ime = p.fullName.split(" ")[0] || p.fullName;
  const authorized = p.status === "authorized";
  const current = p.currentPaymentStatus;
  const review = authorized && (p.reviewRequired || p.orderCancelled) && current !== "refunded";
  const finalState = current === "paid" || current === "refunded";
  const naslov = review ? "Rezervacija sredstava zahteva proveru."
    : authorized && finalState ? "Status plaćanja je ažuriran."
    : authorized ? "Rezervacija sredstava je odobrena." : "Pokušaj plaćanja nije uspeo.";
  const opis = review
    ? (p.orderCancelled ? "Porudžbina je otkazana. " : "") +
      "Banka je prijavila odobrenu rezervaciju sredstava. Potrebna je ručna provera porudžbine i bankarske obrade."
    : authorized && finalState
      ? "Banka je prethodno prijavila odobrenu rezervaciju sredstava."
      : authorized
        ? "Banka je odobrila rezervaciju sredstava. Konačna naplata još nije potvrđena."
        : "Banka nije odobrila ovaj pokušaj plaćanja. Ovaj pokušaj ne potvrđuje uplatu za porudžbinu.";
  const trenutno = current && (review || finalState || (!authorized && current !== "failed"))
    ? `Trenutno stanje porudžbine: ${stanjePlacanja[current]}` : "";
  const iznos = `${authorized ? (finalState ? "Iznos prvobitne rezervacije" : "Iznos rezervacije") : "Iznos pokušaja plaćanja"}: ${cena(p.amount, "RSD")}`;
  const banka = `Status banke: ${p.bankStatusCode} — ${authorized ? "rezervacija odobrena" : "pokušaj nije uspeo"}.`;
  const metoda = `Način plaćanja: ${naziviPlacanja[p.method || "card"]}.`;
  const pitanje = p.kontakt ? "Ako imaš pitanje, samo odgovori na ovaj mejl." : "";
  const text = [
    `Zdravo ${ime},`, "", `Porudžbina: ${p.reference}`, "", naslov, opis,
    ...(trenutno ? [trenutno] : []), metoda, iznos, banka,
    ...(pitanje ? ["", pitanje] : []), "", "MOBITOK",
  ].join("\n");
  const html = `<!doctype html><html lang="sr"><body style="margin:0;background:#f5f5f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1d1d1f">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<p style="font-size:13px;letter-spacing:.12em;color:#6e6e73">MOBITOK</p>
<h1 style="font-size:24px">${bez(naslov)}</h1>
<p>Broj porudžbine ${bez(p.reference)}</p>
<p style="line-height:1.6">${bez(opis)}</p>
${trenutno ? `<p>${bez(trenutno)}</p>` : ""}
<p>${bez(metoda)}</p><p>${bez(iznos)}</p><p>${bez(banka)}</p>
${pitanje ? `<p>${pitanje}</p>` : ""}
</div></body></html>`;
  return {
    subject: `${review ? "Rezervacija sredstava zahteva proveru" : authorized && finalState ? "Status plaćanja ažuriran" : authorized ? "Rezervacija sredstava odobrena" : "Plaćanje nije uspelo"} — ${p.reference}`,
    text, html, ...(p.kontakt ? { replyTo: p.kontakt } : {}),
  };
}

export type BankTransferReceiptData = {
  reference: string;
  fullName: string;
  amount: number;
  receiptReference?: string;
  kontakt?: string;
};

/** Only after record_bank_transfer_receipt returns paymentStatus=paid and idempotent=false.
 * The merchant verified a business-account statement; no automatic bank callback is implied.
 */
function bankTransferStatementReceipt(p: BankTransferReceiptData, refunded: boolean): Omit<Mejl, "to"> {
  if (!poznatIznos(p.amount) || p.amount <= 0 ||
      (p.receiptReference !== undefined && (p.receiptReference.length < 1 ||
        p.receiptReference.length > 160 || /[\x00-\x1f\x7f]/.test(p.receiptReference)))) {
    throw new Error("Neispravna potvrda uplate");
  }
  const details = [
    refunded ? "Prodavnica je proverila bankarski izvod i evidentirala izvršeni povraćaj sredstava."
      : "Prodavnica je proverila priliv na poslovnom računu i evidentirala uplatu.",
    `Porudžbina: ${p.reference}`, `${refunded ? "Iznos povraćaja" : "Iznos uplate"}: ${cena(p.amount, "RSD")}`,
    ...(p.receiptReference ? [`${refunded ? "Referenca potvrđenog povraćaja" : "Referenca potvrđene uplate"}: ${p.receiptReference}`] : []),
    refunded ? "Potvrdu povraćaja sačuvaj uz podatke o porudžbini."
      : "Porudžbina nastavlja obradu prema potvrđenoj dostupnosti i uslovima isporuke.",
  ];
  const text = [`Zdravo ${p.fullName.split(" ")[0] || p.fullName},`, "", ...details,
    ...(p.kontakt ? ["", "Ako imaš pitanje, samo odgovori na ovaj mejl."] : []), "", "MOBITOK"].join("\n");
  const html = `<!doctype html><html lang="sr"><body style="font-family:Arial,sans-serif;color:#1d1d1f">
<div style="max-width:560px;margin:auto;padding:32px 24px"><p>MOBITOK</p><h1>${refunded ? "Povraćaj sredstava je evidentiran." : "Uplata je evidentirana."}</h1>
${details.map(detail => `<p>${bez(detail)}</p>`).join("")}
</div></body></html>`;
  return { subject: `${refunded ? "Povraćaj za porudžbinu" : "Uplata za porudžbinu"} ${p.reference} ${refunded ? "je evidentiran" : "je evidentirana"}`, text, html,
    ...(p.kontakt ? { replyTo: p.kontakt } : {}) };
}

export function bankTransferReceipt(p: BankTransferReceiptData): Omit<Mejl, "to"> {
  return bankTransferStatementReceipt(p, false);
}

/** Only after a new exact full refund is confirmed through the manual statement RPC. */
export function bankTransferRefundReceipt(p: BankTransferReceiptData): Omit<Mejl, "to"> {
  return bankTransferStatementReceipt(p, true);
}

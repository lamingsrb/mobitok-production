"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Check, LoaderCircle, Truck } from "lucide-react";
import "./admin-delivery-settings.css";

export type DeliverySettings = {
  deliveryCourier: string;
  deliveryTime: string;
  deliveryFee: number | null;
  deliveryFreeOver: number | null;
};

type Api = <T>(path: string, init?: RequestInit, timeoutMs?: number) => Promise<T>;
type DeliveryDraft = Record<keyof DeliverySettings, string>;

function toDraft(delivery: DeliverySettings): DeliveryDraft {
  return {
    deliveryCourier: delivery.deliveryCourier ?? "",
    deliveryTime: delivery.deliveryTime ?? "",
    deliveryFee: delivery.deliveryFee?.toString().replace(".", ",") ?? "",
    deliveryFreeOver: delivery.deliveryFreeOver?.toString().replace(".", ",") ?? "",
  };
}

function amount(value: string, label: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const parsed = Number(text.replace(",", "."));
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text) || parsed > 10_000_000) {
    throw new Error(label + " mora biti iznos od 0 do 10.000.000 RSD, sa najviše dve decimale.");
  }
  return parsed;
}

const rsd = new Intl.NumberFormat("sr-Latn-RS", { style: "currency", currency: "RSD", maximumFractionDigits: 2 });

export default function AdminDeliverySettings({
  api, delivery, onSaved,
}: {
  api: Api;
  delivery: DeliverySettings;
  onSaved: (value: DeliverySettings) => void;
}) {
  const [draft, setDraft] = useState<DeliveryDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);
  const saved = toDraft(delivery);
  const values = draft ?? saved;
  const dirty = (Object.keys(saved) as Array<keyof DeliveryDraft>).some(key => values[key] !== saved[key]);

  function edit(key: keyof DeliveryDraft, value: string) {
    setDraft({ ...values, [key]: value });
    setFeedback(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !dirty) return;
    setFeedback(null);
    setBusy(true);
    try {
      const { delivery: updated } = await api<{ delivery: DeliverySettings }>("/api/admin", {
        method: "PATCH",
        body: JSON.stringify({
          action: "update_delivery",
          deliveryCourier: values.deliveryCourier.trim(),
          deliveryTime: values.deliveryTime.trim(),
          deliveryFee: amount(values.deliveryFee, "Cena dostave"),
          deliveryFreeOver: amount(values.deliveryFreeOver, "Prag za besplatnu dostavu"),
        }),
      });
      if (!updated || typeof updated.deliveryCourier !== "string" || typeof updated.deliveryTime !== "string" ||
        [updated.deliveryFee, updated.deliveryFreeOver].some(value => value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0))) {
        throw new Error("Sačuvana podešavanja nisu mogla da se provere. Osveži admin i proveri podatke.");
      }
      onSaved(updated);
      setDraft(null);
      setFeedback({ text: "Dostava je sačuvana. Novi uslovi važe za sledeće porudžbine." });
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Dostava nije sačuvana. Pokušaj ponovo.", error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-delivery panel" id="admin-dostava" tabIndex={-1} aria-labelledby="admin-dostava-title">
      <header className="admin-delivery-header">
        <div className="admin-delivery-icon"><Truck size={22} aria-hidden="true" /></div>
        <div>
          <h3 id="admin-dostava-title">Uslovi dostave</h3>
          <p>Odredi podatke koje kupac vidi pre slanja porudžbine.</p>
        </div>
      </header>
      <form onSubmit={submit} aria-label="Uslovi dostave">
        <fieldset disabled={busy} className="admin-delivery-fields">
          <div>
            <label htmlFor="admin-courier">Kurirska služba</label>
            <input id="admin-courier" name="deliveryCourier" value={values.deliveryCourier} maxLength={120}
              onChange={event => edit("deliveryCourier", event.target.value)} placeholder="npr. naziv kurirske službe" />
          </div>
          <div>
            <label htmlFor="admin-delivery-time">Rok isporuke</label>
            <input id="admin-delivery-time" name="deliveryTime" value={values.deliveryTime} maxLength={120}
              onChange={event => edit("deliveryTime", event.target.value)} placeholder="npr. 1–2 radna dana" />
          </div>
          <div>
            <label htmlFor="admin-delivery-fee">Cena dostave (RSD)</label>
            <input id="admin-delivery-fee" name="deliveryFee" inputMode="decimal" value={values.deliveryFee} maxLength={11}
              onChange={event => edit("deliveryFee", event.target.value)} placeholder="npr. 349,50" aria-describedby="admin-delivery-fee-help" />
            <small id="admin-delivery-fee-help">Prazno znači da cena još nije dogovorena. Unesi 0 za besplatnu dostavu.</small>
          </div>
          <div>
            <label htmlFor="admin-delivery-free">Besplatna dostava od (RSD)</label>
            <input id="admin-delivery-free" name="deliveryFreeOver" inputMode="decimal" value={values.deliveryFreeOver} maxLength={11}
              onChange={event => edit("deliveryFreeOver", event.target.value)} placeholder="npr. 5000" aria-describedby="admin-delivery-free-help" />
            <small id="admin-delivery-free-help">Ostavi prazno ako nema praga za besplatnu dostavu.</small>
          </div>
        </fieldset>

        <div className="admin-delivery-preview">
          <div>
            <strong>Sačuvano za kupce</strong>
            <p>{delivery.deliveryFee === null ? "Cena dostave nije uneta" : delivery.deliveryFee === 0 ? "Besplatna dostava" : rsd.format(delivery.deliveryFee)}
              {delivery.deliveryFreeOver !== null && delivery.deliveryFee !== 0 && " · Besplatno od " + rsd.format(delivery.deliveryFreeOver)}
            </p>
          </div>
          <a href="#admin-placanja">Načini plaćanja <ArrowRight size={15} aria-hidden="true" /></a>
        </div>

        <div className="admin-delivery-actions">
          <button type="submit" className="button button-dark" disabled={busy || !dirty}>
            {busy ? <LoaderCircle size={16} className="account-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
            {busy ? "Čuvam dostavu…" : "Sačuvaj dostavu"}
          </button>
          {dirty && <button type="button" className="button admin-delivery-discard" disabled={busy}
            onClick={() => { setDraft(null); setFeedback(null); }}>Odbaci izmene</button>}
        </div>
        {feedback && <p className={"admin-delivery-feedback" + (feedback.error ? " is-error" : "")}
          role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
      </form>
    </section>
  );
}

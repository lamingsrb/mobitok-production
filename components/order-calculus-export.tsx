"use client";

import { useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  Copy,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  RefreshCw,
  Send,
} from "lucide-react";
import "./order-calculus-export.css";

export type CalculusOrderTransfer = {
  state: "queued" | "sending" | "review_required" | "exported" | "blocked";
  document_id: string | null;
  updated_at?: string | null;
  issue?: string | null;
};

type TransferOrder = {
  id: string;
  reference: string;
  status: string;
  demo: boolean;
  currency: string;
  payment_method?: string;
  payment_status?: string;
  calculus_export?: CalculusOrderTransfer | null;
};

const states = {
  ready: {
    label: "Ručno slanje",
    description: "Pošaljite stavke i dostavu u Calculus kao nacrt za dalju obradu.",
    icon: Send,
  },
  queued: {
    label: "U redu za slanje",
    description: "Porudžbina je u redu za prenos. Možete je poslati i ručno.",
    icon: Clock3,
  },
  sending: {
    label: "Slanje u toku",
    description: "Prenos nacrta je u toku. Osvežite pregled za noviji status.",
    icon: Clock3,
  },
  review_required: {
    label: "Potrebna provera",
    description: "Pronađite nacrt u Calculusu po referenci porudžbine i proverite koje stavke su sačuvane.",
    icon: CircleAlert,
  },
  exported: {
    label: "Nacrt sačuvan",
    description: "Nacrt je sačuvan u Calculusu. Proverite dokument pre izdavanja fiskalnog računa u kasi.",
    icon: CheckCircle2,
  },
  blocked: {
    label: "Slanje zaustavljeno",
    description: "Porudžbina zahteva proveru pre prenosa u Calculus.",
    icon: CircleAlert,
  },
} as const;

const timestampFormat = new Intl.DateTimeFormat("sr-Latn-RS", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Belgrade",
});

const transferFilters = [
  { value: "all", label: "Sve" },
  { value: "queued", label: "Čekaju ili se šalju" },
  { value: "exported", label: "Sačuvani nacrti" },
  { value: "review", label: "Za proveru" },
] as const;

export type CalculusOrderFilter = typeof transferFilters[number]["value"];

export function CalculusOrderTools({ filter, onFilter, shown, total, downloadable = shown, onDownload, onRefresh, refreshing }: {
  filter: CalculusOrderFilter;
  onFilter: (filter: CalculusOrderFilter) => void;
  shown: number;
  total: number;
  downloadable?: number;
  onDownload: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div className="order-calculus-tools">
      <div className="order-calculus-tools__line">
        <div className="order-calculus-tools__filters" role="group" aria-label="Filtriranje po statusu prenosa">
          {transferFilters.map(({ value, label }) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => onFilter(value)}>
              {label}
            </button>
          ))}
        </div>
        <div className="order-calculus-tools__actions">
          <button type="button" className="button" disabled={refreshing} aria-busy={refreshing} onClick={onRefresh}>
            <RefreshCw size={15} className={refreshing ? "account-spin" : undefined} aria-hidden="true" />
            {refreshing ? "Osvežavanje…" : "Osveži"}
          </button>
          <button type="button" className="button" disabled={downloadable === 0} onClick={onDownload}>
            <Download size={15} aria-hidden="true" /> Preuzmi CSV
          </button>
        </div>
      </div>
      <p role="status">Prikazano {shown} od {total} porudžbina. CSV obuhvata stvarne porudžbine iz trenutnog prikaza, među poslednjih 100 porudžbina.</p>
    </div>
  );
}

export function OrderCalculusExport({ order, savingId, enabled = true, error, send }: {
  order: TransferOrder;
  savingId: string | null;
  enabled?: boolean;
  error?: string;
  send: () => void;
}) {
  const [copyFeedback, setCopyFeedback] = useState("");
  const transfer = order.calculus_export;
  const eligible = !order.demo && order.status === "reviewing" && order.currency === "RSD" &&
    order.payment_method === "cod" && order.payment_status === "unpaid";
  const sending = savingId === `calculus-${order.id}`;
  const manualAvailable = enabled && eligible && (!transfer || transfer.state === "queued" || transfer.state === "blocked");
  if (!transfer && (!enabled || (!eligible && !error))) return null;

  const state = sending ? "sending" : transfer?.state ?? "ready";
  const { label, description, icon: Icon } = states[state];
  const documentId = transfer?.document_id;
  const updatedAt = transfer?.updated_at;
  const timestamp = updatedAt && Number.isFinite(Date.parse(updatedAt))
    ? timestampFormat.format(new Date(updatedAt))
    : null;

  async function copy(value: string, success: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyFeedback(success);
    } catch {
      setCopyFeedback(`Označite i kopirajte broj ${value}.`);
    }
  }

  return (
    <div className="account-calculus-export order-calculus" data-calculus-state={state}>
      <div className="order-calculus__head">
        <strong><FileSpreadsheet size={17} aria-hidden="true" />Calculus</strong>
        <span className="order-calculus__badge"><Icon size={14} aria-hidden="true" />{label}</span>
      </div>
      <p className="order-calculus__status" role="status">
        {state === "queued" && !eligible
          ? "Porudžbina trenutno nema uslove za slanje u Calculus."
          : state === "queued" && !enabled
            ? "Porudžbina je u redu za prenos. Slanje je trenutno isključeno."
            : state === "blocked" && transfer?.issue ? transfer.issue : description}
        {documentId && <> ID dokumenta {documentId}.</>}
      </p>
      {order.status === "cancelled" && transfer && transfer.state !== "blocked" && transfer.state !== "queued" && (
        <p className="order-calculus__warning">Porudžbina je otkazana u prodavnici. Proverite stanje nacrta u Calculusu pre rada na kasi.</p>
      )}
      {timestamp && <p className="order-calculus__time">Ažurirano <time dateTime={updatedAt ?? undefined}>{timestamp}</time></p>}
      {(transfer || manualAvailable) && (
        <div className="order-calculus__actions">
          {manualAvailable && (
            <button
              className="button button-dark order-calculus__send"
              type="button"
              disabled={!!savingId}
              aria-busy={sending}
              onClick={send}
            >
              {sending ? <LoaderCircle size={16} className="account-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
              {sending ? "Slanje nacrta…" : "Pošalji nacrt u Calculus"}
            </button>
          )}
          {transfer && (
            <button className="button order-calculus__copy" type="button"
              onClick={() => void copy(order.reference, "Referenca porudžbine je kopirana.")}>
              <Copy size={15} aria-hidden="true" /> Kopiraj referencu
            </button>
          )}
          {documentId && (
            <button className="button order-calculus__copy" type="button"
              onClick={() => void copy(documentId, "ID dokumenta je kopiran.")}>
              <Copy size={15} aria-hidden="true" /> Kopiraj ID
            </button>
          )}
        </div>
      )}
      <p className="order-calculus__copy-feedback" aria-live="polite">{copyFeedback}</p>
      {error && error !== transfer?.issue && <p className="order-calculus__warning" role="alert">{error}</p>}
    </div>
  );
}

export default OrderCalculusExport;

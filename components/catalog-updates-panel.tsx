"use client";

import { useEffect, useId, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, LoaderCircle, RefreshCw } from "lucide-react";
import type { CatalogSupplierUpdate, CatalogUpdatesStatus } from "@/lib/catalog-update-types";
import { catalogHasActiveWork, supplierUpdateState } from "@/lib/catalog-update-state";
import "./catalog-updates-panel.css";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
const formatDate = new Intl.DateTimeFormat("sr-Latn-RS", {
  timeZone: "Europe/Belgrade", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});
const date = (value: string | null | undefined) => value ? formatDate.format(new Date(value)) : "Još nema podatka";
const batchLabels = { running: "U toku", ok: "Završen uspešno", partial: "Delimično uspešan", failed: "Nije uspeo" };
const integer = (value: number) => value.toLocaleString("sr-Latn-RS");

function SupplierCard({ source }: { source: CatalogSupplierUpdate }) {
  const state = supplierUpdateState(source);
  const publication = source.activePublication;
  const start = publication?.createdAt ?? source.activeSync?.startedAt;
  const error = source.lastAttempt?.status === "failed" ? source.lastAttempt.errorSummary ?? source.lastAttempt.errorCode?.replace(/^HTTP_/, "HTTP ") : null;
  return <article className={"catalog-updates-source catalog-updates-" + state.tone}>
    <div className="catalog-updates-source-title"><h3>{source.label}</h3><span className="catalog-updates-badge">{state.label}</span></div>
    {start ? <p className="catalog-updates-progress">Početak posla: {date(start)}</p> : null}
    {publication && publication.phase !== "cleanup" ? <p className="catalog-updates-progress">
      {integer(publication.processed)} obrađeno{publication.staged >= publication.processed && publication.staged > 0 ? " / " + integer(publication.staged) + " pripremljeno" : ""}
    </p> : null}
    <dl>
      <div><dt>Poslednji pokušaj preuzimanja</dt><dd>{date(source.lastAttempt?.startedAt)}</dd></div>
      <div><dt>Uspešno preuzeto</dt><dd>{date(source.lastSuccessfulFeed?.finishedAt)}</dd></div>
      <div><dt>Uspešno objavljeno u prodavnici</dt><dd>{date(source.lastPublishedAt)}</dd></div>
    </dl>
    {error ? <p className="catalog-updates-source-error"><AlertCircle size={16} aria-hidden="true" />{error}</p> : null}
    {source.lastAttempt?.status === "ok" ? <p className="catalog-updates-counts">
      Poslednji izvor: {integer(source.lastAttempt.rowsInSource)} artikala · dodato {integer(source.lastAttempt.added)} · uklonjeno {integer(source.lastAttempt.removed)} · promena cene {integer(source.lastAttempt.priceChanged)}
    </p> : null}
  </article>;
}

export default function CatalogUpdatesPanel({ api }: { api: Api }) {
  const titleId = useId();
  const [data, setData] = useState<CatalogUpdatesStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let current = true, inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (!current || inFlight) return;
      clearTimeout(timer);
      inFlight = true;
      setLoading(true);
      let active = false;
      try {
        const result = await api<CatalogUpdatesStatus>("/api/admin/catalog-updates", {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (!current) return;
        setData(result);
        setError(false);
        setCheckedAt(new Date().toISOString());
        active = catalogHasActiveWork(result);
      } catch {
        if (current && !controller.signal.aborted) setError(true);
      } finally {
        inFlight = false;
        if (current) {
          setLoading(false);
          timer = setTimeout(() => void refresh(), active ? 15000 : 60000);
        }
      }
    };
    const focus = () => { void refresh(); };
    void refresh();
    window.addEventListener("focus", focus);
    return () => { current = false; controller.abort(); clearTimeout(timer); window.removeEventListener("focus", focus); };
  }, [api, reload]);
  const active = data?.suppliers.filter((source) => source.activeSync || source.activePublication) ?? [];
  const failed = data?.suppliers.filter((source) => ["failed", "stale"].includes(supplierUpdateState(source).kind)) ?? [];
  const schedulerBroken = Boolean(data && (!data.schedulerConfigured || data.schedulerError));
  let notice = "Automatsko ažuriranje svih uključenih dobavljača počinje svake noći od 03:00.";
  if (active.length) notice = "U toku: " + active.map((source) => source.label + " — " + supplierUpdateState(source).label.toLocaleLowerCase("sr-Latn-RS")).join("; ") + ". Sa izmenom artikala tog dobavljača sačekajte završetak objave.";
  else if (data?.activeBatch) notice = "Noćni ciklus čeka sledeći korak. Prekinut posao se nastavlja dok se ne završi.";
  else if (failed.length) notice = "Potrebna je provera: " + failed.map((source) => source.label).join(", ") + ". Ostali dobavljači imaju odvojene rezultate.";
  else if (data?.lastBatch) notice = "Poslednji ciklus: " + batchLabels[data.lastBatch.status].toLocaleLowerCase("sr-Latn-RS") + ".";
  if (schedulerBroken) notice = "Automatsko ažuriranje čeka podešavanje servera. Rezultati dobavljača prikazani su odvojeno.";
  const busy = Boolean(data && catalogHasActiveWork(data));
  return <section className="panel catalog-updates-panel" aria-labelledby={titleId} aria-busy={loading}>
    <div className="catalog-updates-heading">
      <div><h2 id={titleId}><Clock3 size={20} aria-hidden="true" />Ažuriranje kataloga</h2><p>Svake noći od 03:00 · vreme Srbije</p></div>
      <button type="button" className="button" disabled={loading} onClick={() => setReload((key) => key + 1)} aria-label="Osveži status ažuriranja">
        <RefreshCw size={16} className={loading ? "catalog-updates-spin" : ""} aria-hidden="true" /><span>Osveži status</span>
      </button>
    </div>
    {error ? <p className="catalog-updates-read-error" role="alert"><AlertCircle size={18} aria-hidden="true" />
      Status trenutno ne može da se proveri.{data ? " Prikaz ispod je poslednje poznato stanje od " + date(checkedAt) + "." : " Pokušajte ponovo."}
    </p> : null}
    {loading && !data ? <p className="catalog-updates-loading" role="status"><LoaderCircle size={18} className="catalog-updates-spin" aria-hidden="true" />Proveravamo stanje dobavljača…</p> : null}
    {data ? <>
      {!data.schedulerConfigured || data.schedulerError ? <p className="catalog-updates-read-error catalog-updates-scheduler-error" role="alert"><AlertCircle size={18} aria-hidden="true" />Automatsko ažuriranje nije podešeno na serveru. Potrebna je provera podešavanja; prikazani rezultati dobavljača ostaju dostupni.</p> : null}
      <p className={"catalog-updates-notice " + (schedulerBroken || failed.length ? "is-error" : busy ? "is-busy" : "is-idle")} role="status">
        {schedulerBroken || failed.length ? <AlertCircle size={18} aria-hidden="true" /> : busy ? <LoaderCircle size={18} aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}{notice}
      </p>
      <p className="catalog-updates-next">{schedulerBroken ? "Planirani raspored od" : "Sledeći planirani početak:"} <strong>{date(data.nextScheduledAt)}</strong>. Ako posao potraje ili se prekine, završava se isti započeti ciklus; preko dana se ne pokreće novi automatski ciklus.</p>
      <details className="catalog-updates-details">
        <summary>Dobavljači, vremena i rezultati <span>{data.suppliers.length}</span></summary>
        <p className="catalog-updates-note">Preuzimanje podataka i objava u prodavnici su odvojeni koraci. Nov datum objave ne znači da je dobavljač poslao nov izvor.</p>
        {data.activeBatch ? <p className="catalog-updates-batch">Tekući ciklus od {date(data.activeBatch.startedAt)}.</p> : null}
        {data.lastBatch ? <p className="catalog-updates-batch">Poslednji završen ciklus: {date(data.lastBatch.startedAt)} — {batchLabels[data.lastBatch.status]}{data.lastBatch.finishedAt ? ", kraj " + date(data.lastBatch.finishedAt) : ""}.</p> : null}
        <div className="catalog-updates-grid">{data.suppliers.map((source) => <SupplierCard key={source.supplier} source={source} />)}</div>
      </details>
    </> : null}
  </section>;
}

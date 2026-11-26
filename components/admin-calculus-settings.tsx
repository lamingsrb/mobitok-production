"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { ArrowRight, CircleCheck, Clock3, FileCheck2, Info, LoaderCircle, Search, TriangleAlert } from "lucide-react";
import "./admin-calculus-settings.css";

export type CalculusTransferSettings = {
  automaticEnabled: boolean;
  counts: { pending: number; review: number; exported: number };
  updatedAt: string | null;
};

type Props = {
  enabled: boolean;
  settings: CalculusTransferSettings | null;
  saving: boolean;
  error?: string;
  onSave: (automaticEnabled: boolean) => void;
  onOpenOrders?: () => void;
  mappingApi?: MappingApi;
};

type MappingApi = <T>(path: string, init?: RequestInit) => Promise<T>;
type MappingProduct = {
  id: string;
  name: string;
  sku: string | null;
  articleCode: string | null;
  taxCode: string | null;
};

const countFormat = new Intl.NumberFormat("sr-Latn-RS");
const dateFormat = new Intl.DateTimeFormat("sr-Latn-RS", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Belgrade",
});
const metrics = [
  { key: "pending", label: "U redu za prenos", icon: Clock3 },
  { key: "review", label: "Za proveru", icon: TriangleAlert },
  { key: "exported", label: "Nacrti u Calculusu", icon: CircleCheck },
] as const;

function TransferModeForm({ enabled, settings, saving, onSave }: Pick<Props, "enabled" | "settings" | "saving" | "onSave">) {
  const helpId = useId();
  const labelId = useId();
  const savedMode = settings?.automaticEnabled ?? false;
  const [automatic, setAutomatic] = useState(savedMode);
  const disabled = !settings || saving || (!enabled && !savedMode);
  const updated = settings?.updatedAt ? new Date(settings.updatedAt) : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!disabled && automatic !== savedMode) onSave(automatic);
  }

  return (
    <form className="admin-calculus-mode" onSubmit={submit} aria-label="Režim prenosa u Calculus">
      <label className="admin-calculus-toggle">
        <span>
          <strong id={labelId}>Automatski šalji porudžbine u Calculus</strong>
          <small id={helpId}>Kada odgovarajuća porudžbina pređe u status „U obradi“, sajt je stavlja u red za prenos.</small>
        </span>
        <input type="checkbox" role="switch" checked={automatic} disabled={disabled} aria-labelledby={labelId} aria-describedby={helpId}
          onChange={(event) => setAutomatic(event.target.checked)} />
        <span aria-hidden="true" className="admin-calculus-switch" />
      </label>
      <div className="admin-calculus-actions">
        <button className="button button-dark" type="submit" disabled={disabled || automatic === savedMode}>
          {saving && <LoaderCircle className="account-spin" size={16} aria-hidden="true" />}
          {saving ? "Čuvanje…" : "Sačuvaj režim prenosa"}
        </button>
        {updated && Number.isFinite(updated.getTime()) && (
          <small>Režim sačuvan <time dateTime={updated.toISOString()}>{dateFormat.format(updated)}</time></small>
        )}
      </div>
    </form>
  );
}

const mappingPath = "/api/admin/calculus/mappings";

function MappingEditor({ api }: { api: MappingApi }) {
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ query: "" });
  const [results, setResults] = useState<MappingProduct[]>([]);
  const [selected, setSelected] = useState<MappingProduct | null>(null);
  const [articleCode, setArticleCode] = useState("");
  const [taxCode, setTaxCode] = useState("");
  const [searching, setSearching] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: boolean; text: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ q: search.query });
    api<{ products: MappingProduct[] }>(mappingPath + "?" + params, { signal: controller.signal })
      .then(({ products }) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(products)) throw new Error("Rezultat pretrage nije dostupan. Pokušaj ponovo.");
        setResults(products);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFeedback({ error: true, text: error instanceof Error ? error.message : "Pretraga artikala trenutno nije dostupna." });
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearching(false);
      });
    return () => controller.abort();
  }, [api, search]);

  function select(product: MappingProduct) {
    setSelected(product);
    setArticleCode(product.articleCode ?? "");
    setTaxCode(product.taxCode ?? "");
    setConfirmRemove(false);
    setFeedback(null);
  }

  function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || searching) return;
    setSelected(null);
    setResults([]);
    setFeedback(null);
    setSearching(true);
    setSearch({ query: query.trim() });
  }

  const changed = articleCode.trim() !== (selected?.articleCode ?? "") || taxCode.trim() !== (selected?.taxCode ?? "");
  const canSave = Boolean(changed && articleCode.trim() && taxCode.trim());

  async function changeMapping(remove: boolean) {
    if (!selected || saving || (!remove && !canSave)) return;
    setSaving(true);
    setFeedback(null);
    const body = remove
      ? { productId: selected.id }
      : { productId: selected.id, articleCode: articleCode.trim(), taxCode: taxCode.trim() };
    try {
      const { product } = await api<{ product: MappingProduct }>(mappingPath, {
        method: remove ? "DELETE" : "PUT",
        body: JSON.stringify(body),
      });
      setResults((previous) => previous.flatMap((item) => {
        if (item.id !== product.id) return [item];
        return remove && !search.query ? [] : [product];
      }));
      if (remove && !search.query) {
        setSelected(null);
        setConfirmRemove(false);
      } else {
        select(product);
      }
      setFeedback({ text: remove ? "Mapiranje je uklonjeno." : "Mapiranje je sačuvano." });
    } catch (error) {
      setFeedback({ error: true, text: error instanceof Error ? error.message : "Mapiranje trenutno nije sačuvano." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-calculus-mapping" aria-labelledby={titleId}>
      <header>
        <h3 id={titleId}>Šifre artikala</h3>
        <p>Pronađi artikal sa sajta i upiši njegove potvrđene šifre iz Calculusa.</p>
      </header>
      <form className="admin-calculus-search" onSubmit={runSearch}>
        <label>
          Naziv, šifra ili ID artikla
          <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={160} disabled={saving} />
        </label>
        <button className="button button-dark" type="submit" disabled={saving || searching}>
          <Search size={16} aria-hidden="true" /> Pretraži artikle
        </button>
      </form>

      <div className="admin-calculus-mapping-grid">
        {searching && <p className="admin-calculus-mapping-note" role="status">Učitavanje artikala…</p>}
        {!searching && results.length === 0 && !feedback?.error && (
          <p className="admin-calculus-mapping-note">{search.query ? "Nema artikala za taj upit." : "Ovde se prikazuju sačuvana mapiranja."}</p>
        )}
        {results.length > 0 && (
          <ul className="admin-calculus-mapping-list" aria-label={search.query ? "Pronađeni artikli" : "Sačuvana mapiranja"}>
            {results.map((product) => (
              <li key={product.id}>
                <button type="button" onClick={() => select(product)} aria-pressed={selected?.id === product.id} disabled={saving}>
                  <strong>{product.name}</strong>
                  <small>{product.sku ? `Šifra dobavljača ${product.sku} · ` : ""}ID artikla ${product.id}</small>
                  <small>{product.articleCode ? "Calculus " + product.articleCode : "Čeka šifru"}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected && (
          <form className="admin-calculus-mapping-form" aria-label="Mapiranje artikla" onSubmit={(event) => {
            event.preventDefault();
            void changeMapping(false);
          }}>
            <p><strong>{selected.name}</strong></p>
            <label>
              Šifra artikla u Calculusu
              <input
                value={articleCode}
                onChange={(event) => setArticleCode(event.target.value)}
                maxLength={120}
                disabled={saving}
                required
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </label>
            <label>
              Poreska šifra u Calculusu
              <input
                value={taxCode}
                onChange={(event) => setTaxCode(event.target.value)}
                maxLength={120}
                disabled={saving}
                required
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </label>
            <div className="admin-calculus-actions">
              <button className="button button-dark" type="submit" disabled={!canSave || saving || confirmRemove}>Sačuvaj mapiranje</button>
              {selected.articleCode && !confirmRemove && (
                <button className="admin-calculus-remove" type="button" onClick={() => setConfirmRemove(true)} disabled={saving}>Ukloni mapiranje</button>
              )}
            </div>
            {confirmRemove && (
              <div className="admin-calculus-remove-confirm">
                <p>Za naredne prenose može biti potrebna nova potvrđena šifra ovog artikla.</p>
                <button type="button" className="admin-calculus-remove" onClick={() => void changeMapping(true)} disabled={saving}>Potvrdi uklanjanje</button>
                <button type="button" className="admin-calculus-remove" onClick={() => setConfirmRemove(false)} disabled={saving}>Odustani</button>
              </div>
            )}
          </form>
        )}
      </div>
      {feedback && (
        <p className={feedback.error ? "admin-calculus-error" : "admin-calculus-mapping-note"} role={feedback.error ? "alert" : "status"}>
          {feedback.error ? <TriangleAlert size={17} aria-hidden="true" /> : <CircleCheck size={17} aria-hidden="true" />}
          {feedback.text}
        </p>
      )}
    </section>
  );
}

export function AdminCalculusSettings({ enabled, settings, saving, error, onSave, onOpenOrders, mappingApi }: Props) {
  const titleId = useId();
  const status = !enabled
    ? "Čeka aktivaciju"
    : !settings
      ? "Podešavanje nije dostupno"
      : settings.automaticEnabled
        ? "Automatski prenos"
        : "Ručni prenos";

  return (
    <section className="panel admin-calculus-settings" id="admin-calculus" aria-labelledby={titleId}>
      <header className="admin-calculus-header">
        <span className="admin-calculus-icon"><FileCheck2 size={24} aria-hidden="true" /></span>
        <div>
          <h2 id={titleId}>Calculus</h2>
          <p>Prenos porudžbina u nacrt za obradu u kasi.</p>
        </div>
        <span className="admin-calculus-status" data-mode={enabled && settings?.automaticEnabled ? "automatic" : undefined} role="status">
          {status}
        </span>
      </header>

      {!enabled && (
        <p className="admin-calculus-notice">
          <Info size={17} aria-hidden="true" />
          <span>{settings?.automaticEnabled
            ? "Veza sa Calculusom trenutno nije dostupna. Automatski režim možete isključiti."
            : "Režim prenosa postaje dostupan posle povezivanja i probe sa Calculusom."}</span>
        </p>
      )}

      {settings && (
        <dl className="admin-calculus-metrics" aria-label="Stanje prenosa">
          {metrics.map(({ key, label, icon: Icon }) => (
            <div key={key} data-kind={key}>
              <dt><Icon size={16} aria-hidden="true" />{label}</dt>
              <dd>{countFormat.format(settings.counts[key])}</dd>
            </div>
          ))}
        </dl>
      )}

      <TransferModeForm
        key={String(settings?.automaticEnabled)}
        enabled={enabled}
        settings={settings}
        saving={saving}
        onSave={onSave}
      />
      {error && <p className="admin-calculus-error" role="alert"><TriangleAlert size={17} aria-hidden="true" />{error}</p>}
      {mappingApi && <MappingEditor api={mappingApi} />}

      <footer className="admin-calculus-footer">
        <p>
          Prenos je dostupan za porudžbine pouzećem bez popusta, sa potvrđenim šiframa artikala i iznosom dostave.
          U ručnom režimu nacrt se šalje iz pregleda porudžbine. Fiskalni račun izdaje se u Calculus kasi.
        </p>
        {onOpenOrders && (
          <button type="button" className="admin-calculus-orders-link" onClick={onOpenOrders}>
            Otvori porudžbine <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
      </footer>
    </section>
  );
}

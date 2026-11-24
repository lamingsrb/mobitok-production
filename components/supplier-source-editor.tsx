"use client";

import { useState, type FormEvent } from "react";
import { Check, ChevronRight, Link2, LoaderCircle, RefreshCw } from "lucide-react";
import type { SupplierSourceSettings } from "@/lib/supplier-source-types";
import "./supplier-source-editor.css";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
export default function SupplierSourceEditor({ supplier, api, onSaved }: {
  supplier: string; api: Api; onSaved: (syncRequired: boolean) => void;
}) {
  const [settings, setSettings] = useState<SupplierSourceSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [authMode, setAuthMode] = useState("keep");
  const [headerName, setHeaderName] = useState("");
  const [headerValue, setHeaderValue] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const result = await api<{ settings: SupplierSourceSettings }>(`/api/admin/supplier-sources?supplier=${encodeURIComponent(supplier)}`);
      setSettings(result.settings);
      setEnabled(result.settings.enabled);
    } catch (err) { setError(err instanceof Error ? err.message : "Podešavanja izvora nisu učitana."); }
    finally { setLoading(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ settings: SupplierSourceSettings; syncRequired: boolean }>("/api/admin/supplier-sources", {
        method: "PATCH", body: JSON.stringify({ supplier, revision: settings.revision, enabled,
          ...(newUrl.trim() ? { newUrl: newUrl.trim() } : {}), authMode,
          ...(authMode === "replace" ? { authHeaderName: headerName.trim(), authHeaderValue: headerValue } : {}) }),
      });
      setSettings(result.settings);
      setEnabled(result.settings.enabled);
      setNewUrl("");
      setHeaderName("");
      setHeaderValue("");
      setAuthMode("keep");
      setMessage(result.syncRequired ? "Izvor je sačuvan. Osvežite katalog ovog dobavljača, pa ponovo uključite objavu u podešavanjima dobavljača."
        : "Podešavanja izvora su sačuvana.");
      onSaved(result.syncRequired);
    } catch (err) { setError(err instanceof Error ? err.message : "Izvor nije sačuvan. Pokušajte ponovo."); }
    finally { setSaving(false); }
  }
  return <details className="proc-source-editor" onToggle={event => {
    if (event.currentTarget.open && !settings && !loading) void load();
  }}>
    <summary><Link2 size={16} /> Adresa i pristup feedu <ChevronRight size={16} /></summary>
    {loading && <p className="proc-help" role="status"><LoaderCircle size={15} className="account-spin" /> Učitavamo podešavanja izvora…</p>}
    {error && <p className="proc-catalog-error" role="alert">{error}</p>}
    {message && <p className="proc-source-message" role="status">{message}</p>}
    {!loading && <button type="button" className="proc-source-reload" onClick={() => void load()} disabled={saving}>
      <RefreshCw size={13} /> Učitaj podešavanja izvora
    </button>}
    {settings && <form onSubmit={save}>
      <p className="proc-help">{settings.urlConfigured ? "Adresa feeda je podešena." : "Adresa feeda još nije podešena."} Sačuvana adresa i ključevi se ne prikazuju. Prazno polje zadržava postojeću adresu i pristup.</p>
      <p className="proc-help proc-source-impact">Promena adrese ili pristupnog ključa privremeno isključuje objavu ovog dobavljača. Zatim pokrenite „Osveži kataloge“ iznad liste i ponovo uključite prodajni katalog u „Podešavanja dobavljača“ ispod ovog obrasca.</p>
      {settings.urlManaged && <p className="proc-help">Adresa se trenutno vodi u serverskom okruženju. Za uređivanje ovde potrebno je ukloniti serversko nadjačavanje.</p>}
      <fieldset disabled={saving || loading}>
        <label>{supplier === "msmobile" ? "Nova adresa feeda (MS Mobile)" : "Nova adresa feeda (HTTPS)"}
          <input type="password" inputMode="url" autoComplete="new-password" spellCheck={false}
            value={newUrl} onChange={event => setNewUrl(event.target.value)} disabled={settings.urlManaged}
            maxLength={4096} placeholder="Prazno = zadrži postojeću adresu" />
        </label>
        {supplier === "msmobile" && <p className="proc-help">Za MS Mobile dozvoljena je i postojeća HTTP adresa na domenu msmobile.rs. Ostali dobavljači koriste HTTPS.</p>}
        <label className="proc-check"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />
          <span>Uključi sinhronizaciju ovog dobavljača</span>
        </label>
        <label>Pristupni ključ ili zaglavlje
          <select value={authMode} onChange={event => setAuthMode(event.target.value)} disabled={settings.authManaged}>
            <option value="keep">Zadrži postojeći pristup</option>
            <option value="replace">Unesi novi pristup</option>
            <option value="clear">Ukloni sačuvani pristup</option>
          </select>
        </label>
        <p className="proc-help">{settings.authManaged
          ? "Pristup ili prijava ovog dobavljača vodi se u serverskim podešavanjima. Promena adrese ga ne briše."
          : settings.authConfigured ? "Pristupni podatak je sačuvan." : "Poseban pristupni podatak nije sačuvan; adresa feeda može već sadržati pristup."}</p>
        {authMode === "replace" && <>
          <label>{supplier === "trig" ? "Naziv zaglavlja (nije potreban za 3G ključ)" : "Naziv zaglavlja"}
            <input value={headerName} onChange={event => setHeaderName(event.target.value)} maxLength={100}
              autoComplete="off" spellCheck={false} required={supplier !== "trig"} placeholder="Authorization ili X-Api-Key" />
          </label>
          <label>Novi ključ ili token
            <input type="password" value={headerValue} onChange={event => setHeaderValue(event.target.value)}
              autoComplete="new-password" maxLength={8192} required />
          </label>
        </>}
        {authMode === "clear" && <p className="proc-help">Čuvanjem uklanjate sačuvano zaglavlje ili ključ. Pristup koji je deo adrese ostaje u adresi.</p>}
      </fieldset>
      <button className="button button-dark" type="submit" disabled={saving || loading}>
        {saving ? <LoaderCircle size={16} className="account-spin" /> : <Check size={16} />} Sačuvaj izvor
      </button>
    </form>}
  </details>;
}

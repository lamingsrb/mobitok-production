"use client";

import { useEffect, useRef, useState, type FocusEvent } from "react";
import { Calculator, Plus, Trash2 } from "lucide-react";
// Podrazumevana tabela se namerno ne uvozi: ovaj kod ide u pregledac, a marza
// ne sme da stigne do kupaca. Editor radi samo sa tabelom iz admin API-ja.
import {
  cenaPoTabeli,
  indeksPraga,
  ispravnaTabelaMarze,
  NAJVECA_GRANICA,
  NAJVECA_MARZA,
  NAJVISE_PRAGOVA,
  prikazIznosa,
  type MarginTier,
} from "@/lib/pricing";

// Tabela marze po nabavnoj ceni sa PDV-om (panel "Cene i marza").
//
// Svaki red je jedan prag: gornja granica nabavne cene i marza za sve cene do
// nje. Poslednji red nema granicu i vazi za sve skuplje. Tabela putuje u
// skrivenom polju forme, zajedno sa ostalim podesavanjima, a provera cene pored
// nje odmah pokazuje kojom bi cenom artikal izasao u prodavnicu.

type Red = { id: number; doIznosa: string; marza: string };

let sledeciId = 0;
const noviRed = (doIznosa: string, marza: string): Red => ({ id: ++sledeciId, doIznosa, marza });

// Prazno polje nije nula: Number("") je 0 i tiho bi proslo proveru.
const broj = (tekst: string) => (tekst.trim() === "" ? Number.NaN : Number(tekst));

// Iznos kako ga admin kuca: "4.312,44", "4312.44", "1.000" ili "1 000 RSD".
const procitajIznos = (tekst: string) => {
  const cisto = tekst.replace(/\s|rsd|din\.?/gi, "");
  if (!cisto) return Number.NaN;
  if (cisto.includes(",")) return Number(cisto.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(\.\d{3})+$/.test(cisto)) return Number(cisto.replace(/\./g, ""));
  return Number(cisto);
};

const procenat = (vrednost: number) =>
  new Intl.NumberFormat("sr-Latn-RS", { maximumFractionDigits: 2 }).format(vrednost) + "%";

const granica = (iznos: number | null) =>
  typeof iznos === "number" && Number.isFinite(iznos) ? prikazIznosa(iznos) : "…";

// Opseg reda u tabeli; gornja granica je polje odmah desno od njega.
const opseg = (pragovi: MarginTier[], i: number) => {
  if (pragovi.length === 1) return "Sve nabavne cene";
  if (i === 0) return "do";
  const od = granica(pragovi[i - 1].up_to);
  return i === pragovi.length - 1 ? `preko ${od} RSD` : `${od} do`;
};

// Isti opseg kao recenica, za proveru cene i citace ekrana.
const opsegTekst = (pragovi: MarginTier[], i: number) => {
  if (pragovi.length === 1) return "sve nabavne cene";
  if (i === pragovi.length - 1) return `preko ${granica(pragovi[i - 1].up_to)} RSD`;
  if (i === 0) return `do ${granica(pragovi[0].up_to)} RSD`;
  return `${granica(pragovi[i - 1].up_to)} do ${granica(pragovi[i].up_to)} RSD`;
};

const opisProblema = (redovi: Red[], pragovi: MarginTier[]) => {
  const poslednji = redovi.length - 1;
  if (redovi.some((red, i) => red.marza.trim() === "" || (i < poslednji && red.doIznosa.trim() === "")))
    return "Upiši granicu i maržu u svaki red.";
  if (pragovi.some((prag) => !Number.isFinite(prag.percent) || prag.percent < 0 || prag.percent > NAJVECA_MARZA))
    return `Marža mora biti između 0 i ${NAJVECA_MARZA}%.`;
  if (
    pragovi.some(
      (prag, i) =>
        i < poslednji && (!Number.isFinite(prag.up_to) || Number(prag.up_to) <= 0 || Number(prag.up_to) > NAJVECA_GRANICA),
    )
  )
    return `Granica mora biti veća od nule i najviše ${prikazIznosa(NAJVECA_GRANICA)} RSD.`;
  if (!ispravnaTabelaMarze(pragovi)) return "Granice moraju da rastu od reda do reda i ne smeju da se ponavljaju.";
  return "";
};

export default function MarginTiersEditor({ tabela, roundTo }: { tabela: MarginTier[]; roundTo: number }) {
  const [redovi, setRedovi] = useState<Red[]>(() =>
    ispravnaTabelaMarze(tabela)
      ? tabela.map((prag) => noviRed(prag.up_to === null ? "" : String(prag.up_to), String(prag.percent)))
      : [noviRed("", "")],
  );
  const [noviId, setNoviId] = useState<number | null>(null);
  const [proba, setProba] = useState("1.000");
  const listaRef = useRef<HTMLOListElement>(null);
  const dodajRef = useRef<HTMLButtonElement>(null);
  const fokusPosleBrisanja = useRef<number | null>(null);

  const pragovi: MarginTier[] = redovi.map((red, i) => ({
    up_to: i === redovi.length - 1 ? null : broj(red.doIznosa),
    percent: broj(red.marza),
  }));
  const problem = opisProblema(redovi, pragovi);
  const iznos = Math.round(procitajIznos(proba) * 100) / 100;
  const aktivan = !problem && iznos > 0 ? indeksPraga(iznos, pragovi) : -1;
  const cena = aktivan >= 0 ? cenaPoTabeli(iznos, { margin_tiers: pragovi, round_to: roundTo }) : 0;
  const korak = Number.isFinite(roundTo) && roundTo > 0 ? roundTo : 0;

  const promeni = (id: number, polje: "doIznosa" | "marza", vrednost: string) =>
    setRedovi((stari) => stari.map((red) => (red.id === id ? { ...red, [polje]: vrednost } : red)));

  // Redovi se poredjaju po granici tek kad admin izadje iz tabele. Dok kuca,
  // red ostaje na mestu, da mu polje ne pobegne ispod kursora.
  const poredjaj = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setRedovi((stari) => {
      const zatvoreni = stari.slice(0, -1);
      if (!zatvoreni.every((red) => Number.isFinite(broj(red.doIznosa)))) return stari;
      const poredjani = [...zatvoreni].sort((a, b) => broj(a.doIznosa) - broj(b.doIznosa));
      return poredjani.every((red, i) => red === zatvoreni[i]) ? stari : [...poredjani, stari[stari.length - 1]];
    });
  };

  // Nov prag ide pre poslednjeg reda, sa dvostruko vecom granicom od najvece i
  // marzom poslednjeg reda, pa ga admin samo doteruje.
  const dodaj = () => {
    if (redovi.length >= NAJVISE_PRAGOVA) return;
    const granice = pragovi
      .slice(0, -1)
      .map((prag) => Number(prag.up_to))
      .filter((iznos) => Number.isFinite(iznos));
    const doIznosa = granice.length ? Math.min(Math.max(...granice) * 2, NAJVECA_GRANICA) : 1000;
    const red = noviRed(String(doIznosa), redovi[redovi.length - 1].marza);
    setRedovi((stari) => [...stari.slice(0, -1), red, stari[stari.length - 1]]);
    setNoviId(red.id);
  };

  const ukloni = (id: number, i: number) => {
    fokusPosleBrisanja.current = i;
    setRedovi((stari) => stari.filter((red) => red.id !== id));
  };

  // Obrisani red nosi fokus sa sobom; vraca se na brisanje reda koji je dosao
  // na njegovo mesto, da korisnik tastature ne zavrsi na vrhu strane.
  useEffect(() => {
    const i = fokusPosleBrisanja.current;
    if (i === null) return;
    fokusPosleBrisanja.current = null;
    const dugmad = listaRef.current?.querySelectorAll<HTMLButtonElement>(".account-margin-remove");
    const dugme = dugmad?.length ? dugmad[Math.min(i, dugmad.length - 1)] : dodajRef.current;
    dugme?.focus();
  }, [redovi]);

  return (
    <section className="account-margin" aria-labelledby="account-margin-title">
      <div className="account-margin-table" onBlur={poredjaj}>
        <div className="account-margin-head">
          <h3 id="account-margin-title">Marža po nabavnoj ceni</h3>
          <p>
            Nabavna cena je cena dobavljača sa PDV-om (na sajtu 3G „Moja cena sa PDV”). Granica
            pripada svom redu: nabavna cena tačno na granici dobija maržu tog reda.
          </p>
        </div>
        <div className="account-margin-cols" aria-hidden="true">
          <span>Nabavna cena sa PDV-om</span>
          <span>Marža</span>
        </div>
        <ol className="account-margin-rows" ref={listaRef}>
          {redovi.map((red, i) => {
            const poslednji = i === redovi.length - 1;
            const opis = opsegTekst(pragovi, i);
            return (
              <li
                key={red.id}
                className={"account-margin-row" + (poslednji ? " is-open" : "") + (i === aktivan ? " is-active" : "")}
              >
                <span className="account-margin-range">{opseg(pragovi, i)}</span>
                {!poslednji && (
                  <label className="account-margin-input account-margin-bound">
                    <span className="sr-only">Gornja granica, red {i + 1}</span>
                    <input
                      className="field"
                      type="number"
                      inputMode="decimal"
                      min={1}
                      max={NAJVECA_GRANICA}
                      step="any"
                      required
                      value={red.doIznosa}
                      autoFocus={red.id === noviId}
                      onFocus={(event) => event.currentTarget.select()}
                      onBlur={() => setNoviId(null)}
                      onChange={(event) => promeni(red.id, "doIznosa", event.target.value)}
                    />
                    <span className="account-margin-suffix" aria-hidden="true">
                      RSD
                    </span>
                  </label>
                )}
                <label className="account-margin-input account-margin-percent">
                  <span className="sr-only">Marža za {opis}</span>
                  <input
                    className="field"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={NAJVECA_MARZA}
                    step="any"
                    required
                    value={red.marza}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => promeni(red.id, "marza", event.target.value)}
                  />
                  <span className="account-margin-suffix" aria-hidden="true">
                    %
                  </span>
                </label>
                {poslednji ? (
                  <span className="account-margin-spacer" aria-hidden="true" />
                ) : (
                  <button
                    className="account-margin-remove"
                    type="button"
                    aria-label={`Ukloni prag ${opis}`}
                    title="Ukloni prag"
                    onClick={() => ukloni(red.id, i)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
        <div className="account-margin-actions">
          <button
            ref={dodajRef}
            className="button account-margin-add"
            type="button"
            onClick={dodaj}
            disabled={redovi.length >= NAJVISE_PRAGOVA}
          >
            <Plus size={16} />
            Dodaj prag
          </button>
          <p className="account-margin-error" aria-live="polite">
            {problem}
          </p>
        </div>
        <input type="hidden" name="marginTiers" value={JSON.stringify(pragovi)} />
      </div>
      <aside className="account-margin-aside">
        <div className="account-margin-check">
          <h3>
            <Calculator size={17} aria-hidden="true" />
            Proveri cenu
          </h3>
          <label>
            Nabavna cena sa PDV-om
            <input
              className="field"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={proba}
              onChange={(event) => setProba(event.target.value)}
              onKeyDown={(event) => {
                // Enter u proveri cene ne sme da sacuva podesavanja.
                if (event.key === "Enter") event.preventDefault();
              }}
            />
          </label>
          <dl>
            <dt>Prag</dt>
            <dd>{aktivan >= 0 ? opsegTekst(pragovi, aktivan) : "—"}</dd>
            <dt>Marža</dt>
            <dd>{aktivan >= 0 ? procenat(pragovi[aktivan].percent) : "—"}</dd>
          </dl>
          <p className="account-margin-price" aria-live="polite">
            <span>Prodajna cena</span>
            <strong>{aktivan >= 0 ? `${prikazIznosa(cena)} RSD` : "—"}</strong>
          </p>
          <small>
            {korak > 0
              ? `Zaokruženo naviše na ${prikazIznosa(korak)} RSD, pre popusta kupca.`
              : "Bez zaokruživanja, pre popusta kupca."}
          </small>
        </div>
        <p className="account-margin-note">
          <strong>Fantech</strong>
          Artikli sa „Fantech” u nazivu, brendu ili 3G kategoriji ne idu po tabeli. Njihova prodajna
          cena je 3G cena bez rabata, sa PDV-om (na 3G „Cena”), tačno na pare — na primer 4.791,60 RSD
          za tastaturu Fantech MK890V2. Popusti kupaca važe i za njih.
        </p>
      </aside>
    </section>
  );
}

"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, Search } from "lucide-react";
import { normalize } from "@/lib/catalog";
import { SPEC_MAX_VALUES } from "@/lib/catalog-specs";
import {
  SPEC_GROUPS,
  brandLabel,
  brandTileTitle,
  modelLabel,
  pluralSr,
  sortBrandTiles,
  sortModelTiles,
  type SpecOption,
  type TileKind,
} from "@/lib/device-tiles";
import { useStore, useT } from "./store-context";

const broj = (value: number) => value.toLocaleString("sr-Latn-RS");

// Klik na kategoriju ili podgrupu je navigacija, ne filter: zaglavlje na ovaj
// dogadjaj brise ukucani upit pretrage (feedback 20.10.2026, video 39).
export const PRETRAGA_OCISTI = "mobitok:ocisti-pretragu";
type KlikMisa = { button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean };
export const ocistiPretragu = (e?: KlikMisa) => {
  // Klik koji otvara novi tab ne menja ovu stranicu, pa ni njenu pretragu.
  if (e && ((e.button ?? 0) !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
  window.dispatchEvent(new Event(PRETRAGA_OCISTI));
};

// Tekst sa mestima {ime} koja se popunjavaju; prevod ostaje jedna cela recenica.
const popuni = (tekst: string, vrednosti: Record<string, string | number>) =>
  tekst.replace(/\{(\w+)\}/g, (_, ime: string) => String(vrednosti[ime] ?? ""));

// Imenica uz broj: na srpskom po padezima (1 model, 2 modela, 5 modela), na engleskom
// samo jedno ili vise. Same reci su kljucevi za prevod ("model" i "modela").
function useUnit() {
  const { language } = useStore();
  const t = useT();
  return (count: number, one: string, few: string, many: string) =>
    t(language === "en" ? (count === 1 ? one : many) : pluralSr(count, one, few, many));
}

// Broj artikala uz plocicu: "1 proizvod", "55 proizvoda" / "55 products".
function useCountLabel() {
  const unit = useUnit();
  return (count: number) => `${broj(count)} ${unit(count, "proizvod", "proizvoda", "proizvoda")}`;
}

// ---------------------------------------------------------------------------
// Stablo kategorija u bocnoj traci: aktivna kategorija je otvorena i pokazuje
// svoje podgrupe sa brojem artikala. Sve su pravi linkovi, pa rade i sa
// novim tabom i tastaturom.
// ---------------------------------------------------------------------------
export function CategoryTree({
  categories,
  category,
  subcategory,
  categoryCounts,
  subcategories,
  totalCount,
  hrefFor,
  renderIcon,
  subName,
  searchActive = false,
  countsKnown = true,
  onNavigate,
}: {
  categories: readonly { id: string; name: string }[];
  category: string;
  subcategory: string;
  categoryCounts: Record<string, number> | null;
  subcategories: [string, number][];
  totalCount: number | null;
  hrefFor: (key: "kategorija" | "podkategorija", value: string) => string;
  renderIcon: (id: string) => ReactNode;
  subName: (key: string) => string;
  // Dok je pretraga aktivna, klik na kategoriju vodi dalje (i brise upit) umesto da sklapa podgrupe.
  searchActive?: boolean;
  countsKnown?: boolean;
  // Obavesti katalog da je kupac izabrao stavku u stablu podgrupa.
  onNavigate?: () => void;
}) {
  const t = useT();
  const podgrupeId = useId();
  // Ponovni klik na otvorenu kategoriju sklapa njene podgrupe (feedback 20.10.2026,
  // video 44). Sklapanje je samo prikaz: adresa i spisak artikala ostaju isti, a
  // pri izboru druge kategorije ili podgrupe (i iz menija) stablo se opet otvara.
  const [sklopljeno, setSklopljeno] = useState({ category, subcategory, closed: false });
  if (sklopljeno.category !== category || sklopljeno.subcategory !== subcategory) {
    setSklopljeno({ category, subcategory, closed: false });
  }
  const closed = sklopljeno.category === category && sklopljeno.subcategory === subcategory && sklopljeno.closed;
  // Dok je pretraga aktivna brojaci bi pokazivali pogotke za upit, a klik na stavku
  // brise upit i otvara celu grupu, pa se tada ne crtaju ni brojaci ni prigusene grupe.
  const brojevi = !searchActive && countsKnown;
  return (
    <nav className="filter-group cat-tree-group" aria-label={t("Kategorije")}>
      <h3>{t("Kategorije")}</h3>
      <ul className="cat-tree">
        <li>
          <Link prefetch={false}
            href={hrefFor("kategorija", "")}
            scroll={false}
            className={"cat-link" + (!category ? " is-active" : "")}
            aria-current={!category ? "page" : undefined}
            onClick={ocistiPretragu}
          >
            <span className="cat-name">{t("Sve kategorije")}</span>
            {brojevi && totalCount !== null && <span className="filter-count">{broj(totalCount)}</span>}
          </Link>
        </li>
        {categories.map((item) => {
          const active = category === item.id;
          const open = active && !closed;
          return (
            <li key={item.id} className={open ? "is-open" : undefined}>
              <Link prefetch={false}
                href={hrefFor("kategorija", item.id)}
                scroll={false}
                className={"cat-link" + (active ? " is-active" : "")}
                aria-expanded={open}
                aria-controls={open && subcategories.length > 0 ? podgrupeId : undefined}
                aria-current={active && !subcategory ? "page" : undefined}
                onClick={(e) => {
                  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  if (active && !searchActive) {
                    e.preventDefault();
                    setSklopljeno({ category, subcategory, closed: !closed });
                    return;
                  }
                  ocistiPretragu();
                }}
              >
                <span className="cat-icon" aria-hidden="true">{renderIcon(item.id)}</span>
                <span className="cat-name">{t(item.name)}</span>
                {brojevi && categoryCounts && <span className="filter-count">{broj(categoryCounts[item.id] ?? 0)}</span>}
              </Link>
              {open && subcategories.length > 0 && (
                <ul className="cat-tree-sub" id={podgrupeId} aria-label={t("Podkategorije")}>
                  {subcategories.map(([key, count]) => {
                    const selected = subcategory === key;
                    return (
                      <li key={key}>
                        <Link prefetch={false}
                          href={hrefFor("podkategorija", selected ? "" : key)}
                          scroll={false}
                          className={"cat-link" + (selected ? " is-active" : "") + (brojevi && count === 0 && !selected ? " is-empty" : "")}
                          aria-current={selected ? "page" : undefined}
                          onClick={(e) => {
                            ocistiPretragu(e);
                            if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) onNavigate?.();
                          }}
                        >
                          <span className="cat-name">{t(subName(key))}</span>
                          {brojevi && <span className="filter-count">{broj(count)}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Plocice brendova pa modela. Stanje potpuno proizlazi iz adrese stranice:
// bez brenda uredjaja je red brendova, sa brendom mreza modela, a izabran model
// skuplja mrezu u usku traku sa izabranim modelom. Dugme Nazad u pregledacu
// zato prirodno vraca korak po korak.
// ---------------------------------------------------------------------------
const MODEL_PAGE = 24;
const SEARCH_FROM = 12;
// Fokus i pomeranje se rade samo posle klika kupca, nikad pri ucitavanju sa linka.
// Zahtev stari od nekoliko sekundi je zaboravljen (klik koji nista nije promenio).
const FOKUS_VAZI_MS = 4000;

type FocusRequest = { kind: "heading" | "brand" | "results"; at: number };

// Naslov rezultata dobija fokus, a stranica se pomera do cele trake samo ako nije lepo
// vidljiva: na racunaru, gde je traka vec na ekranu, nista ne poskoci. Glatko pomeranje
// se gasi kad kupac trazi manje kretanja. Razmak ispod zaglavlja daje scroll-margin-top, a
// donja ivica zaglavlja se meri jer se kontakt traka i zaglavlje sklanjaju pri skrolu nadole i
// vracaju pri skrolu nagore (feedback 02.11.2026, snimak 1); sklonjeno zaglavlje ne zauzima nista.
function revealHeading(node: HTMLElement | null) {
  if (!node) return;
  node.focus({ preventScroll: true });
  const bar = node.closest<HTMLElement>(".device-tiles") ?? node;
  const rect = bar.getBoundingClientRect();
  const zaglavlje = Math.max(0, document.querySelector(".site-header")?.getBoundingClientRect().bottom ?? 0);
  if (rect.top >= zaglavlje && rect.bottom <= window.innerHeight * 0.8) return;
  const mirno = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  bar.scrollIntoView({ block: "start", behavior: mirno ? "auto" : "smooth" });
}

export function DeviceTiles({
  kind,
  subcategory,
  brands,
  models,
  activeBrand,
  activeModel,
  loading,
  refreshing,
  onBrand,
  onModel,
}: {
  kind: TileKind;
  subcategory: string;
  brands: [string, number][];
  models: [string, number][];
  activeBrand: string;
  activeModel: string;
  loading: boolean;
  refreshing: boolean;
  onBrand: (brand: string) => void;
  onModel: (model: string) => void;
}) {
  const t = useT();
  const countLabel = useCountLabel();
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastBrand = useRef("");
  const request = useRef<FocusRequest | null>(null);
  const ask = (kind: FocusRequest["kind"]) => {
    request.current = { kind, at: Date.now() };
  };
  useEffect(() => {
    const wanted = request.current;
    request.current = null;
    if (!wanted || Date.now() - wanted.at > FOKUS_VAZI_MS) return;
    if (wanted.kind === "brand") {
      const tile = Array.from(sectionRef.current?.querySelectorAll<HTMLButtonElement>("button[data-brand]") ?? []).find(
        (node) => node.dataset.brand === lastBrand.current,
      );
      tile?.focus({ preventScroll: true });
    } else if (wanted.kind === "results") {
      revealHeading(headingRef.current);
    } else {
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [activeBrand, activeModel]);

  const sortedBrands = sortBrandTiles(kind, brands);
  const refreshClass = refreshing ? " is-refreshing" : "";

  if (!activeBrand) {
    if (!sortedBrands.length) {
      if (!loading) return null;
      return (
        <section className="device-tiles" aria-hidden="true">
          <div className="tile-row">
            {Array.from({ length: 6 }, (_, index) => <span className="device-tile device-tile-skeleton" key={index} />)}
          </div>
        </section>
      );
    }
    return (
      <section className={"device-tiles" + refreshClass} ref={sectionRef} aria-labelledby={headingId} aria-busy={refreshing || undefined}>
        <h2 className="tiles-title" id={headingId}>{t("Izaberi brend")}</h2>
        <ul className="tile-row">
          {sortedBrands.map(([key, count]) => {
            const title = brandTileTitle(subcategory, kind, key, t);
            return (
              <li key={key}>
                <button
                  type="button"
                  className="device-tile"
                  data-brand={key}
                  title={title}
                  onClick={() => {
                    lastBrand.current = key;
                    ask("heading");
                    onBrand(key);
                  }}
                >
                  <span className="tile-text">
                    <span className="tile-label">{title}</span>
                    <span className="tile-count">{countLabel(count)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <ModelTiles
      key={activeBrand}
      kind={kind}
      subcategory={subcategory}
      brand={activeBrand}
      brandCount={brands.find(([key]) => key === activeBrand)?.[1] ?? null}
      sectionRef={sectionRef}
      models={sortModelTiles(models, activeBrand, kind)}
      activeModel={activeModel}
      loading={loading}
      refreshing={refreshing}
      headingRef={headingRef}
      headingId={headingId}
      countLabel={countLabel}
      onBack={() => {
        lastBrand.current = activeBrand;
        ask("brand");
        onBrand("");
      }}
      onModel={(next) => {
        // Izabran model skuplja mrezu, pa fokus i pomeranje idu na naslov rezultata.
        if (next) ask("results");
        onModel(next);
      }}
    />
  );
}

function ModelTiles({
  kind,
  subcategory,
  brand,
  brandCount,
  sectionRef,
  models,
  activeModel,
  loading,
  refreshing,
  headingRef,
  headingId,
  countLabel,
  onBack,
  onModel,
}: {
  kind: TileKind;
  subcategory: string;
  brand: string;
  brandCount: number | null;
  sectionRef: RefObject<HTMLElement | null>;
  models: [string, number][];
  activeModel: string;
  loading: boolean;
  refreshing: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  headingId: string;
  countLabel: (count: number) => string;
  onBack: () => void;
  onModel: (model: string) => void;
}) {
  const t = useT();
  const unit = useUnit();
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(MODEL_PAGE);
  // Mreza modela se ponovo otvara dugmetom "Promeni model", i to samo za model koji je
  // tada bio izabran: novi izbor opet skuplja mrezu u usku traku.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  const reopened = useRef(false);
  const picking = !activeModel || openFor === activeModel;
  useEffect(() => {
    if (!reopened.current || !picking) return;
    reopened.current = false;
    const grid = gridRef.current;
    (grid?.querySelector<HTMLElement>('button[aria-pressed="true"]') ?? grid?.querySelector<HTMLElement>("button"))?.focus({
      preventScroll: true,
    });
  }, [picking]);

  const query = normalize(search.trim());
  const filtered = query
    ? models.filter(([key]) => normalize(modelLabel(brand, key, kind) + " " + key).includes(query))
    : models;
  let visible = filtered.slice(0, limit);
  const picked = filtered.find(([key]) => key === activeModel);
  if (picked && !visible.includes(picked)) visible = [picked, ...visible];
  const rest = filtered.length - visible.length;
  const title = brandTileTitle(subcategory, kind, brand, t);
  const withSearch = models.length > SEARCH_FROM;
  const modelsText = (count: number) => `${broj(count)} ${unit(count, "model", "modela", "modela")}`;
  const brandName = brandLabel(kind, brand);
  const modelCount = models.find(([key]) => key === activeModel)?.[1];

  const back = (
    <button type="button" className="tile-back" onClick={onBack}>
      <ArrowLeft size={16} aria-hidden="true" /> {t("Svi brendovi")}
    </button>
  );

  // Uska traka: izabran model (ili brend bez modela) i dugme za promenu. Mreza modela
  // je skupljena, pa su rezultati odmah ispod, i na telefonu.
  if (!picking || !models.length) {
    // Laptopovi nemaju modele (nisu deo kataloga), a telefonski brend bez modela (baterije)
    // ih ima nula: u oba slucaja je trazena traka sa brendom, bez poruke o praznini.
    if (!activeModel && loading && kind === "phone" && !models.length) {
      return (
        <section className={"device-tiles model-view" + (refreshing ? " is-refreshing" : "")} aria-labelledby={headingId} aria-busy="true">
          <div className="tiles-head">
            {back}
            <div className="tiles-heading">
              <h2 className="tiles-title" id={headingId} ref={headingRef} tabIndex={-1}>{title}</h2>
            </div>
          </div>
          <div className="tile-grid" aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => <span className="device-tile model-tile device-tile-skeleton" key={index} />)}
          </div>
        </section>
      );
    }
    return (
      <section
        className={"device-tiles model-view is-compact" + (refreshing ? " is-refreshing" : "")}
        aria-labelledby={headingId}
        aria-busy={refreshing || undefined}
        ref={sectionRef}
      >
        <div className="tiles-head">
          {back}
          <div className="tiles-heading">
            <div>
              <h2 className="tiles-title" id={headingId} ref={headingRef} tabIndex={-1}>{title}</h2>
              {activeModel ? (
                <p className="selected-model">
                  <span className="selected-chip" data-model={activeModel}>
                    {modelLabel(brand, activeModel, kind)}
                    {modelCount !== undefined && <span className="selected-chip-count">{countLabel(modelCount)}</span>}
                  </span>
                </p>
              ) : kind === "phone" ? (
                <p>{popuni(t("Prikazujemo sve proizvode marke {brand}."), { brand: brandName })}</p>
              ) : (
                brandCount !== null && <p>{countLabel(brandCount)}</p>
              )}
            </div>
          </div>
          {activeModel && (
            <button
              type="button"
              className="tile-change"
              onClick={() => {
                if (models.length) {
                  reopened.current = true;
                  setOpenFor(activeModel);
                } else {
                  onModel("");
                }
              }}
            >
              {models.length ? t("Promeni model") : t("Ukloni model")}
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className={"device-tiles model-view" + (refreshing ? " is-refreshing" : "")} aria-labelledby={headingId} aria-busy={refreshing || undefined}>
      <div className="tiles-head">
        {back}
        <div className="tiles-heading">
          <div>
            <h2 className="tiles-title" id={headingId} ref={headingRef} tabIndex={-1}>{title}</h2>
            <p>{t("Izaberi model") + " · " + modelsText(models.length)}</p>
          </div>
        </div>
        {withSearch && (
          <label className="tile-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              autoComplete="off"
              aria-label={t("Pretraži modele")}
              placeholder={t("Pretraži modele")}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setLimit(MODEL_PAGE);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && filtered.length === 1) {
                  event.preventDefault();
                  onModel(filtered[0][0]);
                }
              }}
            />
          </label>
        )}
      </div>
      {query && (
        <p className="sr-only" role="status" aria-live="polite">
          {modelsText(filtered.length)}
        </p>
      )}
      {filtered.length ? (
        <ul className="tile-grid" ref={gridRef}>
          {visible.map(([key, count]) => {
            const selected = key === activeModel;
            return (
              <li key={key}>
                <button
                  type="button"
                  className="device-tile model-tile"
                  aria-pressed={selected}
                  title={modelLabel(brand, key, kind)}
                  onClick={() => onModel(selected ? "" : key)}
                >
                  <span className="tile-label">{modelLabel(brand, key, kind)}</span>
                  <span className="tile-count">{countLabel(count)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="tile-note">{popuni(t("Nema modela za „{q}”."), { q: search })}</p>
      )}
      {rest > 0 && (
        <button type="button" className="tile-more" onClick={() => setLimit((current) => current + MODEL_PAGE)}>
          <ChevronDown size={16} aria-hidden="true" />
          {popuni(t("Prikaži još {n} {unit}"), {
            n: Math.min(MODEL_PAGE, rest),
            unit: unit(Math.min(MODEL_PAGE, rest), "model", "modela", "modela"),
          })}
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Svojstva punjaca (snaga, napon, struja, konektor) kao grupe potvrdnih polja.
// Po grupi se bira najvise SPEC_MAX_VALUES vrednosti (toliko prihvata i API).
// ---------------------------------------------------------------------------
const FIRST_VALUES = 4;
const numeric = (value: string) => {
  const parsed = parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

export function SpecFilterGroups({
  specs,
  selected,
  onToggle,
}: {
  specs: Record<string, SpecOption[]>;
  selected: Record<string, string[]>;
  onToggle: (key: string, value: string) => void;
}) {
  const t = useT();
  const hintId = useId();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (!SPEC_GROUPS.some(({ key }) => specs[key]?.length || selected[key]?.length)) return null;

  return (
    <section className="spec-filter-panel" aria-labelledby={hintId}>
      <h2 id={hintId}>{t("Svojstva punjača")}</h2>
      <div className="spec-filter-grid">
        {SPEC_GROUPS.map(({ key }) => {
          const chosen = selected[key] ?? [];
          const options = (specs[key] ?? []).filter((option) => option.count > 0 || chosen.includes(option.value));
          for (const value of chosen) {
            if (!options.some((option) => option.value === value)) options.push({ value, count: 0 });
          }
          if (!options.length) return null;
          const sorted = key === "Konektor"
            ? options.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "sr-Latn-RS", { numeric: true }))
            : options.sort((a, b) => numeric(a.value) - numeric(b.value) || a.value.localeCompare(b.value));
          const open = Boolean(expanded[key]);
          // Izabrane vrednosti ostaju vidljive i kad je spisak skracen.
          const shown = open || sorted.length <= FIRST_VALUES
            ? sorted
            : sorted.filter((option, index) => index < FIRST_VALUES || chosen.includes(option.value));
          const full = chosen.length >= SPEC_MAX_VALUES;
          return (
            <fieldset className="spec-group" key={key} data-spec={key} aria-describedby={full ? `${hintId}-${key}` : undefined}>
              <legend>{t(key)}</legend>
              {shown.map((option) => {
                const checked = chosen.includes(option.value);
                return (
                  <label className="checkbox-label" key={option.value}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={full && !checked}
                      onChange={() => onToggle(key, option.value)}
                    />
                    {option.value}
                    <span className="filter-count">{broj(option.count)}</span>
                  </label>
                );
              })}
              {full && (
                <p className="spec-hint" id={`${hintId}-${key}`} role="status">
                  {popuni(t("Najviše {n} vrednosti u jednoj grupi. Ukloni neku da izabereš drugu."), { n: SPEC_MAX_VALUES })}
                </p>
              )}
              {sorted.length > FIRST_VALUES && (
                <button
                  type="button"
                  className="spec-toggle"
                  aria-expanded={open}
                  onClick={() => setExpanded((current) => ({ ...current, [key]: !open }))}
                >
                  {open ? t("Prikaži manje vrednosti") : t("Prikaži sve vrednosti")}
                </button>
              )}
            </fieldset>
          );
        })}
      </div>
    </section>
  );
}

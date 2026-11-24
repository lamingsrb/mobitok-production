"use client";
import { resolveCatalogLocation } from "@/lib/catalog-layout";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
  FormEvent,
  Dispatch,
  SetStateAction,
} from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import Image from "next/image";
import ProductCardImage from "@/components/product-card-image";
import PaymentMethodPicker from "@/components/payment-method-picker";
import PaymentSecurityMarks from "@/components/payment-security-marks";
import { clearCheckoutAttempt, readCheckoutAttempt, safePaymentPagePath, saveCheckoutAttempt, type CheckoutAttempt } from "@/components/payment-return-panel";
import type { CheckoutPayment, PaymentMethod, PaymentMethodOption } from "@/lib/payment-types";
import { requestWithDeadline } from "@/lib/request-deadline";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Search,
  ShoppingBag,
  ShoppingCart,
  Heart,
  UserRound,
  Menu,
  X,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Plus,
  Minus,
  Check,
  SlidersHorizontal,
  Smartphone,
  Laptop,
  Gamepad2,
  Headphones,
  Wrench,
  Tv,
  Cpu,
  Bike,
  Watch,
  Car,
  Grid2X2,
  Home,
  Sparkles,
  Zap,
  ShieldCheck,
  Package,
  Truck,
  CheckCircle2,
  LoaderCircle,
  RotateCcw,
  Monitor,
  MousePointer2,
  MoveUpRight,
  AudioLines,
  Mail,
  Phone,
  Clock,
  Info,
  Bookmark,
  Command,
  Columns4,
  List,
  Joystick,
  Camera,
  Tablet,
  Dumbbell,
} from "lucide-react";
import {
  categories,
  Product,
} from "@/lib/catalog";
import {
  StoreProvider,
  useStore,
  useCatalog,
  resolveCart,
  usePrice,
  useCena,
  useProdavnica,
  useT,
  useTaxonomy,
  productLimit,
  cartIssues,
  catalogQuery,
  dovuciPrikaz,
} from "./store-context";

import { getClient } from "@/lib/supabase-browser";
import { orderPublicSpecs, publicSpecKey } from "@/lib/public-specs";
import { prikazIznosa } from "@/lib/pricing";
import { ocistiRok, opisDostave } from "@/lib/delivery-terms";
import ModelPicker from "./model-picker";
import { CategoryTree, DeviceTiles, PRETRAGA_OCISTI, SpecFilterGroups, ocistiPretragu } from "./catalog-navigation";
import { SPEC_GROUPS, SPEC_SUBS, brandLabel, facetEntries, facetSpecs, modelLabel, tileKind } from "@/lib/device-tiles";
import { SPEC_MAX_VALUES } from "@/lib/catalog-specs";
import { relocatedCategory } from "@/lib/catalog-taxonomy";

const AccountPanel = dynamic(() => import("./account-panel"), {
  loading: () => <div className="page-loading" role="status"><LoaderCircle className="spin" /> Učitavamo nalog…</div>,
});

const icons: Record<string, typeof Smartphone> = {
  mobilni: Smartphone,
  racunari: Laptop,
  laptop: Laptop,
  gejming: Gamepad2,
  audio: Headphones,
  alati: Wrench,
  tv: Tv,
  kucni: Home,
  delovi: Cpu,
  sport: Bike,
  satovi: Watch,
  auto: Car,
  konzole: Joystick,
  stalci: Camera,
  tableti: Tablet,
  fitnes: Dumbbell,
};
const catalogUrl = (values: Record<string, string>) =>
  "/katalog?" +
  new URLSearchParams(Object.entries(values).filter(([, v]) => v)).toString();
const confirmedMoney = (value: number) => prikazIznosa(value) + " RSD";
// Sediste je adresa registracije firme, ne prodajni prostor (pregled 18.10.2026).
const ONLINE_PRODAJA = "Isključivo onlajn prodaja — adresa sedišta nije maloprodajni objekat.";
// Sadrzaj artikla dolazi od dobavljaca i ne pise se rucno (pregled 18.10.2026).
const IZVOR_PODATAKA = "Nazive, fotografije, opise i specifikacije artikala preuzimamo iz kataloga dobavljača.";
function Icon({ category, size = 24 }: { category: string; size?: number }) {
  const Component = icons[category] || Package;
  return <Component size={size} strokeWidth={1.5} />;
}
// Admin 03.11: grupe za meni, podnozje i stablo filtera. Ugradjene su uvek tu, kao do sada;
// korisnicke grupe iz alata "Katalog" samo kada imaju aktivnih artikala (meta.categories).
function useGrupeMenija() {
  const { taxonomy, meta } = useStore();
  return useMemo(() => {
    const saArtiklima = new Set((meta?.categories ?? []).filter((c) => c.count > 0).map((c) => c.key));
    return taxonomy.groups.filter((g) => g.builtin || saArtiklima.has(g.id));
  }, [taxonomy, meta]);
}
function Logo() {
  return (
    <Link prefetch={false} href="/" className="logo" aria-label="MOBITOK početna">
      <Image
        src="/images/mobitok-logo.webp"
        alt="MOBITOK"
        width={720}
        height={197}
        priority
        className="logo-mark"
      />
    </Link>
  );
}
function ProductImage({
  product,
  className = "",
  priority = false,
}: {
  product: Product;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={product.image}
      alt={product.name}
      width={480}
      height={480}
      className={"product-image " + className}
      sizes="(max-width: 600px) 45vw, (max-width: 1100px) 30vw, 320px"
      priority={priority}
    />
  );
}
function Availability({ product }: { product: Product; detailed?: boolean }) {
  const status = product.availability || "check";
  // Artikal koji je na stanju ne trazi nikakvu oznaku — tisina je najcistiji
  // signal. Oznaka se pojavljuje samo kad kupac treba nesto da zna.
  if (status === "available") return null;
  return (
    <div className={"availability availability-" + status} data-testid="availability">
      <span className="availability-dot" aria-hidden="true" />
      <span>{status === "unavailable" ? "Trenutno nedostupno" : "Dostupnost se proverava"}</span>
    </div>
  );
}

function OrderJourney({ compact = false }: { compact?: boolean }) {
  const store = useStore();
  if (!resolveCart(store.cart, store.products).length) return null;
  return (
    <section className={"order-journey " + (compact ? "is-compact" : "")} aria-label="Kako pripremamo tvoj izbor">
      <div className="order-journey-icon"><Package size={23} /></div>
      <div>
        <span className="eyebrow">JEDNA KORPA. JEDAN PREGLED.</span>
        <h2>Sve za tvoj izbor na jednom mestu.</h2>
        <p>Potvrđuješ jednu porudžbinu, a naš tim proverava i priprema svaki artikal. Rok i način isporuke potvrđuju se posebno.</p>
        {!compact && <div className="order-journey-steps"><span><b>01</b> Tvoj izbor</span><ChevronRight size={15} /><span><b>02</b> Provera i priprema</span><ChevronRight size={15} /><span><b>03</b> Potvrda detalja</span></div>}
      </div>
    </section>
  );
}

function CartReadiness() {
  const store = useStore();
  const issues = cartIssues(store.cart, store.products, store.catalogComplete);
  if (!store.catalogComplete) return <div className="cart-readiness" role="status">
    <div>{store.catalogLoading ? <LoaderCircle className="spin" size={18} /> : <Info size={18} />}<strong>{store.catalogLoading ? "Učitavamo artikle iz tvoje korpe…" : "Katalog trenutno nije potpuno dostupan"}</strong></div>
    <p>Tvoj izbor je sačuvan. Dostupnost i ukupan iznos potvrdićemo kada završimo proveru.</p>
    {!store.catalogLoading && <button type="button" onClick={() => void store.refreshCatalog()}><RotateCcw size={15} />Pokušaj ponovo</button>}
  </div>;
  if (!issues.length && !store.catalogError) return null;
  return <div className="cart-readiness" role="status">
    <div><Info size={18} /><strong>{issues.length ? "Proveri svoj izbor" : "Katalog čeka osvežavanje"}</strong></div>
    {issues.length ? <ul>{issues.map((issue) => <li key={issue.id}>{issue.message}{!store.products.some((product) => product.id === issue.id) && <button type="button" onClick={() => store.setQuantity(issue.id, 0)}>Ukloni artikal</button>}</li>)}</ul> : <p>Dostupnost iz poslednjeg pregleda nije potvrda rezervacije.</p>}
    <button type="button" onClick={() => void store.refreshCatalog()} disabled={store.catalogLoading}><RotateCcw size={15} /> {store.catalogLoading ? "Proveravamo…" : "Proveri dostupnost ponovo"}</button>
  </div>;
}

export function ProductCard({ product }: { product: Product }) {
  const t = useT();
  const taxonomy = useTaxonomy();
  const formatPrice = usePrice();
  const cena = useCena();
  const { add, cart, setQuantity, favorites, toggleFavorite, popust, preparationMode, formatEur } =
    useStore();
  const uPripremi = preparationMode !== false;
  const inCart = cart.find((line) => line.productId === product.id);
  const quantity = inCart ? inCart.quantity : 0;
  const limit = productLimit(product);
  return (
    <article
      className="product-card"
      data-testid="product-card"
      data-product-id={product.id}
    >
      <div className="product-visual">
        <Link prefetch={false} href={"/proizvod/" + product.slug} className="product-image-link">
          <ProductCardImage product={product} />
        </Link>
        {/* Oznaka je nasa podkategorija; sirova vrsta artikla od dobavljaca je
            umela da bude pogresna ("MASKA" na tabletu, pregled 18.10.2026). */}
        {/* Feedback 03.11: oznaka podgrupe je veza do te podgrupe (ili kategorije, kad podgrupe nema). */}
        <Link prefetch={false}
          className="product-tag"
          data-testid="product-tag"
          href={catalogUrl({ kategorija: product.category, podkategorija: product.subcategory || "" })}
        >
          {product.subcategory ? t(taxonomy.subcategoryName(product.category, product.subcategory)) : t(taxonomy.categoryName(product.category))}
        </Link>
        <button
          className={
            "favorite-button " +
            (favorites.includes(product.id) ? "is-favorite" : "")
          }
          aria-label={
            (favorites.includes(product.id) ? "Ukloni iz" : "Dodaj u") +
            " favorite: " +
            product.name
          }
          onClick={() => toggleFavorite(product.id)}
        >
          <Heart
            size={18}
            fill={favorites.includes(product.id) ? "currentColor" : "none"}
          />
        </button>
        <Link prefetch={false} className="quick-view" href={"/proizvod/" + product.slug}>
          Pogledaj detalje <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="product-copy">
        <span className="product-brand">
          {product.brand || t(taxonomy.categoryName(product.category))}
        </span>
        <Link prefetch={false} href={"/proizvod/" + product.slug} className="product-name">
          {product.name}
        </Link>
        <Availability product={product} />
        <div className="product-bottom">
          {!uPripremi ? <div>
            <strong>
              {product.price > 0 ? formatPrice(cena(product.price)) : "Učitavamo cenu…"}
            </strong>
            {product.price > 0 && formatEur(cena(product.price)) && (
              <span className="price-caption">{formatEur(cena(product.price))}</span>
            )}
            {popust > 0 && (
              <span className="price-caption">
                {t("Tvoja cena, popust") + " " + popust + "%"}
              </span>
            )}
          </div> : <span className="preparation-price">Cena će biti objavljena uskoro</span>}
          {!uPripremi && product.price > 0 && <div
            className="card-stepper"
            data-testid="card-stepper"
            data-quantity={quantity}
          >
            <button
              type="button"
              className="card-stepper-button"
              aria-label={"Smanji količinu: " + product.name}
              disabled={quantity === 0}
              onClick={() => setQuantity(product.id, quantity - 1)}
            >
              <Minus size={15} />
            </button>
            <span className="card-stepper-value" aria-live="polite">
              <span className="sr-only">Količina u korpi: </span>
              {quantity}
            </span>
            <button
              type="button"
              className="card-stepper-button is-add"
              aria-label={
                quantity === 0
                  ? "Dodaj u korpu: " + product.name
                  : "Povećaj količinu: " + product.name
              }
              disabled={quantity >= limit}
              onClick={() =>
                quantity === 0
                  ? add(product.id)
                  : setQuantity(product.id, quantity + 1)
              }
            >
              <Plus size={15} />
            </button>
          </div>}
        </div>
      </div>
    </article>
  );
}
// Broj se upisuje citljivo ("064 307 8655"), a link za poziv dobija
// medjunarodni oblik, pa radi i sa stranog broja i iz aplikacija na racunaru.
function telHref(phone: string) {
  const cifre = phone.replace(/[^\d+]/g, "");
  return "tel:" + (/^0[1-9]/.test(cifre) ? "+381" + cifre.slice(1) : cifre);
}
// Telefon i e-mail prodavnice kao linkovi u recenici ("064 … ili office@…").
function KontaktLinkovi() {
  const shop = useProdavnica();
  return <>
    {shop.phone && <a href={telHref(shop.phone)}>{shop.phone}</a>}
    {shop.phone && shop.email && " ili "}
    {shop.email && <a href={"mailto:" + shop.email}>{shop.email}</a>}
  </>;
}
// Kontakt iznad zaglavlja (feedback 05.10.2026, po uzoru na HotSpot i Wincado):
// telefon i e-mail su stalno vidljivi i jednim dodirom pozivaju ili otvaraju
// poruku. Prikazuje se samo ono sto je vlasnik upisao u Admin -> Cene i marza.
// Traka ima stalnu visinu, pa se strana ne pomera dok stizu podaci prodavnice.
function ContactBar() {
  const t = useT();
  const shop = useProdavnica();
  return (
    <div className="contact-bar">
      <div className="contact-bar-inner page-width">
        {shop.phone && (
          <a className="contact-bar-item" href={telHref(shop.phone)} title={t("Pozovi") + " " + shop.phone}>
            <span className="contact-bar-icon" aria-hidden="true"><Phone size={13} /></span>
            <span className="contact-bar-label">{t("Telefon")}</span>
            <strong>{shop.phone}</strong>
          </a>
        )}
        {shop.email && (
          <a className="contact-bar-item" href={"mailto:" + shop.email} title={t("Pošalji e-mail") + " " + shop.email}>
            <span className="contact-bar-icon" aria-hidden="true"><Mail size={13} /></span>
            <span className="contact-bar-label">{t("E-mail")}</span>
            <strong>{shop.email}</strong>
          </a>
        )}
        {shop.hours && (
          <span className="contact-bar-item contact-bar-hours">
            <span className="contact-bar-icon" aria-hidden="true"><Clock size={13} /></span>
            <span className="contact-bar-label">{t("Radno vreme")}</span>
            <strong>{shop.hours}</strong>
          </span>
        )}
      </div>
    </div>
  );
}
// Izbor jezika je u zaglavlju ili meniju kategorija. Sve cene su u RSD.
function Switches({ className }: { className: string }) {
  const store = useStore();
  return (
    <div className={className}>
      <div
        className="currency-switch lang-switch"
        role="group"
        aria-label="Jezik sajta"
      >
        {(["sr", "en"] as const).map((kod) => (
          <button
            key={kod}
            type="button"
            className={store.language === kod ? "is-active" : ""}
            aria-pressed={store.language === kod}
            onClick={() => store.setLanguage(kod)}
          >
            {kod.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
// Meni "Sve kategorije" po uzoru na Wincado (feedback 05.10.2026, video 1):
// uzak spisak kategorija, a podkategorije se otvaraju desno cim mis predje
// preko kategorije, bez klika. Na telefonu i na ekranu bez misa isti spisak
// radi kao harmonika. Na racunaru podkategorije uvek stoje desno, i u niskom
// prozoru, gde se spisak kategorija skroluje (feedback 01.11.2026, slike 96-98).
// Upit mora da ostane isti kao u globals.css i cinematic-theme.css.
const HARMONIKA = "(max-width: 700px), (hover: none)";
const harmonika = () => window.matchMedia(HARMONIKA).matches;
// Isti red za kategoriju postoji kao veza (mis) i kao dugme harmonike; fokus
// ide na onaj koji se trenutno vidi.
const vidljivi = (koren: ParentNode | null | undefined, selektor: string) =>
  Array.from(koren?.querySelectorAll<HTMLElement>(selektor) ?? []).filter((el) => el.offsetParent !== null);
const RED = ".category-row, .category-toggle";
// Fokus koji pomere strelice otvara podkategorije, kao prelaz misa. Tab samo
// prolazi kroz kategorije, a podkategorije tada otvara dugme posle veze.
let fokusStrelicom = false;
const fokusiraj = (el: HTMLElement | null | undefined) => {
  if (!el) return;
  fokusStrelicom = true;
  try {
    el.focus();
  } finally {
    fokusStrelicom = false;
  }
};
function CategoryMenu({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  const t = useT();
  return (
    <div className="category-menu">
      <button
        type="button"
        className={"all-categories" + (open ? " active" : "")}
        data-category-trigger=""
        aria-expanded={open}
        aria-controls={open ? "category-menu-panel" : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown") return;
          e.preventDefault();
          setOpen(true);
          requestAnimationFrame(() => fokusiraj(vidljivi(document.getElementById("category-menu-panel"), RED)[0]));
        }}
      >
        <Grid2X2 size={17} /> {t("Sve kategorije")} <ChevronDown size={14} />
      </button>
      {open && <CategoryPanel setOpen={setOpen} />}
    </div>
  );
}
function CategoryPanel({ setOpen }: { setOpen: (open: boolean) => void }) {
  const t = useT();
  const { meta } = useStore();
  const taxonomy = useTaxonomy();
  const grupe = useGrupeMenija();
  const [aktivna, setAktivna] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tajmer = useRef<number | undefined>(undefined);
  // Dodir nema prelaz misa: prvi dodir otvara podkategorije, drugi vodi na
  // kategoriju. Pamti se sta je bilo otvoreno pre nego sto je fokus pomerio red.
  const dodir = useRef(false);
  const otvorenaPriDodiru = useRef<string | null>(null);
  // Putanja misa za poslednjih 150 ms: kad kupac krene udesno ka podkategorijama
  // i usput preseče susedni red, taj red se ne otvara odmah.
  const trag = useRef<{ x: number; t: number }[]>([]);
  const zaustavi = () => window.clearTimeout(tajmer.current);
  const zatvori = useCallback(
    (vratiFokus: boolean) => {
      setOpen(false);
      // Dugme je u lepljivom zaglavlju i vec se vidi. Bez preventScroll bi pregledac, zbog
      // scroll-padding-top, pomerio stranu nagore iako dugme ostaje na istom mestu.
      if (vratiFokus) vidljivi(document, "[data-category-trigger]")[0]?.focus({ preventScroll: true });
    },
    [setOpen],
  );
  useEffect(() => {
    const panel = panelRef.current;
    // Na telefonu je meni daleko od dugmeta u redosledu, pa fokus ulazi u njega.
    if (panel && window.matchMedia("(max-width: 700px)").matches) panel.focus({ preventScroll: true });
    const naTaster = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const fokus = document.activeElement;
      const grupa = fokus?.closest(".category-flyout");
      // Prvi Escape vraca sa podkategorije na kategoriju, drugi zatvara meni.
      if (grupa && panelRef.current?.contains(grupa)) {
        fokusiraj(vidljivi(grupa.closest(".category-item"), RED)[0]);
        return;
      }
      zatvori(!!fokus && !!panelRef.current?.contains(fokus));
    };
    const naPritisak = (e: PointerEvent) => {
      const cilj = e.target as Element | null;
      if (!cilj || panelRef.current?.contains(cilj) || cilj.closest("[data-category-trigger]")) return;
      zatvori(false);
    };
    const naIstoriju = () => zatvori(false);
    document.addEventListener("keydown", naTaster);
    document.addEventListener("pointerdown", naPritisak);
    window.addEventListener("popstate", naIstoriju);
    return () => {
      document.removeEventListener("keydown", naTaster);
      document.removeEventListener("pointerdown", naPritisak);
      window.removeEventListener("popstate", naIstoriju);
      window.clearTimeout(tajmer.current);
    };
  }, [zatvori]);
  // Promena velicine prozora menja nacin rada menija (harmonika ili podmeni sa
  // strane), pa se ponovo proverava da li se otvorena kategorija vidi.
  const [rezim, setRezim] = useState(0);
  useEffect(() => {
    const upit = window.matchMedia(HARMONIKA);
    const promena = () => setRezim((n) => n + 1);
    upit.addEventListener("change", promena);
    return () => upit.removeEventListener("change", promena);
  }, []);
  // U harmonici se spisak pomera koliko treba da otvorena kategorija bude cela
  // vidljiva. Na racunaru podkategorije stoje desno, od vrha do dna menija
  // (feedback 01.11.2026, slike 96-98), pa ih ne treba pomerati.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !aktivna || !harmonika()) return;
    const stavka = panel.querySelector<HTMLElement>(`.category-item[data-kategorija="${aktivna}"]`);
    if (!stavka) return;
    const vrh = stavka.offsetTop, dno = vrh + stavka.offsetHeight;
    if (dno > panel.scrollTop + panel.clientHeight)
      panel.scrollTo({
        top: Math.min(vrh, dno - panel.clientHeight),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
  }, [aktivna, meta, rezim]);
  const podkategorije = (id: string) =>
    taxonomy.menuSubcategories(id, (meta?.subcategories ?? []).filter((s) => s.category === id).map((s) => s.key));
  const predji = (e: React.PointerEvent, id: string) => {
    if (e.pointerType !== "mouse" || harmonika()) return;
    zaustavi();
    if (aktivna === id) return;
    if (aktivna === null) {
      setAktivna(id);
      return;
    }
    const pocetak = trag.current.find((tacka) => e.timeStamp - tacka.t < 150);
    const kaDesno = !!pocetak && e.clientX - pocetak.x > 4;
    tajmer.current = window.setTimeout(() => {
      // Tastatura je u podkategorijama: mis u prolazu ne sme da ih sakrije sa fokusom.
      if (document.activeElement?.closest(".category-flyout")) return;
      setAktivna(id);
    }, kaDesno ? 320 : 90);
  };
  // Strelice: gore/dole kroz kategorije ili kroz podkategorije, desno ulazi u
  // podkategorije, levo se vraca na kategoriju.
  const strelice = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const cilj = e.target as HTMLElement;
    const pomeri = (lista: HTMLElement[], i: number) => {
      if (!lista.length) return;
      e.preventDefault();
      fokusiraj(lista[(i + lista.length) % lista.length]);
    };
    const redovi = vidljivi(panelRef.current, RED);
    // Dugme za podkategorije pripada redu svoje kategorije.
    const izvor = cilj.matches(".category-expand")
      ? cilj.closest(".category-item")?.querySelector<HTMLElement>(".category-row") ?? cilj
      : cilj;
    const red = redovi.indexOf(izvor);
    if (red >= 0) {
      if (e.key === "ArrowDown") pomeri(redovi, red + 1);
      else if (e.key === "ArrowUp") pomeri(redovi, red - 1);
      else if (e.key === "Home") pomeri(redovi, 0);
      else if (e.key === "End") pomeri(redovi, redovi.length - 1);
      else if (e.key === "ArrowRight" && !harmonika()) {
        const id = cilj.closest<HTMLElement>(".category-item")?.dataset.kategorija;
        if (!id) return;
        e.preventDefault();
        setAktivna(id);
        requestAnimationFrame(() => document.getElementById("meni-" + id)?.querySelector<HTMLElement>("a")?.focus());
      }
      return;
    }
    const grupa = cilj.closest<HTMLElement>(".category-flyout");
    if (!grupa) return;
    const veze = vidljivi(grupa, "a");
    const i = veze.indexOf(cilj);
    if (e.key === "ArrowDown") pomeri(veze, i + 1);
    else if (e.key === "ArrowUp") pomeri(veze, i - 1);
    else if (e.key === "ArrowLeft") {
      e.preventDefault();
      fokusiraj(vidljivi(grupa.closest(".category-item"), RED)[0]);
    }
  };
  return (
    <div
      ref={panelRef}
      id="category-menu-panel"
      className={"category-panel" + (aktivna ? " has-flyout" : "")}
      role="group"
      aria-label={t("Sve kategorije")}
      tabIndex={-1}
      onPointerDown={(e) => {
        dodir.current = e.pointerType !== "mouse";
        otvorenaPriDodiru.current = aktivna;
      }}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        trag.current = [...trag.current.filter((tacka) => e.timeStamp - tacka.t < 150), { x: e.clientX, t: e.timeStamp }];
      }}
      onPointerEnter={zaustavi}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse" || harmonika()) return;
        zaustavi();
        tajmer.current = window.setTimeout(() => {
          if (!panelRef.current?.contains(document.activeElement)) setAktivna(null);
        }, 300);
      }}
      onBlur={(e) => {
        const sledeci = e.relatedTarget as Element | null;
        if (sledeci && !panelRef.current?.contains(sledeci) && !sledeci.closest("[data-category-trigger]")) zatvori(false);
      }}
    >
      <Switches className="menu-switches" />
      <ul className="category-list" onKeyDown={strelice}>
        {grupe.map((c) => {
          const otvorena = aktivna === c.id;
          const spisak = podkategorije(c.id);
          return (
            <li
              key={c.id}
              className={"category-item" + (otvorena ? " is-active" : "")}
              data-kategorija={c.id}
              onPointerEnter={(e) => predji(e, c.id)}
            >
              {/* Veza vodi na stranu kategorije. Podkategorije sa tastature i citaca
                  ekrana otvara dugme posle veze, pa samo ono javlja da li su otvorene. */}
              <div className="category-line">
                <Link prefetch={false}
                  className="category-row"
                  href={catalogUrl({ kategorija: c.id })}
                  onFocus={() => {
                    zaustavi();
                    if (fokusStrelicom) setAktivna(c.id);
                    else setAktivna((a) => (a === c.id ? a : null));
                  }}
                  onClick={(e) => {
                    if (e.detail > 0 && dodir.current && otvorenaPriDodiru.current !== c.id && !harmonika()) {
                      e.preventDefault();
                      setAktivna(c.id);
                      return;
                    }
                    ocistiPretragu(e);
                    zatvori(false);
                  }}
                >
                  <Icon category={c.id} size={19} />
                  <span>{t(c.name)}</span>
                  <ChevronRight size={15} aria-hidden="true" />
                </Link>
                <button
                  type="button"
                  className="category-expand"
                  aria-label={t("Podkategorije") + ": " + t(c.name)}
                  aria-expanded={otvorena}
                  aria-controls={"meni-" + c.id}
                  onClick={() => setAktivna(otvorena ? null : c.id)}
                />
              </div>
              <button
                type="button"
                className="category-toggle"
                aria-expanded={otvorena}
                aria-controls={"meni-" + c.id}
                onClick={() => setAktivna(otvorena ? null : c.id)}
              >
                <Icon category={c.id} size={19} />
                <span>{t(c.name)}</span>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
              <div className="category-flyout" id={"meni-" + c.id} hidden={!otvorena}>
                <div className="category-flyout-head">
                  <strong>{t(c.name)}</strong>
                  <Link prefetch={false}
                    href={catalogUrl({ kategorija: c.id })}
                    aria-label={t("Pogledaj sve") + ": " + t(c.name)}
                    onClick={(e) => {
                      ocistiPretragu(e);
                      zatvori(false);
                    }}
                  >
                    {t("Pogledaj sve")} <ChevronRight size={14} aria-hidden="true" />
                  </Link>
                </div>
                {spisak.length > 0 && (
                  <ul
                    className={spisak.length > 10 ? "is-wide" : undefined}
                    style={spisak.length > 10 ? { gridTemplateRows: `repeat(${Math.ceil(spisak.length / 2)}, auto)` } : undefined}
                  >
                    {spisak.map((sub) => (
                      <li key={sub}>
                        <Link prefetch={false}
                          href={catalogUrl({ kategorija: c.id, podkategorija: sub })}
                          onClick={(e) => {
                            ocistiPretragu(e);
                            zatvori(false);
                          }}
                        >
                          <ChevronRight size={13} aria-hidden="true" />
                          {t(taxonomy.subcategoryName(c.id, sub))}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <Link prefetch={false}
        className="category-panel-footer"
        href="/katalog"
        onClick={(e) => {
          ocistiPretragu(e);
          zatvori(false);
        }}
      >
        {t("Pogledaj ceo asortiman")} <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </div>
  );
}
// Zaglavlje pamti ukucani upit u sebi, pa ga adresa sama ne brise. Kad se
// kategorija ili podgrupa promene ili adresa ostane bez q, upit se brise
// (feedback 20.10.2026, video 39), a upit iz adrese (i posle dugmeta Nazad) se
// vraca u polje. Posebna komponenta, da useSearchParams ima svoj Suspense i ne
// povlaci ceo sajt u klijentsko iscrtavanje. Ta granica se iscrtava tek posle
// hidratacije, pa prvo pojavljivanje ne brise niti prepisuje ono sto je kupac do
// tada ukucao; menja se samo na kasniju promenu adrese.
function PretragaSaAdresom({ onPostavi }: { onPostavi: Dispatch<SetStateAction<string>> }) {
  const params = useSearchParams();
  const kategorija = params.get("kategorija") || "",
    podkategorija = params.get("podkategorija") || "",
    q = params.get("q") || "";
  const kljuc = JSON.stringify([kategorija, podkategorija, q]);
  const poslednji = useRef<string | null>(null);
  useEffect(() => {
    if (poslednji.current === kljuc) return;
    const prviPut = poslednji.current === null;
    poslednji.current = kljuc;
    if (!prviPut) onPostavi(q);
    else if (q) onPostavi((upit) => upit || q);
  }, [kljuc, q, onPostavi]);
  return null;
}
// Kontakt traka i zaglavlje odlaze pri skrolu nadole, a vracaju se tek na vrhu
// strane (novi korisnicki snimak 06.11.2026; menja raniji povratak pri
// skrolu nagore iz feedback-a 02.11). Ostaju vidljivi dok je meni otvoren, dok se kuca
// pretraga i dok je fokus tastature u zaglavlju. Stanje je atribut na <html>, a pomeranje radi CSS.
const ZAGLAVLJE_POMAK = 8;
function useZaglavljeSeSklanja(zadrzi: boolean) {
  const zadrziRef = useRef(zadrzi);
  useEffect(() => {
    zadrziRef.current = zadrzi;
    if (zadrzi) delete document.documentElement.dataset.zaglavlje;
  }, [zadrzi]);
  useEffect(() => {
    const koren = document.documentElement;
    let poslednji = window.scrollY;
    let okvir = 0;
    const prikazi = () => {
      delete koren.dataset.zaglavlje;
    };
    const tastaturaUZaglavlju = () => {
      const fokus = document.activeElement;
      if (!fokus?.closest(".contact-bar, .site-header")) return false;
      try {
        return fokus.matches(":focus-visible");
      } catch {
        return false;
      }
    };
    const proveri = () => {
      okvir = 0;
      const y = Math.min(Math.max(window.scrollY, 0), koren.scrollHeight - window.innerHeight);
      if (y <= 1 || zadrziRef.current || tastaturaUZaglavlju()) {
        prikazi();
        poslednji = y;
        return;
      }
      if (Math.abs(y - poslednji) < ZAGLAVLJE_POMAK) return;
      if (y > poslednji) koren.dataset.zaglavlje = "skriveno";
      // Skrol nagore vise ne otkriva zaglavlje; vraca se tek na vrhu strane.
      poslednji = y;
    };
    const naSkrol = () => {
      if (!okvir) okvir = requestAnimationFrame(proveri);
    };
    const naFokus = (e: FocusEvent) => {
      if (e.target instanceof Element && e.target.closest(".contact-bar, .site-header")) {
        // Tab ne sme da ostavi fokus na kontroli izvan ekrana. Ako je zaglavlje
        // sakriveno, vracamo kupca na vrh zajedno sa fokusiranom kontrolom.
        if (koren.dataset.zaglavlje === "skriveno") window.scrollTo({ top: 0, behavior: "instant" });
        prikazi();
      }
    };
    window.addEventListener("scroll", naSkrol, { passive: true });
    document.addEventListener("focusin", naFokus);
    return () => {
      window.removeEventListener("scroll", naSkrol);
      document.removeEventListener("focusin", naFokus);
      cancelAnimationFrame(okvir);
      prikazi();
    };
  }, []);
}
function Header() {
  const t = useT();
  const taxonomy = useTaxonomy();
  const formatPrice = usePrice();
  const cena = useCena();
  const store = useStore(),
    router = useRouter();
  const [menu, setMenu] = useState(false),
    [query, setQuery] = useState(""),
    [focused, setFocused] = useState(false);
  useZaglavljeSeSklanja(menu || focused);
  // Predlozi se gase 180 ms posle izlaska iz polja, da klik na predlog stigne. Povratak
  // u polje u tom roku otkazuje gasenje, inace bi predlozi nestali dok se kuca.
  const gasenje = useRef<number | undefined>(undefined);
  const ocistiUpit = useCallback(() => setQuery(""), []);
  useEffect(() => {
    window.addEventListener(PRETRAGA_OCISTI, ocistiUpit);
    return () => window.removeEventListener(PRETRAGA_OCISTI, ocistiUpit);
  }, [ocistiUpit]);
  // Na sporom telefonu kupac stigne da kuca pre hidratacije. React taj tekst ne
  // prenosi u stanje, pa bi ga prvo sledece iscrtavanje polja obrisalo; zaglavlje
  // zato preuzme tekst i fokus koje zatekne u polju.
  const polje = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const ukucano = polje.current?.value;
    if (ukucano) setQuery((upit) => upit || ukucano);
    if (polje.current && document.activeElement === polje.current) setFocused(true);
  }, []);
  // Predlog trazi bazu, ne listu u pregledacu: kupac tako vidi ceo katalog, a
  // ne samo ono sto je slucajno vec otvorio. Kucanje se saceka u useCatalog.
  const trazeno = query.trim();
  const sapat = useCatalog({
    q: trazeno,
    sort: "relevance",
    velicina: 5,
    preskoci: trazeno.length < 2,
  });
  const matches = trazeno.length < 2 ? [] : sapat.items;
  // Korpa u zaglavlju pokazuje trenutni iznos (feedback 05.10.2026). Dok traje
  // priprema kupovina je zakljucana, pa korpa stoji prazna i ne odaje cene.
  const korpa = store.preparationMode === false ? store.cart : [];
  const stavke = resolveCart(korpa, store.products);
  const total = korpa.reduce((n, l) => n + l.quantity, 0);
  const iznosKorpe =
    store.catalogComplete || stavke.length === korpa.length
      ? formatPrice(stavke.reduce((s, l) => s + cena(l.product.price) * l.quantity, 0))
      : "…";
  return (
    <>
      <ContactBar />
      <Suspense fallback={null}>
        <PretragaSaAdresom onPostavi={setQuery} />
      </Suspense>
      <header className="site-header">
        <div className="header-main page-width">
          <button
            type="button"
            className="icon-button mobile-menu"
            data-category-trigger=""
            aria-label={t(menu ? "Zatvori kategorije" : "Otvori kategorije")}
            aria-expanded={menu}
            aria-controls={menu ? "category-menu-panel" : undefined}
            onClick={() => setMenu((v) => !v)}
          >
            {menu ? <X /> : <Menu />}
          </button>
          <Logo />
          <form
            className="header-search"
            action="/katalog"
            method="get"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              setFocused(false);
              // Fokus izlazi iz polja, pa se zaglavlje na rezultatima sklanja pri skrolu,
              // a tastatura na telefonu se spusta.
              polje.current?.blur();
              // Salje se ono sto pise u polju, i kad Enter stigne pre nego sto
              // zaglavlje preuzme tekst ukucan pre hidratacije.
              router.push(catalogUrl({ q: polje.current?.value ?? query }));
            }}
          >
            <Search size={19} />
            <input
              ref={polje}
              name="q"
              aria-label={t("Pretraži proizvode")}
              placeholder={t("Šta pokreće tvoj svet? Pronađi ovde.")}
              value={query}
              onFocus={() => {
                window.clearTimeout(gasenje.current);
                setFocused(true);
              }}
              onBlur={() => {
                gasenje.current = window.setTimeout(() => setFocused(false), 180);
              }}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>
              <Command size={11} /> K
            </kbd>
            {focused && query && (
              <div className="search-dropdown">
                <span className="eyebrow">{t("BRZI REZULTATI")}</span>
                {matches.length ? (
                  matches.map((p) => (
                    <Link prefetch={false}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setFocused(false)}
                      href={"/proizvod/" + p.slug}
                      key={p.id}
                    >
                      <ProductImage product={p} />
                      <span>
                        {p.name}
                        <small className="search-path">
                          {t(taxonomy.categoryName(p.category))}
                          {p.subcategory ? " › " + t(taxonomy.subcategoryName(p.category, p.subcategory)) : ""}
                        </small>
                        {store.preparationMode === false && <small>{formatPrice(cena(p.price))}</small>}
                      </span>
                      <ArrowUpRight size={17} />
                    </Link>
                  ))
                ) : trazeno.length < 2 ? (
                  <p className="search-status" role="status">{t("Upiši bar dva slova.")}</p>
                ) : sapat.ucitava ? (
                  // Dok odgovor ne stigne (i dok se kucanje ceka) nema "Nema rezultata":
                  // pregled 18.10.2026 je za JBL video tu poruku, a katalog je imao 54 artikla.
                  <p className="search-status" role="status">
                    <LoaderCircle className="spin" size={16} aria-hidden="true" /> {t("Tražimo…")}
                  </p>
                ) : sapat.greska ? (
                  <p className="search-status" role="status">
                    {t("Pretraga trenutno nije dostupna. Pokušaj ponovo.")}
                  </p>
                ) : (
                  <p className="search-status" role="status">
                    {t("Nema rezultata za „{q}”. Pokušaj naziv uređaja ili kategoriju.").replace("{q}", () => query)}
                  </p>
                )}
                <button className="search-all" type="submit">
                  {t("Pogledaj sve rezultate")} <ArrowRight size={16} />
                </button>
              </div>
            )}
          </form>
          <div className="header-actions">
            <Switches className="header-switches" />
            <Link prefetch={false} href="/nalog" className="header-account">
              <UserRound size={21} />
              <span>{store.signedIn ? t("Moj nalog") : t("Registruj se")}</span>
            </Link>
            <Link
              prefetch={false}
              href="/favoriti"
              className="icon-button header-favorite"
              aria-label={t("Sačuvani proizvodi")}
            >
              <Heart size={23} />
              {store.favorites.length > 0 && (
                <i className="count-dot">{store.favorites.length}</i>
              )}
            </Link>
            <button
              className="header-cart"
              onClick={() => store.setCartOpen(true)}
              aria-label={"Otvori korpu, " + total + " artikala, ukupno " + iznosKorpe}
            >
              <span className="header-cart-icon" aria-hidden="true">
                <ShoppingCart size={19} />
              </span>
              <span className="header-cart-total">{iznosKorpe}</span>
              {total > 0 && <b aria-hidden="true">{total}</b>}
            </button>
          </div>
        </div>
        <div className="nav-wrap">
          <nav
            className="desktop-nav page-width"
            aria-label="Glavna navigacija"
          >
            <CategoryMenu open={menu} setOpen={setMenu} />
            {/* Red sa precicama do kategorija je uklonjen (feedback 01.11.2026, slika 101): sve grupe su u meniju "Sve kategorije". */}
            <Link prefetch={false} className="nav-guide" href="/vodic">
              <Sparkles size={15} /> {t("Pametan izbor")}
            </Link>
          </nav>
        </div>
      </header>
    </>
  );
}
function MobileNav({ path }: { path: string[] }) {
  const t = useT();
  const { cart, favorites, setCartOpen, signedIn, preparationMode } = useStore();
  return (
    <nav className="mobile-nav" aria-label="Mobilna navigacija">
      <Link prefetch={false} className={!path.length ? "active" : ""} href="/">
        <Home />
        <span>{t("Početna")}</span>
      </Link>
      <Link prefetch={false} className={path[0] === "katalog" ? "active" : ""} href="/katalog">
        <Grid2X2 />
        <span>{t("Istraži")}</span>
      </Link>
      <Link prefetch={false} className={path[0] === "favoriti" ? "active" : ""} href="/favoriti">
        <Heart />
        <span>{t("Sačuvano")}</span>
        {favorites.length > 0 && <i>{favorites.length}</i>}
      </Link>
      <button onClick={() => setCartOpen(true)}>
        <ShoppingCart />
        <span>{t("Korpa")}</span>
        {preparationMode === false && cart.length > 0 && <i>{cart.reduce((a, l) => a + l.quantity, 0)}</i>}
      </button>
      <Link prefetch={false} className={path[0] === "nalog" ? "active" : ""} href="/nalog">
        <UserRound />
        <span>{signedIn ? t("Nalog") : t("Registracija")}</span>
      </Link>
    </nav>
  );
}
function Footer() {
  const prodavnica = useProdavnica();
  const grupe = useGrupeMenija();
  const language = useStore().language;
  const uPripremi = useStore().preparationMode !== false;
  const companyCity = prodavnica.companyAddress?.match(/\b\d{5}\s+([^,(]+)/)?.[1]?.trim();
  const companyAddress = companyCity
    ? `${prodavnica.companyAddress?.split(",")[0].trim()}, ${companyCity}`
    : prodavnica.companyAddress;
  return (
    <footer className="site-footer">
      <div className="footer-main page-width">
        <div className="footer-brand">
          <Logo />
          <p>
            Tehnologija koja se uklapa
            <br />u tvoj svet.
          </p>
          <Link href="/vodic">
            Pronađimo pravi izbor <ArrowUpRight size={18} />
          </Link>
        </div>
        <div>
          <h3>Istraži MOBITOK</h3>
          {grupe.map((c) => (
            <Link prefetch={false} key={c.id} href={catalogUrl({ kategorija: c.id })}>
              {c.name}
            </Link>
          ))}
        </div>
        <div>
          <h3>Tu smo za tebe</h3>
          <Link href="/podrska">Pomoć i česta pitanja</Link>
          <Link href="/dostava">Dostava i plaćanje</Link>
          <Link href="/povrat-i-reklamacije">Povrat i reklamacije</Link>
          <Link prefetch={false} href="/nalog">Moj nalog</Link>
        </div>
        <div>
          <h3>Više od prodavnice</h3>
          <Link href="/o-nama">Naša priča</Link>
          <Link href="/vodic">Vodič za dobar izbor</Link>
          <div className="footer-note">
            <span className="status-dot" /> {uPripremi ? "Sajt je u pripremi. Poručivanje nije dostupno." : "Upoznaj našu ponudu."}
          </div>
        </div>
      </div>
      {(prodavnica.phone || prodavnica.email || prodavnica.companyName) && (
        <div className="footer-contact page-width">
          {prodavnica.companyName && (
            <div className="footer-company-name">
              <span>Prodavac</span>
              <strong>{prodavnica.companyShortName || prodavnica.companyName}</strong>
            </div>
          )}
          {prodavnica.companyName && (companyAddress || prodavnica.companyPib || prodavnica.companyRegistrationNumber) && (
            <address className="footer-company-facts">
              {companyAddress && <span>{companyAddress}</span>}
              {prodavnica.companyPib && <span>PIB {prodavnica.companyPib}</span>}
              {prodavnica.companyRegistrationNumber && <span>MB {prodavnica.companyRegistrationNumber}</span>}
              {companyAddress && <span>{ONLINE_PRODAJA}</span>}
            </address>
          )}
          {(prodavnica.phone || prodavnica.email) && (
            <div className="footer-contact-links">
              {prodavnica.phone && <a href={telHref(prodavnica.phone)}>{prodavnica.phone}</a>}
              {prodavnica.email && <a href={"mailto:" + prodavnica.email}>{prodavnica.email}</a>}
            </div>
          )}
        </div>
      )}
      <div className="page-width"><PaymentSecurityMarks language={language} compact /></div>
      <div className="footer-bottom page-width">
        <span>© 2026 MOBITOK. Telefoni i oprema.</span>
        {/* Link ka administraciji je uklonjen iz podnozja (pregled 18.10.2026);
            /admin i dalje radi za administratore, a zastita je na serveru. */}
        <div>
          <Link href="/privatnost">Privatnost</Link>
          <Link href="/uslovi">Uslovi korišćenja</Link>
        </div>
      </div>
    </footer>
  );
}
function SellerDetails({ className = "" }: { className?: string }) {
  const company = useProdavnica();
  if (!company.companyName) return null;
  const started = company.companyStartedOn?.split("-").reverse().join(".");
  return <address className={className}>
    <strong>{company.companyName}</strong>
    {company.companyShortName && <span>Skraćeno poslovno ime: {company.companyShortName}</span>}
    {company.companyAddress && <span>Sedište: {company.companyAddress}</span>}
    <span>{[company.companyRegistrationNumber && `Matični broj: ${company.companyRegistrationNumber}`, company.companyPib && `PIB: ${company.companyPib}`].filter(Boolean).join(" · ")}</span>
    {started && <span>Početak obavljanja delatnosti: {started}.</span>}
    {company.companyActivity && <span>Pretežna delatnost: {company.companyActivity}</span>}
    {company.companyAddress && <span>{ONLINE_PRODAJA}</span>}
  </address>;
}
export function DeviceFinder({ deferUntilIntent = false }: { deferUntilIntent?: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [finderReady, setFinderReady] = useState(!deferUntilIntent);
  const activateFinder = useCallback(() => setFinderReady(true), []);
  useEffect(() => {
    if (!deferUntilIntent || finderReady) return;
    const form = formRef.current;
    if (!form) return;
    if (typeof IntersectionObserver !== "function") { activateFinder(); return; }
    // A mobile browser may deliver an earlier offscreen entry and the visible one together.
    const bounds = form.getBoundingClientRect();
    if (bounds.height > 0 && bounds.bottom > 0 && bounds.top < window.innerHeight) { activateFinder(); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { activateFinder(); observer.disconnect(); }
    });
    observer.observe(form);
    return () => observer.disconnect();
  }, [deferUntilIntent, finderReady, activateFinder]);
  const router = useRouter(),
    [kind, setKind] = useState("maske"),
    [brand, setBrand] = useState(""),
    [model, setModel] = useState("");
  // Brojaci obuhvataju celu ponudu izabrane vrste, nezavisno od stranice.
  // Model koji postoji samo medju staklima ne sme da se nudi medju maskama.
  const ponuda = useCatalog({
    kategorija: "mobilni",
    podkategorija: kind,
    brendUredjaja: brand,
    velicina: 1,
    faseti: true,
    prefetch: false,
    preskoci: !finderReady,
  });
  const finderLoading = !finderReady || ponuda.ucitava;
  const finderError = ponuda.greska || ponuda.facetsUnavailable === true;
  const brandList = facetEntries(ponuda.facets?.deviceBrands).map(([key]) => key);
  // useCatalog zadrzava prethodne brojace dok novi stizu. U obrascu tada ne
  // nudimo stare modele kao da pripadaju upravo izabranoj vrsti i brendu.
  const models = finderLoading || finderError ? [] : facetEntries(ponuda.facets?.deviceModels)
    .map(([key]) => key)
    .sort((a, b) => a.localeCompare(b, "sr"));
  return (
    <section className="device-finder">
      <div className="finder-intro">
        <div className="finder-icon">
          <Smartphone size={25} />
          <span>
            <Check size={9} />
          </span>
        </div>
        <div>
          <span className="eyebrow">PRAVI SPOJ, IZ PRVE.</span>
          <h2>Koji uređaj koristiš?</h2>
          <p>Pronađi opremu koja mu savršeno odgovara.</p>
        </div>
      </div>
      <form
        ref={formRef}
        className="finder-form"
        onFocusCapture={activateFinder}
        onPointerEnter={activateFinder}
        onPointerDownCapture={activateFinder}
        onKeyDownCapture={activateFinder}
        onSubmit={(e) => {
          e.preventDefault();
          router.push(
            catalogUrl({
              kategorija: "mobilni",
              podkategorija: kind,
              brendUredjaja: brand,
              model,
            }),
          );
        }}
      >
        <label>
          <span>
            01 <b>Šta ti treba?</b>
          </span>
          <select
            aria-label="Vrsta opreme"
            value={kind}
            onChange={(e) => {
              activateFinder();
              setKind(e.target.value);
              setBrand("");
              setModel("");
            }}
          >
            <option value="maske">Maske</option>
            <option value="stakla">Zaštitna stakla za telefone</option>
            <option value="stakla-kamere">Zaštita za kameru</option>
            <option value="punjaci">Punjači</option>
            <option value="">Sva mobilna oprema</option>
          </select>
        </label>
        <label>
          <span>
            02 <b>Brend uređaja</b>
          </span>
          <select
            aria-label="Brend uređaja"
            value={brand}
            disabled={finderLoading || finderError}
            onChange={(e) => {
              setBrand(e.target.value);
              setModel("");
            }}
          >
            <option value="">Izaberi brend</option>
            {brandList.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <div className="finder-model-field">
          <span>
            03 <b>Model uređaja</b>
          </span>
          {finderLoading ? (
            <p className="model-picker-note" role="status">Učitavamo modele…</p>
          ) : finderError ? (
            <p className="model-picker-note" role="alert">
              Modele trenutno ne možemo da učitamo.{" "}
              <button type="button" className="text-link" onClick={ponuda.ponovi}>Pokušaj ponovo</button>
            </p>
          ) : !brand ? (
            <p className="model-picker-note">Prvo izaberi brend uređaja.</p>
          ) : !models.length ? (
            <p className="model-picker-note">Za ovu vrstu opreme nema izdvojenih modela za {brand}.</p>
          ) : (
            <ModelPicker key={kind + "/" + brand} brand={brand} models={models} value={model} onChange={setModel} />
          )}
        </div>
        <button className="button button-dark" type="submit">
          Pronađi <ArrowRight size={18} />
        </button>
      </form>
    </section>
  );
}
function SectionHeading({
  eyebrow,
  title,
  link = "/katalog",
  linkText = "Pogledaj sve",
}: {
  eyebrow: string;
  title: string;
  link?: string;
  linkText?: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <Link prefetch={false} className="text-link" href={link}>
        {linkText}
        <ArrowUpRight size={19} />
      </Link>
    </div>
  );
}
function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  const t = useT();
  return (
    <nav className="breadcrumb" aria-label={t("Putanja")}>
      <Link prefetch={false} href="/">{t("Početna")}</Link>
      {items.map((item, i) => (
        <span key={i}>
          <ChevronRight size={12} />
          {item.href ? (
            <Link prefetch={false} href={item.href}>{t(item.label)}</Link>
          ) : (
            <span>{t(item.label)}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
// Kupac bira koliko artikala vidi odjednom; 48 je podrazumevano i ne pise se u adresu
// (feedback 01.11.2026, slika 44; ranije 24).
const VELICINE_STRANE = [24, 48, 96];
// Klijent je 05.10.2026. trazio da se izbaci prikaz sa tri artikla u redu:
// podrazumevano su cetiri, a lista ostaje kao drugi izbor.
type Raspored = "4" | "lista";
const RASPOREDI: { id: Raspored; label: string; ikona: typeof Smartphone }[] = [
  { id: "4", label: "Četiri artikla u redu", ikona: Columns4 },
  { id: "lista", label: "Artikli jedan ispod drugog", ikona: List },
];
// Pretraga unutar izabrane grupe (feedback 01.11.2026, video 67): kucanje posle kratke
// pauze menja q u adresi, a kategorija i podgrupa ostaju; jedno slovo se ne salje.
function PretragaGrupe({ category, subcategory, query }: { category: string; subcategory: string; query: string }) {
  const t = useT();
  const taxonomy = useTaxonomy();
  const router = useRouter();
  const [tekst, setTekst] = useState(query);
  const poslato = useRef(query);
  useEffect(() => {
    if (query === poslato.current) return;
    poslato.current = query;
    setTekst(query);
  }, [query]);
  useEffect(() => {
    const upit = tekst.trim();
    if (upit === poslato.current || upit.length === 1) return;
    const tajmer = window.setTimeout(() => {
      poslato.current = upit;
      const next = new URLSearchParams(window.location.search);
      next.delete("stranica");
      if (upit) next.set("q", upit);
      else {
        next.delete("q");
        if (next.get("sort") === "relevance") next.delete("sort");
      }
      router.replace("/katalog?" + next.toString(), { scroll: false });
    }, 350);
    return () => window.clearTimeout(tajmer);
  }, [tekst, router]);
  const naziv = t(subcategory ? taxonomy.subcategoryName(category, subcategory) : taxonomy.categoryName(category));
  return (
    <label className="catalog-group-search" role="search">
      <Search size={16} aria-hidden="true" />
      <input
        type="search"
        autoComplete="off"
        maxLength={80}
        value={tekst}
        onChange={(e) => setTekst(e.target.value)}
        placeholder={t("Pretraži") + ": " + naziv}
        aria-label={t("Pretraga u grupi") + ": " + naziv}
      />
    </label>
  );
}
function Catalog() {
  const { meta, mergeProducts, preparationMode, catalogEpoch } = useStore();
  const taxonomy = useTaxonomy();
  const grupe = useGrupeMenija();
  const uPripremi = preparationMode !== false;
  const t = useT();
  const formatPrice = usePrice();
  const cena = useCena();
  const params = useSearchParams(),
    router = useRouter();
  const category = params.get("kategorija") || "",
    subcategory = params.get("podkategorija") || "",
    deviceBrand = params.get("brendUredjaja") || "",
    model = params.get("model") || "",
    query = params.get("q") || "",
    brand = params.get("brend") || "";
  // Sortiranje zivi u adresi stranice, da se takav prikaz moze poslati linkom.
  // Tekstualna pretraga prvo prikazuje najbolje poklapanje. Pregled kataloga
  // i kategorija prvo prikazuje najnovije artikle.
  const podrazumevaniSort = query ? "relevance" : "newest";
  const sort = params.get("sort") || podrazumevaniSort;
  const [maxPrice, setMaxPrice] = useState<number | null>(null),
    [filtersOpen, setFiltersOpen] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const scrolledSubgroup = useRef("");
  const trazenaStrana = Number(params.get("stranica") || 1);
  const page =
    Number.isSafeInteger(trazenaStrana) && trazenaStrana > 0 ? Math.min(trazenaStrana, 5000) : 1;
  const trazenaVelicina = Number(params.get("po"));
  const pageSize = VELICINE_STRANE.includes(trazenaVelicina) ? trazenaVelicina : 48;
  // Raspored kartica je licni izbor na racunaru, pa se pamti u ovom pregledacu,
  // a ne u adresi. Na tabletu i telefonu raspored ostaje prilagodjen ekranu.
  // Ranije sacuvan izbor "3" vise ne postoji i tiho postaje podrazumevani "4".
  const [raspored, setRaspored] = useState<Raspored>("4");
  useEffect(() => {
    try {
      const sacuvan = localStorage.getItem("mh-katalog-raspored");
      if (sacuvan === "lista") setRaspored(sacuvan);
    } catch {}
  }, []);
  const izaberiRaspored = (izbor: Raspored) => {
    setRaspored(izbor);
    try {
      localStorage.setItem("mh-katalog-raspored", izbor);
    } catch {}
  };
  const rasporedKlasa = raspored === "lista" ? " grid-list" : " grid-4";
  // Filtriranje, sortiranje i brojace radi baza, koja za to ima indekse.
  // Pregledac dobija tacno jednu stranicu, pa broj artikala u katalogu ne utice
  // ni na brzinu prikaza ni na potrosnju memorije.
  // Svojstva punjaca (snaga, napon, struja, konektor) zive u adresi stranice i
  // mogu se ponoviti: vise vrednosti iste grupe je ILI, razlicite grupe su I.
  const specSelected: Record<string, string[]> = {};
  const specUpit: Record<string, string[]> = {};
  for (const { key, param } of SPEC_GROUPS) {
    const values = params.getAll(param).filter(Boolean);
    if (values.length) { specSelected[key] = values; specUpit[param] = values; }
  }
  const upit = {
    q: query,
    kategorija: category,
    podkategorija: subcategory,
    brendUredjaja: deviceBrand,
    model,
    brend: brand,
    spec: Object.keys(specUpit).length ? specUpit : undefined,
    maxCena: uPripremi ? null : maxPrice,
    sort: uPripremi && (sort === "low" || sort === "high") ? podrazumevaniSort : sort,
    velicina: pageSize,
  };
  const katalog = useCatalog({ ...upit, strana: page, faseti: true });
  const subgroupLocation = subcategory ? `${category}/${subcategory}` : "";
  useLayoutEffect(() => {
    if (!subgroupLocation) {
      scrolledSubgroup.current = "";
    } else if (!katalog.ucitava && scrolledSubgroup.current !== subgroupLocation) {
      scrolledSubgroup.current = subgroupLocation;
      resultsRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, [subgroupLocation, katalog.ucitava]);
  const faseti = katalog.facets;
  const ukupno = katalog.total;
  // Adresa koja nastaje promenom jednog filtera; isto pravilo vazi za klik i za
  // linkove u bocnom stablu. Zavisni izbori se brisu: brendovi i modeli
  // telefona i laptopova su razlicite liste, a svojstva vaze samo za punjace.
  // Izbor kategorije ili podgrupe u stablu je navigacija i brise pretragu
  // (feedback 20.10.2026, video 39); isti izbor preko dugmeta filtera ("x" na
  // izabranoj kategoriji) i svi ostali filteri zadrzavaju q.
  const buildParams = (key: string, value: string, izStabla = false) => {
    const next = new URLSearchParams(params.toString());
    if (key !== "stranica") next.delete("stranica");
    if (value) next.set(key, value);
    else next.delete(key);
    if (izStabla && (key === "kategorija" || key === "podkategorija")) {
      next.delete("q");
      if (next.get("sort") === "relevance") next.delete("sort");
    }
    const clearDependent = (...names: string[]) => names.forEach((name) => next.delete(name));
    const clearSpecs = () => SPEC_GROUPS.forEach(({ param }) => next.delete(param));
    if (key === "kategorija") {
      clearDependent("podkategorija", "brendUredjaja", "model", "brend");
      clearSpecs();
    }
    if (key === "podkategorija") {
      // Izmedju dve podgrupe telefona (maske, stakla...) izabrani telefon ostaje.
      const phoneFrom = (subcategory !== "telefoni" && tileKind(subcategory) === "phone") || (!subcategory && category === "mobilni");
      if (!(phoneFrom && value !== "telefoni" && tileKind(value) === "phone")) clearDependent("brendUredjaja", "model");
      clearDependent("brend");
      clearSpecs();
    }
    if (key === "brendUredjaja") next.delete("model");
    return next;
  };
  const adresaKataloga = (next: URLSearchParams) => (next.toString() ? "/katalog?" + next.toString() : "/katalog");
  const update = (key: string, value: string) => {
    router.push(adresaKataloga(buildParams(key, value)), { scroll: false });
  };
  const toggleSpec = (specKey: string, value: string) => {
    const param = SPEC_GROUPS.find((group) => group.key === specKey)?.param;
    if (!param) return;
    const next = new URLSearchParams(params.toString());
    next.delete("stranica");
    const current = next.getAll(param);
    // Najvise SPEC_MAX_VALUES vrednosti po grupi (toliko prihvata i API): uklanjanje
    // je uvek dozvoljeno, dodavanje preko granice se tiho preskace.
    if (!current.includes(value) && current.length >= SPEC_MAX_VALUES) return;
    next.delete(param);
    (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]).forEach((item) =>
      next.append(param, item),
    );
    router.push(adresaKataloga(next), { scroll: false });
  };
  const removeFilter = (key: string, value: string) => {
    const spec = SPEC_GROUPS.find((group) => group.param === key);
    if (spec) toggleSpec(spec.key, value);
    else update(key, "");
  };
  // Shared links follow moved groups. Removed phone parts stay unavailable.
  const currentQuery = params.toString();
  useEffect(() => {
    // Wait for authoritative placement before legacy aliases can redirect a newly moved-back subgroup.
    if (!meta) return;
    const old = new URLSearchParams(currentQuery);
    const original: [string, string] = [old.get("kategorija") || "", old.get("podkategorija") || ""];
    const structural = resolveCatalogLocation(meta?.layout, ...original);
    const explicit = meta?.layout?.aliases.some((alias) => alias.parent === original[0] && alias.slug === original[1]);
    const target = structural[0] !== original[0] || structural[1] !== original[1] ? structural
      : explicit ? null : relocatedCategory(...original);
    if (!target) return;
    old.set("kategorija", target[0]);
    if (target[1]) old.set("podkategorija", target[1]);
    else old.delete("podkategorija");
    if (!explicit) old.delete("stranica");
    router.replace("/katalog?" + old.toString(), { scroll: false });
  }, [currentQuery, router, meta]);
  const filterEntries = Array.from(params.entries()).filter(
    ([key, value]) => value && key !== "sort" && key !== "stranica" && key !== "po",
  );
  const pageCount = katalog.pages;
  const prvaStrana = Math.min(page, pageCount);
  // "Prikazi jos" dodaje sledecu stranu ispod vec prikazanih artikala, bez
  // napustanja stranice. Dodato vazi samo za ovaj izbor: promena filtera,
  // sortiranja ili stranice ga brise.
  const kljucIzbora = catalogEpoch + ":" + catalogQuery({ ...upit, strana: page });
  const [dodato, setDodato] = useState<{ kljuc: string; strane: Product[][]; stanje: "" | "ucitava" | "greska" }>({
    kljuc: "",
    strane: [],
    stanje: "",
  });
  const dodateStrane = dodato.kljuc === kljucIzbora ? dodato.strane : [];
  const stanjeDodavanja = dodato.kljuc === kljucIzbora ? dodato.stanje : "";
  const poslednjaStrana = Math.min(prvaStrana + dodateStrane.length, pageCount);
  const prikazani = Array.from(
    new Map([...katalog.items, ...dodateStrane.flat()].map((p) => [p.id, p])).values(),
  );
  const prikaziJos = async () => {
    if (stanjeDodavanja === "ucitava" || poslednjaStrana >= pageCount) return;
    setDodato({ kljuc: kljucIzbora, strane: dodateStrane, stanje: "ucitava" });
    try {
      const sledeca = await dovuciPrikaz({ ...upit, strana: poslednjaStrana + 1 });
      mergeProducts(sledeca.items);
      setDodato((pre) =>
        pre.kljuc === kljucIzbora ? { kljuc: kljucIzbora, strane: [...pre.strane, sledeca.items], stanje: "" } : pre,
      );
    } catch {
      setDodato((pre) => (pre.kljuc === kljucIzbora ? { ...pre, stanje: "greska" } : pre));
    }
  };
  const firstIndex = (prvaStrana - 1) * pageSize;
  const lastIndex = Math.min(poslednjaStrana * pageSize, ukupno);
  // Prvih pet strana su odmah dostupne, a prozor prati izabranu stranu i pri kraju.
  const pocetakProzora = Math.max(1, Math.min(prvaStrana - 2, pageCount - 4));
  const brojeviProzora = Array.from({ length: Math.min(5, pageCount) }, (_, index) => pocetakProzora + index);
  const prikazaneStrane = Array.from({ length: poslednjaStrana - prvaStrana + 1 }, (_, index) => prvaStrana + index);
  const pageNumbers = Array.from(new Set([1, ...brojeviProzora, ...(prikazaneStrane.length <= 5 ? prikazaneStrane : [prvaStrana, poslednjaStrana]), poslednjaStrana + 1, pageCount]))
    .filter((number) => number >= 1 && number <= pageCount).sort((a, b) => a - b);
  const goToPage = (number: number) => {
    update("stranica", number === 1 ? "" : String(number));
    resultsRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
  };
  const pagination = (top = false) => pageCount > 1 && (
    <nav className={"catalog-pagination" + (top ? " is-top" : "")} aria-label={t(top ? "Stranice kataloga na vrhu" : "Stranice kataloga na dnu")}>
      <button type="button" onClick={() => goToPage(prvaStrana - 1)} disabled={prvaStrana === 1} aria-label={t("Prethodna stranica")}><ChevronLeft size={18} /><span>{t("Prethodna")}</span></button>
      <div className="catalog-page-numbers">
        {pageNumbers.map((number, index) => <span key={number}>
          {index > 0 && number - pageNumbers[index - 1] > 1 && <span className="pagination-ellipsis" aria-hidden="true">…</span>}
          <button type="button" aria-label={t("Stranica {n}").replace("{n}", String(number))} aria-current={number >= prvaStrana && number <= poslednjaStrana ? "page" : undefined} onClick={() => goToPage(number)}>{number}</button>
        </span>)}
      </div>
      <button type="button" onClick={() => goToPage(poslednjaStrana + 1)} disabled={poslednjaStrana >= pageCount} aria-label={t("Sledeća stranica")}><span>{t("Sledeća")}</span><ChevronRight size={18} /></button>
    </nav>
  );
  // Brojac uz svaki filter kaze koliko artikala ostaje ako se bas taj izabere,
  // pa kupac nikad ne zaluta u prazan prikaz.
  const poOpadanju = (zapis: Record<string, number>) =>
    Object.entries(zapis).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "sr"));
  // Stablo prikazuje sve grupe iz menija, i prazne, da se ne gube iz navigacije.
  const stabloPodgrupa: [string, number][] = category
    ? taxonomy.menuSubcategories(category, Object.keys(faseti?.subcategories ?? {})).map((key) => [key, faseti?.subcategories[key] ?? 0])
    : [];
  const brendoviUredjaja = poOpadanju(faseti?.deviceBrands ?? {});
  const brands = poOpadanju(faseti?.brands ?? {});
  // U izabranoj kategoriji i podgrupi vaze samo njihovi brojaci, ukljucujuci
  // prazan spisak. Globalni telefonski modeli ne popunjavaju praznu podgrupu.
  const samoIzPonude = Boolean(category || subcategory);
  const modeliPodgrupe = samoIzPonude && deviceBrand ? facetEntries(faseti?.deviceModels).map(([key]) => key) : [];
  const modeli = samoIzPonude ? modeliPodgrupe : (meta?.devices ?? [])
    .filter((uredjaj) => !deviceBrand || uredjaj.brand === deviceBrand)
    .map((uredjaj) => uredjaj.key);
  // Model iz adrese ostaje oznaka korisnikovog filtera i kada nema rezultata.
  // Njegovo uklanjanje bi neprimetno prosirilo trazenu ponudu.
  const modeliZaIzbor = model && !modeli.includes(model) ? [model, ...modeli] : modeli;
  const broj = (value: number) => value.toLocaleString("sr-Latn-RS");
  // Plocice brendova i modela (telefoni, laptopovi) i svojstva punjaca stizu kao
  // dodatni brojaci kataloga; kad ih nema, prikaz ih jednostavno ne crta.
  const vrstaPlocica = tileKind(subcategory);
  const modeliPlocica = facetEntries(faseti?.deviceModels);
  const imaSvojstvaPunjaca = SPEC_SUBS.has(subcategory);
  const plociceUzRezultate = subcategory === "telefoni" || imaSvojstvaPunjaca;
  // Unknown/failed facets are not a confirmed zero, nor a total from a previous scope.
  const brojaciPotvrdjeni = faseti !== null && !katalog.ucitava && !katalog.greska;
  const brojKategorija = brojaciPotvrdjeni ? faseti.categories : null;
  const ukupnoKategorija = brojKategorija
    ? Object.values(brojKategorija).reduce((zbir, n) => zbir + n, 0)
    : null;
  // Dok stize odgovor, broj sa prethodnog prikaza nije tacan, pa se ne prikazuje.
  const brojSeCeka = katalog.ucitava || (katalog.greska && !katalog.items.length);
  // Vrsta se zna samo u podgrupama sa plocicama i u telefonima; inace (stari link bez
  // kategorije) brend i model ostaju neutralni, kakvi su u adresi, bez pogadjanja.
  const vrsta = vrstaPlocica ?? (category === "mobilni" ? "phone" : null);
  const oznakaFiltera = (key: string, value: string) => {
    if (key === "kategorija") return t(taxonomy.categoryName(value));
    if (key === "podkategorija") return t(taxonomy.subcategoryName(category, value));
    if (key === "brendUredjaja") return t("Brend uređaja") + ": " + brandLabel(vrsta, value);
    if (key === "model") return t("Model") + ": " + (vrsta ? modelLabel(deviceBrand, value, vrsta) : value);
    const spec = SPEC_GROUPS.find((group) => group.param === key);
    return spec ? t(spec.key) + ": " + value : value;
  };
  const granicaCene = Math.min(200000, Math.max(20000, Math.ceil((meta?.priceMax ?? 100000) / 500) * 500));
  const deviceTiles = vrstaPlocica && (
    <DeviceTiles
      kind={vrstaPlocica}
      subcategory={subcategory}
      brands={brendoviUredjaja}
      models={modeliPlocica}
      activeBrand={deviceBrand}
      activeModel={model}
      loading={katalog.ucitava && !katalog.greska}
      refreshing={katalog.ucitava}
      onBrand={(next) => update("brendUredjaja", next)}
      onModel={(next) => update("model", next)}
    />
  );
  return (
    <div className="page-width inner-page">
      <Breadcrumb items={[{ label: "Katalog" }]} />
      {/* Bez naslova i opisa iznad artikala (feedback 01.11.2026, video 67 i 68): plocice i
          artikli pocinju odmah ispod putanje, a posle pretrage nema "Rezultati za". Naslov
          ostaje samo za citace ekrana. */}
      <h1 className="sr-only">
        {query ? "Rezultati za „" + query + "”" : category ? t(taxonomy.categoryName(category)) : "Svet dobre opreme."}
      </h1>
      {!plociceUzRezultate && deviceTiles}
      {katalog.greska && !katalog.greskaFilter && (
        <div className="catalog-status" role="status">
          <Info size={18} />
          <span>Katalog trenutno ne možemo da učitamo. Tvoji filteri su sačuvani.</span>
          <button type="button" onClick={katalog.ponovi} disabled={katalog.ucitava}>
            <RotateCcw size={15} /> {katalog.ucitava ? "Proveravamo…" : "Pokušaj ponovo"}
          </button>
        </div>
      )}
      {katalog.facetsUnavailable && !katalog.greska && (
        <div className="catalog-status" role="status">
          <Info size={18} />
          <span>Proizvodi su učitani. Filteri i brojači trenutno nisu dostupni.</span>
          <button type="button" onClick={katalog.ponovi} disabled={katalog.ucitava}>
            <RotateCcw size={15} /> {katalog.ucitava ? "Proveravamo…" : "Pokušaj ponovo"}
          </button>
        </div>
      )}
      {katalog.approximate && !katalog.greska && ukupno > 0 && (
        <div className="catalog-status" role="status">
          <Info size={18} />
          <span>Za „{query}” nema tačnog poklapanja, pa prikazujemo najbliže artikle.</span>
        </div>
      )}
      <div className="catalog-layout">
        <aside
          className={"catalog-filters " + (filtersOpen ? "filters-open" : "")}
        >
          <div className="filter-title">
            <h2>Suzi svoj izbor</h2>
            <button
              className="mobile-only icon-button"
              onClick={() => setFiltersOpen(false)}
              aria-label="Zatvori filtere"
            >
              <X />
            </button>
          </div>
          <CategoryTree
            categories={grupe}
            category={category}
            subcategory={subcategory}
            categoryCounts={brojKategorija}
            countsKnown={brojaciPotvrdjeni}
            subcategories={stabloPodgrupa}
            totalCount={ukupnoKategorija}
            hrefFor={(key, value) => adresaKataloga(buildParams(key, value, true))}
            searchActive={!!query}
            renderIcon={(id) => <Icon category={id} size={17} />}
            subName={(key) => taxonomy.subcategoryName(category, key)}
            onNavigate={() => setFiltersOpen(false)}
          />
          {/* Tableti su od 01.11.2026. posebna kategorija (video 62); filter uredjaja se nudi kad ima brendova tableta. */}
          {(category === "mobilni" || (category === "tableti" && (brendoviUredjaja.length > 0 || deviceBrand))) && !vrstaPlocica && (
            <div className="filter-group">
              <h3>Za tvoj uređaj</h3>
              <label className="field">
                Brend uređaja
                <select
                  value={deviceBrand}
                  onChange={(e) => update("brendUredjaja", e.target.value)}
                >
                  <option value="">Svi brendovi uređaja</option>
                  {brendoviUredjaja.map(([b, koliko]) => (
                    <option key={b} value={b}>
                      {b} ({broj(koliko)})
                    </option>
                  ))}
                </select>
              </label>
              <div className="field">
                <span>Model uređaja</span>
                {samoIzPonude && !deviceBrand && !model ? (
                  <p className="model-picker-note">Prvo izaberi brend uređaja.</p>
                ) : samoIzPonude && !modeliZaIzbor.length && !katalog.ucitava ? (
                  <p className="model-picker-note">Modeli za {deviceBrand} nisu izdvojeni; prikazani su svi artikli tog brenda.</p>
                ) : (
                  <ModelPicker key={deviceBrand} brand={deviceBrand} models={modeliZaIzbor} value={model} onChange={(next) => update("model", next)} />
                )}
              </div>
            </div>
          )}
          {brands.length > 0 && (
            <div className="filter-group">
              <h3>Brend opreme</h3>
              <select
                aria-label="Brend opreme"
                value={brand}
                onChange={(e) => update("brend", e.target.value)}
              >
                <option value="">Svi brendovi</option>
                {brands.map(([b, koliko]) => (
                  <option key={b} value={b}>
                    {b} ({broj(koliko)})
                  </option>
                ))}
              </select>
            </div>
          )}
          {!uPripremi && <div className="filter-group">
            <h3>Budžet</h3>
            <label className="range-label">
              {maxPrice ? "Do " + formatPrice(cena(maxPrice)) : t("Sve cene")}
              <input
                aria-label="Maksimalna cena"
                type="range"
                min="500"
                max={granicaCene}
                step="500"
                value={maxPrice ?? granicaCene}
                onChange={(e) => {
                  const izabrano = Number(e.target.value);
                  setMaxPrice(izabrano >= granicaCene ? null : izabrano);
                  if (params.has("stranica")) update("stranica", "");
                }}
              />
            </label>
          </div>}
          <button
            className="button button-dark mobile-only"
            onClick={() => setFiltersOpen(false)}
          >
            {brojSeCeka ? t("Prikaži proizvode") : t("Prikaži {n} proizvoda").replace("{n}", () => broj(ukupno))} <ArrowRight size={17} />
          </button>
        </aside>
        <div className="catalog-results" ref={resultsRef}>
          {plociceUzRezultate && deviceTiles}
          {imaSvojstvaPunjaca && (
            <SpecFilterGroups specs={facetSpecs(faseti?.specs)} selected={specSelected} onToggle={toggleSpec} />
          )}
          {category && <PretragaGrupe key={category + "/" + subcategory} category={category} subcategory={subcategory} query={query} />}
          <div className="catalog-toolbar">
            <button
              className="filter-mobile-button"
              onClick={() => setFiltersOpen(true)}
            >
              <SlidersHorizontal size={17} /> {t("Filteri")}
            </button>
            <span className="catalog-range" role="status" aria-live="polite">{katalog.ucitava ? t("Učitavamo artikle…") : brojSeCeka ? "" : <>{ukupno ? `${firstIndex + 1}–${lastIndex} ${t("od")} ` : ""}{broj(ukupno)} {t("proizvoda")}</>}</span>
            <div className="catalog-view-controls">
            <div className="catalog-page-size" role="group" aria-label="Broj artikala na stranici">
              {VELICINE_STRANE.map((velicina) => (
                <button
                  key={velicina}
                  type="button"
                  aria-pressed={pageSize === velicina}
                  onClick={() => update("po", velicina === 48 ? "" : String(velicina))}
                >
                  {velicina}
                </button>
              ))}
            </div>
            <div className="catalog-layout-switch" role="group" aria-label="Raspored artikala">
              {RASPOREDI.map(({ id, label, ikona: Ikona }) => (
                <button
                  key={id}
                  type="button"
                  aria-label={label}
                  title={label}
                  aria-pressed={raspored === id}
                  onClick={() => izaberiRaspored(id)}
                >
                  <Ikona size={17} />
                </button>
              ))}
            </div>
            <label>
              {t("Sortiraj:")}
              <select
                aria-label={t("Sortiraj proizvode")}
                value={uPripremi && (sort === "low" || sort === "high") ? podrazumevaniSort : sort}
                onChange={(e) => update("sort", e.target.value)}
              >
                {query && <option value="relevance">{t("Najbolje poklapanje")}</option>}
                <option value="naziv">{t("Po nazivu")}</option>
                <option value="newest">{t("Najnovije")}</option>
                {!uPripremi && <option value="low">{t("Cena: od niže ka višoj")}</option>}
                {!uPripremi && <option value="high">{t("Cena: od više ka nižoj")}</option>}
              </select>
            </label>
            </div>
          </div>
          {filterEntries.length > 0 && (
            <div className="active-filters">
              {filterEntries.map(([key, value]) => (
                <button key={key + "=" + value} onClick={() => removeFilter(key, value)}>
                  {oznakaFiltera(key, value)}
                  <X size={12} />
                </button>
              ))}
              <Link prefetch={false} href="/katalog">Očisti sve</Link>
            </div>
          )}
          {pagination(true)}
          {katalog.items.length ? (
            <div className={"product-grid catalogue-grid" + rasporedKlasa + (katalog.ucitava ? " grid-refreshing" : "")}>
              {prikazani.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          ) : katalog.ucitava ? (
            // Kosturi drze isti prostor kao kartice, pa prikaz ne poskoci kad
            // stignu pravi artikli.
            <div className={"product-grid catalogue-grid" + rasporedKlasa} aria-hidden="true">
              {Array.from({ length: pageSize }, (_, index) => (
                <div className="product-skeleton" key={index}>
                  <div className="product-skeleton-visual" />
                  <div className="product-skeleton-line" />
                  <div className="product-skeleton-line short" />
                </div>
              ))}
            </div>
          ) : katalog.greskaFilter ? (
            <div className="empty-state" role="alert" data-filter-error>
              <Info size={40} />
              <h2>{t("Ovaj izbor filtera nije ispravan.")}</h2>
              <p>{t("Neki od izabranih filtera ne možemo da primenimo. Ukloni poslednji izbor ili očisti filtere.")}</p>
              <Link prefetch={false} className="button button-dark" href="/katalog" onClick={() => setMaxPrice(null)}>
                {t("Očisti filtere")}
              </Link>
            </div>
          ) : katalog.greska ? (
            <div className="empty-state">
              <Info size={40} />
              <h2>Katalog trenutno nije dostupan.</h2>
              <p>Tvoji filteri su sačuvani. Pokušaj ponovo za aktuelnu ponudu.</p>
              <button className="button button-dark" onClick={katalog.ponovi}>
                Pokušaj ponovo
              </button>
            </div>
          ) : (
            <div className="empty-state">
              <Search size={40} />
              <h2>Još tražimo pravi spoj.</h2>
              <p>
                U ovom izboru trenutno nema proizvoda.
                <br />
                Promeni model ili ukloni neki filter.
              </p>
              {model && (
                // Stari ili nepoznat model iz linka: jedan klik vraca sve za isti brend.
                <Link prefetch={false} className="button" href={adresaKataloga(buildParams("model", ""))} scroll={false} data-clear-model>
                  {deviceBrand
                    ? t("Prikaži sve za {brand}").replace("{brand}", brandLabel(vrsta, deviceBrand))
                    : t("Prikaži sve bez izbora modela")}
                </Link>
              )}
              <button
                className="button button-dark"
                onClick={() => {
                  setMaxPrice(null);
                  router.push("/katalog");
                }}
              >
                Prikaži svu opremu
              </button>
            </div>
          )}
          {katalog.items.length > 0 && poslednjaStrana < pageCount && (
            <div className="catalog-load-more">
              <button
                type="button"
                className="button"
                onClick={() => void prikaziJos()}
                disabled={stanjeDodavanja === "ucitava" || katalog.ucitava}
              >
                {stanjeDodavanja === "ucitava" ? <LoaderCircle className="spin" size={17} /> : <ChevronDown size={17} />}
                {stanjeDodavanja === "ucitava" ? t("Učitavamo…") : t("Prikaži još")}
              </button>
              {stanjeDodavanja === "greska" && (
                <span role="alert">{t("Sledeće artikle trenutno ne možemo da učitamo. Pokušaj ponovo.")}</span>
              )}
            </div>
          )}
          {pagination()}
          <p className="catalog-disclaimer"><Info size={14} /> {uPripremi
            ? "Katalog je dostupan za razgledanje. Cene i poručivanje objavićemo kada prodavnica bude spremna."
            : "Artikle poručujemo od veleprodaje po prijemu porudžbine. Cene i dostupnost proveravamo pre potvrde."}{" "}
            {IZVOR_PODATAKA}</p>
        </div>
      </div>
    </div>
  );
}
function ProductPage({ slug }: { slug: string }) {
  const { products, ensureProducts, catalogEpoch } = useStore();
  const t = useT();
  const taxonomy = useTaxonomy();
  const formatPrice = usePrice();
  const cena = useCena();
  const store = useStore();
  const [quantity, setQuantity] = useState(1),
    [tab, setTab] = useState("opis"),
    [imageIndex, setImageIndex] = useState(0);
  const [provera, setProvera] = useState<{ slug: string; epoch: number; stanje: "traje" | "nema" | "ima" }>({ slug, epoch: catalogEpoch, stanje: "traje" });
  const zahtev = useRef(0);
  const trenutniSlug = useRef(slug);
  trenutniSlug.current = slug;
  const trazenje = provera.slug === slug && provera.epoch === catalogEpoch ? provera.stanje : "traje";
  // Svako otvaranje detalja potvrđuje da je artikal i dalje u ponudi.
  const product = provera.slug === slug && provera.epoch === catalogEpoch && provera.stanje === "ima" ? products.find((p) => p.slug === slug) : undefined;
  const dovuci = useCallback(() => {
    const redniBroj = ++zahtev.current;
    setProvera({ slug, epoch: catalogEpoch, stanje: "traje" });
    return ensureProducts([slug], true).then((uspelo) => {
      // Zakasneli odgovor prethodnog sluga ili prethodnog pokusaja ne potvrdjuje trenutnu stranicu.
      if (zahtev.current === redniBroj && trenutniSlug.current === slug)
        setProvera({ slug, epoch: catalogEpoch, stanje: uspelo ? "ima" : "nema" });
      return uspelo;
    });
  }, [slug, ensureProducts, catalogEpoch]);
  useEffect(() => {
    void dovuci();
    return () => { zahtev.current += 1; };
  }, [dovuci]);
  // Kompatibilnost maske i stakla ima prednost nad slicnoscu naziva. Bez
  // potvrdjenog modela ne predlazemo dodatak za neki drugi telefon.
  const zaTelefon = VEZANO_ZA_MODEL.includes(product?.subcategory || "");
  const modelZaPredlog = zaTelefon ? product?.devices[0] || "" : "";
  // Par je u istoj kategoriji kao artikal: telefoni u mobilnoj opremi, a maske i
  // stakla za tablete od feedbacka 01.11 u kategoriji Tableti i oprema.
  const dopuna = useCatalog({
    kategorija: product?.category || "mobilni",
    podkategorija: DOPUNA[product?.subcategory || ""] || "maske",
    brendUredjaja: product?.deviceBrand || "",
    model: modelZaPredlog,
    velicina: 8,
    preskoci: !zaTelefon || !modelZaPredlog,
  });
  const slicni = useCatalog({
    kategorija: product?.category || "",
    podkategorija: product?.subcategory || "",
    brendUredjaja: zaTelefon ? product?.deviceBrand || "" : "",
    model: modelZaPredlog,
    velicina: 8,
    preskoci: !product || (zaTelefon && !modelZaPredlog),
  });
  useEffect(() => {
    setImageIndex(0);
    setQuantity(1);
    setTab("opis");
    if (product) store.view(product.id);
  }, [product?.id, store.view]);
  const touchX = useRef<number | null>(null);
  if (!product) return <div className="page-width inner-page"><div className="empty-state"><Package size={40} /><h1>{trazenje === "traje" ? "Učitavamo proizvod…" : trazenje === "nema" ? "Proizvod trenutno ne možemo da učitamo." : "Ovaj artikal trenutno nije u ponudi."}</h1>{trazenje === "nema" && <button className="button button-dark" onClick={() => void dovuci()}>Pokušaj ponovo</button>}<Link prefetch={false} href="/katalog" className="button button-dark">Pogledaj katalog <ArrowRight size={18} /></Link></div></div>;
  const gallery = Array.from(new Set([product.image, ...product.images]));
  const limit = productLimit(product);
  const inCart = store.cart.find((line) => line.productId === product.id)?.quantity || 0;
  const remaining = Math.max(0, limit - inCart);
  // Kruzno listanje: sa poslednje ide na prvu i obrnuto.
  const showImage = (korak: number) =>
    setImageIndex(
      (trenutni) => (trenutni + korak + gallery.length) % gallery.length,
    );
  const related = [...(zaTelefon ? dopuna.items : []), ...slicni.items]
    .filter((p, index, all) => p.id !== product.id && all.findIndex((item) => item.id === p.id) === index)
    .filter((p) => !zaTelefon || (p.deviceBrand === product.deviceBrand && p.devices.includes(modelZaPredlog)))
    .slice(0, 4);
  // Sifra artikla stoji odmah ispod naziva i prva u specifikaciji (feedback
  // 05.10.2026, video 2). Id artikla je "dobavljac-sifra", pa se sifra zna i
  // pre nego sto stigne puna specifikacija.
  const sifra = product.specs["Šifra"] || product.id.slice(product.id.indexOf("-") + 1);
  // Dobavljac ponekad ne upise vrednost ili stavi crtu; takav red se ne prikazuje.
  const prazno = (vrednost?: string) => !vrednost || /^[-–—\s]*$/.test(vrednost);
  // Nasi redovi imaju prednost: isti naziv iz specifikacije dobavljaca se ne
  // ponavlja, bez obzira na velika i mala slova.
  const kljuc = (naziv: string) => naziv.trim().toLocaleLowerCase("sr");
  const pocetak = [
    ["Šifra", sifra],
    ["Brend", product.brand || product.specs["Brend"]],
  ];
  const kraj = [
    ["Kategorija", t(taxonomy.categoryName(product.category))],
    ...(product.devices.length ? [["Kompatibilnost", product.devices.join(", ")]] : []),
  ];
  const zauzeto = new Set([...pocetak, ...kraj].map(([naziv]) => kljuc(naziv)));
  const specifikacija = [
    ...pocetak,
    // Ekran, RAM, memorija... (iz naziva tableta i telefona) idu prvi, ostalo ostaje redom dobavljaca.
    ...orderPublicSpecs(Object.entries(product.specs).filter(([key]) => !zauzeto.has(kljuc(key)) && publicSpecKey(key))),
    ...kraj,
  ].filter(([, vrednost]) => !prazno(vrednost));
  const uredjaj = product.subcategory === "tableti" || product.subcategory === "telefoni";
  // Opis se vise ne ponavlja pored cene, vec samo pod "O proizvodu". Artikal bez
  // opisa nema praznu karticu, pa se odmah vidi specifikacija. Lista artikala ne
  // nosi opis, a BTM ga nikad nema, pa se kartica ne pojavi ni dok detalj stize.
  const imaOpis = product.detailed
    ? !!product.description.trim() || !!product.sourceUrl
    : product.supplier !== "btm";
  const kartica = tab === "opis" && !imaOpis ? "specifikacije" : tab;
  return (
    <div className="page-width inner-page">
      <Breadcrumb
        items={[
          {
            label: t(taxonomy.categoryName(product.category)),
            href: catalogUrl({ kategorija: product.category }),
          },
          ...(product.subcategory
            ? [
                {
                  label: t(taxonomy.subcategoryName(product.category, product.subcategory)),
                  href: catalogUrl({ kategorija: product.category, podkategorija: product.subcategory }),
                },
              ]
            : []),
          { label: product.name },
        ]}
      />
      <div className="product-detail">
        <div className="product-gallery">
          <div
            className="main-product-photo"
            onKeyDown={(event) => {
              if (gallery.length < 2) return;
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                showImage(-1);
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                showImage(1);
              }
            }}
            onTouchStart={(event) => {
              touchX.current = event.touches[0]?.clientX ?? null;
            }}
            onTouchEnd={(event) => {
              const start = touchX.current;
              const end = event.changedTouches[0]?.clientX ?? null;
              touchX.current = null;
              if (start === null || end === null) return;
              const razlika = end - start;
              if (Math.abs(razlika) > 45) showImage(razlika > 0 ? -1 : 1);
            }}
            tabIndex={gallery.length > 1 ? 0 : -1}
            role={gallery.length > 1 ? "group" : undefined}
            aria-label={
              gallery.length > 1
                ? "Fotografije proizvoda, koristi strelice levo i desno"
                : undefined
            }
          >
            {product.brand && <span className="detail-tag">{product.brand}</span>}
            <Image
              src={gallery[imageIndex] || gallery[0]}
              alt={product.name}
              width={800}
              height={800}
              priority
              sizes="(max-width:700px) 90vw, 440px"
            />
            {gallery.length > 1 && (
              <>
                <button
                  type="button"
                  className="gallery-arrow is-prev"
                  onClick={() => showImage(-1)}
                  aria-label={t("Prethodna fotografija")}
                >
                  <ChevronLeft size={22} />
                </button>
                <button
                  type="button"
                  className="gallery-arrow is-next"
                  onClick={() => showImage(1)}
                  aria-label={t("Sledeća fotografija")}
                >
                  <ChevronRight size={22} />
                </button>
                <span className="gallery-counter" aria-hidden="true">
                  {imageIndex + 1}/{gallery.length}
                </span>
              </>
            )}
            <button
              className={
                "favorite-button " +
                (store.favorites.includes(product.id) ? "is-favorite" : "")
              }
              onClick={() => store.toggleFavorite(product.id)}
              aria-label={t("Sačuvaj proizvod")}
            >
              <Heart
                fill={
                  store.favorites.includes(product.id) ? "currentColor" : "none"
                }
              />
            </button>
          </div>
          {gallery.length > 1 && (
            <div className="product-thumbs">
              {gallery.map((src, i) => (
                <button
                  key={src}
                  className={imageIndex === i ? "active" : ""}
                  onClick={() => setImageIndex(i)}
                  aria-label={"Prikaži fotografiju " + (i + 1)}
                >
                  <Image
                    src={src}
                    alt={product.name + " — prikaz " + (i + 1)}
                    width={100}
                    height={100}
                  />
                </button>
              ))}
            </div>
          )}
          <span className="photo-caption">
            Fotografija proizvoda iz izvornog kataloga.
          </span>
        </div>
        <div className="product-detail-copy">
          <span className="eyebrow">
            {t(taxonomy.categoryName(product.category))}
            {product.brand && " / " + product.brand}
          </span>
          <h1>{product.name}</h1>
          <p className="detail-sku">
            {t("Šifra proizvoda")}: <strong>{sifra}</strong>
          </p>
          {store.preparationMode === false ? <div className="detail-price">
            <strong>
              {product.price > 0 ? formatPrice(cena(product.price)) : "Učitavamo cenu…"}
              {product.price > 0 && store.formatEur(cena(product.price)) && (
                <small> {store.formatEur(cena(product.price))}</small>
              )}
            </strong>
            <span>
              {store.popust > 0
                ? t("Tvoja cena, popust") + " " + store.popust + "%"
                : t("Cena sa PDV-om")}
            </span>
          </div> : <div className="detail-price"><strong>Cena će biti objavljena uskoro</strong></div>}
          <div className="product-availability-panel">
            <Availability product={product} detailed />
            <p>{store.preparationMode === false
              ? "Artikal poručujemo od dobavljača čim tvoja porudžbina stigne. Stanje proveravamo pre potvrde; dodavanje u korpu ne rezerviše zalihu."
              : "Pripremamo prodavnicu. Katalog možeš da razgledaš, a poručivanje će biti dostupno posle otvaranja."}</p>
          </div>
          {product.devices.length > 0 && (
            <div className="compatible-box">
              <ShieldCheck size={22} />
              <div>
                <strong>Kompatibilnost</strong>
                <p>
                  {product.deviceBrand} · {product.devices.join(", ")}
                </p>
              </div>
            </div>
          )}
          {store.preparationMode === false && product.price > 0 && <div className="detail-add-row">
            <div className="quantity">
              <button
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                aria-label="Smanji količinu"
                disabled={quantity <= 1}
              >
                <Minus size={15} />
              </button>
              <span aria-label="Količina">{quantity}</span>
              <button
                onClick={() => setQuantity((q) => Math.min(remaining, q + 1))}
                aria-label="Povećaj količinu"
                disabled={quantity >= remaining}
              >
                <Plus size={15} />
              </button>
            </div>
            <button
              className="button button-dark"
              disabled={!remaining || quantity > remaining}
              onClick={() => {
                store.add(product.id, quantity);
                store.setCartOpen(true);
              }}
            >
              <ShoppingBag size={19} /> {limit ? remaining ? "Dodaj u korpu" : "Dostupna količina je u korpi" : "Trenutno nedostupno"} <ArrowRight size={19} />
            </button>
          </div>}
          {store.preparationMode === false && <div className="detail-notes">
            <span>
              <CheckCircle2 size={17} /> Kupovina bez registracije
            </span>
            <span>
              <Truck size={17} />{" "}
              {store.prodavnica.deliveryTime
                ? "Uobičajen rok isporuke: " + store.prodavnica.deliveryTime
                : "Rok isporuke potvrđujemo pre slanja"}
            </span>
            <span>
              <Info size={17} /> Način plaćanja biraš pri poručivanju
            </span>
          </div>}
          <Link className="business-nudge" href="/b2b">
            <Package size={22} />
            <span>
              Potrebna ti je veća količina?
              <small>Pošalji nam spisak artikala za ponudu.</small>
            </span>
            <ArrowUpRight size={19} />
          </Link>
        </div>
      </div>
      <section className="product-information">
        <div className="detail-tabs" role="tablist">
          {imaOpis && (
            <button
              role="tab"
              aria-selected={kartica === "opis"}
              className={kartica === "opis" ? "active" : ""}
              onClick={() => setTab("opis")}
            >
              O proizvodu
            </button>
          )}
          <button
            role="tab"
            aria-selected={kartica === "specifikacije"}
            className={kartica === "specifikacije" ? "active" : ""}
            onClick={() => setTab("specifikacije")}
          >
            Specifikacije
          </button>
          <button
            role="tab"
            aria-selected={kartica === "dostava"}
            className={kartica === "dostava" ? "active" : ""}
            onClick={() => setTab("dostava")}
          >
            Dostava i plaćanje
          </button>
        </div>
        <div className="tab-panel" role="tabpanel">
          {kartica === "opis" ? (
            <>
              <h2>Detalji koji prave razliku.</h2>
              <p className="product-description">{product.description.trim()}</p>
              {product.description.trim() && <p className="spec-note"><Info size={14} aria-hidden="true" /> {t("Opis je iz kataloga dobavljača.")}</p>}
              {product.sourceUrl && (
                <a
                  href={product.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-link"
                >
                  Pogledaj izvorni oglas <ArrowUpRight size={16} />
                </a>
              )}
            </>
          ) : kartica === "specifikacije" ? (
            <>
              <dl className="spec-table">
                {specifikacija.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              {/* Dobavljaci za tablete i telefone ne salju procesor, sistem ni kamere;
                  to se ne dopisuje iz opsteg znanja (pregled 18.10.2026). */}
              <p className="spec-note">
                <Info size={14} aria-hidden="true" />
                {uredjaj
                  ? t("Podaci su iz kataloga dobavljača i naziva artikla. Ono što dobavljač ne navodi, poput procesora, operativnog sistema ili kamera, ne dopisujemo.")
                  : t("Specifikacija je iz kataloga dobavljača.")}
              </p>
            </>
          ) : (
            <>
              <h2>Kako ovaj artikal stiže do tebe.</h2>
              <p>
                Artikal poručujemo od veleprodaje čim primimo tvoju porudžbinu,
                a šaljemo ga kurirskom službom. Dostupne načine plaćanja biraš pri poručivanju.{" "}
                {opisDostave(store.prodavnica, formatPrice).tekst} Od kupovine
                možeš odustati u roku od 14 dana od prijema.
              </p>
              <div className="tab-links">
                <Link className="text-link" href="/dostava">
                  Kako funkcioniše kupovina <ArrowUpRight size={16} />
                </Link>
                <Link className="text-link" href="/povrat-i-reklamacije">
                  Povrat i reklamacije <ArrowUpRight size={16} />
                </Link>
              </div>
            </>
          )}
        </div>
      </section>
      {related.length > 0 && (
        <section className="section-space">
          <SectionHeading
            eyebrow="JOŠ DOBRIH SPOJEVA"
            title="Možda ti baš ovo odgovara."
            link={catalogUrl({ kategorija: product.category })}
          />
          <div className="product-grid">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
function EmptyCart() {
  return (
    <div className="empty-state">
      <ShoppingBag size={45} />
      <span className="eyebrow">IMA MESTA ZA DOBRE STVARI</span>
      <h2>Tvoja korpa čeka prvi upgrade.</h2>
      <p>Pronađi opremu koja prati tvoj ritam.</p>
      <Link prefetch={false} className="button button-dark" href="/katalog">
        Istraži prodavnicu <ArrowRight size={18} />
      </Link>
    </div>
  );
}
function CartLines() {
  const formatPrice = usePrice();
  const cena = useCena();
  const store = useStore();
  return (
    <div className="cart-lines">
      <section className="cart-group" aria-label="Artikli u korpi" data-testid="cart-group">
          {resolveCart(store.cart, store.products).map(({ product, quantity }) => (
        <div className="cart-line" key={product.id}>
          <Link prefetch={false}
            href={"/proizvod/" + product.slug}
            onClick={() => store.setCartOpen(false)}
          >
            <ProductImage product={product} />
          </Link>
          <div className="cart-line-copy">
            <span className="product-brand">{product.brand}</span>
            <Link prefetch={false}
              href={"/proizvod/" + product.slug}
              onClick={() => store.setCartOpen(false)}
            >
              {product.name}
            </Link>
            <strong>
              {formatPrice(cena(product.price))}
            </strong>
            <Availability product={product} />
            <div className="quantity">
              <button
                aria-label={"Smanji količinu: " + product.name}
                onClick={() => store.setQuantity(product.id, quantity - 1)}
              >
                <Minus size={13} />
              </button>
              <span>{quantity}</span>
              <button
                aria-label={"Povećaj količinu: " + product.name}
                onClick={() => store.setQuantity(product.id, quantity + 1)}
                disabled={quantity >= productLimit(product)}
              >
                <Plus size={13} />
              </button>
            </div>
          </div>
          <button
            className="remove-line"
            aria-label={"Ukloni: " + product.name}
            onClick={() => store.setQuantity(product.id, 0)}
          >
            <X size={16} />
          </button>
        </div>
          ))}
      </section>
    </div>
  );
}
// Predlog u korpi dopunjuje ono sto je vec izabrano: uz masku ide staklo za
// isti telefon, uz staklo maska, uz punjac kabl. Kad takvog para nema, nudi se
// slican artikal iz iste vrste opreme, nikad nesto nepovezano. Maske i stakla
// za tablete (feedback 20.10.2026) prave isti par za isti tablet.
const DOPUNA: Record<string, string> = {
  maske: "stakla",
  stakla: "maske",
  "stakla-kamere": "maske",
  "maske-tableti": "stakla-tableti",
  "stakla-tableti": "maske-tableti",
  punjaci: "kablovi",
  kablovi: "punjaci",
};
// Podgrupe ciji artikal odgovara samo tacno odredjenom modelu uredjaja.
const VEZANO_ZA_MODEL = ["maske", "stakla", "stakla-kamere", "maske-tableti", "stakla-tableti"];
function CartSuggestion() {
  const formatPrice = usePrice();
  const cena = useCena();
  const { cart, add, dismissedSuggestions, dismissSuggestion, products } = useStore(),
    [dismissed, setDismissed] = useState(false);
  // Polazi se od poslednjeg artikla dodatog u korpu.
  const lines = resolveCart(cart, products);
  const osnova = lines[lines.length - 1]?.product;
  const podkategorija = osnova?.subcategory || "";
  // Maska i staklo imaju smisla samo za tacno taj model telefona.
  const vezanZaModel = VEZANO_ZA_MODEL.includes(podkategorija);
  const model = vezanZaModel ? osnova?.devices[0] || "" : "";
  const brendUredjaja = vezanZaModel ? osnova?.deviceBrand || "" : "";
  const bezPredloga = !osnova || !podkategorija || podkategorija === "razno" || (vezanZaModel && (!model || !brendUredjaja));
  const slobodan = (p: Product) =>
    productLimit(p) > 0 && !dismissedSuggestions.includes(p.id) && !cart.some((l) => l.productId === p.id)
    && (!vezanZaModel || (Boolean(model && brendUredjaja) && p.deviceBrand === brendUredjaja && p.devices.includes(model)));
  const par = useCatalog({
    kategorija: osnova?.category,
    podkategorija: DOPUNA[podkategorija] || podkategorija,
    model,
    brendUredjaja,
    velicina: 12,
    preskoci: bezPredloga,
  });
  const izPara = par.items.find(slobodan);
  // Kad za taj model nema para, nudi se druga maska ili staklo za isti telefon.
  const slicni = useCatalog({
    kategorija: osnova?.category,
    podkategorija,
    model,
    brendUredjaja,
    velicina: 12,
    preskoci: bezPredloga || !DOPUNA[podkategorija] || par.ucitava || Boolean(izPara),
  });
  const suggestion = izPara ?? slicni.items.find(slobodan);
  if (!suggestion || dismissed) return null;
  return (
    <aside className="cart-suggestion">
      <div className="suggestion-title">
        <span>
          <Sparkles size={15} /> Dobar dodatak tvom izboru
        </span>
        <button
          aria-label="Sakrij predlog"
          onClick={() => {
            dismissSuggestion(suggestion.id);
            setDismissed(true);
          }}
        >
          <X size={15} />
        </button>
      </div>
      <div>
        <ProductImage product={suggestion} />
        <p>
          {suggestion.name}
          <strong>{formatPrice(cena(suggestion.price))}</strong>
        </p>
        <button
          className="add-product"
          aria-label={"Dodaj predlog: " + suggestion.name}
          onClick={() => add(suggestion.id)}
        >
          <Plus size={19} />
        </button>
      </div>
      <small>Dodaje se u korpu samo ako ti tako odlučiš.</small>
    </aside>
  );
}
function CartDrawer() {
  const formatPrice = usePrice();
  const cena = useCena();
  const store = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const uPripremi = store.preparationMode !== false;
  const total = resolveCart(store.cart, store.products).reduce(
    (s, l) => s + cena(l.product.price) * l.quantity,
    0,
  );
  useEffect(() => {
    if (!store.cartOpen) return;
    const prev = document.activeElement as HTMLElement;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") store.setCartOpen(false);
      if (e.key === "Tab") {
        const list = ref.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input,select,textarea,[tabindex="0"]',
        );
        if (!list?.length) return;
        const first = list[0],
          last = list[list.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", key);
      prev?.focus();
    };
  }, [store.cartOpen, store.setCartOpen]);
  if (!store.cartOpen) return null;
  return (
    <div
      className="drawer-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) store.setCartOpen(false);
      }}
    >
      <div
        className="cart-drawer"
        data-testid="cart-drawer"
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-title"
      >
        <div className="drawer-heading">
          <div>
            <span className="eyebrow">{uPripremi ? "MOBITOK JE U PRIPREMI" : "DOBAR IZBOR."}</span>
            <h2 id="cart-title">
              Tvoja korpa{" "}
              <span>({uPripremi ? 0 : store.cart.reduce((s, l) => s + l.quantity, 0)})</span>
            </h2>
          </div>
          <button
            className="icon-button"
            aria-label="Zatvori korpu"
            onClick={() => store.setCartOpen(false)}
          >
            <X />
          </button>
        </div>
        <div className="drawer-body">
          {uPripremi ? (
            // Korpa je vidljiva i pre otvaranja, ali kupovina ostaje zakljucana
            // (i na API-ju), pa ovde nema artikala, cena ni puta do placanja.
            <div className="empty-state cart-preparation">
              <Sparkles size={42} />
              <span className="eyebrow">USKORO OTVARAMO</span>
              <h2>Korpa se otvara zajedno sa prodavnicom.</h2>
              <p>Do tada istraži katalog i sačuvaj omiljene artikle. Cene i poručivanje biće dostupni posle otvaranja.</p>
              <Link prefetch={false} className="button button-dark" href="/katalog" onClick={() => store.setCartOpen(false)}>Istraži katalog <ArrowRight size={18} /></Link>
              <Link className="text-link" href="/favoriti" onClick={() => store.setCartOpen(false)}>Sačuvani proizvodi <ArrowUpRight size={16} /></Link>
            </div>
          ) : store.cart.length ? (
            <>
              <OrderJourney compact />
              <CartReadiness />
              <CartLines />
              <CartSuggestion />
            </>
          ) : (
            <div
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a"))
                  store.setCartOpen(false);
              }}
            >
              <EmptyCart />
            </div>
          )}
        </div>
        {!uPripremi && store.cart.length > 0 && (
          <div className="drawer-summary">
            <div>
              <span>Ukupno</span>
              <strong>{store.catalogComplete ? formatPrice(total) : "Proveravamo…"}</strong>
            </div>
            <p>Izbor plaćanja pri poručivanju · dostava kurirskom službom</p>
            <Link
              href="/placanje"
              className="button button-dark"
              aria-disabled={!store.catalogComplete || cartIssues(store.cart, store.products, store.catalogComplete).length > 0}
              onClick={(event) => { if (!store.catalogComplete || cartIssues(store.cart, store.products, store.catalogComplete).length) event.preventDefault(); else store.setCartOpen(false); }}
            >
              Nastavi na kupovinu <ArrowRight size={18} />
            </Link>
            <Link
              href="/korpa"
              className="view-cart-link"
              onClick={() => store.setCartOpen(false)}
            >
              Pregledaj svoju korpu
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
function CartPage() {
  const formatPrice = usePrice();
  const cena = useCena();
  const t = useT();
  const store = useStore(),
    total = resolveCart(store.cart, store.products).reduce(
      (s, l) => s + cena(l.product.price) * l.quantity,
      0,
    );
  // Cena dostave 0 je besplatna dostava, kao u opisDostave.
  const dostavaBesplatna =
    store.prodavnica.deliveryFee === 0 ||
    (store.prodavnica.deliveryFreeOver !== null && total >= store.prodavnica.deliveryFreeOver);
  return (
    <div className="page-width inner-page">
      <Breadcrumb items={[{ label: "Korpa" }]} />
      <div className="page-title">
        <span className="eyebrow">NA KORAK OD DOBROG IZBORA</span>
        <h1>Tvoja korpa.</h1>
      </div>
      {store.cart.length ? (
        <div className="cart-page-grid">
          <div>
            <OrderJourney />
            <CartReadiness />
            <CartLines />
            <CartSuggestion />
            <Link prefetch={false} href="/katalog" className="text-link">
              <ArrowLeft size={17} /> Nastavi istraživanje
            </Link>
          </div>
          <aside className="order-summary">
            <h2>Tvoj izbor, ukratko.</h2>
            <div>
              <span>Proizvodi</span>
              <strong>{store.catalogComplete ? formatPrice(total) : "Proveravamo…"}</strong>
            </div>
            <div>
              <span>Dostava</span>
              <span>
                {dostavaBesplatna
                  ? "Besplatna"
                  : store.prodavnica.deliveryFee !== null
                    ? formatPrice(store.prodavnica.deliveryFee)
                    : "Potvrđujemo pri potvrdi porudžbine"}
              </span>
            </div>
            <div className="summary-total">
              {/* Dostava se ne sabira u iznos porudzbine, pa uz unetu cenu dostave zbir to i kaze. */}
              <span>{store.prodavnica.deliveryFee && !dostavaBesplatna ? "Ukupno bez dostave" : "Ukupno"}</span>
              <strong>{store.catalogComplete ? formatPrice(total) : "Proveravamo…"}</strong>
            </div>
            {store.popust > 0 && (
              <p className="summary-discount">
                {t("U cenama je uracunat tvoj popust od")} {store.popust}%
                {store.vrstaKupca === "company"
                  ? " " + t("za registrovane firme.")
                  : " " + t("za registrovane kupce.")}
              </p>
            )}
            <p>
              Artikle poručujemo od veleprodaje po prijemu porudžbine.{" "}
              {opisDostave(store.prodavnica, formatPrice).tekst}
            </p>
            <Link href="/placanje" className="button button-dark" aria-disabled={!store.catalogComplete || cartIssues(store.cart, store.products, store.catalogComplete).length > 0} onClick={(event) => { if (!store.catalogComplete || cartIssues(store.cart, store.products, store.catalogComplete).length) event.preventDefault(); }}>
              Nastavi na kupovinu <ArrowRight size={18} />
            </Link>
            <span className="summary-safe">
              <ShieldCheck size={15} /> Pregled i potvrda pre poručivanja
            </span>
          </aside>
        </div>
      ) : (
        <EmptyCart />
      )}
    </div>
  );
}
function CheckoutItems() {
  const store = useStore();
  return <section className="checkout-items" aria-label="Artikli u porudžbini">
    {resolveCart(store.cart, store.products).map(({ product, quantity }) => <div className="checkout-product" key={product.id}>
      <ProductImage product={product} />
      <span>{product.name}<small>Količina: {quantity}</small></span>
      <strong>{store.formatPrice(store.cena(product.price) * quantity)}</strong>
    </div>)}
  </section>;
}

function Checkout() {
  const formatPrice = usePrice();
  const cena = useCena();
  const store = useStore();
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cod");
  const [methods, setMethods] = useState<PaymentMethodOption[] | null>(null);
  const [methodsError, setMethodsError] = useState(false);
  const [methodsAttempt, setMethodsAttempt] = useState(0);
  const [recovery, setRecovery] = useState<CheckoutAttempt | null>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<{ reference: string; total: number; subtotal?: number; discountPercent?: number; currency?: string;
      payment?: CheckoutPayment; delivery: { fee: number | null; time: string; courier: string | null };
      items?: { name: string; quantity: number }[] } | null>(
      null,
    );
  const requestId = useRef({ key: "", signature: "" });
  const submissionLock = useRef(false);
  const checkoutController = useRef<AbortController | null>(null);
  useEffect(() => () => checkoutController.current?.abort(), []);
  const english = store.language === "en";
  const fallbackMethods: PaymentMethodOption[] = [
    { id: "cod", label: english ? "Cash on delivery" : "Pouzećem", description: english ? "Pay the courier when your parcel arrives." : "Plaćaš kuriru kada preuzmeš pošiljku.", available: true },
    { id: "card", label: english ? "Payment card" : "Karticom", description: english ? "Continue to the bank’s payment page." : "Nastavljaš na stranicu banke za plaćanje.", available: false, unavailableReason: english ? "Not enabled yet." : "Trenutno nije omogućeno." },
    { id: "ips_qr", label: english ? "QR bank transfer" : "QR uplata na račun", description: english ? "Scan the payment order. We confirm payment after checking our bank statement." : "Skeniraj nalog za uplatu. Porudžbinu potvrđujemo po proveri priliva.", available: false, unavailableReason: english ? "The business account is not configured yet." : "Poslovni račun još nije podešen." },
  ];
  const displayedMethods = (methods || fallbackMethods).map(method => english ? { ...method,
    label: fallbackMethods.find(option => option.id === method.id)!.label,
    description: fallbackMethods.find(option => option.id === method.id)!.description,
    ...(method.available ? {} : { unavailableReason: "This payment option is not currently available." }),
  } : method);
  const selectedMethod = displayedMethods.find(method => method.id === paymentMethod);
  useEffect(() => {
    const saved = readCheckoutAttempt();
    if (saved) {
      requestId.current = { key: saved.key, signature: saved.signatureHash };
      if (saved.continueUrl && saved.paymentMethod !== "cod") setRecovery(saved);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setMethods(null);
    setMethodsError(false);
    void requestWithDeadline(async signal => {
      const response = await fetch("/api/payments/methods", { cache: "no-store", signal });
      if (!response.ok) throw new Error("payment_methods_unavailable");
      const data = await response.json();
      if (!Array.isArray(data.methods) || data.methods.length > 3 || data.methods.some((method: PaymentMethodOption) =>
        !method || !["cod", "card", "ips_qr"].includes(method.id) || typeof method.available !== "boolean"
        || typeof method.label !== "string" || typeof method.description !== "string"
        || (method.unavailableReason !== undefined && typeof method.unavailableReason !== "string"))
        || new Set(data.methods.map((method: PaymentMethodOption) => method.id)).size !== data.methods.length) throw new Error("invalid_payment_methods");
      return data.methods as PaymentMethodOption[];
    }, { timeoutMs: 12000, signal: controller.signal }).then(value => {
      if (live) setMethods(fallbackMethods.map(fallback => value.find(method => method.id === fallback.id) || { ...fallback, available: false }));
    }).catch(() => {
      if (live) { setMethods(fallbackMethods); setPaymentMethod("cod"); setMethodsError(true); }
    });
    return () => { live = false; controller.abort(); };
    // Fallback options are localized here; availability still comes from the API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [methodsAttempt, english]);
  function changePaymentMethod(next: PaymentMethod) {
    setPaymentMethod(next);
    if (requestId.current.key) clearCheckoutAttempt(requestId.current.key);
    requestId.current = { key: "", signature: "" };
  }
  const issues = cartIssues(store.cart, store.products, store.catalogComplete);
  const total = resolveCart(store.cart, store.products).reduce(
    (s, l) => s + cena(l.product.price) * l.quantity,
    0,
  );
  // Rok iz podesavanja bez zavrsne tacke; recenice u pregledu i potvrdi je dodaju.
  const rok = ocistiRok(store.prodavnica.deliveryTime);
  const deliveryFee = store.prodavnica.deliveryFee === null ? null
    : store.prodavnica.deliveryFee === 0 || (store.prodavnica.deliveryFreeOver !== null && total >= store.prodavnica.deliveryFreeOver)
      ? 0 : store.prodavnica.deliveryFee;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submissionLock.current) return;
    submissionLock.current = true;
    setError("");
    setPending(true);
    const controller = new AbortController();
    checkoutController.current = controller;
    const form = new FormData(e.currentTarget);
    // Ime i prezime se unose odvojeno (pregled 18.10.2026), a porudzbina i dalje cuva jedno polje.
    const customer = {
      fullName: `${String(form.get("firstName") ?? "").trim()} ${String(form.get("lastName") ?? "").trim()}`.trim(),
      email: form.get("email"),
      phone: form.get("phone"),
      address: form.get("address"),
      city: form.get("city"),
      postalCode: form.get("postalCode"),
      note: form.get("note") || "",
    };
    try {
      if (!methods || !selectedMethod?.available) throw new Error(english ? "Choose an available payment method." : "Izaberi dostupan način plaćanja.");
      if (form.get("termsAccepted") !== "on") throw new Error(english ? "Please accept the purchase terms." : "Prihvati uslove kupovine pre poručivanja.");
      const latest = await store.refreshCatalog();
      controller.signal.throwIfAborted();
      if (!latest) throw new Error("Ne možemo da proverimo aktuelni katalog. Tvoja korpa je sačuvana — pokušaj ponovo.");
      const currentIssues = cartIssues(store.cart, latest);
      if (currentIssues.length) throw new Error("Dostupnost se promenila. Vrati se na korpu i proveri označene artikle.");
      const refreshedTotal = resolveCart(store.cart, latest).reduce((sum, line) => sum + cena(line.product.price) * line.quantity, 0);
      if (Math.abs(refreshedTotal - total) > 0.01) throw new Error("Cena u katalogu je ažurirana. Proveri novi iznos u pregledu i ponovo potvrdi svoj izbor.");
      const cartSnapshot = store.cart.map(line => ({ productId: line.productId, quantity: line.quantity }));
      const data = await requestWithDeadline(async signal => {
        const session = await getClient()?.auth.getSession();
        signal.throwIfAborted();
        if (session?.error) throw new Error("Prijava je istekla. Prijavi se ponovo pa pokušaj ponovo.");
        const token = session?.data.session?.access_token;
        const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({
          customer, items: cartSnapshot, userId: session?.data.session?.user.id ?? null, paymentMethod, termsAccepted: true,
        })));
        const signature = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
        if (requestId.current.signature !== signature) requestId.current = { key: crypto.randomUUID(), signature };
        saveCheckoutAttempt({ key: requestId.current.key, signatureHash: signature, paymentMethod, cart: cartSnapshot });
        const response = await fetch("/api/orders", {
          method: "POST", signal, credentials: "same-origin",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
          body: JSON.stringify({ idempotencyKey: requestId.current.key, customer, items: cartSnapshot, paymentMethod, termsAccepted: true }),
        });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || "Porudžbina nije sačuvana. Pokušaj ponovo.");
        return value;
      }, { timeoutMs: 25000, signal: controller.signal });
      if (typeof data.reference !== "string" || typeof data.total !== "number" || !Number.isFinite(data.total)
        || (data.payment && (data.payment.method !== paymentMethod || data.payment.currency !== "RSD"
          || !["unpaid", "pending", "authorized", "paid", "failed", "cancelled", "expired", "review_required", "refund_pending", "refunded"].includes(data.payment.status)
          || (data.payment.payableTotal !== null && (typeof data.payment.payableTotal !== "number" || !Number.isFinite(data.payment.payableTotal) || data.payment.payableTotal < 0))))) {
        throw new Error("Potvrdu porudžbine trenutno ne možemo da prikažemo. Pokušaj ponovo.");
      }
      if (paymentMethod !== "cod") {
        const continueUrl = safePaymentPagePath(data.payment?.continueUrl, window.location.origin);
        if (!continueUrl) throw new Error("Nastavak plaćanja trenutno nije dostupan. Korpa je sačuvana; pokušaj ponovo.");
        const saved: CheckoutAttempt = { key: requestId.current.key, signatureHash: requestId.current.signature,
          paymentMethod, cart: cartSnapshot, continueUrl, reference: data.reference };
        saveCheckoutAttempt(saved);
        setRecovery(saved);
        // Full navigation can begin before the provider's persistence effect.
        // Clear only the stored cart synchronously; the private recovery has its IDs/quantities.
        try {
          const value = JSON.parse(localStorage.getItem("volt-store-v1") || "{}");
          const existing = value && typeof value === "object" && !Array.isArray(value) ? value : {};
          localStorage.setItem("volt-store-v1", JSON.stringify({ ...existing, cart: [] }));
        } catch {}
        store.clear();
        try { window.location.assign(continueUrl); }
        catch { setError(english ? "Your order is saved. Use the continue link to open the payment page." : "Porudžbina je sačuvana. Otvori plaćanje preko dugmeta za nastavak."); }
        return;
      }
      // Sadrzaj porudzbine za potvrdu se pamti pre praznjenja korpe.
      const stavke = resolveCart(store.cart, latest).map((line) => ({ name: line.product.name, quantity: line.quantity }));
      const confirmedDelivery = typeof data.payment?.payableTotal === "number"
        ? Math.max(0, Math.round((data.payment.payableTotal - data.total) * 100) / 100) : deliveryFee;
      setResult({ ...data, items: stavke, delivery: { fee: confirmedDelivery, time: rok, courier: store.prodavnica.courier } });
      clearCheckoutAttempt(requestId.current.key);
      store.clear();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Veza trenutno nije dostupna. Pokušaj ponovo.",
      );
    } finally {
      if (checkoutController.current === controller) checkoutController.current = null;
      submissionLock.current = false;
      setPending(false);
    }
  };
  if (recovery?.continueUrl) return <section className="payment-return-panel" aria-labelledby="checkout-resume-title">
    <div className="payment-return-mark" aria-hidden="true"><ShieldCheck size={32} /></div>
    <span className="payment-return-eyebrow">{english ? "YOUR ORDER IS SAVED" : "PORUDŽBINA JE SAČUVANA"}</span>
    <h1 id="checkout-resume-title">{english ? "Continue your payment." : "Nastavi plaćanje."}</h1>
    <p className="payment-return-description">{english ? "You can return to the saved order without submitting a new one." : "Vrati se na sačuvanu porudžbinu bez ponovnog poručivanja."}</p>
    {recovery.reference && <p>{english ? "Order reference: " : "Broj porudžbine: "}<strong>{recovery.reference}</strong></p>}
    {error && <p className="payment-return-error" role="alert">{error}</p>}
    <div className="payment-return-actions"><a className="button button-dark" href={recovery.continueUrl}>{english ? "Continue payment" : "Nastavi na plaćanje"}<ArrowRight size={18} /></a></div>
  </section>;
  if (result)
    return (
      <div className="page-width checkout-success">
        <div className="success-icon">
          <Check size={40} />
        </div>
        <span className="eyebrow">SVE JE NA SVOM MESTU</span>
        <h1>
          Dobar izbor.
          <br />
          Porudžbina je primljena.
        </h1>
        <p>
          Broj porudžbine: <strong>{result.reference}</strong>
          <br />
          Sačuvaj ga — po njemu proveravamo status i odgovaramo na pitanja.
        </p>
        {result.items?.length ? (
          <section className="success-items" aria-label="Sadržaj porudžbine">
            <span className="eyebrow">SADRŽAJ PORUDŽBINE</span>
            <ul>
              {result.items.map((stavka, i) => (
                <li key={i}>
                  <span>{stavka.name}</span>
                  <strong>{stavka.quantity} kom.</strong>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section className="receipt-summary" aria-label="Potvrđen obračun porudžbine">
          <span className="eyebrow">POTVRĐEN OBRAČUN</span>
          {typeof result.subtotal === "number" && <div><span>Artikli pre popusta</span><strong>{confirmedMoney(result.subtotal)}</strong></div>}
          {typeof result.discountPercent === "number" && result.discountPercent > 0 && <div className="receipt-discount"><span>Primenjen popust</span><strong>{result.discountPercent}%</strong></div>}
          <div className="receipt-total"><span>{result.payment?.payableTotal !== null && result.payment?.payableTotal !== undefined ? "Ukupno za plaćanje" : "Ukupno artikli"}</span><strong>{confirmedMoney(result.payment?.payableTotal ?? result.total)}</strong></div>
          <small>Iznos je potvrđen pri čuvanju porudžbine. Prikaz u drugoj valuti je informativan.</small>
        </section>
        <ul className="success-facts">
          <li>
            <strong>Plaćanje</strong>
            <span>{result.payment?.method === "card" ? "Karticom, preko stranice banke. Status plaćanja prati se uz porudžbinu." : result.payment?.method === "ips_qr" ? "Izabrano je IPS QR plaćanje. Potvrdu uplate prati uz porudžbinu." : "Pouzećem, kuriru pri preuzimanju pošiljke. Ništa nije naplaćeno unapred."}</span>
          </li>
          <li>
            <strong>Dostava</strong>
            {/* Isti uslovi kao u pregledu porudzbine: unete cena i rok se prikazuju, a ne "potvrdjujemo". */}
            <span>
              Kurirskom službom{result.delivery.courier ? ` ${result.delivery.courier}` : ""} na adresu iz porudžbine.{" "}
              {result.delivery.fee === 0
                ? "Dostava je besplatna."
                : result.delivery.fee !== null
                    ? `Cena dostave: ${confirmedMoney(result.delivery.fee)}.`
                    : "Cenu dostave potvrđujemo pre slanja."}{" "}
              {result.delivery.time
                ? `Uobičajen rok isporuke: ${result.delivery.time}.`
                : "Rok isporuke potvrđujemo pre slanja."}
            </span>
          </li>
          <li>
            <strong>Status bez naloga</strong>
            <span>
              {store.prodavnica.phone || store.prodavnica.email ? (
                <>Javi nam se na <KontaktLinkovi /> i navedi broj porudžbine.</>
              ) : (
                <>Piši nam preko stranice <Link href="/podrska">Podrška</Link> i navedi broj porudžbine.</>
              )}
            </span>
          </li>
        </ul>
        <div className="notice">
          {result.delivery.fee !== null && result.delivery.time
            ? "Ovo je potvrda prijema porudžbine. Porudžbinu prihvatamo kada ti potvrdimo dostupnost artikala."
            : "Ovo je potvrda prijema porudžbine. Konačan obračun sa troškom dostave potvrđujemo pre slanja."}
        </div>
        <Link prefetch={false} href="/katalog" className="button button-dark">
          Nastavi istraživanje <ArrowUpRight size={18} />
        </Link>
      </div>
    );
  if (!store.cart.length)
    return (
      <div className="page-width inner-page">
        <EmptyCart />
      </div>
    );
  return (
    <div className="page-width inner-page">
      <Breadcrumb
        items={[{ label: "Korpa", href: "/korpa" }, { label: "Kupovina" }]}
      />
      <div className="page-title">
        <span className="eyebrow">JEDNOSTAVNO, OD POČETKA DO KRAJA</span>
        <h1>Još par detalja.</h1>
        <p>
          {store.signedIn
            ? "Ostavi podatke za isporuku i izaberi način plaćanja."
            : "Kupovina bez registracije: ostavi podatke za isporuku i izaberi način plaćanja."}
        </p>
      </div>
      <details className="mobile-order-preview">
        <summary><ShoppingBag size={20} /><span>Tvoj izbor <small>{store.cart.reduce((sum, line) => sum + line.quantity, 0)} kom. u korpi</small></span><strong>{store.catalogComplete ? formatPrice(total) : "Proveravamo…"}</strong><ChevronDown size={17} /></summary>
        <CheckoutItems />
        <Link href="/korpa" className="text-link">Izmeni korpu <ArrowUpRight size={16} /></Link>
      </details>
      <form onSubmit={submit} className="checkout-grid">
        <div className="checkout-form">
          <OrderJourney compact />
          <CartReadiness />
          <div className="checkout-step">
            <span>01</span>
            <h2>Tvoji podaci</h2>
          </div>
          <div className="notice">
            <Info size={18} />
            <span>
              {store.signedIn ? "" : "Nalog nije potreban — porudžbinu šalješ kao gost. "}
              Podatke koristimo za isporuku ove porudžbine i kontakt u vezi sa
              njom.
            </span>
          </div>
          <div className="form-grid">
            <label className="field">
              Ime
              <input
                name="firstName"
                disabled={pending}
                autoComplete="given-name"
                required
                minLength={2}
                maxLength={50}
                placeholder="Petar"
              />
            </label>
            <label className="field">
              Prezime
              <input
                name="lastName"
                disabled={pending}
                autoComplete="family-name"
                required
                minLength={2}
                maxLength={60}
                placeholder="Petrović"
              />
            </label>
            <label className="field">
              E-mail adresa
              <input
                name="email"
                type="email"
                disabled={pending}
                autoComplete="email"
                required
                maxLength={254}
                placeholder="petar@example.com"
              />
            </label>
            <label className="field">
              Telefon
              <input
                name="phone"
                type="tel"
                disabled={pending}
                autoComplete="tel"
                required
                minLength={7}
                maxLength={24}
                placeholder="060 123 4567"
              />
            </label>
          </div>
          <div className="checkout-step">
            <span>02</span>
            <h2>Adresa za isporuku</h2>
          </div>
          <div className="notice">
            <Truck size={18} />
            <span>
              Dostavu obavlja kurirska služba
              {store.prodavnica.courier ? " " + store.prodavnica.courier : ""}, na
              adresu koju uneseš ispod.
            </span>
          </div>
          <div className="form-grid">
            <label className="field full">
              Ulica i broj
              <input
                name="address"
                disabled={pending}
                autoComplete="street-address"
                required
                minLength={5}
                maxLength={200}
                placeholder="Primer ulice 12"
              />
            </label>
            <label className="field">
              Grad
              <input
                name="city"
                disabled={pending}
                autoComplete="address-level2"
                required
                minLength={2}
                maxLength={100}
                placeholder="Beograd"
              />
            </label>
            <label className="field">
              Poštanski broj
              <input
                name="postalCode"
                disabled={pending}
                inputMode="numeric"
                autoComplete="postal-code"
                pattern="[0-9]{5}"
                required
                placeholder="11000"
              />
            </label>
            <label className="field full">
              Napomena <small>(opciono)</small>
              <textarea
                name="note"
                disabled={pending}
                maxLength={500}
                placeholder="Nešto što želiš da napomeneš?"
                rows={3}
              />
            </label>
          </div>
          <div className="checkout-step">
            <span>03</span>
            <h2>Plaćanje i potvrda</h2>
          </div>
          <PaymentMethodPicker selected={paymentMethod} onChange={changePaymentMethod} disabled={pending || !methods}
            methods={displayedMethods} language={store.language} />
          <PaymentSecurityMarks language={store.language} />
          <p className="payment-method-bank-note"><Info size={15} aria-hidden="true" /><span>{english ? "All payments are made in Serbian dinars (RSD). Your bank may convert the amount to your card account currency using its applicable exchange rate." : "Sva plaćanja su u srpskim dinarima (RSD). Ako je račun tvoje kartice u drugoj valuti, banka može preračunati iznos po svom važećem kursu."}</span></p>
          {methodsError && <div className="checkout-payment-notice" role="status">
            <span>{english ? "We could not check the other payment options. Cash on delivery remains available." : "Ostale načine plaćanja trenutno nismo uspeli da proverimo. Plaćanje pouzećem ostaje dostupno."}</span>
            <button type="button" onClick={() => setMethodsAttempt(value => value + 1)} disabled={pending}>{english ? "Check again" : "Proveri ponovo"}</button>
          </div>}
          {methods && !displayedMethods.some(method => method.available) && <p className="checkout-payment-notice" role="status">{english ? "Payment is temporarily unavailable. Your cart is saved; please check again later." : "Plaćanje trenutno nije dostupno. Korpa je sačuvana; proveri ponovo kasnije."}</p>}
          <label className="checkbox-label consent-label">
            <input type="checkbox" name="termsAccepted" required disabled={pending} />{" "}
            <span>
              Prihvatam <Link href="/uslovi">uslove kupovine</Link>. Kako
              koristimo podatke piše u <Link href="/privatnost">informaciji o privatnosti</Link>.
            </span>
          </label>
        </div>
        <aside className="order-summary checkout-summary">
          <h2>U tvojoj korpi <Link href="/korpa">Izmeni</Link></h2>
          <CheckoutItems />
          {store.popust > 0 && <p className="summary-discount">U prikazane cene uračunat je popust od {store.popust}%. Konačan obračun potvrđuje se pri čuvanju porudžbine.</p>}
          <div className="checkout-payment-summary"><span>{english ? "Items" : "Artikli"}</span><strong>{store.catalogComplete ? formatPrice(total) : "Proveravamo…"}</strong></div>
          <div className="checkout-payment-summary"><span>{english ? "Delivery" : "Dostava"}</span><strong>{deliveryFee === null ? (english ? "Confirmed before dispatch" : "Potvrđujemo pre slanja") : deliveryFee === 0 ? (english ? "Free" : "Besplatno") : formatPrice(deliveryFee)}</strong></div>
          <div className="checkout-payment-summary"><span>{english ? "Payment" : "Plaćanje"}</span><strong>{selectedMethod?.label || "—"}</strong></div>
          <div className="summary-total">
            <span>{deliveryFee === null ? (english ? "Items total" : "Ukupno artikli") : (english ? "Total to pay" : "Ukupno za plaćanje")}</span>
            <strong>{store.catalogComplete ? formatPrice(total + (deliveryFee ?? 0)) : "Proveravamo…"}</strong>
          </div>
          <p>
            {store.prodavnica.deliveryFee === 0
              ? "Dostava je besplatna."
              : store.prodavnica.deliveryFreeOver !== null && total >= store.prodavnica.deliveryFreeOver
                ? "Dostava je besplatna za ovaj iznos."
                : store.prodavnica.deliveryFee !== null
                  ? `U obračun je uključena dostava (${formatPrice(store.prodavnica.deliveryFee)}).`
                  : "Iznos ne uključuje dostavu. Cenu dostave potvrđujemo pre slanja."}{" "}
            {rok
              ? `Uobičajen rok isporuke: ${rok}.`
              : "Rok isporuke potvrđujemo pre slanja."}
          </p>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button
            className="button button-lime"
            type="submit"
            disabled={pending || !methods || !selectedMethod?.available || !store.catalogComplete || issues.length > 0}
          >
            {pending ? (
              <>
                <LoaderCircle className="spin" size={19} /> Čuvamo porudžbinu…
              </>
            ) : (
              <>
                {paymentMethod === "card" ? (english ? "Continue to card payment" : "Nastavi na plaćanje karticom") : paymentMethod === "ips_qr" ? (english ? "Confirm and continue" : "Potvrdi i nastavi") : (english ? "Place order with payment obligation" : "Poruči uz obavezu plaćanja")}
                <ArrowRight size={18} />
              </>
            )}
          </button>
          <span className="summary-safe">
            <ShieldCheck size={15} /> {paymentMethod === "cod" ? (english ? "Pay when your parcel arrives" : "Plaćanje pri preuzimanju") : (english ? "Payment continues on the bank’s page" : "Plaćanje se nastavlja na stranici banke")}
          </span>
        </aside>
      </form>
    </div>
  );
}
function Favorites() {
  const { favorites, products, ensureProducts, catalogEpoch } = useStore();
  // Lokalni snimak nije potvrda da je artikal i dalje vidljiv. Kartice se prikazuju tek nakon uspesne provere.
  const key = JSON.stringify([catalogEpoch, favorites]);
  const [verification, setVerification] = useState<{ key: string; ok: boolean; error: boolean }>({ key: "", ok: false, error: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    if (!favorites.length) return;
    setVerification({ key, ok: false, error: false });
    void ensureProducts(favorites, true).then((ok) => {
      if (current) setVerification({ key, ok, error: !ok });
    });
    return () => { current = false; };
  }, [key, ensureProducts, attempt]);
  const verified = verification.key === key && verification.ok;
  const failed = verification.key === key && verification.error;
  const sacuvani = verified ? favorites
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is Product => !!p) : [];
  return (
    <div className="page-width inner-page">
      <Breadcrumb items={[{ label: "Sačuvano" }]} />
      <div className="page-title">
        <span className="eyebrow">TVOJ LIČNI IZBOR</span>
        <h1>Za kasnije. Ili za sada.</h1>
        <p>
          Sve što ti je zapalo za oko, na jednom mestu. Sačuvani artikli ostaju
          samo u ovom pregledaču na ovom uređaju i ne prenose se na drugi uređaj,
          ni kada si prijavljen.
        </p>
      </div>
      {favorites.length && !verified ? (
        <div className="empty-state" aria-busy={!failed}>
          <p role={failed ? "alert" : "status"}>{failed ? "Sačuvani artikli trenutno nisu dostupni. Pokušaj ponovo." : "Proveravamo sačuvane artikle…"}</p>
          {failed && <button className="button" onClick={() => setAttempt((value) => value + 1)}>Pokušaj ponovo</button>}
        </div>
      ) : favorites.length ? (
        <div className="product-grid">
          {sacuvani.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Heart size={42} />
          <h2>Sačuvaj ono što ti se sviđa.</h2>
          <p>Dodirni srce pored proizvoda i on će te čekati ovde, u ovom pregledaču.</p>
          <Link prefetch={false} href="/katalog" className="button button-dark">
            Pronađi svoj izbor <ArrowRight size={18} />
          </Link>
        </div>
      )}
    </div>
  );
}
function Guide() {
  const t = useT();
  const formatPrice = usePrice();
  const uPripremi = useStore().preparationMode !== false;
  const [category, setCategory] = useState(""),
    [budget, setBudget] = useState(5000),
    [done, setDone] = useState(false);
  // Predlog racuna baza: najskuplje sto staje u budzet, iz celog kataloga a ne
  // iz onoga sto je kupac usput otvorio.
  const predlog = useCatalog({
    kategorija: category,
    maxCena: budget >= 100000 ? null : budget,
    sort: "high",
    velicina: 4,
    preskoci: uPripremi || !done || !category,
  });
  const found = predlog.items;
  // Dok cene nisu objavljene vodic nema budzet, ali i dalje vodi: oblast otvara taj deo
  // kataloga, a izbor uredjaja opremu za tacan model (pregled 18.10.2026).
  if (uPripremi) return (
    <div className="page-width inner-page">
      <Breadcrumb items={[{ label: "Vodič za dobar izbor" }]} />
      <section className="guide-page-intro">
        <div className="guide-page-icon">
          <Sparkles size={32} />
        </div>
        <span className="eyebrow">VODIČ ZA DOBAR IZBOR</span>
        <h1>
          Pronađi opremu
          <br />
          koja ti odgovara.
        </h1>
        <p>
          Izaberi oblast ili svoj uređaj i otvorićemo deo kataloga koji ti
          treba. Korak sa budžetom dodajemo kada objavimo cene.
        </p>
      </section>
      <div className="quiz-panel">
        <h2>
          <span>01</span> Šta želiš da unaprediš?
        </h2>
        <div className="quiz-options">
          {categories.map((c) => (
            <Link prefetch={false} key={c.id} href={catalogUrl({ kategorija: c.id })}>
              <Icon category={c.id} size={29} />
              <strong>{c.short}</strong>
            </Link>
          ))}
        </div>
      </div>
      <DeviceFinder />
    </div>
  );
  return (
    <div className="page-width inner-page">
      <Breadcrumb items={[{ label: "Vodič za dobar izbor" }]} />
      <section className="guide-page-intro">
        <div className="guide-page-icon">
          <Sparkles size={32} />
        </div>
        <span className="eyebrow">TVOJ MALI TECH SAVETNIK</span>
        <h1>
          Pravi izbor počinje
          <br />
          pravim pitanjem.
        </h1>
        <p>
          Izaberi oblast i budžet. Izdvojićemo opremu iz kataloga koja se
          uklapa.
        </p>
      </section>
      <div className="quiz-panel">
        <h2>
          <span>01</span> Šta želiš da unaprediš?
        </h2>
        <div className="quiz-options">
          {categories.map((c) => (
            <button
              key={c.id}
              className={category === c.id ? "selected" : ""}
              onClick={() => {
                setCategory(c.id);
                setDone(false);
              }}
            >
              <Icon category={c.id} size={29} />
              <strong>{c.short}</strong>
              {category === c.id && <CheckCircle2 size={17} />}
            </button>
          ))}
        </div>
        <h2>
          <span>02</span> Koji ti budžet odgovara?
        </h2>
        <div className="budget-options">
          {[2000, 5000, 10000, 25000, 100000].map((b) => (
            <button
              className={budget === b ? "selected" : ""}
              key={b}
              onClick={() => {
                setBudget(b);
                setDone(false);
              }}
            >
              {b === 100000 ? t("Bez ograničenja") : "Do " + formatPrice(b)}
            </button>
          ))}
        </div>
        <button
          disabled={!category}
          className="button button-dark"
          onClick={() => setDone(true)}
        >
          Pronađi moj izbor <Sparkles size={18} />
        </button>
      </div>
      {done && (
        <section className="section-space">
          <SectionHeading
            eyebrow="PREMA TVOM IZBORU I BUDŽETU"
            title={
              found.length || predlog.ucitava
                ? "Tvoja nova dobra kombinacija."
                : "Proširimo malo izbor."
            }
            link={catalogUrl({ kategorija: category })}
          />
          {found.length ? (
            <div className="product-grid">
              {found.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          ) : predlog.ucitava ? (
            <div className="empty-state">
              <LoaderCircle size={32} className="spin" />
            </div>
          ) : (
            <p>
              Trenutno nema proizvoda u odabranom budžetu. Povećaj budžet ili
              izaberi drugu kategoriju.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
// Odgovori o kupovini i dostavi nose recenicu o ceni i roku iz podesavanja (opisDostave),
// da FAQ ne protivreci korpi i stranici Dostava kada vlasnik upise cenu ili rok.
const faqOdgovori = (dostava: string) => [
  [
    "Da li trenutno mogu da kupim proizvod?",
    `Možeš. Artikal poručujemo od ugovorene veleprodaje čim primimo tvoju porudžbinu i šaljemo ga kurirskom službom. Dostupne načine plaćanja biraš pri poručivanju. ${dostava}`,
  ],
  [
    "Kako da pronađem masku za svoj telefon?",
    "Na početnoj strani izaberi vrstu opreme, brend i model uređaja. Iste filtere imaš i u katalogu. Kompatibilnost je navedena na stranici proizvoda; ne prikazujemo drugi model kao zamenu.",
  ],
  [
    "Mogu li da kupim bez registracije?",
    "Možeš. Kupovina bez registracije je dostupna: izabereš artikle, uneseš podatke za isporuku i potvrdiš porudžbinu, bez otvaranja naloga. Poslovni nalog zahteva registraciju i odobrenje administratora.",
  ],
  [
    "Kako da zatražim ponudu za više komada?",
    "Za veću količinu artikala pošalji nam upit sa spiskom i brojem komada. Registracija firme sama ne donosi popust; ponudu dogovaramo za konkretan upit.",
  ],
  [
    "Koji su uslovi dostave i povrata?",
    `Šaljemo kurirskom službom; način plaćanja biraš pri poručivanju. ${dostava} Od kupovine možeš odustati u roku od 14 dana od prijema robe; postupak, obrazac i reklamacije su na stranici Povrat i reklamacije.`,
  ],
  [
    "Da li se moji izbori pamte?",
    "Korpa, sačuvani artikli i nedavno pregledani proizvodi pamte se samo u ovom pregledaču na ovom uređaju i ne prenose se na drugi uređaj, ni kada si prijavljen. Možeš ih obrisati iz podešavanja pregledača. Podaci porudžbine čuvaju se odvojeno, u bazi prodavnice.",
  ],
];
// Obrazac za odustanak od ugovora zakljucenog na daljinu (pregled 18.10.2026): kupac ga salje
// e-mailom, sa tekstom vec u poruci, ili ga kopira. Potpis treba samo kada se salje na papiru.
function ObrazacOdustanka() {
  const shop = useProdavnica();
  const [kopirano, setKopirano] = useState<"" | "da" | "ne">("");
  const tekst = [
    "IZJAVA O ODUSTANKU OD UGOVORA ZAKLJUČENOG NA DALJINU",
    "",
    "Prodavac: " + (shop.companyName || "MOBITOK"),
    shop.companyAddress ? "Sedište: " + shop.companyAddress : null,
    shop.email ? "E-mail: " + shop.email : null,
    "",
    "Obaveštavam vas da odustajem od ugovora o kupovini sledeće robe:",
    "",
    "Broj porudžbine:",
    "Artikli i količina:",
    "Datum porudžbine:",
    "Datum prijema robe:",
    "Ime i prezime:",
    "Adresa:",
    "Broj računa za povraćaj (samo za pouzeće ili uplatu na račun; za karticu povraćaj ide na istu karticu):",
    "Datum:",
    "Potpis (samo ako se obrazac šalje na papiru):",
  ].filter((red) => red !== null).join("\n");
  return (
    <div className="withdrawal-form">
      <pre>{tekst}</pre>
      <div className="withdrawal-actions">
        {shop.email && (
          <a
            className="button button-dark"
            href={`mailto:${shop.email}?subject=${encodeURIComponent("Izjava o odustanku od ugovora")}&body=${encodeURIComponent(tekst)}`}
          >
            <Mail size={18} /> Pošalji e-mailom
          </a>
        )}
        <button
          type="button"
          className="button button-light"
          onClick={() => {
            // Bez dozvole ili na http-u clipboard ne postoji ili odbija; kupac tada mora da zna da tekst nije kopiran.
            const upis: Promise<void> | undefined = navigator.clipboard?.writeText(tekst);
            if (!upis) { setKopirano("ne"); return; }
            upis.then(() => setKopirano("da"), () => setKopirano("ne"));
          }}
        >
          {kopirano === "da" ? <><Check size={18} /> Kopirano</> : "Kopiraj obrazac"}
        </button>
      </div>
      <p className="withdrawal-status" role="status">
        {kopirano === "da" ? "Obrazac je kopiran." : kopirano === "ne" ? "Kopiranje nije uspelo. Označi tekst obrasca iznad i kopiraj ga ručno." : ""}
      </p>
    </div>
  );
}
function InfoPage({ kind }: { kind: string }) {
  const { preparationMode, prodavnicaStanje } = useStore();
  const uPripremi = preparationMode !== false;
  const prodavnica = useProdavnica();
  const formatPrice = usePrice();
  const dostava = opisDostave(prodavnica, formatPrice);
  const faq = faqOdgovori(dostava.tekst);
  const imaKontakt = Boolean(prodavnica.phone || prodavnica.email);
  // Adresa sedista se vidi samo u odeljku "Podaci o prodavcu", koji postoji kada je unet naziv firme.
  const imaAdresu = Boolean(prodavnica.companyName && prodavnica.companyAddress);
  if (kind === "podrska")
    return (
      <div className="page-width inner-page support-page">
        <Breadcrumb items={[{ label: "Podrška" }]} />
        <div className="page-title">
          <span className="eyebrow">JASNI ODGOVORI. BEZ KOMPLIKOVANJA.</span>
          <h1>
            Tu smo za tvoj
            <br />
            sledeći dobar izbor.
          </h1>
          <p>{uPripremi ? "Istraži katalog i saznaj više o prodavnici pre otvaranja." : "Sve što treba da znaš o poručivanju, dostavi i plaćanju."}</p>
        </div>
        <div className="faq-list" id="povrat">
          {(uPripremi ? [
            ["Da li trenutno mogu da poručim?", "Prodavnica je u pripremi. Katalog možeš da razgledaš, ali cene i poručivanje još nisu dostupni."],
            faq[1],
            ["Mogu li da kupim bez registracije?", "Da. Kada prodavnica bude otvorena, porudžbinu ćeš moći da pošalješ kao gost, bez naloga. Za pregled kataloga i čuvanje artikala nalog takođe nije potreban."],
            ["Da li se sačuvani artikli pamte?", "Sačuvani artikli pamte se samo u ovom pregledaču na ovom uređaju i ne prenose se na drugi uređaj, ni kada si prijavljen."],
          ] : faq).map(([q, a], i) => (
            <details key={q} open={i === 0}>
              <summary>
                {q}
                <Plus size={20} />
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
        <p className="support-links">
          <Link href="/dostava">Dostava i plaćanje</Link>
          <Link href="/povrat-i-reklamacije">Povrat i reklamacije</Link>
          <Link href="/uslovi">Uslovi korišćenja</Link>
          <Link href="/privatnost">Privatnost</Link>
        </p>
        {/* Kontakt stize sa /api/pricing: dok se ucitava ili kad ne stigne, kupac to i vidi,
            umesto poruke da kontakt ne postoji (pregled 18.10.2026). */}
        <div className="notice" role="status">
          {imaKontakt ? (
            <span>
              Za pitanja nam se javi na <KontaktLinkovi />.
              {prodavnica.hours ? " Radno vreme: " + prodavnica.hours + "." : ""}
            </span>
          ) : prodavnicaStanje === "ucitava" ? (
            <>
              <LoaderCircle className="spin" size={16} aria-hidden="true" />
              <span>Učitavamo kontakt prodavnice…</span>
            </>
          ) : prodavnicaStanje === "greska" ? (
            <span>Kontakt trenutno ne možemo da učitamo. Osveži stranicu za nekoliko trenutaka.</span>
          ) : (
            <span>Kontakt prodavnice objavljujemo uskoro.</span>
          )}
        </div>
      </div>
    );
  if (kind === "o-nama")
    return (
      <div className="page-width inner-page about-page">
        <Breadcrumb items={[{ label: "Naša priča" }]} />
        <div className="about-hero">
          <span className="eyebrow">NOVA FREKVENCIJA TECH KUPOVINE</span>
          <h1>
            Dobra tehnologija.
            <br />
            <span>Još bolji osećaj.</span>
          </h1>
          <p>
            Gradimo mesto na kom lako pronalaziš pravu opremu. Za uređaj koji
            nosiš svuda, sto za kojim nastaju ideje i igru u kojoj daješ sve.
          </p>
        </div>
        <div className="about-values">
          {[
            [
              "01",
              "Manje traženja.",
              "Od kategorije do tačnog modela uređaja. Jasni koraci, konkretni proizvodi.",
            ],
            [
              "02",
              "Više tvog stila.",
              "Mobilna i računarska oprema, audio, gejming i alat — u istom ritmu.",
            ],
            [
              "03",
              "Prostor za biznis.",
              "Poseban pristup za servise, prodavnice i timove. Saradnja koja počinje razgovorom.",
            ],
          ].map(([n, t, d]) => (
            <div key={n}>
              <span>{n}</span>
              <h2>{t}</h2>
              <p>{d}</p>
            </div>
          ))}
        </div>
        <div className="notice">{uPripremi
          ? "MOBITOK je u pripremi. Katalog možeš da istražiš, dok su cene i poručivanje privremeno nedostupni."
          : "MOBITOK je nova prodavnica. Artikal poručujemo od ugovorene veleprodaje po prijemu porudžbine."}</div>
        {prodavnica.companyName && <section className="company-details"><h2>Podaci o prodavcu</h2><SellerDetails /></section>}
        <Link prefetch={false} href="/katalog" className="button button-dark">
          Upoznaj naš svet <ArrowUpRight size={18} />
        </Link>
      </div>
    );
  const content: Record<string, { title: string; body: React.ReactNode }> = {
    dostava: {
      title: "Jednostavno do poslednjeg koraka.",
      body: (
        <>
          <h2>Kako poručivanje teče</h2>
          <p>
            Nemamo sopstveno skladište. Artikal poručujemo od ugovorene
            veleprodaje čim tvoja porudžbina stigne, a zatim ga šaljemo
            kurirskom službom na adresu iz porudžbine. Porudžbinu možeš poslati
            i bez registracije.
          </p>
          <h2>Plaćanje</h2>
          <p>
            Dostupni načini plaćanja prikazani su pri poručivanju. Kod pouzeća
            iznos plaćaš kuriru pri preuzimanju. Ako izabereš karticu, podatke
            unosiš na stranici banke; sredstva se rezervišu, a naplata sledi nakon slanja.
            Kod QR uplate skeniraš nalog u aplikaciji svoje banke; porudžbinu potvrđujemo po proveri priliva prema izvodu.
          </p>
          <p>
            Podatke kartice i sigurnosni kod unosiš isključivo na zaštićenoj stranici banke.
            MOBITOK ih ne prima niti čuva. Ne šalji nam ih e-mailom.
          </p>
          {/* Oblast dostave, licno preuzimanje i nepreuzeta posiljka cekaju potvrdu vlasnika
              (pregled 18.10.2026), pa se ne navode kao pravilo. */}
          <h2>Onlajn prodaja</h2>
          <p>
            Prodaja je isključivo onlajn; adresa sedišta prodavca nije prodajni
            objekat.
          </p>
          <h2>Cena dostave i rok isporuke</h2>
          {prodavnica.courier && (
            <p>Pošiljku predajemo kurirskoj službi {prodavnica.courier}.</p>
          )}
          {/* Iste recenice kao u korpi, FAQ-u i Uslovima: potvrdjuje se samo ono sto nije uneto. */}
          {dostava.cena && <p>{dostava.cena}</p>}
          {dostava.rok && <p>{dostava.rok}</p>}
          {dostava.potvrda && (
            <p>
              {dostava.potvrda} To zavisi od dobavljača i kurirske službe. Dok
              to ne potvrdimo, pošiljka se ne šalje.
            </p>
          )}
          <h2>Cene i dostupnost</h2>
          <p>
            Katalog objedinjuje artikle iz partnerskih izvora. Uz svaki artikal
            prikazujemo dostupnost iz poslednje provere. Dodavanje u korpu ne
            rezerviše zalihu; pre potvrde ponovo proveravamo izbor i cene.
          </p>
          <h2>Jedna korpa, jedna porudžbina</h2>
          <p>
            Sve što izabereš potvrđuješ jednom porudžbinom, a naš tim prati
            pripremu svakog artikla. Ako artikli ne mogu da krenu zajedno,
            pošiljka može stići u više paketa; broj paketa i rokove potvrđujemo
            pri potvrdi porudžbine.
          </p>
          <h2>Otkazivanje</h2>
          <p>
            Ako želiš da otkažeš porudžbinu pre slanja, javi nam se sa brojem
            porudžbine.
          </p>
          <h2>Povrat i reklamacije</h2>
          <p>
            Od kupovine možeš odustati u roku od 14 dana od prijema robe.
            Postupak, obrazac za odustanak i način prijave reklamacije su na
            stranici <Link href="/povrat-i-reklamacije">Povrat i reklamacije</Link>.
          </p>
        </>
      ),
    },
    privatnost: {
      title: "Tvoji podaci. Jasna pravila.",
      body: (
        <>
          {/* Pregled 18.10.2026: primaoci su navedeni poimence, a prava i rokovi prate Zakon o
              zastiti podataka o licnosti. Da li dobavljac salje paket direktno kupcu (pa dobija
              ime, adresu i telefon) ceka potvrdu vlasnika, pa se o dobavljacima nista ne tvrdi. */}
          <h2>Ko obrađuje podatke</h2>
          <p>
            {prodavnica.companyName ? (
              <>
                Rukovalac podacima je {prodavnica.companyName}; ostali podaci o
                prodavcu su na dnu ove stranice.{" "}
              </>
            ) : (
              <>Rukovalac podacima je prodavac koji vodi prodavnicu MOBITOK.{" "}</>
            )}
            {prodavnica.email ? (
              <>
                Za pitanja o podacima i za ostvarivanje prava piši nam na{" "}
                <a href={"mailto:" + prodavnica.email}>{prodavnica.email}</a>.
              </>
            ) : (
              <>
                Za pitanja o podacima javi nam se preko stranice{" "}
                <Link href="/podrska">Podrška</Link>.
              </>
            )}
          </p>
          <h2>Koje podatke obrađujemo</h2>
          <ul>
            <li>
              Porudžbina: ime i prezime, e-mail, telefon, adresa, grad i
              poštanski broj, napomena ako je upišeš, izabrani artikli, iznos i
              vreme porudžbine.
            </li>
            <li>
              Plaćanje: način plaćanja, iznos i valuta, vreme i referenca pokušaja
              ili transakcije, rezultat rezervacije sredstava i evidencija potvrđene
              naplate, priliva, poništenja ili povraćaja. Pune podatke kartice i sigurnosni
              kod ne primamo niti čuvamo.
            </li>
            <li>
              Nalog, koji nije obavezan za kupovinu: ime i prezime, e-mail,
              bezbedno obrađena lozinka i, po želji, naziv firme i PIB. Ako se
              prijaviš preko Google naloga, Google nam dostavlja ime i e-mail
              adresu tog naloga.
            </li>
            <li>
              Prijava za poslovni nalog: naziv firme, PIB, matični broj, kontakt
              osoba, telefon i adresa firme.
            </li>
            <li>
              Samo u tvom pregledaču, ne kod nas: korpa, sačuvani artikli,
              nedavno pregledani proizvodi, izabrani jezik, valuta i raspored
              kataloga, kao i sesija prijave.
            </li>
          </ul>
          <h2>Svrha i pravni osnov</h2>
          <p>
            Podatke porudžbine obrađujemo da bismo zaključili i izvršili ugovor
            o kupovini: da pripremimo i pošaljemo pošiljku, javimo ti se u vezi
            sa porudžbinom i rešimo odustanak ili reklamaciju. Bez podataka za
            isporuku porudžbinu ne možemo da pošaljemo. Deo podataka čuvamo i
            zato što to nalažu propisi, na primer o računovodstvu i zaštiti
            potrošača. Nalog i poslovni nalog obrađujemo na osnovu tvoje
            registracije. Podatke ne koristimo za reklame, ne prodajemo ih i ne
            prijavljujemo te na newsletter. Ne donosimo automatizovane odluke
            zasnovane na tvojim podacima.
          </p>
          <h2>Kome se podaci dostavljaju</h2>
          <ul>
            <li>
              Kurirskoj službi: ime i prezime, adresa, telefon i iznos za
              naplatu ako je izabrano pouzeće, radi isporuke.
            </li>
            <li>
              Raiffeisen banci i njenom platnom procesoru UPC: tehnički podaci potrebni
              za pokretanje i proveru kartičnog plaćanja, uključujući referencu, iznos i
              valutu. Podatke kartice unosiš na njihovoj stranici; njihovu obradu uređuju
              i njihova obaveštenja o privatnosti.
            </li>
            <li>
              Pružaocima usluga na kojima sajt radi: Vercel (hosting sajta),
              Supabase (baza i nalozi, podaci se čuvaju u Frankfurtu, u EU) i
              Resend (slanje e-mail poruka u vezi sa nalogom i porudžbinom). Oni
              podatke obrađuju samo da bi sajt i ove usluge radili.
            </li>
            <li>
              Google: Gmail sanduče na koje stižu obaveštenja prodavnice o
              porudžbinama i tvoje poruke prodavnici.
            </li>
            <li>Državnim organima, kada to nalaže zakon.</li>
          </ul>
          <p>
            Vercel, Supabase, Resend i Google su kompanije sa sedištem u SAD.
            Baza se čuva u Frankfurtu (EU), ali se deo podataka može obrađivati
            i van Srbije, uključujući SAD.
          </p>
          <h2>Koliko dugo čuvamo podatke</h2>
          <p>
            Podatke porudžbine čuvamo dok traju rokovi za odustanak,
            reklamacije i saobraznost robe, a podatke iz knjigovodstvenih
            isprava onoliko koliko propisi nalažu. Nalog čuvamo dok ne zatražiš
            njegovo brisanje. Podatke u pregledaču brišeš sam, brisanjem podataka
            sajta u podešavanjima pregledača.
          </p>
          <h2>Tvoja prava</h2>
          <p>
            Možeš tražiti pristup svojim podacima, ispravku, brisanje,
            ograničenje obrade i prenos podataka, kao i podneti prigovor na
            obradu. Na zahtev odgovaramo bez odlaganja, a najkasnije u roku od
            30 dana. Ako smatraš da obrada nije zakonita, možeš podneti
            pritužbu Povereniku za informacije od javnog značaja i zaštitu
            podataka o ličnosti.
          </p>
          <h2>Kolačići i analitika</h2>
          <p>
            Sajt ne koristi analitiku ni reklamne kolačiće. U pregledaču se čuva
            samo ono što je potrebno da sajt radi: korpa, sačuvani artikli,
            podešavanja prikaza, sesija prijave i podaci za nastavak započetog
            plaćanja. Pune podatke kartice i sigurnosni kod unosiš na stranici banke;
            ne unosiš ih u obrazac ove prodavnice.
          </p>
        </>
      ),
    },
    uslovi: {
      title: "Pre nego što kreneš.",
      body: (
        <>
          <h2>Poručivanje</h2>
          <p>
            MOBITOK nema sopstveno skladište. Artikal poručujemo od ugovorene
            veleprodaje po prijemu tvoje porudžbine. Porudžbinu možeš poslati i
            bez registracije. Porudžbina je prihvaćena kada potvrdimo
            dostupnost, konačnu cenu, cenu dostave i rok isporuke.
          </p>
          <h2>Cene</h2>
          <p>
            Cene su iskazane sa PDV-om i ne uključuju cenu dostave. Ako se cena
            ili dostupnost kod dobavljača promene pre potvrde, javljamo ti pre
            slanja i možeš odustati bez obaveze. Isto važi ako ti potvrđena cena
            dostave ili rok isporuke ne odgovaraju.
          </p>
          <h2>Plaćanje</h2>
          <p>
            Dostupne načine plaćanja i konačan iznos proveri pri poručivanju.
            Pouzećem plaćaš kuriru pri preuzimanju. Ako izabereš karticu,
            podatke unosiš na stranici banke; sredstva se rezervišu,
            a naplata sledi nakon slanja.
            Kod QR uplate porudžbinu potvrđujemo nakon provere priliva prema bankarskom izvodu.
          </p>
          <p>
            Podatke kartice i sigurnosni kod unosiš isključivo na zaštićenoj stranici banke.
            MOBITOK ih ne prima niti čuva. Ne šalji nam ih e-mailom.
          </p>
          <p>
            Sva plaćanja su u srpskim dinarima (RSD). Ako je račun tvoje kartice u drugoj
            valuti, banka može preračunati iznos po svom važećem kursu.
          </p>
          <h2>Dostava</h2>
          <p>
            Isporuku obavlja kurirska služba, na adresu iz porudžbine.{" "}
            {dostava.tekst} Artikli različitih dobavljača mogu stići u više
            paketa.
          </p>
          <h2>Odustanak od kupovine</h2>
          <p>
            Od ugovora zaključenog na daljinu možeš odustati u roku od 14 dana
            od dana prijema robe, bez navođenja razloga (ako porudžbina stigne u
            više paketa, od prijema poslednjeg). Izjavu o odustanku pošalji
            e-mailom{imaAdresu ? " ili poštom na adresu sedišta" : ""};
            možeš koristiti{" "}
            <Link href="/povrat-i-reklamacije">obrazac za odustanak</Link>. Robu
            vrati najkasnije 14 dana od dana slanja izjave. Odgovaraš samo za
            umanjenje vrednosti robe nastalo rukovanjem koje nije potrebno da se
            utvrde njena priroda, karakteristike i funkcionalnost. Direktne
            troškove vraćanja snosi kupac, osim ako je isporučen pogrešan ili
            neispravan artikal.
          </p>
          <p>
            Uplaćen iznos, zajedno sa troškom standardne dostave, vraćamo bez
            troškova za tebe, najkasnije 14 dana od dana prijema izjave, a
            povraćaj možemo
            zadržati dok ne primimo robu ili dokaz da je poslata. Zakon predviđa
            izuzetke, na primer za zapečaćenu robu koja se iz higijenskih
            razloga ne može vratiti kada je otpečaćena.
          </p>
          <p>
            Za plaćanje karticom, povraćaj obrađujemo preko banke na karticu kojom je plaćeno.
            Za pouzeće i uplatu na račun, vraćamo novac na račun koji navedeš.
          </p>
          <h2>Reklamacije</h2>
          <p>
            Ako artikal ima nedostatak ili ne odgovara porudžbini, javi nam broj
            porudžbine, opis problema i, ako možeš, fotografiju. Prijem
            reklamacije potvrđujemo bez odlaganja, uz evidencijski broj.
            Odgovor šaljemo najkasnije u roku od osam dana od prijema, a
            reklamaciju rešavamo najkasnije u roku od 15 dana, odnosno 30 dana
            za tehničku robu. Ceo postupak je na stranici{" "}
            <Link href="/povrat-i-reklamacije">Povrat i reklamacije</Link>.
          </p>
        </>
      ),
    },
    "povrat-i-reklamacije": {
      title: "Povrat i reklamacije.",
      body: (
        <>
          <h2>Odustanak u roku od 14 dana</h2>
          <p>
            Od kupovine na daljinu možeš odustati u roku od 14 dana od dana
            prijema robe, bez navođenja razloga. Ako porudžbina stigne u više
            paketa, rok teče od dana prijema poslednjeg paketa.
          </p>
          <ol className="legal-steps">
            <li>
              Pošalji izjavu o odustanku
              {prodavnica.email ? (
                <>
                  {" "}e-mailom na <a href={"mailto:" + prodavnica.email}>{prodavnica.email}</a>
                </>
              ) : null}
              {imaAdresu ? (prodavnica.email ? " ili poštom" : " poštom") + " na adresu sedišta iz odeljka „Podaci o prodavcu”" : ""}
              . Možeš koristiti obrazac ispod ili poslati drugu nedvosmislenu
              izjavu.
            </li>
            <li>
              Potvrdu prijema izjave šaljemo bez odlaganja, zajedno sa adresom
              na koju vraćaš robu.
            </li>
            <li>
              Robu vrati najkasnije 14 dana od dana slanja izjave. Direktne
              troškove vraćanja snosi kupac, osim ako je isporučen pogrešan ili
              neispravan artikal.
            </li>
            <li>
              Za plaćanje karticom, povraćaj obrađujemo preko banke na karticu kojom je plaćeno.
              Za pouzeće i uplatu na račun, vraćamo novac na račun koji navedeš u izjavi.
              Povraćaj uključuje trošak standardne dostave, bez troškova za tebe,
              najkasnije 14 dana od dana prijema izjave. Povraćaj možemo
              zadržati dok ne primimo robu ili dokaz da je poslata.
            </li>
          </ol>
          <p>
            Odgovaraš samo za umanjenje vrednosti robe nastalo rukovanjem koje
            nije potrebno da se utvrde njena priroda, karakteristike i
            funkcionalnost. Zakon predviđa izuzetke od prava na odustanak, na
            primer za zapečaćenu robu koja se iz higijenskih razloga ne može
            vratiti kada je otpečaćena.
          </p>
          <h2>Obrazac za odustanak</h2>
          <ObrazacOdustanka />
          <h2>Reklamacije</h2>
          <p>
            Ako artikal ima nedostatak ili ne odgovara porudžbini, prijavi
            reklamaciju
            {imaKontakt ? (
              <>
                {" "}na <KontaktLinkovi />
              </>
            ) : null}{" "}
            i navedi broj porudžbine, opis problema i, ako možeš, fotografiju.
          </p>
          <ul>
            <li>Prijem reklamacije potvrđujemo bez odlaganja, uz evidencijski broj.</li>
            <li>Odgovor šaljemo najkasnije u roku od osam dana od prijema reklamacije.</li>
            <li>
              Reklamaciju rešavamo najkasnije u roku od 15 dana od prijema, odnosno
              30 dana za tehničku robu.
            </li>
          </ul>
          <h2>Saobraznost i garancija</h2>
          <p>
            Prodavac odgovara za nesaobraznost robe ugovoru koja se pojavi u roku
            od dve godine od dana prelaska rizika na kupca. Garancija
            proizvođača ili uvoznika, kada postoji, ne umanjuje ta zakonska
            prava.
          </p>
          <h2>Vansudsko rešavanje sporova</h2>
          <p>
            Ako spor ne rešimo dogovorom, možeš se obratiti telu za vansudsko
            rešavanje potrošačkih sporova sa liste ministarstva nadležnog za
            zaštitu potrošača. Prodavac je dužan da učestvuje u tom postupku.
          </p>
        </>
      ),
    },
  };
  const c = content[kind] || content.uslovi;
  const naziv: Record<string, string> = {
    dostava: "Dostava i plaćanje",
    privatnost: "Privatnost",
    "povrat-i-reklamacije": "Povrat i reklamacije",
    uslovi: "Uslovi korišćenja",
  };
  return (
    <div className="page-width inner-page legal-page">
      <Breadcrumb items={[{ label: naziv[kind] ?? "Uslovi korišćenja" }]} />
      <span className="eyebrow">DOBRO JE ZNATI</span>
      <h1>{c.title}</h1>
      <article>
        {/* U pripremi se prikazuju isti uslovi koji ce vaziti od otvaranja, uz jasnu napomenu
            (ranije su dostava i uslovi bili zamenjeni kratkim tekstom bez pravila kupovine). */}
        {uPripremi && kind !== "privatnost" && (
          <div className="notice">
            <Info size={18} />
            <span>
              Prodavnica je u pripremi i porudžbine se još ne primaju. Ispod su
              uslovi koji će važiti od otvaranja.
            </span>
          </div>
        )}
        {c.body}
        {prodavnica.companyName && <section className="company-details"><h2>Podaci o prodavcu</h2><SellerDetails /></section>}
      </article>
      <Link href="/podrska" className="text-link">
        Još odgovora <ArrowUpRight size={18} />
      </Link>
    </div>
  );
}
// Upit za vecu kolicinu ide direktno prodavnici: e-mail sa unapred upisanim poljima ili poziv.
// Ranije je bez e-maila vodio na Podrsku, koja opet nije imala kontakt (pregled 18.10.2026).
const POLJA_UPITA = [
  "Naziv firme:",
  "PIB:",
  "Kontakt osoba i telefon:",
  "",
  "Artikli (naziv ili šifra) i količine:",
  "",
  "Željeni rok isporuke:",
  "Napomena:",
].join("\n");
function BusinessInquiry() {
  const company = useProdavnica();
  const { prodavnicaStanje } = useStore();
  return <div className="page-width inner-page business-inquiry">
    <Breadcrumb items={[{ label: "Veće porudžbine" }]} />
    <span className="eyebrow">MOBITOK ZA FIRME I TIMOVE</span>
    <h1>Treba ti više komada?</h1>
    <p>Pošalji nam koje artikle tražiš i koliko komada ti je potrebno. Javićemo se sa informacijama o dostupnosti i mogućoj ponudi za tu količinu.</p>
    <div className="business-inquiry-actions">
      {company.email ? (
        <a className="button button-dark" href={`mailto:${company.email}?subject=${encodeURIComponent("Upit za veću porudžbinu")}&body=${encodeURIComponent(POLJA_UPITA)}`}><Mail size={18} /> Pošalji upit e-mailom</a>
      ) : company.phone ? (
        <a className="button button-dark" href={telHref(company.phone)}><Phone size={18} /> Pozovi {company.phone}</a>
      ) : prodavnicaStanje === "ucitava" ? (
        // Dok se kontakt ucitava nema na sta da se klikne, pa nije dugme (pregled 18.10.2026).
        <div className="notice" role="status"><LoaderCircle className="spin" size={16} aria-hidden="true" /><span>Učitavamo kontakt prodavnice…</span></div>
      ) : (
        <div className="notice" role="status">
          <span>{prodavnicaStanje === "greska" ? "Kontakt trenutno ne možemo da učitamo. Osveži stranicu za nekoliko trenutaka." : "Kontakt prodavnice objavljujemo uskoro."}</span>
        </div>
      )}
      {company.email && company.phone && <a className="text-link" href={telHref(company.phone)}>{company.phone}</a>}
    </div>
    <p className="business-inquiry-hint">U poruci navedi naziv firme, PIB, artikle (naziv ili šifru) i količine, željeni rok isporuke i kontakt telefon.</p>
    <small>Za običnu kupovinu nisu potrebni podaci firme pri registraciji. Naziv firme i PIB možeš dodati opciono.</small>
  </div>;
}
type StorefrontProps = { path: string[]; children?: React.ReactNode };

function Content({ path, children }: StorefrontProps) {
  const uPripremi = useStore().preparationMode !== false;
  if (uPripremi && (path[0] === "korpa" || path[0] === "placanje"))
    return <div className="page-width inner-page"><div className="preparation-route panel">
      <span className="eyebrow">MOBITOK JE U PRIPREMI</span>
      <h1>Prodavnica se uskoro otvara.</h1>
      <p>Za sada možeš da istražiš katalog i sačuvaš omiljene artikle. Cene i poručivanje još nisu dostupni. Kada otvorimo prodavnicu, poručivanje će biti moguće i bez registracije.</p>
      <Link prefetch={false} href="/katalog" className="button button-dark">Istraži katalog <ArrowRight size={18} /></Link>
    </div></div>;
  if (!path.length) return children;
  if (path[0] === "katalog") return <Catalog />;
  if (path[0] === "proizvod") return <ProductPage slug={path[1]} />;
  if (path[0] === "favoriti") return <Favorites />;
  if (path[0] === "korpa") return <CartPage />;
  if (path[0] === "placanje") return <Checkout />;
  if (path[0] === "vodic") return <Guide />;
  if (path[0] === "b2b") return <BusinessInquiry />;
  if (["nalog", "admin"].includes(path[0]))
    return (
      <div className="page-width inner-page">
        <Breadcrumb
          items={[
            {
              label:
                path[0] === "nalog" ? "Moj nalog" : "Administracija",
            },
          ]}
        />
        <AccountPanel mode={path[0] === "nalog" ? "account" : "admin"} />
      </div>
    );
  return <InfoPage kind={path[0]} />;
}
function Site({ path, children }: StorefrontProps) {
  const { toast, preparationMode } = useStore();
  return (
    <div className="volt-universe" data-page={path.length ? "store" : "home"}>
      <div className="site-atmosphere" aria-hidden="true" />
      <a className="skip-link" href="#main-content">
        Pređi na sadržaj
      </a>
      <Header />
      {preparationMode !== false && <div className="preparation-banner" role="status">
        <div className="page-width preparation-banner-inner">
          <span className="preparation-banner-mark"><Sparkles size={19} /></span>
          <div><strong>MOBITOK je u pripremi.</strong><span>Upoznaj naš asortiman i sačuvaj favorite. Cene i poručivanje biće dostupni posle otvaranja.</span></div>
          <Link prefetch={false} href="/katalog">Istraži katalog <ArrowUpRight size={16} /></Link>
        </div>
      </div>}
      <main id="main-content">
        <Suspense
          fallback={
            <div className="page-loading">
              <LoaderCircle className="spin" /> Učitavamo tvoj izbor…
            </div>
          }
        >
          <Content path={path}>{children}</Content>
        </Suspense>
      </main>
      <Footer />
      <MobileNav path={path} />
      <CartDrawer />
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {toast}
        </div>
      )}
    </div>
  );
}
export default function Storefront({ path, children }: StorefrontProps) {
  return (
    <StoreProvider>
      <Site path={path}>{children}</Site>
    </StoreProvider>
  );
}

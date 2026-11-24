"use client";

import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, useScroll, useTransform } from "motion/react";
import { ArrowDown, ArrowUpRight, AudioLines, Check, ChevronRight, Gamepad2, Headphones, Laptop, Pause, Play, Smartphone, Sparkles, Wrench, Zap } from "lucide-react";
import { categories, type Product } from "@/lib/catalog";
import { useCatalog, useStore, useTaxonomy } from "./store-context";
import CinemaScene from "./cinema-scene";

const quickCategories = [
  { name: "Maske", href: "/katalog?kategorija=mobilni&podkategorija=maske" },
  { name: "Stakla", href: "/katalog?kategorija=mobilni&podkategorija=stakla" },
  { name: "Računari", href: "/katalog?kategorija=racunari" },
  { name: "Gejming", href: "/katalog?kategorija=gejming" },
  { name: "Slušalice i zvučnici", href: "/katalog?kategorija=audio" },
];
const categoryVisuals = [
  { id: "mobilni", title: "Uvek\nuz tebe.", image: "/products/kp-149287172-1.webp", icon: Smartphone, color: "mint", label: "MOBILNA OPREMA" },
  { id: "gejming", title: "Tvoj potez.\nTvoja igra.", image: "/images/home-gaming.webp", icon: Gamepad2, color: "lilac", label: "GEJMING" },
  { id: "audio", title: "Svet na\ntvojoj frekvenciji.", image: "/images/home-audio.webp", icon: Headphones, color: "peach", label: "AUDIO" },
];

// The installed Motion hook snapshots this setting once. Keep live OS changes reactive.
const subscribeMotionPreference = (changed: () => void) => {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
};
const readMotionPreference = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const serverMotionPreference = () => true;
function useMotionPreference() {
  return useSyncExternalStore(subscribeMotionPreference, readMotionPreference, serverMotionPreference);
}

function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduced = useMotionPreference();
  return <motion.div className={className} initial={false} whileInView={reduced ? undefined : { opacity: [0.4, 1], y: [28, 0] }} viewport={{ once: true, amount: 0.12 }} transition={{ duration: 0.8, delay, ease: [0.2, 0.7, 0.2, 1] }}>{children}</motion.div>;
}

function CinemaStory() {
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const reduced = useMotionPreference();
  const sceneReady = useCallback(() => setReady(true), []);
  const sceneUnavailable = useCallback(() => setReady(false), []);
  useEffect(() => {
    try { setPaused(localStorage.getItem("volt-motion-paused") === "true"); } catch {}
    setPreferencesReady(true);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.motion = !preferencesReady || paused || reduced ? "paused" : "running";
  }, [preferencesReady, paused, reduced]);
  const toggleMotion = () => {
    const next = !paused;
    setPaused(next);
    try { localStorage.setItem("volt-motion-paused", String(next)); } catch {}
  };
  return (
    <section className="cine-story" data-testid="cinema-story" aria-label="MOBITOK — telefoni i oprema">
      <div className="cine-stage">
        <div className="cine-stage-bg" aria-hidden="true">
          <div className="cine-glow cine-glow-main" />
          <div className="cine-glow cine-glow-second" />
          <div className="cine-grid" />
          <div className="cine-orbit cine-orbit-one" /><div className="cine-orbit cine-orbit-two" />
          <span className="cine-bg-word">MOBITOK</span>
        </div>
        <div className="cine-copy">
          <span className="cine-intro-label">PRONAĐI SVOJ IZBOR</span>
          <h1 className="cine-title"><span>OPREMA ZA</span><span className="cine-title-accent">TVOJ DAN.</span></h1>
          <p className="cine-description">Maske, stakla, slušalice, računari i gejming oprema — pronađi ono što ti treba.</p>
          <div className="cine-actions">
            <Link prefetch={false} href="/katalog" className="cine-button cine-button-lime">Istraži katalog <ArrowUpRight size={21} /></Link>
          </div>
          <nav className="cine-quick-categories" aria-label="Brze kategorije">{quickCategories.map((item) => <Link prefetch={false} key={item.name} href={item.href}>{item.name}</Link>)}</nav>
        </div>
        <div className={"cinema-model" + (ready ? " is-ready" : "")}>
          <div className="cine-fallback" aria-hidden="true"><img src="/images/hero-audio.webp" srcSet="/images/hero-audio-small.webp 760w, /images/hero-audio.webp 1536w" sizes="(max-width: 760px) 100vw, 70vw" width={1536} height={1024} alt="" fetchPriority="high" decoding="async" /></div>
          <CinemaScene className="volt-scene" paused={!preferencesReady || paused || !!reduced} onReady={sceneReady} onUnavailable={sceneUnavailable} />
          <div className="cine-model-shadow" aria-hidden="true" />
        </div>
        <div className="cine-stage-bottom">
          <button className="cine-pause" onClick={toggleMotion} aria-label={paused ? "Pokreni animacije" : "Pauziraj animacije"} aria-pressed={paused}>{paused ? <Play size={15} /> : <Pause size={15} />}<span>{paused ? "Pokreni" : "Pauziraj"}</span></button>
        </div>
      </div>
    </section>
  );
}

function SetupScene() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const rotate = useTransform(scrollYProgress, [0, 1], [-13, 8]);
  const y = useTransform(scrollYProgress, [0, 1], [45, -40]);
  const reduced = useMotionPreference();
  return <div ref={ref} className="cine-setup-art" aria-hidden="true">
    <div className="cine-setup-halo" />
    <motion.div className="cine-workstation" style={reduced ? {} : { rotateY: rotate, y }}>
      <div className="cine-monitor"><div className="cine-monitor-screen"><div className="cine-screen-orb" /><span>PLAY.<br />CREATE.<br /><b>REPEAT.</b></span><i>MOBITOK SETUP / 01</i></div><div className="cine-monitor-chin">MOBITOK</div></div>
      <div className="cine-monitor-stem" /><div className="cine-monitor-base" />
      <div className="cine-keyboard">{Array.from({ length: 45 }, (_, i) => <i key={i} />)}</div>
      <div className="cine-mouse"><i /></div>
      <div className="cine-desk" />
    </motion.div>
    <span className="cine-art-caption">TVOJ PROSTOR. TVOJA ENERGIJA.</span>
  </div>;
}

export default function CinematicHome({ renderProduct, deviceFinder }: { renderProduct: (product: Product) => ReactNode; deviceFinder: ReactNode }) {
  const [active, setActive] = useState("sve");
  const discoverRef = useRef<HTMLElement>(null);
  const [featuredVisible, setFeaturedVisible] = useState(false);
  useEffect(() => {
    const section = discoverRef.current;
    if (!section) return;
    if (typeof IntersectionObserver !== "function") { setFeaturedVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setFeaturedVisible(true); observer.disconnect(); }
    }, { rootMargin: "400px" });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);
  const { recent, products, ensureProducts, catalogEpoch } = useStore();
  const taxonomy = useTaxonomy();
  // Pocetna prikazuje cetiri artikla po kategoriji i trazi bas njih, umesto da
  // ceka ceo katalog samo da bi uzela prva cetiri.
  const izdvojeni = useCatalog({ kategorija: active === "sve" ? "" : active, velicina: 4, prefetch: false, preskoci: !featuredVisible });
  const featured = izdvojeni.items;
  // Lokalna istorija nije potvrda vidljivosti. Opcioni prikaz ceka uspesnu proveru trenutnog izbora.
  const recentKey = JSON.stringify([catalogEpoch, recent]);
  const [verifiedRecentKey, setVerifiedRecentKey] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setVerifiedRecentKey(null);
    if (!recent.length) return;
    void ensureProducts(recent, true).then((ok) => {
      if (current && ok) setVerifiedRecentKey(recentKey);
    });
    return () => { current = false; };
  }, [recentKey, ensureProducts]);
  const recentProducts = verifiedRecentKey === recentKey
    ? recent.map(id => products.find(p => p.id === id)).filter((p): p is Product => !!p).slice(0, 4)
    : [];
  return <div className="cine-home">
    <CinemaStory />
    <section className="cine-finder-entry page-width" aria-label="Pronađi opremu za svoj telefon">{deviceFinder}</section>
    <section id="kolekcije" className="cine-worlds cine-section">
      <div className="page-width">
        <Reveal className="cine-section-heading"><div><span className="cine-eyebrow"><i /> PRONAĐI SVOJU FREKVENCIJU</span><h2>Pet svetova.<br /><span>Beskrajno tvojih priča.</span></h2></div><p>Za ono što radiš.<br />Za ono što voliš.<br /><b>Za sve što tek dolazi.</b></p></Reveal>
        <div className="cine-world-grid">{categoryVisuals.map((category, i) => {
          const Icon = category.icon;
          return <Reveal key={category.id} delay={i * 0.08}><Link prefetch={false} className={"cine-world cine-world-" + category.color} href={"/katalog?kategorija=" + category.id}>
            <div className="cine-world-top"><span><Icon size={15} />{category.label}</span><span className="cine-round-arrow"><ArrowUpRight size={22} /></span></div>
            <h3>{category.title.split("\n").map((line) => <span key={line}>{line}</span>)}</h3><div className="cine-world-orbit" /><Image src={category.image} alt="" width={480} height={480} sizes="(max-width: 700px) 80vw, 30vw" className="cine-world-product" /><span className="cine-world-bottom">OTKRIJ KOLEKCIJU <ArrowUpRight size={16} /></span>
          </Link></Reveal>;
        })}</div>
        <div className="cine-other-worlds"><Link prefetch={false} href="/katalog?kategorija=racunari"><Laptop /><span>Prostor za velike ideje.<small>{taxonomy.categoryName("racunari")}</small></span><ArrowUpRight /></Link><Link prefetch={false} href="/katalog?kategorija=alati"><Wrench /><span>Preciznost u tvojim rukama.<small>{taxonomy.categoryName("alati")}</small></span><ArrowUpRight /></Link></div>
      </div>
    </section>
    <section ref={discoverRef} className="cine-discover cine-section">
      <div className="cine-discover-orb" aria-hidden="true" />
      <div className="page-width">
        <Reveal className="cine-section-heading"><div><span className="cine-eyebrow"><i /> MALI UPGRADE. VELIKA RAZLIKA.</span><h2>Tvoj sledeći<br /><span>„to je to” trenutak.</span></h2></div><Link prefetch={false} className="cine-text-link" href="/katalog">Ceo asortiman <ArrowUpRight size={21} /></Link></Reveal>
        <div className="cine-tabs" role="group" aria-label="Izdvojeni proizvodi po kategoriji">{[{ id: "sve", short: "Za tvoj ritam" }, ...categories].map(c => <button key={c.id} className={active === c.id ? "active" : ""} onClick={() => setActive(c.id)} aria-pressed={active === c.id}>{c.short}{active === c.id && <span />}</button>)}</div>
        <div className="product-grid cine-product-grid" aria-busy={izdvojeni.ucitava}>
          {!featuredVisible || izdvojeni.ucitava ? Array.from({ length: 4 }, (_, index) => (
            <div className="product-skeleton" key={index} aria-hidden="true">
              <div className="product-visual product-skeleton-visual" style={{ animation: "none" }} />
              <div className="product-copy">
                <div className="product-skeleton-line" style={{ animation: "none" }} />
                <div className="product-skeleton-line short" style={{ animation: "none" }} />
              </div>
            </div>
          )) : featured.map(p => <Fragment key={p.id}>{renderProduct(p)}</Fragment>)}
        </div>
        <div className="cine-selection-note"><span><Check size={16} /> Sačuvaj favorite.</span><span><Check size={16} /> Uporedi detalje.</span><span><Check size={16} /> Izaberi svoj upgrade.</span></div>
      </div>
    </section>
    <section className="cine-setup-section">
      <div className="page-width cine-setup-layout"><Reveal className="cine-setup-copy"><span className="cine-eyebrow"><i /> SVE POČINJE TVOJIM PROSTOROM</span><h2>NE SAMO<br />SETUP.<br /><span>TVOJ SVET.</span></h2><p>Stvori kutak u koji jedva čekaš da se vratiš. Za još jednu partiju. Još jednu ideju. Još jedan dobar dan.</p><Link prefetch={false} href="/katalog?kategorija=gejming" className="cine-button cine-button-lime">Složi svoj setup <ArrowUpRight size={20} /></Link></Reveal><SetupScene /></div>
      <div className="cine-setup-footer page-width"><span><Gamepad2 size={18} /> PLAY YOUR WAY</span><span><Zap size={18} /> CREATE YOUR SPACE</span><span><AudioLines size={18} /> FEEL YOUR RHYTHM</span></div>
    </section>
    <section className="cine-connections cine-section page-width">
      <Reveal className="cine-guide-card"><div className="cine-guide-symbol" aria-hidden="true"><Sparkles /><i /><i /></div><span className="cine-eyebrow">DOBAR IZBOR JE JEDNOSTAVAN.</span><h2>Prava oprema.<br /><span>Baš za tebe.</span></h2><p>Izaberi šta želiš da unaprediš i pronađi opremu koja se uklapa u tvoj dan.</p><Link href="/vodic" className="cine-button cine-button-dark">Pronađi svoj izbor <ArrowUpRight size={20} /></Link></Reveal>
      <Reveal className="cine-business-card" delay={0.12}><span className="cine-eyebrow">ZA FIRME I TIMOVE</span><h2>Više komada?<br /><span>Pošalji upit.</span></h2><p>Za veću porudžbinu napiši nam šta ti treba. Proverićemo dostupnost i pripremiti odgovor za konkretnu količinu.</p><Link href="/b2b" className="cine-text-link">Zatraži ponudu <ArrowUpRight size={21} /></Link><div className="cine-business-orbs" aria-hidden="true"><i /><i /><i /></div></Reveal>
    </section>
    {recentProducts.length > 0 && <section className="cine-recent page-width cine-section"><div className="cine-section-heading"><div><span className="cine-eyebrow">OSTALO TI JE U MISLIMA?</span><h2>Vrati se svom izboru.</h2></div></div><div className="product-grid cine-product-grid">{recentProducts.map(p => <Fragment key={p.id}>{renderProduct(p)}</Fragment>)}</div></section>}
    <div className="cine-signoff page-width">
      <span>TEHNOLOGIJA SE MENJA.<br />DOBAR OSEĆAJ OSTAJE.</span>
      <Link prefetch={false} href="/katalog" className="cine-signoff-logo" aria-label="Pogledaj MOBITOK katalog">
        {/* Tamna verzija znaka: podloga ove sekcije je svetla, bela bi nestala. */}
        <Image src="/images/mobitok-logo-dark.webp" alt="MOBITOK" width={720} height={197} sizes="(max-width: 760px) 86vw, 640px" />
      </Link>
    </div>
  </div>;
}

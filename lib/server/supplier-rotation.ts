// Okidac "jedan izvor po pozivu": pg_cron u bazi zove ?rotate=1 svakog sata, a GitHub Actions je
// rezerva (njegov raspored kasni i po nekoliko sati). Na red dolazi izvor koji najduze nije pokusan,
// pa nepravilni pozivi ne preskacu nijedan izvor. Cista logika, bez baze, da bi mogla da se proveri testom.

const HOUR_MS = 3_600_000;

// Izvori koji ogranicavaju preuzimanja: najmanji razmak (sati) od poslednjeg pokusaja, posebno posle
// uspeha i posle greske. MS Mobile osvezava datoteku jednom dnevno, a posle serije preuzimanja
// preusmerava zahteve umesto da vrati datoteku.
export const MIN_GAP_HOURS: Record<string, { ok: number; failed: number }> = {
  msmobile: { ok: 20, failed: 8 },
};

export const tooSoon = (supplier: string, last: { status: string; started_at: string } | null, now: number) => {
  const gap = MIN_GAP_HOURS[supplier];
  if (!gap || !last) return false;
  const started = Date.parse(last.started_at);
  if (Number.isNaN(started)) return false;
  return now - started < (last.status === "ok" ? gap.ok : gap.failed) * HOUR_MS;
};

// Dva okidaca (pg_cron i rezerva) mogu da stignu blizu jedan drugom; ako je bilo koji izvor pokrenut
// u ovom roku, poziv ne pokrece nista novo.
export const ROTATION_GUARD_MINUTES = 45;

export type RunInfo = { status: string; started_at: string; finished_at: string | null };
export type RotationSource = {
  supplier: string;
  catalogEnabled: boolean;
  catalogPublishedAt: string | null;
  stockMaxAgeHours: number;
  last: RunInfo | null; // poslednji pokusaj
  lastOk: RunInfo | null; // poslednje uspesno osvezavanje
  unpublishedSince?: string | null; // kraj najstarijeg uspesnog osvezavanja posle poslednje objave
};

const vreme = (value: string | null | undefined) => {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isNaN(ms) ? null : ms;
};

/** Stanje izvora iz poslednjih poslova (najnoviji prvi). */
export const rotationState = (
  sources: { supplier: string; catalog_enabled?: boolean | null; catalog_published_at?: string | null; stock_max_age_hours?: number | null }[],
  runs: ({ supplier: string } & RunInfo)[],
): RotationSource[] =>
  sources.map((s) => {
    const own = runs.filter((r) => r.supplier === s.supplier);
    const pick = (r: RunInfo | undefined) => (r ? { status: r.status, started_at: r.started_at, finished_at: r.finished_at } : null);
    const published = vreme(s.catalog_published_at) ?? -Infinity;
    const unpublished = own.filter((r) => r.status === "ok" && (vreme(r.finished_at) ?? -Infinity) > published);
    return {
      supplier: s.supplier,
      catalogEnabled: Boolean(s.catalog_enabled),
      catalogPublishedAt: s.catalog_published_at ?? null,
      stockMaxAgeHours: s.stock_max_age_hours ?? 30,
      last: pick(own[0]),
      lastOk: pick(own.find((r) => r.status === "ok")),
      unpublishedSince: unpublished.at(-1)?.finished_at ?? null,
    };
  });

export const recentlyStarted = (sources: RotationSource[], now: number) =>
  sources.some((s) => {
    const started = vreme(s.last?.started_at);
    return started !== null && now - started < ROTATION_GUARD_MINUTES * 60_000;
  });

/** Uspesno osvezen izvor ciji katalog posle toga nije objavljen (npr. prekinuta objava). */
export const needsPublish = (s: RotationSource) => {
  const synced = vreme(s.lastOk?.finished_at);
  if (!s.catalogEnabled || synced === null) return false;
  const published = vreme(s.catalogPublishedAt);
  return published === null || published < synced;
};

// Objava koja ovoliko sati posle uspesnog osvezavanja nije prosla ni u ponovljenim pokusajima (svaki
// poziv rotacije je ponavlja) vise nije prolazna greska.
export const PUBLISH_LAG_HOURS = 3;

/**
 * Izvori sa ukljucenim katalogom ciji osvezen katalog duze od PUBLISH_LAG_HOURS nije objavljen. Dok
 * objava kasni, artikli izvora su "proveriti dostupnost" i ne mogu da se poruce, iako osvezavanje
 * uspeva, pa poziv javlja gresku kao i za zastareo izvor. Kasnjenje se meri od najstarijeg
 * neobjavljenog osvezavanja, jer novo osvezavanje sa neuspelom objavom ne sme da ga ponisti.
 */
export const publishLagging = (sources: RotationSource[], now: number) =>
  sources
    .filter((s) => {
      const since = vreme(s.unpublishedSince);
      return needsPublish(s) && since !== null && now - since >= PUBLISH_LAG_HOURS * HOUR_MS;
    })
    .map((s) => s.supplier);

/** Sledeci izvor: najduze nepokusan (bez istorije prvi), pa abecedno; izvor sa ogranicenjem ceka svoj razmak. */
export const pickNext = (sources: RotationSource[], now: number): RotationSource | null => {
  const ready = sources.filter((s) => !tooSoon(s.supplier, s.last, now));
  ready.sort((a, b) => {
    const ta = vreme(a.last?.started_at) ?? -Infinity, tb = vreme(b.last?.started_at) ?? -Infinity;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.supplier < b.supplier ? -1 : a.supplier > b.supplier ? 1 : 0;
  });
  return ready[0] ?? null;
};

/**
 * Izvori bez uspesnog osvezavanja u roku vazenja lagera (stock_max_age_hours): njihovi artikli su
 * u prodavnici "proveriti dostupnost" i ne mogu da se poruce, pa poziv tada javlja gresku.
 */
export const staleSources = (sources: RotationSource[], now: number) =>
  sources
    .filter((s) => {
      const ok = vreme(s.lastOk?.finished_at) ?? vreme(s.lastOk?.started_at);
      return ok === null || now - ok >= s.stockMaxAgeHours * HOUR_MS;
    })
    .map((s) => s.supplier);

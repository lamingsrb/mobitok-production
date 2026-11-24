export const CATALOG_CHANGED_EVENT = "mobitok:catalog-changed";
export const CATALOG_CHANGED_CHANNEL = "mobitok:catalog";

type CatalogChange = { id: string };
let localSequence = 0;

// Admin poziva tek posle uspesne izmene. ID je isti za lokalni dogadjaj i
// BroadcastChannel, pa ista kartica ne obnavlja katalog dvaput.
export function notifyCatalogChanged(): void {
  if (typeof window === "undefined") return;
  const detail: CatalogChange = {
    id: `${Date.now()}-${++localSequence}-${Math.random().toString(36).slice(2)}`,
  };
  window.dispatchEvent(new CustomEvent(CATALOG_CHANGED_EVENT, { detail }));
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(CATALOG_CHANGED_CHANNEL);
      channel.postMessage(detail);
      channel.close();
    }
  } catch {}
}

export function subscribeCatalogChanges(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const seen = new Set<string>();
  let lastUnidentified = -Infinity;
  const receive = (value: unknown) => {
    const id = value && typeof value === "object" && "id" in value && typeof value.id === "string"
      ? value.id : "";
    if (id) {
      if (seen.has(id)) return;
      seen.add(id);
      if (seen.size > 64) seen.delete(seen.values().next().value!);
    } else {
      // Podrzava i obican window event koji nema detail, bez duplog signala.
      const now = Date.now();
      if (now - lastUnidentified < 100) return;
      lastUnidentified = now;
    }
    onChange();
  };
  const onWindow = (event: Event) => receive((event as CustomEvent).detail);
  window.addEventListener(CATALOG_CHANGED_EVENT, onWindow);
  let channel: BroadcastChannel | undefined;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CATALOG_CHANGED_CHANNEL);
      channel.onmessage = (event: MessageEvent) => receive(event.data);
    }
  } catch {}
  return () => {
    window.removeEventListener(CATALOG_CHANGED_EVENT, onWindow);
    channel?.close();
  };
}

// Generacija pripada celom browser cache-u, ukljucujuci zahteve koji su vec u
// letu. Obrisana mapa sama ne bi sprecila stari odgovor da je ponovo napuni.
export class CatalogViewCache<T> extends Map<string, T> {
  generation = 0;
  private knownRevision: string | undefined;
  private listeners = new Set<() => void>();

  constructor(private readonly limit = 48) { super(); }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  invalidate(forgetRevision = false): void {
    super.clear();
    this.generation++;
    if (forgetRevision) this.knownRevision = undefined;
    for (const listener of this.listeners) listener();
  }

  observeRevision(revision: unknown): boolean {
    if (typeof revision !== "string" || !revision.trim() || revision === this.knownRevision) return false;
    const changed = this.knownRevision !== undefined || this.size > 0;
    this.knownRevision = revision;
    if (changed) this.invalidate();
    return changed;
  }

  commit(key: string, value: T, generation: number): boolean {
    if (generation !== this.generation) return false;
    super.delete(key);
    super.set(key, value);
    while (this.size > this.limit) {
      const oldest = this.keys().next().value;
      if (oldest === undefined) break;
      super.delete(oldest);
    }
    return true;
  }
}

// Sve sacuvane stavke se provere, uz ogranicen broj paralelnih HTTP zahteva.
export class CatalogRequestQueue {
  private active = 0;
  private waiting: Array<() => void> = [];
  constructor(private readonly concurrency = 4) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("INVALID_CONCURRENCY");
  }
  run<T>(work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiting.push(() => {
        this.active++;
        void Promise.resolve().then(work).then(resolve, reject).finally(() => {
          this.active--;
          this.drain();
        });
      });
      this.drain();
    });
  }
  private drain(): void {
    while (this.active < this.concurrency && this.waiting.length) this.waiting.shift()!();
  }
}

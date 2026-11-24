import type { CatalogPublicationStatus, CatalogSupplierUpdate, CatalogUpdatesStatus } from "./catalog-update-types";

export type SupplierUpdateState = { kind: "disabled" | "syncing" | "publishing" | "waiting" | "failed" | "stale" | "pending" | "ok" | "unknown"; tone: "muted" | "busy" | "error" | "success"; label: string };
const leased = (until: string | null, now: number) => Boolean(until && Date.parse(until) > now);
export function publicationPhaseLabel(publication: CatalogPublicationStatus): string {
  if (publication.phase === "cleanup") return "Završavanje objave";
  if (publication.phase === "staging" || publication.phase === "materialize") return "Priprema artikala";
  if (publication.phase === "done") return "Objavljeno";
  return "Objava u prodavnici";
}
export function supplierUpdateState(source: CatalogSupplierUpdate, now = Date.now()): SupplierUpdateState {
  if (!source.enabled) return { kind: "disabled", tone: "muted", label: "Automatsko ažuriranje isključeno" };
  if (source.activePublication) return leased(source.activePublication.leaseUntil, now)
    ? { kind: "publishing", tone: "busy", label: publicationPhaseLabel(source.activePublication) }
    : { kind: "waiting", tone: "busy", label: "Objava čeka nastavak" };
  if (source.activeSync) return leased(source.activeSync.leaseUntil, now)
    ? { kind: "syncing", tone: "busy", label: "Preuzimanje i obrada izvora" }
    : { kind: "waiting", tone: "busy", label: "Preuzimanje čeka proveru" };
  if (source.lastAttempt?.status === "failed") return { kind: "failed", tone: "error", label: "Preuzimanje nije uspelo" };
  if (source.lastAttempt?.status === "running") return { kind: "waiting", tone: "busy", label: "Čeka nastavak provere" };
  if (!source.lastSuccessfulFeed) return { kind: "unknown", tone: "muted", label: "Još nema uspešnog preuzimanja" };
  if (now - Date.parse(source.lastSuccessfulFeed.finishedAt) > source.stockMaxAgeHours * 3600000)
    return { kind: "stale", tone: "error", label: "Izvor nije osvežen na vreme" };
  if (!source.catalogEnabled) return { kind: "ok", tone: "muted", label: "Preuzeto; objava isključena" };
  if (source.lastPublication?.status === "failed") return { kind: "failed", tone: "error", label: "Objava nije završena" };
  if (!source.lastPublishedAt || Date.parse(source.lastPublishedAt) < Date.parse(source.lastSuccessfulFeed.finishedAt))
    return { kind: "pending", tone: "busy", label: "Preuzeto; čeka objavu" };
  return { kind: "ok", tone: "success", label: "Preuzeto i objavljeno" };
}
export function catalogHasActiveWork(status: CatalogUpdatesStatus): boolean {
  return Boolean(status.activeBatch || status.suppliers.some((source) => source.activeSync || source.activePublication));
}

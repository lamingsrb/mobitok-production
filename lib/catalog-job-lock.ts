import { CATALOG_JOB_STORAGE_KEY } from "./catalog-admin-types";

export async function withCatalogJobLock(run: () => Promise<void>): Promise<boolean> {
  // Bez atomskog zakljucavanja ne pokrecemo masovni posao u starom/nebezbednom pregledacu.
  if (typeof navigator === "undefined" || !navigator.locks) return false;
  return navigator.locks.request(CATALOG_JOB_STORAGE_KEY, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) return false;
    await run();
    return true;
  });
}

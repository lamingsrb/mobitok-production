// BTM background feed gets more upstream time without consuming the commit reserve.
export const BTM_BACKGROUND_FEED_TIMEOUT_MS = 90_000;
export const BTM_COMMIT_RESERVE_MS = 60_000;
const MIN_BTM_FEED_TIMEOUT_MS = 45_000;

export class SupplierFeedBudgetError extends Error {
  readonly code = "FEED_BUDGET_TOO_SMALL";
  constructor() {
    super("Nema dovoljno vremena za bezbedno osve\u017eavanje BTM izvora. Prethodni katalog je sa\u010duvan.");
    this.name = "SupplierFeedBudgetError";
  }
}

/** Only the background BTM path opts in. Undefined preserves every other supplier default. */
export function backgroundFeedTimeoutMs(supplier: string, deadline: number, now = Date.now()): number | undefined {
  if (supplier !== "btm") return undefined;
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) throw new SupplierFeedBudgetError();
  const timeout = Math.min(BTM_BACKGROUND_FEED_TIMEOUT_MS, Math.floor(deadline - now - BTM_COMMIT_RESERVE_MS));
  if (!Number.isFinite(timeout) || timeout < MIN_BTM_FEED_TIMEOUT_MS) throw new SupplierFeedBudgetError();
  return timeout;
}

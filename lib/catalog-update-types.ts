export type CatalogBatchKind = "scheduled" | "manual" | "recovery";
export type CatalogBatchStatus = "running" | "ok" | "partial" | "failed";
export type CatalogStepStatus = "queued" | "syncing" | "publishing" | "ok" | "failed" | "skipped";
export type CatalogUpdateStep = {
  supplier: string; status: CatalogStepStatus; startedAt: string | null; finishedAt: string | null;
  errorCode: string | null; errorSummary: string | null;
};
export type CatalogUpdateBatch = {
  id: string; kind: CatalogBatchKind; localDate: string; status: CatalogBatchStatus;
  startedAt: string; finishedAt: string | null; updatedAt: string;
  currentSupplier: string | null; leaseUntil: string | null; steps: CatalogUpdateStep[];
};
export type CatalogPublicationStatus = {
  status: string; phase: string | null; createdAt: string; finishedAt: string | null; leaseUntil: string | null;
  staged: number; processed: number; changed: number; deactivated: number;
};
export type CatalogSupplierUpdate = {
  supplier: string; label: string; enabled: boolean; catalogEnabled: boolean; stockMaxAgeHours: number; lastPublishedAt: string | null;
  lastAttempt: {
    status: string; startedAt: string; finishedAt: string | null; rowsInSource: number;
    added: number; removed: number; priceChanged: number; errorCode: string | null; errorSummary: string | null;
  } | null;
  lastSuccessfulFeed: { startedAt: string; finishedAt: string } | null;
  lastPublication: CatalogPublicationStatus | null;
  activeSync: { startedAt: string; leaseUntil: string | null } | null;
  activePublication: CatalogPublicationStatus | null;
};
export type CatalogUpdatesStatus = {
  timezone: "Europe/Belgrade"; scheduledStart: "03:00"; nextScheduledAt: string;
  schedulerConfigured: boolean; schedulerError: "SCHEDULER_NOT_CONFIGURED" | null;
  activeBatch: CatalogUpdateBatch | null; lastBatch: CatalogUpdateBatch | null;
  suppliers: CatalogSupplierUpdate[];
};

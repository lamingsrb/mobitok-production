/** Exact model selection for deleting current articles in one subgroup. */
export interface CatalogModelScope {
  category: string;
  subcategory: string;
  deviceBrand: string;
  device: string;
}

export interface CatalogModelOptions {
  brands: { value: string; count: number }[];
  models: { device: string; total: number; shared: number }[];
}


export const CATALOG_MODEL_LIMITS = { models: 200, modelLength: 120, brandLength: 60, samples: 5 } as const;
export interface CatalogModelSetScope {
  category: string;
  subcategory: string;
  deviceBrand: string;
  devices: string[];
}
/** Unique current articles, not the sum of per-model tile counts. */
export interface CatalogModelSelectionPreview {
  total: number;
  totalCapped: boolean;
  shared: number; // Matching articles that also support a valid model outside the selected set.
  samples: { id: string; name: string }[];
}
export function parseModelSelectionPreview(value: unknown): CatalogModelSelectionPreview {
  const row = typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  if (!row || !integer(row.total) || row.total > 10001 || typeof row.totalCapped !== "boolean" ||
      (row.totalCapped ? row.total !== 10001 : row.total > 10000) || !integer(row.shared) || row.shared > row.total ||
      !Array.isArray(row.samples) || row.samples.length > CATALOG_MODEL_LIMITS.samples || row.samples.length > row.total) throw new Error("CATALOG_MODEL_SELECTION_INVALID");
  const ids = new Set<string>();
  const samples = row.samples.map((item: unknown) => {
    const sample = typeof item === "object" && item !== null && !Array.isArray(item) ? item as Record<string, unknown> : null;
    if (!sample || typeof sample.id !== "string" || !sample.id || sample.id.length > 95 || ids.has(sample.id) ||
        typeof sample.name !== "string" || !sample.name) throw new Error("CATALOG_MODEL_SELECTION_INVALID");
    ids.add(sample.id);return { id: sample.id, name: sample.name.slice(0, 200) };
  });
  return { total: row.total, totalCapped: row.totalCapped, shared: row.shared, samples };
}

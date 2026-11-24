/** Admin metadata only. Saved URLs and credentials never belong in this contract. */
export type SupplierSourceSettings = {
  supplier: string;
  label: string;
  kind: string;
  revision: string;
  enabled: boolean;
  urlConfigured: boolean;
  urlManaged: boolean;
  authConfigured: boolean;
  authManaged: boolean;
};

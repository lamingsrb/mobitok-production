import { createHmac, timingSafeEqual } from "node:crypto";
export const RETENTION_TOKEN_DOMAIN = "mobitok:supplier-image-retention:v1";
export function supplierImageRetentionToken(secret: string): string {
  if (secret.length < 16) throw new Error("RETENTION_SECRET_NOT_CONFIGURED");
  return createHmac("sha256", secret).update(RETENTION_TOKEN_DOMAIN).digest("hex");
}
export function authorizedSupplierImageRetention(header: string | null, secrets: (string | undefined)[]) {
  if (!header || !/^Bearer [a-f0-9]{64}$/.test(header)) return false;
  const given = Buffer.from(header.slice(7));
  return secrets.filter((v): v is string => Boolean(v && v.length >= 16)).some(secret => {
    const expected = Buffer.from(supplierImageRetentionToken(secret));
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

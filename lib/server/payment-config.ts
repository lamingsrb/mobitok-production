import { createHash, createHmac, createPrivateKey, X509Certificate } from "node:crypto";

export type RaiffeisenEnvironment = "disabled" | "test" | "production";
export type RaiffeisenConfig = Readonly<{
  environment: "test" | "production";
  merchantId: string; terminalId: string; privateKeyPem: string; gatewayCertificatePem: string;
  gatewayUrl: string; statusUrl: string; accessSecret: string;
  certificateRegistered: boolean; productionApproved: boolean;
}>;
export type PaymentReadiness = Readonly<{
  environment: RaiffeisenEnvironment; configured: boolean;
  certificateRegistered: boolean; productionApproved: boolean;
  sandboxReady: boolean; productionReady: boolean;
}>;
const endpoints = {
  test: { gatewayUrl: "https://ecg.test.upc.ua/rbrs/pay", statusUrl: "https://ecg.test.upc.ua/rbrs/service/01" },
  production: { gatewayUrl: "https://ecommerce.raiffeisenbank.rs/rbrs/pay", statusUrl: "https://ecommerce.raiffeisenbank.rs/rbrs/service/01" },
} as const;

export class PaymentConfigurationError extends Error {
  constructor() { super("Payment configuration is unavailable"); this.name = "PaymentConfigurationError"; }
}
const pem = (value: string | undefined) => (value ?? "").replace(/\\n/g, "\n").trim();
const truth = (value: string | undefined) => value === "true";
export function loadRaiffeisenConfig(env: NodeJS.ProcessEnv = process.env): RaiffeisenConfig {
  try {
    const environment = env.RAIFFEISEN_ENVIRONMENT;
    if (environment !== "test" && environment !== "production") throw new PaymentConfigurationError();
    const merchantId = env.RAIFFEISEN_MERCHANT_ID ?? "", terminalId = env.RAIFFEISEN_TERMINAL_ID ?? "";
    const privateKeyPem = pem(env.RAIFFEISEN_PRIVATE_KEY_PEM), gatewayCertificatePem = pem(env.RAIFFEISEN_GATEWAY_CERT_PEM);
    const accessSecret = env.PAYMENTS_ACCESS_SECRET ?? "";
    if (!/^[A-Za-z0-9]{1,15}$/.test(merchantId) || !/^[A-Za-z0-9]{8}$/.test(terminalId) ||
        !/^[A-Za-z0-9_+/=-]{43,256}$/.test(accessSecret)) throw new PaymentConfigurationError();
    const privateKey = createPrivateKey(privateKeyPem), cert = new X509Certificate(gatewayCertificatePem);
    const publicKey = cert.publicKey;
    if (privateKey.asymmetricKeyType !== "rsa" || (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 1024 ||
        publicKey.asymmetricKeyType !== "rsa" || (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 1024) throw new PaymentConfigurationError();
    // Certificate validity is not a replacement for the bank's explicitly supplied signing key.
    // Transport TLS remains verified independently. Do not download keys from callback data.
    return Object.freeze({ environment, merchantId, terminalId, privateKeyPem, gatewayCertificatePem,
      accessSecret, ...endpoints[environment], certificateRegistered: truth(env.RAIFFEISEN_CERTIFICATE_REGISTERED),
      productionApproved: truth(env.RAIFFEISEN_PRODUCTION_APPROVED) });
  } catch { throw new PaymentConfigurationError(); }
}

export function paymentReadiness(env: NodeJS.ProcessEnv = process.env): PaymentReadiness {
  const environment = env.RAIFFEISEN_ENVIRONMENT === "test" || env.RAIFFEISEN_ENVIRONMENT === "production"
    ? env.RAIFFEISEN_ENVIRONMENT : "disabled";
  try {
    const c = loadRaiffeisenConfig(env);
    return { environment, configured: true, certificateRegistered: c.certificateRegistered,
      productionApproved: c.productionApproved, sandboxReady: environment === "test" && c.certificateRegistered,
      productionReady: environment === "production" && c.certificateRegistered && c.productionApproved };
  } catch { return { environment, configured: false, certificateRegistered: false,
    productionApproved: false, sandboxReady: false, productionReady: false }; }
}

export function checkoutCapability(requestKey: string, requestHash: string, secret: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(requestKey) || !/^[0-9a-f]{64}$/.test(requestHash) || secret.length < 43) throw new PaymentConfigurationError();
  return createHmac("sha256", secret).update(`mobitok-payment-v1\n${requestKey}\n${requestHash}`).digest("hex");
}
export function paymentTokenHash(token: string): string {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new PaymentConfigurationError();
  return createHash("sha256").update(token).digest("hex");
}
export function paymentCookieName(attemptId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attemptId)) throw new PaymentConfigurationError();
  return `mh_payment_${attemptId.replace(/-/g, "").toLowerCase()}`;
}
export function publicPaymentOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.NEXT_PUBLIC_SITE_URL || "https://mobitok.rs";
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) throw new PaymentConfigurationError();
    if (url.origin === "https://mobitok.rs") return url.origin;
    if (["test", "development"].includes(env.NODE_ENV ?? "") && url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url.origin;
  } catch { /* Fixed error below; no credential-bearing URL is reported. */ }
  throw new PaymentConfigurationError();
}

export function loadPaymentAccessSecret(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.PAYMENTS_ACCESS_SECRET ?? "";
  if (!/^[A-Za-z0-9_+/=-]{43,256}$/.test(value)) throw new PaymentConfigurationError();
  return value;
}
/** Verification survives a checkout pause; it needs neither the merchant private key nor guest access secret. */
export function loadRaiffeisenVerificationConfig(environment: "test" | "production", env: NodeJS.ProcessEnv = process.env) {
  try {
    const configuredEnvironment = env.RAIFFEISEN_ENVIRONMENT;
    if (configuredEnvironment !== environment && configuredEnvironment !== "disabled") throw new PaymentConfigurationError();
    const merchantId = env.RAIFFEISEN_MERCHANT_ID ?? "", terminalId = env.RAIFFEISEN_TERMINAL_ID ?? "";
    const gatewayCertificatePem = pem(env.RAIFFEISEN_GATEWAY_CERT_PEM);
    const key = new X509Certificate(gatewayCertificatePem).publicKey;
    if (!/^[A-Za-z0-9]{1,15}$/.test(merchantId) || !/^[A-Za-z0-9]{8}$/.test(terminalId) ||
      key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 1024) throw new PaymentConfigurationError();
    return { merchantId, terminalId, gatewayCertificatePem };
  } catch { throw new PaymentConfigurationError(); }
}

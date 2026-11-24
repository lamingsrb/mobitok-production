import { constants, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

// Bank-supplied RBRS guide: RSA/SHA-1, Delay=1 (preauthorization), RSD minor units.
// Private keys and certificates are supplied only by the server caller; no key is logged.
export const RAIFFEISEN_CURRENCY = "941" as const;
export const RAIFFEISEN_DELAY = "1" as const;
export const RAIFFEISEN_NOTIFY_MAX_BYTES = 16_384;

export type RaiffeisenExpectedAttempt = Readonly<{
  merchantId: string;
  terminalId: string;
  orderId: string;
  purchaseTime: string;
  amountMinor: number;
  sessionData: string;
}>;

export type RaiffeisenPaymentForm = Readonly<{
  Version: "1"; MerchantID: string; TerminalID: string; TotalAmount: string;
  Currency: "941"; PurchaseTime: string; OrderID: string; SD: string;
  Delay: "1"; locale: "RS"; Signature: string;
}>;

export type RaiffeisenNotification = Readonly<{
  MerchantID: string; TerminalID: string; OrderID: string; Delay: "1";
  PurchaseTime: string; TotalAmount: string; Currency: "941"; XID: string;
  SD: string; TranCode: string; ApprovalCode: string; Signature: string;
}>;

export type RaiffeisenVerifiedNotification = Readonly<{
  merchantId: string; terminalId: string; orderId: string; purchaseTime: string;
  amountMinor: number; totalAmount: string; sessionData: string; xid: string;
  tranCode: string; approvalCode: string; currency: "941"; delay: "1";
  status: "authorized" | "declined";
}>;

export class RaiffeisenProtocolError extends Error {
  constructor() {
    super("Invalid Raiffeisen payment data");
    this.name = "RaiffeisenProtocolError";
  }
}

function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new RaiffeisenProtocolError();
}

function purchaseTimeValid(value: string): boolean {
  if (!/^\d{12}(?:[+-]\d{4})?$/.test(value)) return false;
  const year = 2000 + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4)), day = Number(value.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 ||
      day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
      Number(value.slice(6, 8)) > 23 || Number(value.slice(8, 10)) > 59 ||
      Number(value.slice(10, 12)) > 59) return false;
  return value.length === 12 || (Number(value.slice(13, 15)) <= 23 && Number(value.slice(15, 17)) <= 59);
}

function validateAttempt(attempt: RaiffeisenExpectedAttempt): void {
  requireValid(attempt !== null && typeof attempt === "object");
  requireValid(typeof attempt.merchantId === "string" && /^[A-Za-z0-9]{1,15}$/.test(attempt.merchantId));
  requireValid(typeof attempt.terminalId === "string" && /^[A-Za-z0-9]{8}$/.test(attempt.terminalId));
  // These are opaque server-generated identifiers, within the guide's 20/99 byte limits.
  // An unreserved ASCII subset avoids ambiguity in the semicolon/comma signature grammar.
  requireValid(typeof attempt.orderId === "string" && /^[A-Za-z0-9._~-]{1,20}$/.test(attempt.orderId));
  requireValid(typeof attempt.sessionData === "string" && /^[A-Za-z0-9_-]{16,99}$/.test(attempt.sessionData));
  requireValid(typeof attempt.purchaseTime === "string" && purchaseTimeValid(attempt.purchaseTime));
  requireValid(Number.isSafeInteger(attempt.amountMinor) && attempt.amountMinor > 0 && attempt.amountMinor <= 999_999_999_999);
}

export function raiffeisenRequestSignatureData(attempt: RaiffeisenExpectedAttempt): string {
  validateAttempt(attempt);
  return [attempt.merchantId, attempt.terminalId, attempt.purchaseTime,
    attempt.orderId + ",1", RAIFFEISEN_CURRENCY, String(attempt.amountMinor),
    attempt.sessionData, ""].join(";");
}

export function createRaiffeisenPaymentForm(
  attempt: RaiffeisenExpectedAttempt, merchantPrivateKeyPem: string,
): RaiffeisenPaymentForm {
  const data = raiffeisenRequestSignatureData(attempt);
  let signature: string;
  try {
    const key = createPrivateKey(merchantPrivateKeyPem);
    requireValid(key.asymmetricKeyType === "rsa" && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 1024);
    signature = sign("RSA-SHA1", Buffer.from(data, "utf8"), {
      key, padding: constants.RSA_PKCS1_PADDING,
    }).toString("base64");
  } catch { throw new RaiffeisenProtocolError(); }
  return Object.freeze({
    Version: "1", MerchantID: attempt.merchantId, TerminalID: attempt.terminalId,
    TotalAmount: String(attempt.amountMinor), Currency: RAIFFEISEN_CURRENCY,
    PurchaseTime: attempt.purchaseTime, OrderID: attempt.orderId, SD: attempt.sessionData,
    Delay: RAIFFEISEN_DELAY, locale: "RS", Signature: signature,
  });
}

const notificationNames = [
  "MerchantID", "TerminalID", "OrderID", "Delay", "PurchaseTime", "TotalAmount",
  "Currency", "XID", "SD", "TranCode", "ApprovalCode", "Signature",
] as const;
const notificationNameSet = new Set<string>(notificationNames);
const notificationLowerNames = new Set(notificationNames.map(name => name.toLowerCase()));
const unsupportedNames = new Set(["AltCurrency", "AltTotalAmount", "UPCToken", "UPCTokenExp"]);

function canonicalSignature(signature: string): boolean {
  if (signature.length < 128 || signature.length > 2048 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(signature)) return false;
  return Buffer.from(signature, "base64").toString("base64") === signature;
}

function validateNotification(value: RaiffeisenNotification): void {
  requireValid(value !== null && typeof value === "object");
  for (const name of notificationNames) requireValid(typeof value[name] === "string");
  requireValid(/^[A-Za-z0-9]{1,15}$/.test(value.MerchantID));
  requireValid(/^[A-Za-z0-9]{8}$/.test(value.TerminalID));
  requireValid(/^[A-Za-z0-9._~-]{1,20}$/.test(value.OrderID));
  requireValid(value.Delay === RAIFFEISEN_DELAY && value.Currency === RAIFFEISEN_CURRENCY);
  requireValid(purchaseTimeValid(value.PurchaseTime));
  requireValid(/^\d{1,12}$/.test(value.TotalAmount) && Number(value.TotalAmount) > 0);
  requireValid(/^[A-Za-z0-9_-]{16,99}$/.test(value.SD));
  requireValid(/^[\x21-\x7e]{1,28}$/.test(value.XID) && !value.XID.includes(";"));
  requireValid(/^\d{3}$/.test(value.TranCode));
  requireValid(value.ApprovalCode === "" || /^[A-Za-z0-9]{6}$/.test(value.ApprovalCode));
  requireValid(value.TranCode !== "000" || value.ApprovalCode.length === 6);
  requireValid(canonicalSignature(value.Signature));
}

function decodeFormPart(part: string): string {
  try { return decodeURIComponent(part.replace(/\+/g, " ")); }
  catch { throw new RaiffeisenProtocolError(); }
}

export function parseRaiffeisenNotification(
  body: string | Uint8Array, contentType: string,
): RaiffeisenNotification {
  requireValid(typeof contentType === "string");
  const [mediaType, ...parameters] = contentType.toLowerCase().split(";");
  requireValid(mediaType.trim() === "application/x-www-form-urlencoded");
  const charsets = parameters.filter(parameter => /^\s*charset\s*=/.test(parameter));
  requireValid(charsets.length <= 1 && (charsets.length === 0 ||
    /^charset\s*=\s*"?utf-8"?$/.test(charsets[0].trim())));
  let text: string;
  try {
    requireValid(typeof body === "string" || body instanceof Uint8Array);
    const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body;
    requireValid(bytes.byteLength > 0 && bytes.byteLength <= RAIFFEISEN_NOTIFY_MAX_BYTES);
    requireValid(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf));
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    requireValid(!text.startsWith("\uFEFF"));
  } catch { throw new RaiffeisenProtocolError(); }
  const result: Partial<Record<typeof notificationNames[number], string>> = {};
  const seen = new Set<string>();
  const parts = text.split("&");
  requireValid(parts.length <= 64);
  for (const part of parts) {
    if (part === "") continue;
    const separator = part.indexOf("=");
    requireValid(separator > 0);
    const name = decodeFormPart(part.slice(0, separator));
    const value = decodeFormPart(part.slice(separator + 1));
    requireValid(name.length <= 64 && value.length <= 4096 && !seen.has(name));
    seen.add(name);
    requireValid(!unsupportedNames.has(name) || value === "");
    if (notificationNameSet.has(name)) result[name as typeof notificationNames[number]] = value;
    else requireValid(!notificationLowerNames.has(name.toLowerCase()));
    // Future, unsigned metadata is ignored. PAN/RRN/email/wallet data never leaves this parser.
  }
  // The supplied PHP handler concatenates a missing decline ApprovalCode as empty.
  // It is never synthesized for a successful authorization.
  if (result.ApprovalCode === undefined && result.TranCode !== undefined && result.TranCode !== "000") {
    result.ApprovalCode = "";
  }
  const parsed = result as RaiffeisenNotification;
  validateNotification(parsed);
  return Object.freeze(parsed);
}

export function raiffeisenNotificationSignatureData(notification: RaiffeisenNotification): string {
  validateNotification(notification);
  return [notification.MerchantID, notification.TerminalID, notification.PurchaseTime,
    notification.OrderID + "," + notification.Delay, notification.XID, notification.Currency,
    notification.TotalAmount, notification.SD, notification.TranCode, notification.ApprovalCode, ""].join(";");
}

/** Verifies authenticity and attempt binding only. Caller must atomically persist/replay-check in the DB.
 * A delayed notification is not rejected merely because its original PurchaseTime is old.
 * With the bank-mandated Delay=1, even TranCode=000 means authorized, never settled/paid.
 */
export function verifyRaiffeisenNotification(
  notification: RaiffeisenNotification, expected: RaiffeisenExpectedAttempt, gatewayCertificatePem: string,
): RaiffeisenVerifiedNotification {
  validateAttempt(expected);
  const data = raiffeisenNotificationSignatureData(notification);
  try {
    const key = createPublicKey(gatewayCertificatePem);
    requireValid(key.asymmetricKeyType === "rsa" && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 1024);
    const signature = Buffer.from(notification.Signature, "base64");
    requireValid(signature.byteLength === Math.ceil((key.asymmetricKeyDetails?.modulusLength ?? 0) / 8));
    requireValid(verify("RSA-SHA1", Buffer.from(data, "utf8"), {
      key, padding: constants.RSA_PKCS1_PADDING,
    }, signature));
  } catch { throw new RaiffeisenProtocolError(); }
  requireValid(notification.MerchantID === expected.merchantId &&
    notification.TerminalID === expected.terminalId && notification.OrderID === expected.orderId &&
    notification.PurchaseTime === expected.purchaseTime && Number(notification.TotalAmount) === expected.amountMinor &&
    notification.SD === expected.sessionData);
  return Object.freeze({
    merchantId: notification.MerchantID, terminalId: notification.TerminalID,
    orderId: notification.OrderID, purchaseTime: notification.PurchaseTime,
    amountMinor: Number(notification.TotalAmount), totalAmount: notification.TotalAmount,
    sessionData: notification.SD, xid: notification.XID, tranCode: notification.TranCode,
    approvalCode: notification.ApprovalCode, currency: RAIFFEISEN_CURRENCY, delay: RAIFFEISEN_DELAY,
    status: notification.TranCode === "000" ? "authorized" : "declined",
  });
}

/** approve acknowledges the merchant's acceptance; it is not a capture operation.
 * Return this only after a durable accepted transition or an exact, already persisted replay.
 */
export function createRaiffeisenNotifyResponse(
  notification: RaiffeisenVerifiedNotification, action: "approve" | "reverse", reason = "ok",
): string {
  validateAttempt({
    merchantId: notification.merchantId, terminalId: notification.terminalId,
    orderId: notification.orderId, purchaseTime: notification.purchaseTime,
    amountMinor: notification.amountMinor, sessionData: notification.sessionData,
  });
  requireValid(action === "approve" || action === "reverse");
  requireValid(notification.currency === RAIFFEISEN_CURRENCY && notification.delay === RAIFFEISEN_DELAY);
  requireValid(/^\d{1,12}$/.test(notification.totalAmount) && Number(notification.totalAmount) === notification.amountMinor);
  requireValid(/^[\x21-\x7e]{1,28}$/.test(notification.xid) && !notification.xid.includes(";"));
  requireValid(typeof reason === "string" && /^[\x20-\x7e]{0,255}$/.test(reason));
  return [
    "MerchantID=" + notification.merchantId, "TerminalID=" + notification.terminalId,
    "OrderID=" + notification.orderId, "Delay=1", "Currency=941",
    "TotalAmount=" + notification.totalAmount, "XID=" + notification.xid,
    "PurchaseTime=" + notification.purchaseTime, "Response.action=" + action,
    "Response.reason=" + reason, "Response.forwardUrl=", "",
  ].join("\n");
}

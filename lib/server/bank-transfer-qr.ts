import QRCode from "qrcode";

// NBS invoice QR (K:PR), not an acquiring-bank PT/EK payment authorization.
// Official specification: https://ips.nbs.rs/PDF/pdfPreporukeValidacija.pdf
// Annex (version <=13, ECC M, UTF-8 <=331 bytes):
// https://www.nbs.rs/export/sites/NBS_site/documents/propisi/propisi-ps/odluka_instant_transfer_2018_i_prilog.pdf
export const BANK_TRANSFER_QR_MAX_AMOUNT_MINOR = 30_000_000; // Checkout policy: IPS system <=300,000 RSD.
export const BANK_TRANSFER_QR_MAX_BYTES = 331;
export const BANK_TRANSFER_QR_PAYMENT_CODE = "221" as const;

export type BankTransferQrInput = Readonly<{
  accountNumber: string;
  recipientName: string;
  // Kept in the order snapshot/UI; omitted from N to avoid truncating the legal recipient name.
  recipientAddress?: string;
  amountMinor: number;
  reference: string;
}>;

export class BankTransferQrError extends Error {
  constructor() {
    super("Podaci za uplatu putem QR koda nisu ispravni.");
    this.name = "BankTransferQrError";
  }
}
function requireValid(value: unknown): asserts value {
  if (!value) throw new BankTransferQrError();
}

export function isValidBankTransferAccount(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{18}$/.test(value)) return false;
  // Incremental arithmetic avoids precision loss for the 18-digit domestic account.
  let remainder = 0;
  for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

const punctuation = new Set(Array.from("!\"#$%&'()*+,-./:;<=>?@[]^_`{}~‘’“”„ "));
function recipientNameValid(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) return false;
  const characters = Array.from(value);
  return characters.length <= 70 && characters.every(character =>
    /^[\p{L}\p{M}\p{N}]$/u.test(character) || punctuation.has(character));
}

export function buildBankTransferQrPayload(input: BankTransferQrInput): string {
  requireValid(input !== null && typeof input === "object");
  requireValid(isValidBankTransferAccount(input.accountNumber));
  requireValid(recipientNameValid(input.recipientName));
  requireValid(Number.isSafeInteger(input.amountMinor) && input.amountMinor > 0 &&
    input.amountMinor <= BANK_TRANSFER_QR_MAX_AMOUNT_MINOR);
  // Exact server-generated order reference. No shortening or replacement of a reference.
  requireValid(typeof input.reference === "string" && /^[A-Za-z0-9-]{1,23}$/.test(input.reference));
  const amount = Math.floor(input.amountMinor / 100) + "," + String(input.amountMinor % 100).padStart(2, "0");
  const fields = [
    "K:PR", "V:01", "C:1", "R:" + input.accountNumber, "N:" + input.recipientName,
    "I:RSD" + amount, "SF:" + BANK_TRANSFER_QR_PAYMENT_CODE, "S:" + input.reference,
  ];
  // Checkout references fit both S and the recommended25-character RO including model00.
  fields.push("RO:00" + input.reference);
  const payload = fields.join("|");
  requireValid(Buffer.byteLength(payload, "utf8") <= BANK_TRANSFER_QR_MAX_BYTES);
  return payload;
}

/** Local PNG only: account/order data is never submitted to an external QR service.
 * Display the label "NBS IPS QR" next to this invoice QR and state that payment is verified manually.
 */
export async function renderBankTransferQr(input: BankTransferQrInput): Promise<{
  payload: string;
  dataUrl: string;
}> {
  const payload = buildBankTransferQrPayload(input);
  try {
    const segments = [{ data: Buffer.from(payload, "utf8"), mode: "byte" as const }];
    const code = QRCode.create(segments, { errorCorrectionLevel: "M" });
    requireValid(code.version <= 13);
    const dataUrl = await QRCode.toDataURL(segments, {
      version: code.version, type: "image/png", errorCorrectionLevel: "M",
      margin: 4, scale: 6, color: { dark: "#000000", light: "#FFFFFF" },
    });
    requireValid(dataUrl.startsWith("data:image/png;base64,"));
    return { payload, dataUrl };
  } catch { throw new BankTransferQrError(); }
}

import { z } from "zod";
import { HttpError } from "./supabase";

const namespace = "http://tempuri.org/";
const soapNamespace = "http://schemas.xmlsoap.org/soap/envelope/";
const exportState = z.enum(["sending", "review_required", "exported"]);
export const calculusExportRow = z.object({
  state: exportState,
  document_id: z.string().nullable(),
  updated_at: z.string(),
});

export function visibleCalculusExport(row: z.infer<typeof calculusExportRow>, now = Date.now()) {
  return {
    state: row.state === "sending" && now - Date.parse(row.updated_at) >= 120_000
      ? "review_required" as const
      : row.state,
    document_id: row.document_id,
  };
}

const xmlField = z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f\ufffe\uffff]+$/u);
const articleSchema = z.object({ code: xmlField, tax: xmlField });
const draftSettings = z.object({
  documentType: xmlField,
  customerCode: xmlField,
  warehouseCode: xmlField,
  creatorCode: xmlField,
  currencyCode: xmlField,
  codPaymentName: xmlField,
  products: z.record(z.string(), articleSchema),
  delivery: articleSchema.optional(),
});

export function loadCalculusDraftConfig(env: Readonly<Record<string, string | undefined>> = process.env) {
  const unavailable = "Podešavanja za slanje u Calculus nisu završena.";
  try {
    const url = new URL(env.CALCULUS_SOAP_URL ?? "");
    const authorization = env.CALCULUS_SOAP_AUTHORIZATION ?? "";
    if (
      url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !url.pathname.toLowerCase().endsWith(".asmx") ||
      !/^(?:Basic|Bearer) [\x21-\x7e]+$/.test(authorization)
    ) throw new Error(unavailable);
    const settings = draftSettings.parse(JSON.parse(env.CALCULUS_DRAFT_SETTINGS ?? ""));
    return { url, authorization, settings };
  } catch {
    throw new HttpError(503, unavailable);
  }
}

type Money = number | string | null;
type OrderSnapshot = {
  reference: string;
  total: Money;
  discount_percent: Money;
  delivery_fee_snapshot: Money;
  payable_total: Money;
  order_items: { product_id: string; quantity: number; unit_price: Money; line_total: Money }[];
};

function minorUnits(value: Money) {
  if (value === null || !/^\d{1,10}(?:\.\d{1,2})?$/.test(String(value))) return null;
  return Math.round(Number(value) * 100);
}

export function prepareCalculusDraft(
  order: OrderSnapshot,
  settings: z.infer<typeof draftSettings>,
  today = new Date(),
) {
  if (minorUnits(order.discount_percent) !== 0)
    throw new HttpError(409, "Prenos porudžbina sa popustom zahteva ručnu obradu u Calculusu.");
  const delivery = minorUnits(order.delivery_fee_snapshot);
  const total = minorUnits(order.total);
  const payable = minorUnits(order.payable_total);
  if (delivery === null || total === null || payable === null || payable !== total + delivery || payable <= 0)
    throw new HttpError(409, "Proverite sačuvane iznose porudžbine i dostave pre prenosa u Calculus.");
  if (!/^MT-[A-F\d]{10}$/.test(order.reference) || !order.order_items.length)
    throw new HttpError(409, "Porudžbina nema važeću referencu ili stavke za prenos.");

  let itemTotal = 0;
  const lines = order.order_items.map((item) => {
    const mapped = Object.hasOwn(settings.products, item.product_id) ? settings.products[item.product_id] : undefined;
    if (!mapped) throw new HttpError(409, "Za najmanje jedan artikal nedostaje potvrđena šifra u Calculusu.");
    const unitPrice = minorUnits(item.unit_price);
    const lineTotal = minorUnits(item.line_total);
    if (unitPrice === null || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20 ||
      lineTotal !== unitPrice * item.quantity)
      throw new HttpError(409, "Iznos ili količina stavke zahtevaju proveru pre prenosa u Calculus.");
    itemTotal += lineTotal;
    return {
      artusl: "A",
      sifartusl: mapped.code,
      tarifa: mapped.tax,
      kolicina: String(item.quantity),
      mpcena: (unitPrice / 100).toFixed(2),
    };
  });
  if (itemTotal !== total)
    throw new HttpError(409, "Zbir stavki ne odgovara sačuvanom iznosu porudžbine.");
  if (delivery > 0) {
    if (!settings.delivery) throw new HttpError(409, "Nedostaje potvrđena šifra usluge dostave u Calculusu.");
    lines.push({
      artusl: "U",
      sifartusl: settings.delivery.code,
      tarifa: settings.delivery.tax,
      kolicina: "1",
      mpcena: (delivery / 100).toFixed(2),
    });
  }

  return {
    header: {
      vrstadokumenta: settings.documentType,
      datum: new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Belgrade" }).format(today),
      komitent: settings.customerCode,
      magacin: settings.warehouseCode,
      kreator: settings.creatorCode,
      valuta: settings.currencyCode,
      ekstdok1: order.reference,
      status: "B",
      prokmag: "N",
      prokknj: "N",
      nacpl: settings.codPaymentName,
      tarifa: "M",
    },
    lines,
  };
}

const xmlEntities: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
};

async function insert(
  config: ReturnType<typeof loadCalculusDraftConfig>,
  method: "UbaciZagDok" | "UbaciStavDok",
  values: Record<string, string>,
  deadline: number,
) {
  const fields = Object.entries(values).map(([name, value]) =>
    `<${name}>${value.replace(/[&<>"']/g, (character) => xmlEntities[character])}</${name}>`
  ).join("");
  const timeLeft = deadline - Date.now();
  if (timeLeft <= 0) throw new Error("Calculus deadline exceeded");
  const response = await fetch(config.url, {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(Math.min(5000, timeLeft)),
    headers: {
      Authorization: config.authorization,
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"${namespace}${method}"`,
    },
    body: `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="${soapNamespace}"><soap:Body><${method} xmlns="${namespace}">${fields}</${method}></soap:Body></soap:Envelope>`,
  });
  if (!response.ok) throw new Error("Calculus SOAP request rejected");
  const xml = (await response.text()).trim();
  // Only accept the single positive ID in the ASMX response for this exact method.
  // Faults, business messages, and unexpected XML all require manual reconciliation.
  const envelope = xml.length <= 16_384 && xml.match(
    /^(?:<\?xml[^<>]*\?>\s*)?<([\w-]+):Envelope\b([^<>]*)>\s*<\1:Body>\s*([\s\S]*?)\s*<\/\1:Body>\s*<\/\1:Envelope>$/,
  );
  if (!envelope || !envelope[2].includes(`xmlns:${envelope[1]}="${soapNamespace}"`))
    throw new Error("Unexpected Calculus SOAP envelope");
  const result = envelope[3].match(new RegExp(
    `^<${method}Response xmlns="${namespace}">\\s*<${method}Result>\\s*([1-9][0-9]{0,9})\\s*</${method}Result>\\s*</${method}Response>$`,
  ));
  if (!result) throw new Error("Calculus did not return a document or line ID");
  return result[1];
}

export async function writeCalculusDraft(
  config: ReturnType<typeof loadCalculusDraftConfig>,
  draft: ReturnType<typeof prepareCalculusDraft>,
  saveDocumentId: (id: string) => Promise<void>,
) {
  const deadline = Date.now() + 40_000;
  const documentId = await insert(config, "UbaciZagDok", draft.header, deadline);
  await saveDocumentId(documentId);
  for (const line of draft.lines) {
    await insert(config, "UbaciStavDok", {
      kljucdok: documentId,
      magacin: draft.header.magacin,
      ...line,
    }, deadline);
  }
  return documentId;
}

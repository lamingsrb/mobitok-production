import type { CalculusOrderFilter, CalculusOrderTransfer } from "@/components/order-calculus-export";

type Amount = number | string | null;

type ReportOrder = {
  reference: string;
  status: string;
  created_at: string;
  demo?: boolean;
  total: Amount;
  delivery_fee_snapshot?: Amount;
  payable_total?: Amount;
  calculus_export?: CalculusOrderTransfer | null;
};

const statesByFilter: Record<Exclude<CalculusOrderFilter, "all">, readonly CalculusOrderTransfer["state"][]> = {
  queued: ["queued", "sending"],
  exported: ["exported"],
  review: ["review_required", "blocked"],
};

export function filterCalculusOrders<T extends ReportOrder>(orders: readonly T[], filter: CalculusOrderFilter): T[] {
  if (filter === "all") return orders.slice();
  const states = statesByFilter[filter];
  return orders.filter((order) => order.calculus_export && states.includes(order.calculus_export.state));
}

const orderStatus = new Map([
  ["received", "Primljena"],
  ["reviewing", "U obradi"],
  ["completed", "Završena"],
  ["cancelled", "Otkazana"],
]);

const transferStatus: Record<CalculusOrderTransfer["state"], string> = {
  queued: "Čeka prenos",
  sending: "Slanje u toku",
  review_required: "Potrebna provera",
  exported: "Nacrt sačuvan",
  blocked: "Slanje zaustavljeno",
};

const localDate = new Intl.DateTimeFormat("sr-Latn-RS", {
  timeZone: "Europe/Belgrade",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function date(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? localDate.format(date) : "";
}

function amount(value?: Amount) {
  if (value == null || !/^\d{1,10}(?:\.\d{1,2})?$/.test(String(value))) return "";
  return Number(value).toFixed(2).replace(".", ",");
}

function csvField(value: string) {
  const startsFormula = /^[\s\uFEFF]*[=+\-@＝＋－＠]|^[\t\r\n]/u.test(value);
  return `"${startsFormula ? "'" : ""}${value.replace(/"/g, '""')}"`;
}

function csvLine(fields: string[]) {
  return fields.map(csvField).join(";");
}

export function calculusOrderCsv(orders: readonly ReportOrder[]): string {
  const heading = csvLine([
    "Referenca porudžbine",
    "Datum porudžbine",
    "Status porudžbine",
    "Status prenosa u Calculus",
    "ID dokumenta u Calculusu",
    "Ažuriran status prenosa",
    "Artikli (RSD)",
    "Dostava (RSD)",
    "Ukupno (RSD)",
    "Napomena o prenosu",
  ]);
  const rows = orders.filter((order) => !order.demo).map((order) => {
    const transfer = order.calculus_export;
    return csvLine([
      order.reference,
      date(order.created_at),
      orderStatus.get(order.status) ?? "Nepoznat status",
      transfer ? transferStatus[transfer.state] : "Bez prenosa",
      transfer?.document_id ?? "",
      date(transfer?.updated_at),
      amount(order.total),
      amount(order.delivery_fee_snapshot),
      amount(order.payable_total),
      transfer?.issue ?? (transfer?.state === "review_required" ? "Proverite nacrt po referenci u Calculusu." : ""),
    ]);
  });
  return `\ufeff${[heading, ...rows].join("\r\n")}\r\n`;
}

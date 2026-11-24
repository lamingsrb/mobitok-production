import type { Mejl } from "./mail";
const escape = (v: string) => v.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;", "'": "&#39;" }[c]!));
export function paymentOperationReceipt(p: { reference: string; fullName: string; amount: number;
  operation: "captured" | "voided" | "refunded" | "received"; method?: "card" | "ips_qr"; reviewRequired?: boolean }): Omit<Mejl, "to"> {
  if (!Number.isFinite(p.amount) || p.amount <= 0) throw new Error("Invalid receipt amount");
  const messages = {
    captured: ["Plaćanje je potvrđeno", "Evidentirana je konačna naplata kartične porudžbine prema potvrdi iz bankarskog portala."],
    voided: ["Rezervacija sredstava je oslobođena", "Evidentirano je oslobađanje kartične rezervacije prema potvrdi iz bankarskog portala."],
    refunded: ["Povraćaj sredstava je potvrđen", p.method === "ips_qr" ? "Povraćaj uplate na račun je proveren i evidentiran prema potvrdi iz bankarskog izvoda. Vreme prikaza na računu zavisi od obrade banaka." : "Evidentiran je povraćaj po prvobitnoj kartičnoj transakciji prema potvrdi iz bankarskog portala. Vreme prikaza na računu zavisi od banke izdavaoca kartice."],
    received: ["Uplata na račun je potvrđena", "Priliv na poslovni račun je proveren i evidentiran prema bankarskom izvodu."],
  } as const;
  const [title, detail] = p.reviewRequired ? ["Uplata zahteva proveru porudžbine", "Uplata je zabeležena nakon isteka ili zatvaranja porudžbine. Prodavnica proverava dalji postupak; porudžbina nije automatski obnovljena. Ne ponavljajte uplatu."] : messages[p.operation];
  const amount = new Intl.NumberFormat("sr-RS", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(p.amount) + " RSD";
  return { subject: `${title} — ${p.reference}`, text: `${p.fullName},\n\n${title}.\n${detail}\nPorudžbina: ${p.reference}\nIznos: ${amount}\n\nMOBITOK`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;color:#392849"><p>MOBITOK</p><h1>${escape(title)}</h1><p>${escape(detail)}</p><p>Porudžbina: <strong>${escape(p.reference)}</strong></p><p>Iznos: <strong>${escape(amount)}</strong></p></div>` };
}

"use client";

import { useId } from "react";
import { CreditCard, LockKeyhole, QrCode, Truck } from "lucide-react";
import type { Language } from "@/lib/i18n";
import type { PaymentMethod, PaymentMethodOption } from "@/lib/payment-types";
import "./payment-method-picker.css";

export type PaymentMethodPickerProps = {
  selected: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
  disabled?: boolean;
  methods: readonly PaymentMethodOption[];
  language?: Language;
};

const icons = { cod: Truck, card: CreditCard, ips_qr: QrCode };
const copy = {
  sr: {
    legend: "Način plaćanja",
    helper: "Izaberi način koji ti odgovara.",
    selected: "Izabrano",
    unavailable: "Trenutno nije omogućeno.",
    reserved: "Sredstva se rezervišu; naplata nakon slanja.",
    bank: "Podatke kartice unosiš na stranici banke.",
  },
  en: {
    legend: "Payment method",
    helper: "Choose the option that works for you.",
    selected: "Selected",
    unavailable: "Not enabled yet.",
    reserved: "Funds are reserved; you are charged after dispatch.",
    bank: "Enter your card details on the bank’s page.",
  },
};

/** Controlled native radios; this component never starts or confirms a payment. */
export default function PaymentMethodPicker({ selected, onChange, disabled = false,
  methods, language = "sr" }: PaymentMethodPickerProps) {
  const groupId = useId();
  const text = copy[language];
  return (
    <fieldset className={`payment-method-picker${disabled ? " is-disabled" : ""}`} disabled={disabled}
      aria-describedby={`${groupId}-help`}>
      <legend>{text.legend}</legend>
      <p className="payment-method-help" id={`${groupId}-help`}>{text.helper}</p>
      <div className="payment-method-options">
        {methods.map(method => {
          const Icon = icons[method.id];
          const id = `${groupId}-${method.id}`;
          const checked = selected === method.id;
          const card = method.id === "card" && method.available;
          const unavailable = !method.available;
          return (
            <label key={method.id} className={`payment-method-option${checked ? " is-selected" : ""}${unavailable ? " is-unavailable" : ""}`}>
              <input className="payment-method-radio" type="radio" name={`${groupId}-payment-method`}
                value={method.id} checked={checked} disabled={unavailable}
                onChange={() => onChange(method.id)}
                aria-labelledby={`${id}-label`}
                aria-describedby={[`${id}-description`, card ? `${id}-reservation` : "", unavailable ? `${id}-unavailable` : ""].filter(Boolean).join(" ")} />
              <span className="payment-method-icon" aria-hidden="true"><Icon size={23} strokeWidth={1.6} /></span>
              <span className="payment-method-copy">
                <span className="payment-method-title" id={`${id}-label`}>{method.label}</span>
                <span className="payment-method-description" id={`${id}-description`}>{method.description}</span>
                {card && <span className="payment-method-reservation" id={`${id}-reservation`}>{text.reserved}</span>}
              </span>
              {unavailable ? (
                <span className="payment-method-availability" id={`${id}-unavailable`}>
                  <LockKeyhole size={13} aria-hidden="true" />
                  <span>{method.unavailableReason || text.unavailable}</span>
                </span>
              ) : (
                <span className={`payment-method-selection${checked ? " is-visible" : ""}`} aria-hidden="true">{text.selected}</span>
              )}
            </label>
          );
        })}
      </div>
      {selected === "card" && methods.some(method => method.id === "card" && method.available) && (
        <p className="payment-method-bank-note"><LockKeyhole size={15} aria-hidden="true" /><span>{text.bank}</span></p>
      )}
    </fieldset>
  );
}

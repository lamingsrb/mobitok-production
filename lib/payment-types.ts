/** Public checkout state only. Provider credentials and database rows stay on the server. */
export type PaymentMethod = "cod" | "card" | "ips_qr";

export type PaymentStatus =
  | "unpaid"
  | "pending"
  | "authorized"
  | "paid"
  | "failed"
  | "cancelled"
  | "expired"
  | "review_required"
  | "refund_pending"
  | "refunded";

/** Availability must come from verified server configuration, including IPS setup. */
export type PaymentMethodOption = {
  id: PaymentMethod;
  label: string;
  description: string;
  available: boolean;
  unavailableReason?: string;
};

export type CheckoutPayment = {
  method: PaymentMethod;
  status: PaymentStatus;
  payableTotal: number | null;
  currency: "RSD";
  continueUrl?: string;
};

export type BankTransferInstructions = {
  recipientName: string;
  recipientAddress: string | null;
  accountNumber: string;
  reference: string;
  purpose: string;
  expiresAt: string;
  qrUrl?: string;
};
export type PaymentStatusSnapshot = CheckoutPayment & {
  reference?: string;
  testMode: boolean;
  canRetry: boolean;
  bankTransfer?: BankTransferInstructions;
  confirmationSource?: string | null;
};

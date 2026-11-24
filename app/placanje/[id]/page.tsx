import type { Metadata } from "next";
import PaymentReturnPanel from "@/components/payment-return-panel";
export const metadata: Metadata = { title: "Status plaćanja", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function PaymentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nastavi?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <PaymentReturnPanel paymentId={id} autoStart={query.nastavi === "1"} />;
}

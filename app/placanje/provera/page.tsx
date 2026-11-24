import Link from "next/link";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Provera plaćanja", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function PaymentRecoveryPage() {
  return <main style={{ maxWidth: 600, margin: "10vh auto", padding: 32 }}><p>MOBITOK</p><h1>Proverite status plaćanja</h1>
    <p>Povratak sa banke nije dovoljan da potvrdimo plaćanje. Otvorite prethodnu korpu ili svoj nalog i proverite status porudžbine pre novog pokušaja.</p>
    <p><Link href="/nalog">Moj nalog</Link> · <Link href="/korpa">Nazad u korpu</Link></p></main>;
}

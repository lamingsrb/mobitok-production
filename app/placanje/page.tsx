import type { Metadata } from "next";
import Storefront from "@/components/storefront";
export const metadata: Metadata = { title: "Kupovina", robots: { index: false, follow: false } };
export default function CheckoutPage() { return <Storefront path={["placanje"]} />; }

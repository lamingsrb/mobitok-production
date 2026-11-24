import type { Metadata } from "next";
import Storefront from "@/components/storefront";
import { notFound } from "next/navigation";
const routes = [
  "favoriti",
  "korpa",
  "placanje",
  "nalog",
  "b2b",
  "admin",
  "o-nama",
  "podrska",
  "dostava",
  "privatnost",
  "uslovi",
  "vodic",
  "povrat-i-reklamacije",
];
// Svaka stranica ima svoj naslov u kartici pregledaca i u pretrazi (pregled 18.10.2026).
// Sablon "%s | MOBITOK" je u app/layout.tsx.
const naslovi: Record<string, string> = {
  katalog: "Katalog",
  favoriti: "Sačuvani artikli",
  korpa: "Korpa",
  placanje: "Kupovina",
  nalog: "Moj nalog",
  b2b: "Ponuda za firme",
  admin: "Administracija",
  "o-nama": "Naša priča",
  podrska: "Podrška i česta pitanja",
  dostava: "Dostava i plaćanje",
  privatnost: "Privatnost",
  uslovi: "Uslovi korišćenja",
  vodic: "Vodič za dobar izbor",
  "povrat-i-reklamacije": "Povrat i reklamacije",
};
// Stalne javne stranice zadrzavaju staticko posluzivanje; proizvodi imaju svoju dinamicku rutu.
export const revalidate = 300;
export const dynamicParams = true;
export function generateStaticParams() {
  return routes.map((s) => ({ slug: [s] }));
}
export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }): Promise<Metadata> {
  const { slug } = await params;
  if (slug.length !== 1 || !naslovi[slug[0]]) return {};
  if (slug[0] === "admin") return { title: naslovi.admin, robots: { index: false, follow: false } };
  return { title: naslovi[slug[0]] };
}
export default async function Page({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  if (!(slug.length === 1 && routes.includes(slug[0]))) notFound();
  return <Storefront path={slug} />;
}

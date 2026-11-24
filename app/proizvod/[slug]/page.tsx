import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import Storefront from "@/components/storefront";
import { catalogItems } from "@/lib/server/catalog-search";
import { getAdminClient } from "@/lib/server/supabase";

// Vidljivost i SEO proizvoda proveravaju se pri svakom zahtevu, bez ISR rezervnog prikaza.
export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ slug: string }> };
const artikalIzBaze = cache(async (slug: string) => {
  try {
    const items = await catalogItems(getAdminClient(), [slug]);
    return { data: items.find((item) => item.slug === slug) ?? null, failed: false };
  } catch {
    return { data: null, failed: true };
  }
});

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = await params;
  const artikal = (await artikalIzBaze(slug)).data;
  if (!artikal) return { title: "Artikal", robots: { index: false, follow: false } };
  let naziv = artikal.name;
  try {
    const { data } = await getAdminClient().from("product_overrides").select("seo_title")
      .eq("product_id", artikal.id).maybeSingle();
    naziv = data?.seo_title ?? naziv;
  } catch {}
  return { title: naziv.length > 100 ? naziv.slice(0, 99).trimEnd() + "…" : naziv };
}

export default async function ProductPage({ params }: RouteProps) {
  const { slug } = await params;
  const { data, failed } = await artikalIzBaze(slug);
  if (failed) throw new Error("Katalog trenutno nije dostupan.");
  if (!data) notFound();
  return <Storefront path={["proizvod", slug]} />;
}

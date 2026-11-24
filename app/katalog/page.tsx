import type { Metadata } from "next";
import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import Storefront from "@/components/storefront";
import { catalogLocation } from "@/lib/server/catalog-location";
import { getAdminClient } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const locationForRequest = cache((query: string) => catalogLocation(getAdminClient(), new URLSearchParams(query)));
async function location(searchParams: Props["searchParams"]) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  // Metadata and page share only this render's result; visibility is checked on every new request.
  return locationForRequest(query.toString());
}
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const result = await location(searchParams);
  if (result.blocked) notFound();
  if (result.redirect) permanentRedirect(result.url);
  return { title: "Katalog", alternates: { canonical: result.url } };
}
export default async function CatalogPage({ searchParams }: Props) {
  const result = await location(searchParams);
  if (result.blocked) notFound();
  if (result.redirect) permanentRedirect(result.url);
  return <Storefront path={["katalog"]} />;
}

import { getAdminClient, HttpError } from "@/lib/server/supabase";

// Bez pouzdanog odgovora baze prodavnica ostaje u bezbednom rezimu.
export async function preparationMode(signal?: AbortSignal): Promise<boolean> {
  const { data, error } = await getAdminClient(signal)
    .from("shop_settings")
    .select("preparation_mode")
    .eq("id", true)
    .maybeSingle();
  if (error || !data) throw new HttpError(503, "Rezim prodavnice trenutno nije dostupan.");
  return data.preparation_mode === true;
}

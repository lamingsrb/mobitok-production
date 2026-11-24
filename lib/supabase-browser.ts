// Supabase klijent za pregledac, na jednom mestu.
//
// Izdvojeno iz account-panel.tsx da bi store-context mogao da ga koristi bez
// kruzne zavisnosti (store-context -> account-panel -> store-context).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchWithDeadline } from "./request-deadline";
import { configuredSupabaseUrl } from "./supabase-config";

let browserClient: SupabaseClient | null = null;

export function getClient() {
  const url = configuredSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NODE_ENV);
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!browserClient) browserClient = createClient(url, key, { global: { fetch: fetchWithDeadline } });
  return browserClient;
}

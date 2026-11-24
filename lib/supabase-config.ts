/** The project URL/ref is public; only the project's keys are credentials. */
export const CLOUD_SUPABASE_URL = "https://aysjbxkaeuglciktvcrh.supabase.co";

/** Production never sends credentials or data to a local or alternate project. */
export function configuredSupabaseUrl(value: string | undefined, environment: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (url.origin === CLOUD_SUPABASE_URL) return CLOUD_SUPABASE_URL;
    const localTest = environment === "test" || environment === "development";
    if (localTest && ["http:", "https:"].includes(url.protocol)
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url.origin;
  } catch {}
  return null;
}

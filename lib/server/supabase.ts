import { createClient } from "@supabase/supabase-js";
import { requestWithDeadline } from "../request-deadline";
import { configuredSupabaseUrl } from "../supabase-config";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function getAdminClient(signal?: AbortSignal) {
  const url = configuredSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NODE_ENV);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new HttpError(
      503,
      "Servis trenutno nije dostupan. Pokušajte ponovo kasnije.",
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(signal ? {
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          const parent = init?.signal ?? (input instanceof Request ? input.signal : undefined);
          return fetch(input, { ...init, signal: parent ? AbortSignal.any([parent, signal]) : signal });
        },
      },
    } : {}),
  });
}

export async function getRequestUser(request: Request, required = true) {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    if (!required) return null;
    throw new HttpError(401, "Prijavite se da biste nastavili.");
  }
  if (!authorization.startsWith("Bearer ") || authorization.length > 8192) {
    throw new HttpError(401, "Prijava nije važeća. Prijavite se ponovo.");
  }
  const { data, error } = await requestWithDeadline(
    (signal) => getAdminClient(signal).auth.getUser(authorization.slice(7)),
    { timeoutMs: 8000, signal: request.signal },
  ).catch(() => {
    throw new HttpError(503, "Provera prijave trenutno nije dostupna. Poku\u0161ajte ponovo.");
  });
  if (error) {
    // Provider/network failure does not mean that the member signed out.
    if (!error.status || error.status >= 500 || error.status === 408 || error.status === 429)
      throw new HttpError(503, "Provera prijave trenutno nije dostupna. Poku\u0161ajte ponovo.");
    throw new HttpError(401, "Prijava je istekla. Prijavite se ponovo.");
  }
  if (!data.user) throw new HttpError(401, "Prijava je istekla. Prijavite se ponovo.");
  return data.user;
}

export async function requireAdmin(request: Request) {
  const user = await getRequestUser(request);
  const { data, error } = await requestWithDeadline(
    (signal) => getAdminClient()
      .from("profiles")
      .select("role")
      .eq("id", user!.id)
      .abortSignal(signal)
      .maybeSingle(),
    { timeoutMs: 8000, signal: request.signal },
  ).catch(() => {
    throw new HttpError(503, "Provera administratorskog pristupa trenutno nije dostupna. Poku\u0161ajte ponovo.");
  });
  if (error)
    throw new HttpError(503, "Provera administratorskog pristupa trenutno nije dostupna. Poku\u0161ajte ponovo.");
  if (data?.role !== "admin")
    throw new HttpError(403, "Ova stranica je dostupna administratoru prodavnice.");
  return user!;
}

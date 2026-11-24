import { createHmac } from "node:crypto";
import { z } from "zod";
import { getAdminClient, HttpError } from "./supabase";

export async function parseBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxLength = 24000,
): Promise<T> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    throw new HttpError(415, "Zahtev mora biti u JSON formatu.");
  }
  const raw = await request.text();
  if (raw.length > maxLength) throw new HttpError(413, "Zahtev je prevelik.");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Zahtev nije ispravno unet.");
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(
      400,
      result.error.issues[0]?.message ?? "Proverite unete podatke.",
    );
  }
  return result.data;
}

export async function rateLimit(
  request: Request,
  scope: string,
  limit: number,
  userId?: string,
) {
  const address = (
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    "local"
  )
    .split(",")[0]
    .trim()
    .slice(0, 128);
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new HttpError(503, "Servis trenutno nije dostupan.");
  const key = createHmac("sha256", secret)
    .update(`${scope}:${userId ?? address}`)
    .digest("hex");
  const { data, error } = await getAdminClient().rpc("consume_request_quota", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: 900,
  });
  if (error) {
    // Admin 03.11 (K9): bez ovoga se greska kvote (npr. INVALID_QUOTA) ne vidi u logu servera.
    console.error("rateLimit", scope, error.code, error.message);
    throw new HttpError(
      503,
      "Servis trenutno nije dostupan. Pokušajte ponovo.",
    );
  }
  if (data !== true)
    throw new HttpError(
      429,
      "Previše pokušaja. Sačekajte 15 minuta pa pokušajte ponovo.",
    );
}

export function apiError(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json(
      { error: error.message },
      {
        status: error.status,
        headers:
          error.status === 429
            ? { "Retry-After": "900", "Cache-Control": "no-store" }
            : { "Cache-Control": "no-store" },
      },
    );
  }
  return Response.json(
    { error: "Došlo je do greške. Pokušajte ponovo kasnije." },
    {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

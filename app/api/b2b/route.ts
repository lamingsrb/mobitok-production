import { apiError, parseBody, rateLimit } from "@/lib/server/http";
import {
  getAdminClient,
  getRequestUser,
  HttpError,
} from "@/lib/server/supabase";
import { b2bSchema } from "@/lib/server/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request);
    const body = await parseBody(request, b2bSchema);
    await rateLimit(request, "b2b", 5, user!.id);
    const { data, error } = await getAdminClient()
      .from("b2b_applications")
      .insert({
        user_id: user!.id,
        company_name: body.companyName,
        pib: body.pib,
        registration_number: body.registrationNumber ?? null,
        contact_name: body.contactName,
        email: user!.email,
        phone: body.phone,
        city: body.city,
        address: body.address,
        postal_code: body.postalCode ?? null,
      })
      .select("id,status,created_at")
      .single();
    if (error?.code === "23505")
      throw new HttpError(
        409,
        "Već ste poslali prijavu. Njen status možete videti na svom nalogu.",
      );
    if (error)
      throw new HttpError(503, "Prijava nije sačuvana. Pokušajte ponovo.");
    return Response.json(
      {
        application: data,
        message: "Prijava je sačuvana i čeka pregled administratora.",
      },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(request: Request) {
  try {
    const user = await getRequestUser(request);
    const admin = getAdminClient();
    const [
      { data: application, error },
      { data: profile, error: profileError },
    ] = await Promise.all([
      admin
        .from("b2b_applications")
        .select("id,company_name,status,created_at,reviewed_at")
        .eq("user_id", user!.id)
        .maybeSingle(),
      admin
        .from("profiles")
        .select("role,discount_percent")
        .eq("id", user!.id)
        .maybeSingle(),
    ]);
    if (error || profileError)
      throw new HttpError(503, "Status prijave trenutno nije dostupan.");
    return Response.json(
      {
        application,
        profile: profile ?? { role: "customer", discount_percent: 0 },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

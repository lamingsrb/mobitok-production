import { apiError } from "@/lib/server/http";
import { getAdminClient, getRequestUser, HttpError } from "@/lib/server/supabase";
import { popustZaKupca, type Buyer } from "@/lib/pricing";
import { PODRAZUMEVANA_PODESAVANJA } from "@/lib/server/pricing-defaults";

export const runtime = "nodejs";

// Koliki popust vazi za onoga ko gleda prodavnicu.
//
// Vraca samo popust i vrstu kupca. Marza se namerno ne salje: ona je racun
// prodavnice, ne podatak za kupca.
export async function GET(request: Request) {
  try {
    // Istekao ili neispravan token ne sme da obori prodavnicu — takav posetilac
    // je prosto neregistrovan dok se ponovo ne prijavi.
    const user = await getRequestUser(request, false).catch(() => null);
    const admin = getAdminClient();

    const { data: podesavanja, error: settingsError } = await admin
      .from("shop_settings")
      .select(
        "discount_guest_percent,discount_person_percent,discount_company_percent,preparation_mode,contact_phone,contact_email,contact_hours,delivery_courier,delivery_fee,delivery_free_over,delivery_time,company_name,company_short_name,company_started_on,company_activity,company_pib,company_registration_number,company_address",
      )
      .eq("id", true)
      .maybeSingle();
    if (settingsError || !podesavanja)
      throw new HttpError(503, "Podešavanja prodavnice trenutno nisu dostupna.");
    const s = { ...PODRAZUMEVANA_PODESAVANJA, ...(podesavanja ?? {}) };

    let buyer: Buyer = "guest";
    let rabat = 0;
    if (user) {
      buyer = "person";
      const [{ data: profil }, { data: prijava }] = await Promise.all([
        admin
          .from("profiles")
          .select("role,discount_percent")
          .eq("id", user.id)
          .maybeSingle(),
        admin
          .from("b2b_applications")
          .select("status")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      if (profil?.role === "b2b" && prijava?.status === "approved") {
        buyer = "company";
        rabat = Number(profil.discount_percent ?? 0);
      }
    }

    // Prodavnica prikazuje samo ono sto je vlasnik zaista uneo. Prazno polje
    // se izostavlja, da se nigde ne bi pojavio prazan red ili izmisljen podatak.
    const tekst = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const broj = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
    const shop = {
      phone: tekst(podesavanja?.contact_phone),
      email: tekst(podesavanja?.contact_email),
      hours: tekst(podesavanja?.contact_hours),
      courier: tekst(podesavanja?.delivery_courier),
      deliveryFee: podesavanja?.preparation_mode ? null : broj(podesavanja?.delivery_fee),
      deliveryFreeOver: podesavanja?.preparation_mode ? null : broj(podesavanja?.delivery_free_over),
      deliveryTime: tekst(podesavanja?.delivery_time),
      companyName: tekst(podesavanja?.company_name),
      companyShortName: tekst(podesavanja?.company_short_name),
      companyStartedOn: tekst(podesavanja?.company_started_on),
      companyActivity: tekst(podesavanja?.company_activity),
      companyPib: tekst(podesavanja?.company_pib),
      companyRegistrationNumber: tekst(podesavanja?.company_registration_number),
      companyAddress: tekst(podesavanja?.company_address),
    };

    return Response.json(
      { buyer, discountPercent: popustZaKupca(buyer, s, rabat), shop },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

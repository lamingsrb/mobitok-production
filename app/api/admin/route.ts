import { after } from "next/server";
import { apiError, parseBody, rateLimit } from "@/lib/server/http";
import { mejlPodesen, otkazivanjePorudzbine, posalji } from "@/lib/server/mail";
import { getAdminClient, HttpError, requireAdmin } from "@/lib/server/supabase";
import { adminActionSchema } from "@/lib/server/validation";
import { PODRAZUMEVANA_PODESAVANJA, vazecaTabelaMarze } from "@/lib/server/pricing-defaults";
import { procurementError } from "@/lib/server/procurement";
import { publishSupplierCatalog } from "@/lib/server/catalog-publish";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const admin = getAdminClient();
    const [orders, applications, products, orderCount, pendingCount] =
      await Promise.all([
        admin
          .from("orders")
          .select(
            "id,reference,customer,total,subtotal,discount_percent,currency,status,demo,created_at,payment_method,payment_status,delivery_fee_snapshot,payable_total,payment_confirmation_source,order_items(product_id,name,quantity,unit_price,line_total)",
          )
          .order("created_at", { ascending: false })
          .limit(100),
        admin
          .from("b2b_applications")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
        admin
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("active", true),
        admin.from("orders").select("id", { count: "exact", head: true }),
        admin
          .from("b2b_applications")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
      ]);
    if (
      [orders, applications, products, orderCount, pendingCount].some(
        (result) => result.error,
      )
    ) {
      throw new HttpError(503, "Pregled podataka trenutno nije dostupan.");
    }
    // Podesavanja cena vidi samo administrator; marza ne izlazi nigde drugde.
    const { data: settingsRow, error: settingsReadError } = await admin
      .from("shop_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    if (settingsReadError || !settingsRow)
      throw new HttpError(503, "Podešavanja prodavnice trenutno nisu dostupna.");
    const settings = { ...PODRAZUMEVANA_PODESAVANJA, ...(settingsRow ?? {}), margin_tiers: vazecaTabelaMarze(settingsRow.margin_tiers) };
    // Supplier statistics belong to the procurement view, which loads them separately.
    // The legacy overview must not scan supplier_products before another admin tool opens.

    return Response.json(
      {
        counts: {
          products: products.count ?? 0,
          orders: orderCount.count ?? 0,
          pendingB2b: pendingCount.count ?? 0,
        },
        orders: orders.data ?? [],
        applications: applications.data ?? [],
        settings,
        supplier: null,
        demo: (orders.data ?? []).some((order) => order.demo),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAdmin(request);
    const body = await parseBody(request, adminActionSchema);
    await rateLimit(request, "admin-mutations", 120, user.id);
    const admin = getAdminClient();
    if (body.action === "set_preparation_mode") {
      const { data, error } = await admin
        .from("shop_settings")
        .update({ preparation_mode: body.enabled, updated_at: new Date().toISOString(), updated_by: user.id })
        .eq("id", true)
        .select("preparation_mode")
        .single();
      if (error) throw new HttpError(503, "Rezim prodavnice nije promenjen. Pokusajte ponovo.");
      return Response.json({ preparationMode: data.preparation_mode }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "update_delivery") {
      const { data, error } = await admin
        .from("shop_settings")
        .update({
          delivery_courier: body.deliveryCourier ?? "",
          delivery_time: body.deliveryTime ?? "",
          delivery_fee: body.deliveryFee,
          delivery_free_over: body.deliveryFreeOver,
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        })
        .eq("id", true)
        .select("delivery_courier,delivery_time,delivery_fee,delivery_free_over")
        .abortSignal(AbortSignal.timeout(8000))
        .single();
      if (error || !data)
        throw new HttpError(503, "Podešavanja dostave nisu sačuvana. Pokušajte ponovo.");
      return Response.json({
        delivery: {
          deliveryCourier: data.delivery_courier,
          deliveryTime: data.delivery_time,
          deliveryFee: data.delivery_fee === null ? null : Number(data.delivery_fee),
          deliveryFreeOver: data.delivery_free_over === null ? null : Number(data.delivery_free_over),
        },
      }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "update_settings") {
      const { error: settingsError } = await admin
        .from("shop_settings")
        .update({
          margin_tiers: body.marginTiers,
          vat_percent: body.vatPercent,
          discount_guest_percent: body.discountGuestPercent,
          discount_person_percent: body.discountPersonPercent,
          discount_company_percent: body.discountCompanyPercent,
          round_to: body.roundTo,
          contact_phone: body.contactPhone,
          contact_email: body.contactEmail,
          contact_hours: body.contactHours,
          ...(body.deliveryCourier === undefined ? {} : { delivery_courier: body.deliveryCourier }),
          ...(body.deliveryFee === undefined ? {} : { delivery_fee: body.deliveryFee }),
          ...(body.deliveryFreeOver === undefined ? {} : { delivery_free_over: body.deliveryFreeOver }),
          ...(body.deliveryTime === undefined ? {} : { delivery_time: body.deliveryTime }),
          company_name: body.companyName,
          company_short_name: body.companyShortName,
          company_started_on: body.companyStartedOn || null,
          company_activity: body.companyActivity,
          company_pib: body.companyPib,
          company_registration_number: body.companyRegistrationNumber,
          company_address: body.companyAddress,
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        })
        .eq("id", true);
      if (settingsError)
        throw new HttpError(503, "Podešavanja nisu sačuvana. Pokušajte ponovo.");
      const { data:sources,error:sourcesError }=await admin.from("supplier_sources").select("supplier").eq("enabled",true);
      const deadline=Date.now()+240_000;
      let published=0;
      const pending:string[]=[];
      if(sourcesError)throw new HttpError(503,"Podešavanja su sačuvana. Pregled objavljivanja trenutno nije dostupan.");
      for(const source of sources??[]){
        try {
          const publication=await publishSupplierCatalog(admin,source.supplier,{deadline});
          if(["sync_required","in_progress","busy","capacity"].includes(publication.reason??""))pending.push(source.supplier);
          else published+=Number(publication.published)||0;
        } catch { pending.push(source.supplier); }
      }
      return Response.json(
        { result: { saved:true,published,catalogPublishRequired:pending.length>0,pendingSuppliers:pending,
          ...(pending.length?{warning:"Podešavanja su sačuvana. Nove cene se objavljuju automatski u manjim delovima."}:{}) } },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const { data, error } =
      body.action === "review_b2b"
        ? await admin.rpc("admin_review_b2b", {
            p_actor_id: user.id,
            p_application_id: body.applicationId,
            p_status: body.status,
            p_discount: body.discountPercent,
          })
        : await admin.rpc("admin_update_order", {
            p_actor_id: user.id,
            p_order_id: body.orderId,
            p_status: body.status,
          });
    if (error?.message.includes("NOT_FOUND"))
      throw new HttpError(404, "Traženi zapis ne postoji.");
    if (error) procurementError(error.message);
    // Mejl o otkazivanju ide samo kada porudzbina tek sada postaje otkazana. Prethodni
    // status ('from') funkcija cita pod zakljucavanjem reda (202610180004), pa ni ponovljen
    // ni istovremen zahtev ne salje drugi mejl (pregled 18.10.2026). Bez 'from' mejla nema.
    // Kupac dobija mejl posle odgovora, kao potvrdu porudzbine; neuspeh slanja
    // se samo belezi i ne vraca otkazivanje. Demo porudzbine nemaju pravog kupca.
    const otkazujeSe =
      body.action === "update_order" &&
      body.status === "cancelled" &&
      typeof data?.from === "string" &&
      data.from !== "cancelled";
    if (otkazujeSe && !data?.demo && mejlPodesen()) {
      const orderId = body.orderId;
      const referenca = String(data?.reference ?? "");
      after(async () => {
        try {
          const [{ data: red }, { data: podesavanja }] = await Promise.all([
            admin.from("orders").select("customer,payment_method,payment_status,payable_total,delivery_fee_snapshot").eq("id", orderId).maybeSingle(),
            admin.from("shop_settings").select("contact_email").eq("id", true).maybeSingle(),
          ]);
          const kupac = (red?.customer ?? {}) as { email?: unknown; fullName?: unknown };
          const email = String(kupac.email ?? "").trim();
          if (!email) return;
          const kontakt = String(podesavanja?.contact_email ?? "").trim() || undefined;
          const ishod = await posalji({
            to: email,
            replyTo: kontakt,
            ...otkazivanjePorudzbine({
              reference: referenca,
              fullName: String(kupac.fullName ?? "").trim(),
              placanje: { method: red?.payment_method ?? "cod", status: red?.payment_status ?? "unpaid", payableTotal: red?.payable_total, deliveryFee: red?.delivery_fee_snapshot },
              kontakt,
            }),
          });
          if (!ishod.sent)
            console.error("Mejl o otkazivanju nije poslat", { referenca, razlog: ishod.reason });
        } catch (greska) {
          console.error("Mejl o otkazivanju nije poslat", {
            referenca,
            razlog: greska instanceof Error ? greska.name : "greska",
          });
        }
      });
    }
    return Response.json(
      { result: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

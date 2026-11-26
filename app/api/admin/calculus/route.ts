import { z } from "zod";
import {
  calculusExportRow,
  loadCalculusDraftConfig,
  prepareCalculusDraft,
  visibleCalculusExport,
  writeCalculusDraft,
} from "@/lib/server/calculus";
import { apiError, parseBody, rateLimit } from "@/lib/server/http";
import { getAdminClient, HttpError, requireAdmin } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const inputSchema = z.object({ orderId: z.uuid() });
const claimSchema = calculusExportRow.extend({ claimed: z.boolean() });
const stateFields = "state,document_id,updated_at";
const unavailable = "Evidencija prenosa u Calculus trenutno nije dostupna.";
const ineligible = "Možete preneti stvarnu porudžbinu za pouzeće koja je u obradi.";
type ExportRow = z.infer<typeof calculusExportRow>;

function response(result: ReturnType<typeof visibleCalculusExport>) {
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}

async function readExport(orderId: string) {
  const { data, error } = await getAdminClient(AbortSignal.timeout(4000))
    .from("calculus_order_exports").select(stateFields).eq("order_id", orderId).maybeSingle();
  if (error) throw new HttpError(503, unavailable);
  return data ? calculusExportRow.parse(data) : null;
}

async function saveExport(orderId: string, state: ExportRow["state"], documentId: string | null) {
  const { data, error } = await getAdminClient(AbortSignal.timeout(3000))
    .from("calculus_order_exports")
    .update({ state, document_id: documentId, updated_at: new Date().toISOString() })
    .eq("order_id", orderId).eq("state", "sending").select(stateFields).single();
  if (error || !data) throw new HttpError(503, unavailable);
  return calculusExportRow.parse(data);
}

export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    if (process.env.CALCULUS_DRAFT_EXPORT_ENABLED !== "true")
      throw new HttpError(503, "Prenos u Calculus još nije uključen.");
    const { orderId } = await parseBody(request, inputSchema, 256);
    await rateLimit(request, "calculus-draft-export", 20, actor.id);

    const previous = await readExport(orderId);
    if (previous) return response(visibleCalculusExport(previous));

    const { data: order, error: orderError } = await getAdminClient(AbortSignal.timeout(4000))
      .from("orders")
      .select("reference,status,demo,currency,payment_method,payment_status,total,discount_percent,delivery_fee_snapshot,payable_total,order_items(product_id,quantity,unit_price,line_total)")
      .eq("id", orderId).maybeSingle();
    if (orderError) throw new HttpError(503, "Porudžbina trenutno nije dostupna.");
    if (!order) throw new HttpError(404, "Porudžbina ne postoji.");
    if (order.demo !== false || order.status !== "reviewing" || order.currency !== "RSD" ||
      order.payment_method !== "cod" || order.payment_status !== "unpaid")
      throw new HttpError(409, ineligible);

    const config = loadCalculusDraftConfig();
    const draft = prepareCalculusDraft(order, config.settings);
    const { data, error } = await getAdminClient(AbortSignal.timeout(4000))
      .rpc("claim_calculus_order_export", { p_order_id: orderId, p_actor_id: actor.id });
    if (error?.message === "CALCULUS_ORDER_NOT_FOUND") throw new HttpError(404, "Porudžbina ne postoji.");
    if (error?.message === "CALCULUS_ORDER_INELIGIBLE") throw new HttpError(409, ineligible);
    if (error?.message === "CALCULUS_ADMIN_REQUIRED") throw new HttpError(403, "Potreban je administratorski pristup.");
    if (error) throw new HttpError(503, unavailable);
    const claim = claimSchema.parse(data);
    if (!claim.claimed) return response(visibleCalculusExport(claim));

    let documentId: string | null = null;
    try {
      const id = await writeCalculusDraft(config, draft, async (id) => {
        documentId = id;
        await saveExport(orderId, "sending", id);
      });
      return response(visibleCalculusExport(await saveExport(orderId, "exported", id)));
    } catch {
      const review = await saveExport(orderId, "review_required", documentId).catch(() => null);
      if (review) return response(visibleCalculusExport(review));
      const recorded = await readExport(orderId).catch(() => null);
      if (recorded?.state === "exported") return response(visibleCalculusExport(recorded));
      return response({ state: "review_required", document_id: documentId });
    }
  } catch (error) {
    return apiError(error);
  }
}

import { z } from "zod";
import {
  calculusExportRow,
  loadCalculusDraftConfig,
  prepareCalculusDraft,
  visibleCalculusExport,
  writeCalculusDraft,
} from "./calculus";
import { getAdminClient, HttpError } from "./supabase";

const claimSchema = calculusExportRow.extend({ claimed: z.boolean() });
const stateFields = "state,document_id,updated_at";
const unavailable = "Evidencija prenosa u Calculus trenutno nije dostupna.";
const ineligible = "Možete preneti stvarnu porudžbinu za pouzeće koja je u obradi.";
const adminRequired = "Potreban je administratorski pristup.";
type ExportRow = z.infer<typeof calculusExportRow>;
type Config = ReturnType<typeof loadCalculusDraftConfig>;

export function calculusTransferReady() {
  if (process.env.CALCULUS_DRAFT_EXPORT_ENABLED !== "true") return false;
  try {
    loadCalculusDraftConfig();
    return true;
  } catch {
    return false;
  }
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

export async function transferCalculusOrder(orderId: string, actorId: string, config = loadCalculusDraftConfig()) {
  const previous = await readExport(orderId);
  if (previous) return visibleCalculusExport(previous);

  const db = getAdminClient(AbortSignal.timeout(5000));
  const { data: order, error: orderError } = await db.from("orders")
    .select("reference,status,demo,currency,payment_method,payment_status,total,discount_percent,delivery_fee_snapshot,payable_total,order_items(product_id,name,quantity,unit_price,line_total)")
    .eq("id", orderId).maybeSingle();
  if (orderError) throw new HttpError(503, "Porudžbina trenutno nije dostupna.");
  if (!order) throw new HttpError(404, "Porudžbina ne postoji.");
  if (order.demo !== false || order.status !== "reviewing" || order.currency !== "RSD" ||
    order.payment_method !== "cod" || order.payment_status !== "unpaid")
    throw new HttpError(409, ineligible);

  const productIds = order.order_items.map((item) => item.product_id);
  const productCodes = { ...config.settings.products };
  if (productIds.length) {
    const { data: mappings, error } = await getAdminClient(AbortSignal.timeout(4000))
      .from("calculus_article_mappings").select("product_id,article_code,tax_code").in("product_id", productIds);
    if (error) throw new HttpError(503, "Šifre artikala za Calculus trenutno nisu dostupne.");
    // Define own keys even when a legacy product ID is a JavaScript property name.
    for (const row of mappings ?? []) {
      Object.defineProperty(productCodes, row.product_id, {
        value: { code: row.article_code, tax: row.tax_code }, enumerable: true, configurable: true,
      });
    }
  }
  const draft = prepareCalculusDraft(order, { ...config.settings, products: productCodes });
  const { data, error } = await getAdminClient(AbortSignal.timeout(4000))
    .rpc("claim_calculus_order_export", { p_order_id: orderId, p_actor_id: actorId });
  if (error?.message === "CALCULUS_ORDER_NOT_FOUND") throw new HttpError(404, "Porudžbina ne postoji.");
  if (error?.message === "CALCULUS_ORDER_INELIGIBLE") throw new HttpError(409, ineligible);
  if (error?.message === "CALCULUS_ADMIN_REQUIRED") throw new HttpError(403, adminRequired);
  if (error) throw new HttpError(503, unavailable);
  const claim = claimSchema.parse(data);
  if (!claim.claimed) return visibleCalculusExport(claim);

  let documentId: string | null = null;
  try {
    const id = await writeCalculusDraft(config, draft, async (id) => {
      documentId = id;
      await saveExport(orderId, "sending", id);
    });
    return visibleCalculusExport(await saveExport(orderId, "exported", id));
  } catch {
    const review = await saveExport(orderId, "review_required", documentId).catch(() => null);
    if (review) return visibleCalculusExport(review);
    const recorded = await readExport(orderId).catch(() => null);
    if (recorded?.state === "exported") return visibleCalculusExport(recorded);
    return { state: "review_required" as const, document_id: documentId, updated_at: new Date().toISOString() };
  }
}

const queuedOrder = z.object({
  order_id: z.uuid(), actor_id: z.uuid(), lease_token: z.uuid(), attempt_count: z.number().int().positive(),
});

export async function processCalculusQueue(limit: number) {
  const config = loadCalculusDraftConfig();
  let processed = 0;
  while (processed < limit) {
    const { data, error } = await getAdminClient(AbortSignal.timeout(4000)).rpc("lease_calculus_transfer");
    if (error) throw new HttpError(503, unavailable);
    if (!data) break;
    const job = queuedOrder.parse(data);
    let state = "completed";
    let issue: string | null = null;
    let delay: number | null = null;
    try {
      const result = await transferCalculusOrder(job.order_id, job.actor_id, config);
      if (result.state === "sending") {
        state = "pending";
        delay = 120;
      }
    } catch (error) {
      if (error instanceof HttpError && (error.status === 404 || error.message === ineligible)) {
        state = "skipped";
      } else if (error instanceof HttpError && (error.status === 403 || error.status === 409)) {
        state = "blocked";
        issue = error.message;
      } else {
        issue = "Privremeni problem sa obradom prenosa.";
        state = job.attempt_count >= 3 ? "blocked" : "pending";
        if (state === "pending") delay = 120 * job.attempt_count;
      }
    }
    const { error: finishError } = await getAdminClient(AbortSignal.timeout(4000))
      .rpc("finish_calculus_transfer", {
        p_order_id: job.order_id, p_lease_token: job.lease_token, p_state: state,
        p_error: issue, p_retry_seconds: delay,
      });
    if (finishError) throw new HttpError(503, unavailable);
    processed += 1;
  }
  return processed;
}

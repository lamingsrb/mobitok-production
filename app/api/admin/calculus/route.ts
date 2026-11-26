import { z } from "zod";
import { calculusTransferReady, processCalculusQueue, transferCalculusOrder } from "@/lib/server/calculus-transfer";
import { apiError, parseBody, rateLimit } from "@/lib/server/http";
import { getAdminClient, HttpError, requireAdmin } from "@/lib/server/supabase";
import { after } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 90;

const orderSchema = z.object({ orderId: z.uuid() });
const settingsSchema = z.object({ automaticEnabled: z.boolean() });
const overviewSchema = z.object({
  automatic_enabled: z.boolean(),
  updated_at: z.string().nullable(),
  pending: z.number(),
  review: z.number(),
  exported: z.number(),
});
const noStore = { headers: { "Cache-Control": "no-store" } };
const unavailable = "Podešavanja prenosa trenutno nisu dostupna.";

async function overview() {
  const { data, error } = await getAdminClient(AbortSignal.timeout(5000)).rpc("calculus_transfer_overview");
  if (error) throw new HttpError(503, unavailable);
  const settings = overviewSchema.parse(data);
  return {
    enabled: calculusTransferReady(),
    settings: {
      automaticEnabled: settings.automatic_enabled,
      updatedAt: settings.updated_at,
      counts: { pending: settings.pending, review: settings.review, exported: settings.exported },
    },
  };
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return Response.json(await overview(), noStore);
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const { automaticEnabled } = await parseBody(request, settingsSchema, 256);
    if (automaticEnabled && !calculusTransferReady())
      throw new HttpError(409, "Automatsko slanje je dostupno nakon podešavanja veze sa Calculusom.");
    await rateLimit(request, "calculus-transfer-settings", 25, actor.id);
    const { error } = await getAdminClient(AbortSignal.timeout(5000)).rpc("set_calculus_automatic_transfer", {
      p_actor_id: actor.id, p_enabled: automaticEnabled,
    });
    if (error) throw new HttpError(503, unavailable);
    if (automaticEnabled) {
      after(() => processCalculusQueue(1).catch(() => {
        console.error("Pokretanje Calculus reda nije uspelo. Red ostaje sačuvan.");
      }));
    }
    return Response.json(await overview(), noStore);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    if (!calculusTransferReady()) throw new HttpError(503, "Prenos u Calculus još nije uključen.");
    const { orderId } = await parseBody(request, orderSchema, 256);
    await rateLimit(request, "calculus-draft-export", 20, actor.id);
    return Response.json(await transferCalculusOrder(orderId, actor.id), noStore);
  } catch (error) {
    return apiError(error);
  }
}

import { timingSafeEqual } from "node:crypto";
import { calculusTransferReady, processCalculusQueue } from "@/lib/server/calculus-transfer";
import { apiError } from "@/lib/server/http";
import { HttpError } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    const expected = Buffer.from(`Bearer ${secret ?? ""}`);
    const given = Buffer.from(request.headers.get("authorization") ?? "");
    if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected))
      throw new HttpError(401, "Pristup nije dozvoljen.");
    const enabled = calculusTransferReady();
    return Response.json({ processed: enabled ? await processCalculusQueue(3) : 0 }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}

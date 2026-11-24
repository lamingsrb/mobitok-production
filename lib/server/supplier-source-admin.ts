import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { SupplierSourceSettings } from "../supplier-source-types";
import { HttpError } from "./supabase";

const supplierId = z.string().regex(/^[a-z0-9_-]{1,40}$/);
const cleanSecret = z.string().min(1).max(8192).refine(value => !/[\u0000-\u001f\u007f]/.test(value), "Pristupni podatak sadrži nedozvoljene znakove.");
export const supplierSourceQuerySchema = z.object({ supplier: supplierId }).strict();
export const supplierSourcePatchSchema = z.object({
  supplier: supplierId,
  revision: z.iso.datetime({ offset: true }),
  newUrl: z.string().trim().min(1).max(4096).optional(),
  enabled: z.boolean().optional(),
  authMode: z.enum(["keep", "replace", "clear"]).default("keep"),
  authHeaderName: z.string().trim().max(100).optional(),
  authHeaderValue: cleanSecret.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.authMode !== "replace" && (value.authHeaderName !== undefined || value.authHeaderValue !== undefined)) {
    ctx.addIssue({ code: "custom", message: "Za nove pristupne podatke izaberite zamenu pristupa." });
  }
  if (value.authMode === "replace") {
    if (!value.authHeaderValue) ctx.addIssue({ code: "custom", message: "Unesite novi ključ ili token." });
    const name = value.authHeaderName || "";
    if ((value.supplier !== "trig" && !name) || (name && (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
      || /^(host|content-length|transfer-encoding|connection|proxy-.*|upgrade|trailer|te|origin|referer|forwarded|x-forwarded-.*)$/i.test(name)))) {
      ctx.addIssue({ code: "custom", message: "Unesite dozvoljen naziv zaglavlja, na primer Authorization ili X-Api-Key." });
    }
  }
  if (value.newUrl === undefined && value.enabled === undefined && value.authMode === "keep") {
    ctx.addIssue({ code: "custom", message: "Unesite adresu ili izaberite promenu pristupa ili sinhronizacije." });
  }
});
export type SupplierSourcePatch = z.infer<typeof supplierSourcePatchSchema>;
export type PrivateSupplierSource = {
  supplier: string; label: string; kind: string; updated_at: string; enabled: boolean;
  url: string | null; auth_header_name: string | null; auth_header_value: string | null;
  sync_lease_until: string | null;
};
type Environment = Record<string, string | undefined>;
const fields = "supplier,label,kind,updated_at,enabled,url,auth_header_name,auth_header_value,sync_lease_until";
const envUrl = (supplier: string, env: Environment) => Boolean(env[`${supplier.toUpperCase()}_FEED_URL`]);
const managedAuth = (supplier: string, env: Environment) => supplier === "msmobile" || supplier === "dv"
  || (supplier === "trig" && Boolean(env.TRIG_API_KEY));

export function sourceSettings(row: PrivateSupplierSource, env: Environment = process.env): SupplierSourceSettings {
  return { supplier: row.supplier, label: row.label, kind: row.kind, revision: row.updated_at,
    enabled: row.enabled, urlConfigured: Boolean(row.url) || envUrl(row.supplier, env),
    urlManaged: envUrl(row.supplier, env),
    authConfigured: row.supplier === "msmobile" ? Boolean(env.MSMOBILE_EMAIL && env.MSMOBILE_PASSWORD)
      : Boolean(row.auth_header_value || (row.supplier === "trig" && env.TRIG_API_KEY)),
    authManaged: managedAuth(row.supplier, env) };
}

export function assertSourceOrigin(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  if (site === "cross-site" || (origin !== null && origin !== new URL(request.url).origin)) {
    throw new HttpError(403, "Izmenu pošaljite iz admin centra ove prodavnice.");
  }
}

export function publicFeedAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2))))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address)
    && !/^2001:(?:0*db8|0+|0*10|0*20):/i.test(address) && !/^2002:/i.test(address);
}

type ResolveHost = (host: string) => Promise<{ address: string }[]>;
export async function validateSourceUrl(value: string, supplier: string,
  resolveHost: ResolveHost = host => lookup(host, { all: true, verbatim: true })): Promise<string> {
  let url: URL;
  try { url = new URL(value); } catch { throw new HttpError(400, "Unesite ispravnu HTTPS adresu feeda."); }
  const host = url.hostname.toLowerCase();
  const msHttp = supplier === "msmobile" && ["msmobile.rs", "www.msmobile.rs"].includes(host) && url.protocol === "http:" && !url.port;
  if (/[\u0000-\u0020\u007f]/.test(value) || (url.protocol !== "https:" && !msHttp) || url.username || url.password
    || url.hash || (url.port && url.port !== "443") || isIP(host) || host.includes(":")
    || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
    || /\.(localhost|local|internal|invalid|test|lan|home|onion)$/i.test(host)) {
    throw new HttpError(400, "Koristite javnu HTTPS adresu bez korisničkog imena, lozinke ili posebnog porta.");
  }
  const fixedHosts: Record<string, string[]> = {
    msmobile: ["msmobile.rs", "www.msmobile.rs"], dv: ["digitalvision.rs", "www.digitalvision.rs"],
    trig: ["rstrig-api-kzczjbhb7d44s.azurewebsites.net"],
  };
  if (fixedHosts[supplier] && !fixedHosts[supplier].includes(host)) {
    throw new HttpError(400, "Ovaj dobavljač koristi svoj postojeći domen; unesite novu putanju ili pristupni parametar na tom domenu.");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([resolveHost(host), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("DNS timeout")), 4000);
    })]);
    if (!addresses.length || addresses.some(row => !publicFeedAddress(row.address))) {
      throw new HttpError(400, "Adresa feeda mora voditi do javnog servera dobavljača.");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Domen feeda trenutno nije moguće proveriti. Proverite adresu i pokušajte ponovo.");
  } finally { clearTimeout(timer); }
  return url.toString();
}

export async function readSourceSettings(db: SupabaseClient, supplier: string, env: Environment = process.env) {
  const { data, error } = await db.from("supplier_sources").select(fields).eq("supplier", supplier).maybeSingle();
  if (error) throw new HttpError(503, "Podešavanja izvora trenutno nisu dostupna.");
  if (!data) throw new HttpError(404, "Dobavljač nije pronađen.");
  return sourceSettings(data as PrivateSupplierSource, env);
}

export async function saveSourceSettings(db: SupabaseClient, actorId: string, input: SupplierSourcePatch,
  env: Environment = process.env, resolveHost?: ResolveHost) {
  const { data: row, error } = await db.from("supplier_sources").select(fields).eq("supplier", input.supplier).maybeSingle();
  if (error) throw new HttpError(503, "Podešavanja izvora trenutno nisu dostupna.");
  if (!row) throw new HttpError(404, "Dobavljač nije pronađen.");
  const source = row as PrivateSupplierSource;
  if (input.revision !== source.updated_at) throw new HttpError(409, "Izvor je u međuvremenu promenjen. Osvežite podešavanja pre čuvanja.");
  if (source.sync_lease_until && Date.parse(source.sync_lease_until) > Date.now()) {
    throw new HttpError(409, "Sinhronizacija ovog dobavljača je u toku. Sačekajte završetak pa sačuvajte izmenu.");
  }
  if (input.newUrl !== undefined && envUrl(input.supplier, env)) {
    throw new HttpError(409, "Adresa je podešena u serverskom okruženju. Najpre uklonite serversko nadjačavanje da bi važila adresa iz admin centra.");
  }
  if (input.authMode !== "keep" && managedAuth(input.supplier, env)) {
    throw new HttpError(409, "Pristup ovom dobavljaču vodi se u serverskim podešavanjima.");
  }
  const patch: Record<string, unknown> = {};
  if (input.newUrl !== undefined) {
    patch.url = await validateSourceUrl(input.newUrl, input.supplier, resolveHost);
    if (input.authMode === "keep" && source.auth_header_value) {
      let previousOrigin = "";
      try { previousOrigin = new URL(source.url || "").origin; } catch { /* Unknown old origin requires explicit auth choice. */ }
      if (new URL(String(patch.url)).origin !== previousOrigin) {
        throw new HttpError(400, "Za adresu na drugom domenu izričito izaberite novi pristup ili uklonite sačuvani pristup. Postojeći ključ se ne šalje novom serveru.");
      }
    }
  }
  if (input.enabled !== undefined) {
    if (input.enabled && !input.newUrl && !source.url && !envUrl(input.supplier, env)) {
      throw new HttpError(400, "Najpre podesite adresu feeda.");
    }
    patch.enabled = input.enabled;
  }
  if (input.authMode === "replace") {
    patch.auth_header_name = input.authHeaderName || null;
    patch.auth_header_value = input.authHeaderValue;
  } else if (input.authMode === "clear") {
    patch.auth_header_name = null;
    patch.auth_header_value = null;
  }
  // Row lock, compare-and-swap, resync gate, and sanitized audit commit together.
  const { data: saved, error: saveError } = await db.rpc("admin_update_supplier_source", {
    p_actor_id: actorId, p_supplier: input.supplier, p_revision: input.revision, p_patch: patch,
  });
  if (saveError) {
    const message = String(saveError.message ?? "");
    if (/SOURCE_VERSION_CONFLICT|SOURCE_BUSY/.test(message)) throw new HttpError(409, "Izvor je promenjen ili je počela sinhronizacija. Osvežite podešavanja i pokušajte ponovo.");
    if (message.includes("SOURCE_NOT_FOUND")) throw new HttpError(404, "Dobavljač nije pronađen.");
    if (message.includes("FORBIDDEN")) throw new HttpError(403, "Ova radnja je dostupna administratoru.");
    throw new HttpError(503, "Izvor nije sačuvan. Pokušajte ponovo; pristupni podaci nisu prikazani.");
  }
  if (!saved?.revision) throw new HttpError(503, "Čuvanje izvora nije potvrđeno. Osvežite podešavanja pre ponovnog pokušaja.");
  return { settings: sourceSettings({ ...source, ...patch, updated_at: saved.revision } as PrivateSupplierSource, env),
    syncRequired: saved.syncRequired === true };
}

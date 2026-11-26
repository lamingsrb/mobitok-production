import { z } from "zod";
import { apiError, parseBody, rateLimit } from "@/lib/server/http";
import { getAdminClient, HttpError, requireAdmin } from "@/lib/server/supabase";

export const runtime = "nodejs";

const productId = z.string().trim().min(1).max(240);
const code = z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f\ufffe\uffff]+$/u);
const productBody = z.object({ productId });
const mappingBody = productBody.extend({ articleCode: code, taxCode: code });
const noStore = { headers: { "Cache-Control": "no-store" } };
const unavailable = "Šifarnik artikala za Calculus trenutno nije dostupan.";
type Product = { id: string; name: string; supplier_sku: string | null };
type Mapping = { article_code: string; tax_code: string };
const productFields = "id,name,supplier_sku";

function present(product: Product, mapping?: Mapping) {
  return {
    id: product.id, name: product.name, sku: product.supplier_sku,
    articleCode: mapping?.article_code ?? null, taxCode: mapping?.tax_code ?? null,
  };
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const term = (new URL(request.url).searchParams.get("q") ?? "").trim();
    if (term.length > 240) throw new HttpError(400, "Unesite kraći pojam za pretragu.");
    const db = getAdminClient(AbortSignal.timeout(6500));
    const byId = new Map<string, Product>();
    if (term) {
      const like = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
      const results = await Promise.all([
        db.from("products").select(productFields).eq("id", term).limit(1),
        db.from("products").select(productFields).eq("supplier_sku", term).limit(12),
        db.from("products").select(productFields).eq("active", true).ilike("name", like).order("name").limit(15),
      ]);
      if (results.some((result) => result.error)) throw new HttpError(503, unavailable);
      for (const result of results) {
        for (const item of result.data ?? []) byId.set(item.id, item);
      }
    } else {
      const { data, error } = await db.from("calculus_article_mappings")
        .select("article_code,tax_code,products!inner(id,name,supplier_sku)")
        .order("updated_at", { ascending: false }).limit(30);
      if (error) throw new HttpError(503, unavailable);
      const products = (data ?? []).flatMap((row) => {
        const product = Array.isArray(row.products) ? row.products[0] : row.products;
        return product ? [present(product, row)] : [];
      });
      return Response.json({ products }, noStore);
    }
    const selected = [...byId.values()].slice(0, 20);
    if (!selected.length) return Response.json({ products: [] }, noStore);
    const { data: mappings, error } = await db.from("calculus_article_mappings")
      .select("product_id,article_code,tax_code").in("product_id", selected.map((item) => item.id));
    if (error) throw new HttpError(503, unavailable);
    const byProduct = new Map(mappings?.map((mapping) => [mapping.product_id, mapping]));
    return Response.json({ products: selected.map((item) => present(item, byProduct.get(item.id))) }, noStore);
  } catch (error) {
    return apiError(error);
  }
}

async function changeMapping(request: Request, remove: boolean) {
  try {
    const actor = await requireAdmin(request);
    const body = remove ? await parseBody(request, productBody, 3000) : await parseBody(request, mappingBody, 3000);
    await rateLimit(request, "calculus-article-mapping", 90, actor.id);
    const db = getAdminClient(AbortSignal.timeout(6500));
    const { data: product, error: productError } = await db.from("products")
      .select(productFields).eq("id", body.productId).maybeSingle();
    if (productError) throw new HttpError(503, unavailable);
    if (!product) throw new HttpError(404, "Artikal više nije dostupan.");

    const mapping = "articleCode" in body && "taxCode" in body
      ? { article_code: body.articleCode as string, tax_code: body.taxCode as string }
      : undefined;
    const { error } = await (mapping
      ? db.from("calculus_article_mappings").upsert({
        product_id: body.productId, ...mapping, updated_at: new Date().toISOString(), updated_by: actor.id,
      })
      : db.from("calculus_article_mappings").delete().eq("product_id", body.productId));
    if (error) throw new HttpError(503, "Šifra artikla u Calculusu nije sačuvana.");
    return Response.json({ product: present(product, mapping) }, noStore);
  } catch (error) {
    return apiError(error);
  }
}

export function PUT(request: Request) {
  return changeMapping(request, false);
}

export function DELETE(request: Request) {
  return changeMapping(request, true);
}

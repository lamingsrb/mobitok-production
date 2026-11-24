import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type { Product } from "../catalog";
import { catalogPublicRevision } from "./catalog-revision";

const READ_BATCH_SIZE = 250;
const PRODUCT_COLUMNS = "id,slug,name,category,subcategory,brand,device_brand,devices,price,image,images,description,specs,stock,is_demo,tags,supplier,supplier_sku";
type CatalogRow = Omit<Product, "deviceBrand" | "price" | "isDemo" | "supplier"> & {
  device_brand: string | null;
  price: number | string;
  is_demo: boolean;
  supplier: string | null;
  supplier_sku: string | null;
};
type InventoryRow = {
  supplier: string;
  supplier_sku: string;
  stock: number | null;
  stock_status: string;
  available: boolean;
  last_seen_at: string;
};
const inventoryKey = (supplier: string | null, sku: string | null) => JSON.stringify([supplier, sku]);

export async function readPublicCatalogPage(db:SupabaseClient,page=0,pageSize=250){
  const [sourceResult,inventoryResult,catalogRevision]=await Promise.all([
    db.from("supplier_sources").select("supplier,label,enabled,catalog_enabled,stock_max_age_hours,safety_stock,lead_time_days,updated_at,catalog_published_at,last_synced_at").order("supplier"),
    db.from("supplier_sync_runs").select("id,finished_at").eq("status","ok").order("finished_at",{ascending:false}).limit(1).maybeSingle(),
    catalogPublicRevision(db),
  ]);
  const {data:sources,error:sourceError}=sourceResult;
  if(sourceError||inventoryResult.error)throw sourceError||inventoryResult.error;
  const sourceMap=new Map((sources??[]).map(s=>[s.supplier,s]));
  const products:Product[]=[];
  const allowed=(sources??[]).filter(s=>s.enabled&&s.catalog_enabled).map(s=>s.supplier);
  const revision=createHash("sha256").update(JSON.stringify({sources,inventory:inventoryResult.data,catalogRevision})).digest("hex").slice(0,24);
  if(!allowed.length)return {products,page,pageSize,totalCount:0,pageCount:1,revision};
  const offset=page*pageSize;
  // A wide ordered page (with or without a foreign-table embed) times out against the
  // production security-barrier view. Page narrow IDs first, then hydrate bounded IDs
  // through the SAME view: a product hidden between requests must still be excluded.
  const {data:idRows,error:pageError,count}=await db.from("catalog_visible_products")
    .select("id",{count:"exact"}).eq("active",true).in("supplier",allowed)
    .order("id").range(offset,offset+pageSize-1);
  if(pageError)throw pageError;
  const ids=(idRows??[]).map(row=>row.id as string);
  const rowsById=new Map<string,CatalogRow>();
  for(let start=0;start<ids.length;start+=READ_BATCH_SIZE){
    const {data,error}=await db.from("catalog_visible_products").select(PRODUCT_COLUMNS)
      .in("id",ids.slice(start,start+READ_BATCH_SIZE)).limit(READ_BATCH_SIZE);
    if(error)throw error;
    for(const row of (data??[]) as CatalogRow[])rowsById.set(row.id,row);
  }
  const rows=ids.flatMap(id=>{const row=rowsById.get(id);return row?[row]:[];});
  const skusBySupplier=new Map<string,Set<string>>();
  for(const row of rows){
    if(!row.supplier||!row.supplier_sku)continue;
    const skus=skusBySupplier.get(row.supplier)??new Set<string>();
    skus.add(row.supplier_sku);skusBySupplier.set(row.supplier,skus);
  }
  const inventoryByKey=new Map<string,InventoryRow>();
  await Promise.all([...skusBySupplier].map(async([supplier,skuSet])=>{
    const skus=[...skuSet];
    for(let start=0;start<skus.length;start+=READ_BATCH_SIZE){
      const {data,error}=await db.from("supplier_products")
        .select("supplier,supplier_sku,stock,stock_status,available,last_seen_at")
        .eq("supplier",supplier).in("supplier_sku",skus.slice(start,start+READ_BATCH_SIZE)).limit(READ_BATCH_SIZE);
      // An inventory error is not an empty page or an unavailable offer: let the caller retry.
      if(error)throw error;
      for(const row of (data??[]) as InventoryRow[])inventoryByKey.set(inventoryKey(row.supplier,row.supplier_sku),row);
    }
  }));
  for(const p of rows){
    const source=sourceMap.get(p.supplier);
    if(p.supplier&&(!source?.enabled||!source?.catalog_enabled))continue;
    const inventory=inventoryByKey.get(inventoryKey(p.supplier,p.supplier_sku));
    // Vreme vidjenja ponude, kao public.mh_offer_seen: dostupan red je vidjen i u poslednjem
    // uspesnom osvezavanju izvora, iako tada nije prepisan (upisuju se samo promene).
    const seen=inventory?(inventory.available&&source?.last_synced_at&&new Date(source.last_synced_at)>new Date(inventory.last_seen_at)?source.last_synced_at:inventory.last_seen_at):undefined;
    const published=source?.catalog_published_at&&seen&&new Date(source.catalog_published_at)>=new Date(seen);
    const fresh=published&&seen&&Date.now()-new Date(seen).getTime()<(source?.stock_max_age_hours??30)*3600000;
    // Izvor bez broja komada ali sa potvrdjenom dostupnoscu: vazi kolicina
    // upisana pri objavi, ne nula.
    const samoDostupnost=inventory?.stock===null&&inventory?.stock_status==="available";
    const stock=samoDostupnost?Math.max(0,(p.stock??0)-(source?.safety_stock??0)):inventory?.stock===null?0:Math.max(0,(inventory?.stock??p.stock)-(source?.safety_stock??0));
    const availability:Product["availability"]=!fresh?"check":!inventory?.available||inventory?.stock_status==="unavailable"?"unavailable":samoDostupnost?(stock>0?"available":"unavailable"):inventory?.stock===null?"check":stock>0?"available":"unavailable";
    products.push({id:p.id,slug:p.slug,name:p.name,category:p.category,subcategory:p.subcategory,brand:p.brand,
      deviceBrand:p.device_brand,devices:p.devices,price:Number(p.price),image:p.image,images:p.images,
      description:p.description,specs:p.specs,stock,isDemo:p.is_demo,tags:p.tags,
      supplier:p.supplier||undefined,stockUpdatedAt:seen,availability,leadTimeDays:source?.lead_time_days??null});
  }
  return {products,page,pageSize,totalCount:count??products.length,pageCount:Math.max(1,Math.ceil((count??products.length)/pageSize)),revision};
}

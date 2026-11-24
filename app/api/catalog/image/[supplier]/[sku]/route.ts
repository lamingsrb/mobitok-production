import { getAdminClient } from "@/lib/server/supabase";
import { dozvoljenaAdresa, proksirajSliku, sacuvajSliku } from "@/lib/server/supplier-image";
import { dvCardRequestKey, proxyCardRequest } from "@/lib/catalog-card-image";
import { dvCardImageResponse, proxyCardImageResponse } from "@/lib/server/catalog-card-image";
import { imageFailure, imageRequest } from "@/lib/server/image-request";
import { readStoredSupplierPhoto, serveSavedSupplierPhoto, storedSupplierPhotoURL } from "@/lib/server/stored-supplier-photo";
export const runtime="nodejs";
export const maxDuration=30;

/** 3G stores supplier-required local originals; MS Mobile streams its HTTP-only source. */
export async function GET(request:Request,{params}:{params:Promise<{supplier:string;sku:string}>}){
  const {supplier,sku}=await params;
  if(!["trig","msmobile","dv"].includes(supplier)||!/^\w[\w.-]{0,99}$/.test(sku))return imageFailure(404);
  const query=new URL(request.url).search;
  if(supplier==="dv"){
    const key=dvCardRequestKey(request.url);
    if(!key)return imageFailure(404);
    return imageRequest(request,signal=>dvCardImageResponse(getAdminClient(signal),sku,key,fetch,signal));
  }
  // Only the fixed card preset is accepted; reject arbitrary cache-busting before I/O.
  const card=proxyCardRequest(request.url);
  if(query&&!card)return imageFailure(404);
  return imageRequest(request,async signal=>{
    const db=getAdminClient(signal);
    const deliver=async(response:Promise<Response>)=>card?proxyCardImageResponse(await response,signal):response;
    const {data:product,error:publicError}=await db.from("catalog_visible_products").select("id").eq("supplier",supplier).eq("supplier_sku",sku).eq("active",true).maybeSingle();
    if(publicError)return imageFailure();
    if(!product)return imageFailure(404);
    signal.throwIfAborted();
    if(supplier==="msmobile"){
      const {data:izvor,error}=await db.from("supplier_products").select("slike:source_payload->Images").eq("supplier",supplier).eq("supplier_sku",sku).single();
      if(error)return imageFailure();
      const prva=(Array.isArray(izvor?.slike)?izvor.slike:[]).find((adresa:unknown)=>dozvoljenaAdresa(adresa,supplier));
      const adresa=dozvoljenaAdresa(prva,supplier);
      return adresa?deliver(proksirajSliku(adresa,signal)):imageFailure(404);
    }
    const {data:item,error}=await db.from("supplier_products").select("image_url,cached_image_url").eq("supplier",supplier).eq("supplier_sku",sku).single();
    if(error)return imageFailure();
    const previousCachedURL=item?.cached_image_url;
    if(previousCachedURL&&storedSupplierPhotoURL(previousCachedURL)){
      const stored=await readStoredSupplierPhoto(previousCachedURL,signal);
      if(stored.state==="ready")return deliver(Promise.resolve(stored.response));
      if(stored.state!=="missing")return stored.response;
      signal.throwIfAborted();
    }
    const url=dozvoljenaAdresa(item?.image_url);
    if(!url)return imageFailure(404);
    // Missing local copy: revalidate the original allowlist, then create one compressed local copy.
    const saved=await sacuvajSliku(db,url,signal);
    signal.throwIfAborted();
    let update=db.from("supplier_products").update({cached_image_url:saved.publicUrl}).eq("supplier",supplier).eq("supplier_sku",sku).eq("image_url",item!.image_url);
    if(previousCachedURL)update=update.eq("cached_image_url",previousCachedURL);
    const {error:updateError}=await update;
    if(updateError)return imageFailure();
    signal.throwIfAborted();
    return deliver(serveSavedSupplierPhoto(saved,signal));
  });
}

import { getAdminClient } from "@/lib/server/supabase";
import { dozvoljenaAdresa, otisakAdrese, proksirajSliku, sacuvajSliku } from "@/lib/server/supplier-image";
import { imageFailure, imageRequest } from "@/lib/server/image-request";
import { readStoredSupplierPhoto, serveSavedSupplierPhoto } from "@/lib/server/stored-supplier-photo";
export const runtime="nodejs";
export const maxDuration=30;

/** Extra 3G photos share the same source-hashed Storage object; MS Mobile never uploads. */
export async function GET(request:Request,{params}:{params:Promise<{supplier:string;sku:string;n:string}>}){
  const {supplier,sku,n}=await params;
  const redni=Number(n);
  if(!["trig","msmobile"].includes(supplier)||!/^\w[\w.-]{0,99}$/.test(sku)||!(/^[1-9]\d?$/.test(n))||new URL(request.url).search)return imageFailure(404);
  return imageRequest(request,async signal=>{
    const db=getAdminClient(signal);
    const {data:product,error:publicError}=await db.from("catalog_visible_products").select("id").eq("supplier",supplier).eq("supplier_sku",sku).eq("active",true).maybeSingle();
    if(publicError)return imageFailure();
    if(!product)return imageFailure(404);
    signal.throwIfAborted();
    const {data:item,error}=await db.from("supplier_products").select(supplier==="msmobile"?"slike:source_payload->Images":"slike:source_payload->ImagePaths").eq("supplier",supplier).eq("supplier_sku",sku).single();
    if(error)return imageFailure();
    const putanje:unknown[]=Array.isArray(item?.slike)?item.slike:[];
    const adrese=Array.from(new Set(putanje.filter((adresa):adresa is string=>typeof adresa==="string"&&(supplier==="msmobile"?dozvoljenaAdresa(adresa,supplier)!==null:/^https:\/\//.test(adresa)))));
    const url=dozvoljenaAdresa(adrese[redni],supplier);
    if(!url)return imageFailure(404);
    if(supplier==="msmobile")return proksirajSliku(url,signal);
    const otisak=otisakAdrese(url);
    const {data:postojece,error:listError}=await db.storage.from("supplier-images").list("trig",{search:otisak,limit:1});
    if(listError)return imageFailure();
    signal.throwIfAborted();
    const ime=postojece?.find((fajl)=>fajl.name.startsWith(otisak))?.name;
    if(ime){
      const stored=await readStoredSupplierPhoto(db.storage.from("supplier-images").getPublicUrl(`trig/${ime}`).data.publicUrl,signal);
      if(stored.state==="ready")return stored.response;
      if(stored.state!=="missing")return stored.response;
      signal.throwIfAborted();
    }
    const saved=await sacuvajSliku(db,url,signal);
    return serveSavedSupplierPhoto(saved,signal);
  });
}

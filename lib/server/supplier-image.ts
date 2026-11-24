import { createHash } from "node:crypto";
import { compressSupplierPhoto } from "./compress-supplier-photo";
import type { SupabaseClient } from "@supabase/supabase-js";
import { imageFailure } from "./image-request";
import { downloadRasterSource } from "./catalog-image-source";

const KES_SLIKE="public, max-age=31536000, s-maxage=3600, immutable";
const TIPOVI:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"};
const NAJVISE_BAJTOVA=8388608;

/** Bytes, rather than a redirect, preserve local-route/Next image compatibility. */
export async function posaljiSliku(url:string,contentType?:string,telo?:Uint8Array,signal?:AbortSignal){
  signal?.throwIfAborted();
  if(telo)return new Response(new Uint8Array(telo),{headers:{"Content-Type":contentType!,"Cache-Control":KES_SLIKE}});
  try{
    const {bytes,contentType:tip}=await downloadRasterSource(new URL(url),NAJVISE_BAJTOVA,{signal});
    return new Response(new Uint8Array(bytes),{headers:{"Content-Type":tip,"Cache-Control":KES_SLIKE}});
  }catch{return imageFailure();}
}

/** Only the known supplier hosts; MS Mobile's source is HTTP-only. */
export function dozvoljenaAdresa(adresa:unknown,supplier:string="trig"):URL|null{
  try{
    const url=new URL(typeof adresa==="string"?adresa:"");
    if(url.username||url.password)return null;
    if(supplier==="dv")return url.protocol==="https:"&&["digitalvision.rs","www.digitalvision.rs"].includes(url.hostname)?url:null;
    if(supplier==="msmobile")return ["http:","https:"].includes(url.protocol)&&["msmobile.rs","www.msmobile.rs"].includes(url.hostname)&&url.pathname.startsWith("/images/")?url:null;
    return url.protocol==="https:"&&url.hostname==="rstrigb2bee.blob.core.windows.net"?url:null;
  }catch{return null;}
}

/** MS Mobile streams through HTTPS; no Storage upload. */
export async function proksirajSliku(url:URL,signal?:AbortSignal){
  try{
    const {bytes:telo,contentType:tip}=await downloadRasterSource(url,NAJVISE_BAJTOVA,{signal});
    return new Response(new Uint8Array(telo),{headers:{"Content-Type":tip,"Cache-Control":"public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400"}});
  }catch{return imageFailure();}
}

export const otisakAdrese=(url:URL)=>createHash("sha256").update(url.toString()).digest("hex");

/** Client must be created with the request signal, which also aborts Storage upload. */
export async function sacuvajSliku(db:SupabaseClient,url:URL,signal?:AbortSignal){
  signal?.throwIfAborted();
  const {bytes:downloaded,contentType}=await downloadRasterSource(url,NAJVISE_BAJTOVA,{signal});
  const slika=await compressSupplierPhoto(downloaded,contentType,signal);
  signal?.throwIfAborted();
  const path=`trig/${otisakAdrese(url)}.${TIPOVI[contentType]}`;
  const bucket=db.storage.from("supplier-images");
  const {error}=await bucket.upload(path,slika,{contentType,upsert:false,cacheControl:"31536000"});
  signal?.throwIfAborted();
  const {publicUrl}=bucket.getPublicUrl(path).data;
  if(error){
    // Another request may already have saved this source, including a gallery photo.
    const code = "code" in error ? error.code : undefined;
    const existing = code === "ResourceAlreadyExists" || code === "KeyAlreadyExists" ||
      (error.status === 400 && !code && error.message === "The resource already exists");
    if (existing)
      return {publicUrl,contentType,slika:undefined};
    throw error;
  }
  return {publicUrl,contentType,slika};
}

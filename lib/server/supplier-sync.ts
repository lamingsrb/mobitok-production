import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./supabase";
import { readFeed, probeFeed, type SupplierSource } from "./supplier-feed";
import { backgroundFeedTimeoutMs, SupplierFeedBudgetError } from "./supplier-feed-budget";
import { publishSupplierCatalog } from "./catalog-publish";
import { sourceStageBatches } from "./source-stage-batches";
import { configuredSupabaseUrl } from "../supabase-config";
import { needsPublish, pickNext, publishLagging, recentlyStarted, rotationState, staleSources, tooSoon, ROTATION_GUARD_MINUTES, type RunInfo } from "./supplier-rotation";

export type SyncReport = {
  supplier: string; runId: string; status: "ok" | "failed" | "skipped";
  itemsInSource: number; skipped: number; added: number; returned: number; removed: number;
  priceChanged: number; unchanged: number; withStock: number; withImage: number;
  durationMs: number; error?: string;
  // Safe structured staging diagnostic; never provider bodies, URLs or credentials.
  errorCode?: string;
  // Koliko je artikala zaista objavljeno i, ako nije, zasto. Bez ovoga
  // sinhronizacija prijavljuje uspeh i kad u prodavnicu ne stigne nista.
  published?: number; publishReason?: string; publishPending?: boolean; publishErrorCode?: string;
  // Koliko je redova izvora prepisano (ostali su nepromenjeni) i da li je poziv samo ponovio objavu.
  written?: number; action?: "publish";
};
type SourceRow = SupplierSource & { updated_at?: string | null; catalog_enabled?: boolean | null; catalog_published_at?: string | null; stock_max_age_hours?: number | null };
// Rok jednog poziva rute (maxDuration 300 s) umanjen za objavu i odgovor.
const ROK_MS=240_000;
// Posle ovoliko vremena od pocetka poziva ne pokrece se nova objava (rotacija) ni novo osvezavanje
// (rezerva): feed, upis i objava moraju da stanu u maxDuration.
const START_OBJAVE_MS=150_000,START_REZERVE_MS=120_000;
const pauza=(ms:number)=>new Promise(r=>setTimeout(r,ms));
// Greska sa SQLSTATE ili PGRST kodom dolazi iz baze, pa je transakcija sigurno vracena. Bez koda
// (prekid veze, timeout API gateway-a) upis moze i dalje da radi i da se uspesno zavrsi.
const odgovorBaze=(code:unknown)=>typeof code==="string"&&(/^[0-9A-Z]{5}$/.test(code)||code.startsWith("PGRST"));
class NepoznatIshod extends Error {}
type Odgovor<T>={data:T|null;error:{code?:string;message?:string}|null;status?:number};
// Citanje bez upisa se ponavlja: prolazna greska API-ja inace preskace ceo sat rotacije. 18.10.2026.
// Supabase API je u 16:17 i 16:22 UTC citanje istorije odbio sa 401, a citanje podesavanja u istom
// pozivu, sa istim kljucem, proslo je; isti poziv u 16:29 prolazi.
const procitaj=async<T>(tabela:string,upit:()=>PromiseLike<Odgovor<T>>):Promise<Odgovor<T>>=>{
  for(let pokusaj=1;;pokusaj++){
    const odgovor=await upit();
    if(!odgovor.error) return odgovor;
    console.error(`Citanje "${tabela}" nije uspelo (pokusaj ${pokusaj}, HTTP ${odgovor.status??"-"})`,odgovor.error);
    if(pokusaj>=3) return odgovor;
    await pauza(pokusaj*3000);
  }
};
// Kod baze ili HTTP status ostaje u odgovoru rute, pa se uzrok vidi i u net._http_response, bez Vercel logova.
const stagingFailureCode=(error:unknown,status:unknown):string|undefined=>{
  const code=typeof error==="object"&&error!==null&&"code" in error?error.code:null;
  if(typeof code==="string"&&/^(?:[0-9A-Z]{5}|PGRST[0-9A-Z]{3})$/.test(code))return code;
  if(typeof status==="number"&&Number.isInteger(status)&&status>=400&&status<=599)return "HTTP_"+status;
  return undefined;
};
const saKodom=(poruka:string,{error,status}:Odgovor<unknown>)=>{
  const kod=odgovorBaze(error?.code)?error?.code:status?`HTTP ${status}`:"";
  return `${poruka}${kod?` (${kod})`:""}.`;
};

export const getSyncClient = (): SupabaseClient => {
  const url = configuredSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NODE_ENV), key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(503, "Servis trenutno nije dostupan.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
};
export const loadSources = async (db: SupabaseClient): Promise<SourceRow[]> => {
  const odgovor=await procitaj("supplier_sources",()=>db.from("supplier_sources").select("*").order("supplier"));
  const {data,error}=odgovor;
  if(error) throw new HttpError(503,saKodom("Podešavanja dobavljača nisu dostupna",odgovor));
  return (data ?? []).map(row=>({...row,url:process.env[`${row.supplier.toUpperCase()}_FEED_URL`] || row.url,field_map:row.field_map ?? {}}));
};
export const loadSource = async(db:SupabaseClient,supplier:string) => {
  const source=(await loadSources(db)).find(s=>s.supplier===supplier);
  if(!source) throw new HttpError(404,"Dobavljač nije podešen.");
  return source;
};
export const probeSupplier = async(supplier:string) => {
  const source=await loadSource(getSyncClient(),supplier);
  return {supplier,label:source.label,enabled:source.enabled,url_set:Boolean(source.url),...(await probeFeed(source))};
};
const prazanIzvestaj=(supplier:string,status:SyncReport["status"]):SyncReport=>({supplier,runId:"",status,itemsInSource:0,skipped:0,added:0,returned:0,removed:0,priceChanged:0,unchanged:0,withStock:0,withImage:0,durationMs:0});
const failedReport=(supplier:string,error:string):SyncReport=>({...prazanIzvestaj(supplier,"failed"),error});

type IshodPosla={status:string;rows_in_source:number;rows_skipped:number;added:number;returned:number;removed:number;price_changed:number;unchanged:number};
/** Stanje posla; dok jos radi, proverava se na 5 s do roka. */
const ishodPosla=async(db:SupabaseClient,runId:string,rok:number):Promise<IshodPosla|null>=>{
  for(;;){
    const {data,error}=await db.from("supplier_sync_runs").select("status,rows_in_source,rows_skipped,added,returned,removed,price_changed,unchanged").eq("id",runId).maybeSingle();
    if(!error&&data?.status!=="running")return data as IshodPosla|null;
    if(Date.now()+5000>=rok)return error?null:data as IshodPosla;
    await pauza(5000);
  }
};
/** Objava ima trajan posao i male transakcije; nepoznat ishod se nastavlja sledecim pozivom. */
const objavi=async(db:SupabaseClient,supplier:string,report:SyncReport,rok:number)=>{
  try {
    const objava=await publishSupplierCatalog(db,supplier,{deadline:rok});
    report.published=objava.published;
    if(objava.reason)report.publishReason=objava.reason;
    if(objava.errorCode)report.publishErrorCode=objava.errorCode;
    report.publishPending=["sync_required","in_progress","busy","capacity"].includes(objava.reason??"");
  } catch(error) {
    console.error('Objava kataloga "'+supplier+'" nije uspela',error);
    report.publishPending=true;
    const code=typeof error==="object"&&error!==null&&"code" in error?error.code:null;
    if(typeof code==="string"&&/^(?:[0-9A-Z]{5}|PGRST[0-9A-Z]{3})$/.test(code))report.publishErrorCode=code;
    report.error="Izvor je osvežen, ali objavljivanje kataloga treba nastaviti pri sledećem pokretanju.";
  }
};
const oslobodiZakup=async(db:SupabaseClient,supplier:string,runId:string)=>{
  for(let pokusaj=1;pokusaj<=2;pokusaj++){
    const {error}=await db.from("supplier_sources").update({sync_run_id:null,sync_lease_until:null}).eq("supplier",supplier).eq("sync_run_id",runId);
    if(!error)return;
    // Zakup istice sam za 10 min (begin_supplier_sync); do tada izvor ceka.
    console.error(`Zakup izvora "${supplier}" nije oslobodjen (pokusaj ${pokusaj})`,error);
    if(pokusaj<2)await pauza(1000);
  }
};

/** Staged batches become visible in one transaction; interrupted jobs cannot corrupt stock. */
export const syncSupplier = async(supplier:string,rok=Date.now()+ROK_MS):Promise<SyncReport> => {
  const started=Date.now(),db=getSyncClient(),source=await loadSource(db,supplier);
  const report=prazanIzvestaj(supplier,"skipped");
  if(!source.enabled || !source.url) return {...report,error:"Izvor nije uključen ili nema adresu.",durationMs:Date.now()-started};
  // Cleanup commits separately: a later capacity rejection must not restore old files.
  const {data:cleaned,error:cleanupError}=await db.rpc("cleanup_supplier_sync_stage");
  if(cleanupError||cleaned===false)return {...report,error:cleanupError
    ?"Privremeni podaci nisu dostupni. Osve\u017eavanje \u0107e se ponoviti."
    :"Osve\u017eavanje je ve\u0107 u toku.",durationMs:Date.now()-started};
  const {data:runId,error:leaseError}=await db.rpc("begin_supplier_sync",{p_supplier:supplier});
  if(leaseError) return {...report,error:leaseError.message.includes("SYNC_BUSY")?"Osvežavanje je već u toku.":"Osvežavanje ne može da se pokrene.",durationMs:Date.now()-started};
  report.runId=runId;
  let upisMozdaRadi=false;
  try {
    // The editor may save a new URL/key or disable the source before the lease
    // is acquired. Once leased, edits are blocked; fetch that protected snapshot.
    const leasedSource=await loadSource(db,supplier);
    if(!leasedSource.enabled||!leasedSource.url)throw new Error("Izvor je u međuvremenu isključen ili nema adresu. Preuzimanje nije pokrenuto.");
    const {items,skipped}=await readFeed(leasedSource, backgroundFeedTimeoutMs(leasedSource.supplier, rok));
    if(skipped > items.length * .1) throw new Error("Previše neispravnih zapisa. Prethodni katalog je sačuvan.");
    const stagingRows=items.map(item=>({run_id:runId,supplier_sku:item.supplier_sku,payload:item}));
    for(const rows of sourceStageBatches(stagingRows)){
      let error,status;
      for(let attempt=0;attempt<3;attempt++){
        ({error,status}=await db.from("supplier_sync_stage").upsert(rows,{onConflict:"run_id,supplier_sku"}));
        if(!error||error.message?.includes("SYNC_CAPACITY")) break;
        await pauza(300*(attempt+1));
      }
      if(error){
        report.errorCode=stagingFailureCode(error,status);
        const message=error.message?.includes("SYNC_CAPACITY")
          ?"Uvoz je odložen zbog prostora u bazi. Prethodni katalog je sačuvan."
          :"Preuzeti artikli nisu sačuvani. Prethodni katalog je sačuvan.";
        throw new Error(message+(report.errorCode?" ("+report.errorCode+")":""));
      }
    }
    const {data,error}=await db.rpc("commit_supplier_sync",{p_supplier:supplier,p_run_id:runId,p_expected:items.length,p_skipped:skipped});
    if(error){
      console.error(`Upis osvezavanja "${supplier}" nije potvrdjen`,error);
      if(!odgovorBaze(error.code)) throw new NepoznatIshod("Osvežavanje nije završeno. Pokušajte ponovo.");
      throw new Error(error.message.includes("INCOMPLETE_FEED")?"Izvor je nepotpun. Prethodni katalog je sačuvan.":"Osvežavanje nije završeno. Pokušajte ponovo.");
    }
    Object.assign(report,data,{status:"ok",itemsInSource:items.length,skipped,withStock:items.filter(i=>i.stock!==null).length,withImage:items.filter(i=>i.image_url).length});
    await objavi(db,supplier,report,rok);
  } catch(error) {
    if(error instanceof SupplierFeedBudgetError) report.errorCode=error.code;
    // Izgubljen HTTP odgovor moze da stigne posle uspesnog upisa, a upis moze i da traje duze od
    // veze sa API-jem. Uspeh se nikad ne prepisuje; dok upis mozda radi, ceka se njegov ishod.
    const nepoznato=error instanceof NepoznatIshod;
    const posao=await ishodPosla(db,runId,nepoznato?rok:0);
    if(posao?.status==="ok"){
      Object.assign(report,{status:"ok",itemsInSource:posao.rows_in_source,skipped:posao.rows_skipped,added:posao.added,returned:posao.returned,removed:posao.removed,priceChanged:posao.price_changed,unchanged:posao.unchanged});
      await objavi(db,supplier,report,rok);
    }else if(nepoznato&&(!posao||posao.status==="running")){
      // Ishod nije poznat do roka: posao i zakup ostaju netaknuti. Zakup istice sam (10 min), a
      // sledece pokretanje vidi uspeh ili posao oznaci kao neuspeo (begin_supplier_sync).
      upisMozdaRadi=true;
      report.status="failed";
      report.error="Potvrda osvežavanja nije stigla na vreme. Ishod se vidi pri sledećem pokretanju.";
    }else{
      report.status="failed";
      report.error=error instanceof Error && !/https?:|fetch|apiKey/i.test(error.message)?error.message.slice(0,400):"Dobavljač trenutno nije dostupan. Pokušajte ponovo.";
      await db.from("supplier_sync_runs").update({status:"failed",finished_at:new Date().toISOString(),error:report.error}).eq("id",runId).eq("status","running");
    }
  } finally {
    if(!upisMozdaRadi) await oslobodiZakup(db,supplier,runId);
  }
  return {...report,durationMs:Date.now()-started};
};

const poslednjiPoslovi=async(db:SupabaseClient)=>{
  const odgovor=await procitaj("supplier_sync_runs",()=>db.from("supplier_sync_runs").select("supplier,status,started_at,finished_at").order("started_at",{ascending:false}).limit(200));
  const {data,error}=odgovor;
  // Bez istorije razmak se ne moze proveriti, pa se izvor ne osvezava na slepo.
  if(error) throw new HttpError(503,saKodom("Istorija osvežavanja nije dostupna",odgovor));
  return (data??[]) as ({supplier:string}&RunInfo)[];
};
const stanjeIzvora=async(db:SupabaseClient)=>{
  const [sources,runs,publications,settings]=await Promise.all([
    loadSources(db),poslednjiPoslovi(db),
    procitaj("catalog_publication_runs",()=>db.from("catalog_publication_runs").select("supplier").eq("status","running").not("phase","is",null).order("created_at").limit(100)),
    procitaj<{updated_at:string|null;publish_supplier_catalog:boolean}>("shop_settings",()=>db.from("shop_settings").select("updated_at,publish_supplier_catalog").eq("id",true).single()),
  ]);
  if(publications.error)throw new HttpError(503,saKodom("Istorija objavljivanja nije dostupna",publications));
  if(settings.error)throw new HttpError(503,saKodom("Podešavanja prodavnice nisu dostupna",settings));
  const catalogOpen=settings.data?.publish_supplier_catalog!==false;
  const eligible=new Set(sources.filter(s=>catalogOpen&&s.enabled&&s.catalog_enabled).map(s=>s.supplier));
  const pending=new Set((publications.data??[]).map(row=>row.supplier as string).filter(s=>eligible.has(s)));
  const settingsUpdated=Date.parse(settings.data?.updated_at??"")||0;
  const configPending=new Set(sources.filter(s=>eligible.has(s.supplier)&&Math.max(Date.parse(s.updated_at??"")||0,settingsUpdated)>(Date.parse(s.catalog_published_at??"")||0)).map(s=>s.supplier));
  return {sources,runs,pending,configPending,stanje:rotationState(sources.filter(s=>s.enabled&&s.url),runs)};
};

/** Rucno osvezavanje svih omogucenih izvora iz admin panela; izvor sa ogranicenjem ceka svoj razmak. */
export const runSupplierSync = async():Promise<SyncReport[]> => {
  const pocetak=Date.now(),db=getSyncClient();
  const {sources,runs,pending}=await stanjeIzvora(db);
  const poslednji=new Map(rotationState(sources,runs).map(s=>[s.supplier,s.last] as const));
  const reports:SyncReport[]=[];
  for(const s of sources.filter(s=>s.enabled)){
    if(pending.has(s.supplier)){
      const report:SyncReport={...prazanIzvestaj(s.supplier,"ok"),action:"publish"};
      await objavi(db,s.supplier,report,pocetak+ROK_MS);
      reports.push(report);
      continue;
    }
    if(tooSoon(s.supplier,poslednji.get(s.supplier)??null,pocetak)){
      reports.push({...prazanIzvestaj(s.supplier,"skipped"),error:"Prekratak razmak od poslednjeg osvežavanja; dobavljač ograničava preuzimanja."});
      continue;
    }
    if(Date.now()-pocetak>START_REZERVE_MS){
      reports.push({...prazanIzvestaj(s.supplier,"skipped"),error:"U ovom pozivu nema vremena; preostale izvore nastavlja satna rotacija."});
      continue;
    }
    try { reports.push(await syncSupplier(s.supplier,pocetak+ROK_MS)); }
    catch { reports.push(failedReport(s.supplier,"Izvor trenutno nije dostupan.")); }
  }
  return reports;
};

export type RotationResult={reports:SyncReport[];stale:string[]};
/**
 * Jedan izvor po pozivu (pg_cron svakog sata, GitHub Actions kao rezerva; vidi supplier-rotation.ts).
 * stale: izvori objavljeni u prodavnici bez uspesnog osvezavanja u roku vazenja lagera ili sa objavom
 * koja kasni duze od PUBLISH_LAG_HOURS (artikli im se ne mogu poruciti); ruta tada vraca gresku da bi
 * rezervni okidac poslao upozorenje.
 */
export const syncByRotation=async(now=Date.now()):Promise<RotationResult>=>{
  const pocetak=Date.now(),db=getSyncClient();
  const {stanje,pending,configPending}=await stanjeIzvora(db);
  const objavljeni=stanje.filter(s=>s.catalogEnabled);
  const zastareli=new Set(staleSources(objavljeni,now)),kasni=new Set(publishLagging(objavljeni,now));
  const stale=()=>[...new Set([...zastareli,...kasni])];
  const upravo=stanje.find(s=>recentlyStarted([s],now));
  const reports:SyncReport[]=upravo?[{...prazanIzvestaj(upravo.supplier,"skipped"),error:"Osvežavanje je pokrenuto u poslednjih "+ROTATION_GUARD_MINUTES+" min."}]:[];
  // Nedovrsenoj objavi se ne menja snimak izvora novim preuzimanjem.
  const next=upravo?null:pickNext(stanje.filter(s=>!pending.has(s.supplier)),now);
  let synced:SyncReport|null=null;
  if(next){
    try { synced=await syncSupplier(next.supplier,pocetak+ROK_MS); }
    catch { synced=failedReport(next.supplier,"Izvor trenutno nije dostupan."); }
    reports.push(synced);
    if(synced.status==="ok"){
      zastareli.delete(next.supplier);
      if(!synced.error&&!synced.publishPending) kasni.delete(next.supplier);
    }
  }
  // Trajni posao obuhvata i nezavrsenu objavu posle promene podesavanja, bez novog feeda.
  const zaObjavu=stanje.filter(s=>s.catalogEnabled&&(pending.has(s.supplier)||configPending.has(s.supplier)||needsPublish(s)))
    .sort((a,b)=>Number(pending.has(b.supplier))-Number(pending.has(a.supplier)));
  for(const s of zaObjavu){
    if(s.supplier===next?.supplier&&synced?.status==="ok") continue;
    if(Date.now()-pocetak>START_OBJAVE_MS) break;
    const t=Date.now(),report:SyncReport={...prazanIzvestaj(s.supplier,"ok"),action:"publish"};
    await objavi(db,s.supplier,report,pocetak+ROK_MS);
    if(!report.error&&!report.publishPending) kasni.delete(s.supplier);
    reports.push({...report,durationMs:Date.now()-t});
    // Samo jedna zaostala objava po pozivu, uz redovne upite prodavnice.
    break;
  }
  return {reports,stale:stale()};
};
/** Rezerva za dnevni Vercel Cron: osvezava omogucene izvore bez uspesnog osvezavanja u poslednjih maxAgeHours, jedan za drugim. */
export const syncStale=async(maxAgeHours=26,now=Date.now()):Promise<SyncReport[]>=>{
  const pocetak=Date.now(),db=getSyncClient();
  const {stanje,pending}=await stanjeIzvora(db);
  const zastareli=new Set(staleSources(stanje.map(s=>({...s,stockMaxAgeHours:maxAgeHours})),now));
  const reports:SyncReport[]=[];
  for(const s of stanje.filter(s=>zastareli.has(s.supplier))){
    if(pending.has(s.supplier)){
      const report:SyncReport={...prazanIzvestaj(s.supplier,"ok"),action:"publish"};
      await objavi(db,s.supplier,report,pocetak+ROK_MS);
      reports.push(report);
      continue;
    }
    if(tooSoon(s.supplier,s.last,now)) continue;
    if(Date.now()-pocetak>START_REZERVE_MS){ reports.push({...prazanIzvestaj(s.supplier,"skipped"),error:"U ovom pozivu nema vremena; osvežava ga satna rotacija."}); continue; }
    try { reports.push(await syncSupplier(s.supplier,pocetak+ROK_MS)); }
    catch { reports.push(failedReport(s.supplier,"Izvor trenutno nije dostupan.")); }
  }
  return reports;
};

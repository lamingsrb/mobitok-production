import { loadCatalogLayout } from "./catalog-layout";
import { resolveCatalogLocation } from "../catalog-layout";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { jeFantech, prodajnaCenaArtikla } from "../pricing";
import { PODRAZUMEVANA_PODESAVANJA, vazecaTabelaMarze } from "./pricing-defaults";
import { bezStarihModelaZaMaske, izvuciUredjajZaArtikal } from "./device-extract";
import { chargerSpecs, chargerSpecValue } from "./charger-attributes";
import { deviceSpecs } from "./device-specs";
import { publicSpecKey } from "../public-specs";
import { isValidSpecValue, SPEC_KEYS, SPEC_LABELS, SPEC_SUBS } from "../catalog-specs";
import { refineStoreCategory } from "./store-category";
import { dozvoljenaAdresa } from "./supplier-image";
import { loadSupplierOverrides, NO_OVERRIDES, originalChanged, origRefreshRow, reconcileOverrides, refreshOriginals, resolveOverride } from "./product-overrides";
export { refineStoreCategory } from "./store-category";

const normalize = (value:string) => (value||"").toLowerCase().replace(/đ/g,"dj").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
// Dobavljaci uz tehniku povremeno nose i artikle koji ne pripadaju ovoj
// prodavnici (hrana, pice, pripejd kartice). Ovde se sklanjaju iz ponude.
// Trajno resenje je pravilo u supplier_category_map sa kategorijom "__skip__";
// ovaj spisak hvata ono sto dobavljac drzi u zajednickoj kategoriji "Razno".
const NIJE_ZA_PRODAVNICU = /\b(aronija|sok od|pekmez|med prirodn|rakij|vino\b|kafa\b)/i;
// Kategorija u mapiranju koja znaci "ne objavljuj".
const PRESKOCI = "__skip__";
// Kolicina koja se upisuje kad dobavljac potvrdjuje dostupnost ali ne salje broj.
const DOSTUPNO_BEZ_BROJA=5;
// Prodavnica radi u pravoj prodaji; artikli vise nisu oznaceni kao probni.
const DEMO_ARTIKLI=false;
// Klijent je 22.09.2026. trazio jedan naziv za zastitu telefona: "maska".
// Dobavljaci pisu i "torbica" i "futrola", pa se to menja u imenu i opisu koje
// kupac vidi. Adresa artikla ostaje ista, a pretraga i dalje nalazi stare reci
// jer search_synonyms "futrola" i "torbica" siri i na "maska".
const uMasku=(tekst:string)=>tekst.replace(/\b(torbic|futrol|furtol)(a|e|u|i|om|ama)\b/gi,(rec:string,_koren:string,nastavak:string)=>{
  const nova="mask"+nastavak.toLowerCase();
  if(rec===rec.toUpperCase())return nova.toUpperCase();
  return rec[0]===rec[0].toUpperCase()?nova[0].toUpperCase()+nova.slice(1):nova;
});
// Isto pravilo vazi i za maske za tablete, posebnu podgrupu od 20.10.2026.
const PODGRUPE_MASKI=new Set(["maske","maske-tableti"]);
// Nazivi dolaze od dobavljaca i ostaju kakvi jesu; ovde se sredjuju samo razmaci i interpunkcija
// ("( bez", " ,", ",,", dupli razmaci). Velika slova, dijakritici i "/" se ne diraju, a adresa
// artikla se racuna iz izvornog naziva, pa se ne menja.
export const urediNaziv=(tekst:string)=>tekst.replace(/\s+/g," ").trim().replace(/([(\[]) /g,"$1").replace(/ ([)\]])/g,"$1").replace(/ +([,;])(?=\p{L})/gu,"$1 ").replace(/ +([,;])/g,"$1").replace(/,{2,}/g,",");
// 3G salje opis kao HTML: pasusi su u <br /> i <p>, a slova kao &scaron;.
// Kupac vidi obican tekst, sa pasusima u novim redovima.
const ZNAKOVI:Record<string,string>={nbsp:" ",amp:"&",lt:"<",gt:">",quot:"\"",apos:"'",scaron:"š",Scaron:"Š",ccaron:"č",Ccaron:"Č",cacute:"ć",Cacute:"Ć",zcaron:"ž",Zcaron:"Ž",dstrok:"đ",Dstrok:"Đ",plusmn:"±",ndash:"–",mdash:"—",deg:"°",times:"×",hellip:"…",lsquo:"‘",rsquo:"’",ldquo:"“",rdquo:"”",bdquo:"„",laquo:"«",raquo:"»",euro:"€",copy:"©",reg:"®",trade:"™",micro:"µ",middot:"·",bull:"•",sup2:"²",sup3:"³",frac12:"½",frac14:"¼",frac34:"¾",Omega:"Ω",ohm:"Ω",asymp:"≈",le:"≤",ge:"≥",shy:"",emsp:" ",ensp:" ",thinsp:" ",zwj:"",zwnj:"",mu:"μ",Phi:"Φ",phi:"φ",Oslash:"Ø",oslash:"ø",rarr:"→",larr:"←",radic:"√",ordm:"º",ordf:"ª",acute:"´",eacute:"é",egrave:"è",Uuml:"Ü",uuml:"ü",Ouml:"Ö",ouml:"ö",Auml:"Ä",auml:"ä",sup1:"¹",prime:"′",Prime:"″",eth:"ð",aelig:"æ",infin:"∞",ne:"≠",minus:"−",alpha:"α",beta:"β",Delta:"Δ",lambda:"λ"};
const ocistiOpis=(html:string)=>html
  .replace(/<\s*(br|\/p|\/li|\/div|\/h[1-6]|\/tr)\b[^>]*>/gi,"\n")
  .replace(/<[^>]*>/g," ")
  .replace(/&amp;(?=#?[a-z0-9]+;)/gi,"&")
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi,(ceo:string,kod:string)=>{
    if(kod[0]!=="#")return ZNAKOVI[kod]??ceo;
    const broj=kod[1]==="x"||kod[1]==="X"?parseInt(kod.slice(2),16):Number(kod.slice(1));
    return broj>0&&broj<0x110000?String.fromCodePoint(broj):ceo;
  })
  .replace(/[ \t\u00a0]+/g," ")
  .replace(/ *\n */g,"\n")
  .replace(/\n{3,}/g,"\n\n")
  .trim();
// 3G uz artikal salje do 17 fotografija; galerija ih prikazuje najvise ovoliko.
const NAJVISE_SLIKA=12;
const categoryByType:Record<string,[string,string]>={MASKA:["mobilni","maske"],STAKLO:["mobilni","stakla"],PUNJAC:["mobilni","punjaci"],KABL:["mobilni","kablovi"],BATERIJA:["mobilni","baterije"],"EKSTERNA BATERIJA":["mobilni","baterije"],DRZAC:["mobilni","drzaci"],"PAMETNI SAT":["mobilni","satovi"],TELEFONIJA:["mobilni","telefoni"],SLUSALICE:["audio","slusalice"],ZVUCNIK:["audio","zvucnici"],TASTATURA:["racunari","tastature"],MIS:["racunari","misevi"],MEMORIJA:["racunari","memorije"],TORBA:["racunari","oprema"],ALAT:["alati","alati"]};
// Uredjaj sa dodatkom u pakovanju ("tablet + maska") nije dodatak: oznaka vrste iz naziva bi ga
// u pretrazi svrstala medju maske, punjace i kablove (pregled 18.10.2026).
const UREDJAJI=new Set(["telefoni","tableti","pametni-satovi","deciji-satovi","mikrofoni"]);
const VRSTE_UREDJAJA=new Set(["TELEFONIJA","PAMETNI SAT"]);
// Recnik pretrage zivi od imena aktivnih artikala, pa se osvezava kad se katalog promeni.
// Neuspeh ovde ne sme da obori objavu: pretraga do sledece promene radi sa starim recnikom.
const osveziRecnik=async(db:SupabaseClient)=>{
  const {error}=await db.rpc("refresh_search_vocabulary");
  if(error)console.error("Recnik pretrage nije osvezen",error);
};

// Admin 03.11: overrides je samo informativno i postoji samo kada objava ima posla sa rucnim izmenama osoblja.
export type CatalogPublication={published:number;changed?:number;deactivated?:number;reason?:string;errorCode?:string;overrides?:{applied:number;reconciled:number;refreshed:number}};
type PublicationState={id:string;phase:string;stage_after:string|null;staged:number;processed:number;changed:number;deactivated:number;done?:boolean;published?:number};
type PublicationOptions={deadline?:number;pauseMs?:number;skipUnchanged?:boolean};
const publicationPause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const sqlError=(error:unknown)=>typeof error==="object"&&error!==null&&"code" in error&&typeof error.code==="string"&&/^[0-9A-Z]{5}$/.test(error.code);
// Admin 03.11: reconcile posle objave hvata izmenu osoblja upisanu dok objava radi. Rezerva pokriva izmenu
// cija je transakcija pocela pre citanja mape i razliku satova; nastavljen posao proverava sve izmene.
const RECONCILE_MARGIN_MS=10*60_000;
// Najvise 2.000 osvezenih originala po pozivu (K9); ostatak hvata sledeca rotacija.
const REFRESH_LIMIT=2000;
/** Publish only a verified source. Purchase costs and source payload never enter public products. */
export async function publishSupplierCatalog(db:SupabaseClient,supplier:string,options:PublicationOptions={}):Promise<CatalogPublication>{
  const deadline=options.deadline??Date.now()+210_000,pauseMs=options.pauseMs??250;
  const [sourceResult,settingsResult,mapResult]=await Promise.all([
    db.from("supplier_sources").select("*").eq("supplier",supplier).single(),
    db.from("shop_settings").select("*").eq("id",true).single(),
    db.from("supplier_category_map").select("*").order("priority",{ascending:false}),
  ]);
  if(sourceResult.error||settingsResult.error||mapResult.error) throw new Error("Catalog configuration unavailable");
  // Tabela marze iz baze; ako je nekim slucajem neispravna, vazi podrazumevana.
  const source=sourceResult.data,settings={...PODRAZUMEVANA_PODESAVANJA,...settingsResult.data,margin_tiers:vazecaTabelaMarze(settingsResult.data.margin_tiers)};
  const enabled=source.enabled&&source.catalog_enabled&&settings.publish_supplier_catalog&&source.price_currency==="RSD"&&source.price_includes_vat!==null&&(supplier!=="trig"||["Price","ClientPrice"].includes(source.price_field));
  // Javni upiti vec proveravaju zastavice izvora; iskljucivanje ne prepisuje ceo products.
  if(!enabled)return {published:0,deactivated:0,reason:"configuration"};
  if(Date.now()+5000>=deadline)return {published:0,reason:"in_progress"};
  const {data:run,error:runError}=await db.from("supplier_sync_runs").select("id,started_at,status").eq("supplier",supplier).eq("status","ok").order("started_at",{ascending:false}).limit(1).maybeSingle();
  if(runError||!run||(source.price_basis_updated_at&&new Date(run.started_at)<new Date(source.price_basis_updated_at))) return {published:0,reason:"sync_required"};
  // Optional CLI optimization only. Code-only mapping changes require a fresh
  // publication, so normal callers never infer freshness from feed timestamps.
  if(options.skipUnchanged){
    const {data:previous,error}=await db.from("catalog_publication_runs")
      .select("status,phase,source_updated_at,settings_updated_at,sync_run_id,finished_at")
      .eq("supplier",supplier).order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(error)throw error;
    const sameTime=(a:string|null,b:string|null)=>!!a&&!!b&&Date.parse(a)===Date.parse(b);
    if(previous?.status==="ok"&&previous.phase==="done"&&previous.sync_run_id===run.id
      &&sameTime(previous.source_updated_at,source.updated_at)
      &&sameTime(previous.settings_updated_at,settings.updated_at)
      &&source.catalog_published_at&&previous.finished_at
      &&Date.parse(source.catalog_published_at)>=Date.parse(run.started_at)){
      return {published:0,changed:0,deactivated:0,reason:"current"};
    }
  }
  const owner=randomUUID();
  let state:PublicationState|null=null;
  let publicationId:string|null=null;
  // Admin 03.11: poslednji vraceni rezultat; finally mu dopisuje overrides.
  let last=null as CatalogPublication|null;
  const summary=(reason?:string,errorCode?:string):CatalogPublication=>(last={published:reason?0:state?.staged??0,changed:state?.changed??0,deactivated:state?.deactivated??0,...(reason?{reason}:{}),...(errorCode?{errorCode}:{})});
  // Posle nepoznatog HTTP ishoda zakup ostaje do isteka: upis mozda jos radi.
  const releasePublication=async(failed=false)=>{
    if(!publicationId)return;
    // Database time owns the lease. A caller clock ahead of Postgres must not
    // keep the next worker blocked after this worker has yielded.
    try{
      const {error}=await db.rpc("release_catalog_publication",{p_id:publicationId,p_owner:owner,p_failed:failed});
      if(error)console.warn("Zakup objave nije oslobodjen; nastavak ceka njegov istek",sqlError(error)?(error as {code:string}).code:"transport");
    }catch{
      console.warn("Zakup objave nije oslobodjen; nastavak ceka njegov istek","transport");
    }
  };
  const yieldPublication=async(reason:string,errorCode?:string)=>{
    await releasePublication();
    return summary(reason,errorCode);
  };
  const publicationTime=new Date().toISOString();
  const naNeto=(iznos:number)=>source.price_includes_vat?iznos/(1+Number(settings.vat_percent)/100):iznos;
  // Admin 03.11: rucne izmene osoblja. startedAt se belezi pre citanja mape (ulaz za reconcile u finally).
  const startedAt=Date.now(),overrideStats={applied:0,reconciled:0,refreshed:0},refreshRows:Array<Record<string,string|null>>=[];
  let overrides=NO_OVERRIDES,since=new Date(startedAt-RECONCILE_MARGIN_MS),busy=false;
  try {
  const {data:begun,error:beginError}=await db.rpc("begin_catalog_publication",{p_supplier:supplier,p_source_updated_at:source.updated_at,p_settings_updated_at:settings.updated_at,p_sync_run_id:run.id,p_owner:owner});
  if(beginError)throw beginError;
  state=begun as PublicationState;
  publicationId=state.id;
  // Admin 03.11 (A1): mapa se cita jednom po pozivu, POSLE zakupa: run u fazi staging vec postoji, pa baza odbija uklanjanje
  // override-a (PUBLICATION_RUNNING) i mapa ostaje tacna do kraja poziva. Greska citanja (osim "nema tabele") ide kroz catch:
  // bez mape bi objava vratila stare nazive i obrisane artikle.
  overrides=await loadSupplierOverrides(db,supplier);
  // Structural moves cannot run while this durable publication exists. Read placement after begin.
  const layout=await loadCatalogLayout(db);
  // Admin 03.11: nastavljen posao ima redove stage-ovane ranijom mapom, pa reconcile proverava sve izmene dobavljaca.
  if(state.phase!=="staging"||state.stage_after!==null||state.staged>0)since=new Date(0);
  while(state.phase==="staging"){
    if(Date.now()+5000>=deadline)return await yieldPublication("in_progress");
    let query=db.from("supplier_products").select("supplier_sku,name,barcode,brand,price_excl_vat,stock,stock_status,image_url,supplier_category,product_type,source_payload").eq("supplier",supplier).eq("available",true).neq("stock_status","unavailable").order("supplier_sku").range(0,249);
    if(state.stage_after!==null)query=query.gt("supplier_sku",state.stage_after);
    const {data,error}=await query;
    if(error)throw error;
    const rows=(data??[]).flatMap(item=>{
      if(!item.image_url)return [];
      // 3G ne salje broj komada, samo da li artikal ima. Da ne bi cela ponuda
      // izgledala rasprodato, potvrdjena dostupnost dobija istu gornju granicu
      // kakvu i BTM salje za "5 ili vise". Tacan lager se i dalje ne tvrdi.
      const onHand=Number.isFinite(Number(item.stock))&&item.stock!==null
        ?Math.max(0,Math.trunc(Number(item.stock)))
        :item.stock_status==="available"?DOSTUPNO_BEZ_BROJA:0;
      if(!onHand)return [];
      // Cena po tabeli marze. Fantech ide po 3G cenovniku bez rabata (Price),
      // a ne po nasoj nabavnoj ceni (feedback 05.10.2026).
      const price=prodajnaCenaArtikla({nabavnaNeto:naNeto(Number(item.price_excl_vat)),cenovnikNeto:supplier==="trig"?naNeto(Number(item.source_payload?.Price)):null,fantech:jeFantech(item.name,item.brand,item.supplier_category)},settings);
      if(!price)return [];
      const categoryPath=normalize(item.supplier_category);
      const match=mapResult.data.find(m=>categoryPath.includes(normalize(m.segment)));
      if(match?.shop_category===PRESKOCI)return [];
      if(NIJE_ZA_PRODAVNICU.test(item.name))return [];
      const [mappedCategory,mappedSubcategory]=match?[match.shop_category,match.shop_subcategory]:categoryByType[item.product_type]??["mobilni","razno"];
      const [category,subcategory]=refineStoreCategory(mappedCategory,mappedSubcategory,item.name,item.brand||"",item.supplier_category||"",item.product_type||"");
      if(category===PRESKOCI)return [];
      const base=normalize(item.name).replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60).replace(/-+$/,"");
      // Marka i modeli uredjaja za plocice u prodavnici: maske, stakla, stakla za kamere,
      // baterije telefona (marka+model) i delovi za laptopove (samo marka). Pravilo bira doradjena podkategorija.
      // Maske samo za stare iPhone i Samsung modele se ne objavljuju (feedback 02.11.2026).
      const uredjaj=bezStarihModelaZaMaske(subcategory,izvuciUredjajZaArtikal({name:item.name,brand:item.brand,subcategory,productType:item.product_type}));
      if(!uredjaj)return [];
      // Admin 03.11: rucna izmena osoblja menja samo prikazana polja (naziv, opis, grupa, podgrupa). Original je ono
      // sto bi objava upisala bez nje. Slug, uredjaji i svojstva idu iz naziva dobavljaca i podgrupe prikaza (K16).
      const id=`${supplier}-${item.supplier_sku}`;
      const opis=["trig","msmobile","dv"].includes(supplier)?ocistiOpis(String(item.source_payload?.Description||item.source_payload?.opis||"")).slice(0,4000):"";
      const original={name:urediNaziv(PODGRUPE_MASKI.has(subcategory)?uMasku(item.name):item.name),description:PODGRUPE_MASKI.has(subcategory)?uMasku(opis):opis,category,subcategory};
      const izmena=overrides.get(id);
      const resolved=resolveOverride(original,izmena);
      if(!resolved){overrideStats.applied++;return [];}
      const [canonicalCategory,canonicalSubcategory]=resolveCatalogLocation(layout,resolved.category,resolved.subcategory??"");
      const prikaz={...resolved,category:canonicalCategory,subcategory:canonicalSubcategory};
      const podgrupa=prikaz.subcategory;
      let {deviceBrand,devices}=uredjaj;
      if(podgrupa!==subcategory){
        // Premesten artikal: uredjaji po pravilu podgrupe prikaza. Maska samo za stare iPhone/Samsung modele ostaje gde ju je
        // osoblje premestilo, bez tih modela.
        const premesten=izvuciUredjajZaArtikal({name:item.name,brand:item.brand,subcategory:podgrupa,productType:item.product_type});
        ({deviceBrand,devices}=bezStarihModelaZaMaske(podgrupa,premesten)??{...premesten,devices:[]});
      }
      const specs:Record<string,string>={Brend:item.brand||"—","Šifra":item.supplier_sku};
      if(item.barcode)specs.Barkod=item.barcode;
      if(supplier==="trig"&&Array.isArray(item.source_payload?.Attributes)){
        for(const attribute of item.source_payload.Attributes){
          if(attribute.AttributeName&&attribute.AttributeValue&&publicSpecKey(String(attribute.AttributeName))&&Object.keys(specs).length<18)specs[String(attribute.AttributeName).slice(0,80)]=String(attribute.AttributeValue).slice(0,200);
        }
      }
      // Tableti i telefoni: ekran, RAM, memorija, baterija, veze i pakovanje samo kad ih naziv jasno navodi.
      // Podatak dobavljaca ima prednost (isti kljuc bez obzira na velika slova i razmake); ovi kljucevi ne
      // ulaze u ogranicenje od 18 jer ih ima najvise sedam i dolaze iz naziva, ne iz liste atributa.
      const imaKljuc=new Set(Object.keys(specs).map(k=>k.trim().toLowerCase()));
      for(const [kljuc,vrednost] of Object.entries(deviceSpecs(item.name,podgrupa)))if(!imaKljuc.has(kljuc.trim().toLowerCase()))specs[kljuc]=vrednost;
      // Svojstva za filtere u bocnoj traci (Snaga/Napon/Struja/Konektor) u podkategorijama koje
      // ih prikazuju (SPEC_SUBS). Ime atributa dobavljaca se svodi na nase ("SNAGA", "Snaga "
      // -> "Snaga"), da filter ne dobije dva kljuca za isto. Vrednost dobavljaca ima prednost
      // samo ako prolazi pravilo adrese (isValidSpecValue: inace bi klik na nju bio 400; npr.
      // "5.5*2.5" ne prolazi) i ima oblik vrednosti iz naziva; inace vazi vrednost iz naziva
      // punjaca, ili nista.
      // Ovih najvise 4 kljuca idu preko ogranicenja od 18 (ono stiti od dugackih lista
      // atributa dobavljaca, a filteri bi bez njih ostali prazni).
      if(SPEC_SUBS.has(podgrupa)){
        const nasKljuc=new Map(SPEC_KEYS.map(k=>[normalize(SPEC_LABELS[k]),SPEC_LABELS[k]]));
        const odDobavljaca:Record<string,string>={};
        for(const [kljuc,vrednost] of Object.entries(specs)){
          const nas=nasKljuc.get(normalize(kljuc).replace(/\s+/g," ").trim());
          if(!nas)continue;
          delete specs[kljuc];
          const tekst=String(vrednost).replace(/\s+/g," ").trim();
          const oblik=isValidSpecValue(tekst)?chargerSpecValue(nas,tekst):null;
          if(oblik&&!(nas in odDobavljaca))odDobavljaca[nas]=oblik;
        }
        const izNaziva:Record<string,string>=podgrupa==="laptop-punjaci"?chargerSpecs(item.name):{};
        for(const k of SPEC_KEYS){
          const vrednost=odDobavljaca[SPEC_LABELS[k]]??izNaziva[SPEC_LABELS[k]];
          if(vrednost)specs[SPEC_LABELS[k]]=vrednost;
        }
      }
      // 3G (cuvanje u Storage) i MS Mobile (samo http, pa bi pregledac blokirao sliku na https stranici)
      // idu kroz nasu rutu. Digital Vision i BTM salju https slike koje se prikazuju direktno.
      const proksi=supplier==="trig"||supplier==="msmobile";
      // Isti spisak adresa koristi i image ruta, pa broj objavljenih slika ne moze da pretekne broj dostupnih.
      const imaProveru=supplier==="msmobile"||supplier==="dv";
      // Prva fotografija je image_url (prva https adresa iz ImagePaths). Ostale idu
      // kroz /[n], koja ih, kao i prvu, cuva u nasem Storage-u pri prvom otvaranju.
      const kljucSlika=supplier==="trig"?"ImagePaths":supplier==="msmobile"?"Images":supplier==="dv"?"slike":"";
      const putanje:unknown[]=kljucSlika&&Array.isArray(item.source_payload?.[kljucSlika])?item.source_payload[kljucSlika]:[];
      const adrese=Array.from(new Set(putanje.filter((adresa):adresa is string=>typeof adresa==="string"&&(imaProveru?dozvoljenaAdresa(adresa,supplier)!==null:/^https:\/\//.test(adresa)))));
      // MS Mobile i Digital Vision: artikal bez ijedne dozvoljene slike se ne objavljuje.
      if(imaProveru&&!adrese.length)return [];
      const image=proksi?`/api/catalog/image/${supplier}/${encodeURIComponent(item.supplier_sku)}`:supplier==="dv"?adrese[0]:item.image_url;
      const images=supplier==="dv"&&adrese.length
        ?adrese.slice(0,NAJVISE_SLIKA)
        :[image,...Array.from({length:proksi?Math.max(0,Math.min(adrese.length,NAJVISE_SLIKA)-1):0},(_,n)=>`/api/catalog/image/${supplier}/${encodeURIComponent(item.supplier_sku)}/${n+1}`)];
      if(izmena){
        overrideStats.applied++;
        // Admin 03.11: snimak originala se osvezava samo kad se dobavljacev original promenio (K9).
        if(refreshRows.length<REFRESH_LIMIT&&originalChanged(izmena.orig,original))refreshRows.push(origRefreshRow(id,original));
      }
      return [{id,supplier,supplier_sku:item.supplier_sku,
        slug:`${base||"artikal"}-${supplier==="btm"?"":`${supplier}-`}${item.supplier_sku}`,
        name:prikaz.name,category:prikaz.category,subcategory:podgrupa,brand:item.brand||"",device_brand:deviceBrand,devices,price,
        image,images,description:prikaz.description,
        specs,stock:onHand,is_demo:DEMO_ARTIKLI,tags:item.product_type&&(!UREDJAJI.has(podgrupa)||VRSTE_UREDJAJA.has(item.product_type))?[item.product_type]:[],active:true,updated_at:publicationTime}];
    });
    const after=data?.length?data[data.length-1].supplier_sku:state.stage_after;
    const {data:staged,error:writeError}=await db.rpc("stage_catalog_publication",{p_id:publicationId,p_owner:owner,p_rows:rows,p_after:after,p_complete:!data||data.length<250});
    if(writeError)throw writeError;
    state=staged as PublicationState;
    if(pauseMs>0)await publicationPause(pauseMs);
  }
  while(!state.done){
    if(Date.now()+5000>=deadline)return await yieldPublication("in_progress");
    const {data:result,error}=await db.rpc("apply_catalog_publication_batch",{p_id:publicationId,p_owner:owner,p_limit:100});
    if(error)throw error;
    state={...state,...result} as PublicationState;
    if(!state.done&&pauseMs>0)await publicationPause(pauseMs);
  }
  // Recnik se osvezava jednom po celoj objavi, nikada po paketu.
  if(state.changed!==0||state.deactivated!==0)await osveziRecnik(db);
  return summary();
  }catch(error){
    const message=typeof error==="object"&&error!==null&&"message" in error?String(error.message):"";
    if(message.includes("PUBLICATION_BUSY")||message.includes("PUBLICATION_LEASE_LOST")){busy=true;return summary("busy");}
    if(message.includes("PUBLICATION_CAPACITY"))return await yieldPublication("capacity");
    const code=sqlError(error)?(error as {code:string}).code:"";
    if(["57014","55P03","40001","40P01"].includes(code)){
      // Ovaj RPC je vracen, a ranije potvrdjeni paketi ostaju na trajnom kursoru.
      console.warn("Objava kataloga odložena zbog prolazne greške baze",code);
      return await yieldPublication("in_progress",code);
    }
    if(publicationId){
      const {data:completed}=await db.from("catalog_publication_runs").select("status,staged,changed,deactivated").eq("id",publicationId).maybeSingle();
      if(completed?.status==="ok"){
        state={...state!,...completed};
        await osveziRecnik(db);
        return summary();
      }
      if(!sqlError(error)){
        // Prekid transporta ne dokazuje rollback. Nastavlja se isti posao.
        return summary("in_progress");
      }
      await releasePublication(true);
    }
    throw error;
  }finally{
    // Admin 03.11: reconcile ponovo primenjuje rucne izmene koje je objava pregazila (izmena tokom objave).
    // Ide na svakom izlazu osim "busy": tada posao vodi drugi radnik i on ga radi na svom kraju. Ne baca.
    if(!busy){
      // Admin 03.11 (B1): snimak originala se osvezava na svakom izlazu (i kad se objava nastavlja u sledecem pozivu); ne baca.
      if(refreshRows.length)overrideStats.refreshed=await refreshOriginals(db,supplier,refreshRows);
      overrideStats.reconciled=await reconcileOverrides(db,supplier,since);
      // Vraceni objekat je isti onaj koji je summary napravio; finally mu samo dopisuje brojeve.
      if(last&&(overrides.size||overrideStats.reconciled||overrideStats.refreshed))last.overrides={...overrideStats};
    }
  }
}

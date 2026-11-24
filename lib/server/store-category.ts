type StoreCategory = [category: string, subcategory: string];

export const SKIP_STORE_CATEGORY = "__skip__";

const normalize = (value: string) => (value || "").toLowerCase().replace(/đ/g, "dj")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

const RANAC = /\b(?:ranac|ranc(?:a|u|em|i|evi|eva|evima|eve|ev)|back[ -]?packs?|rucksacks?)\b/;
const TORBA_ZA_LAPTOP = /\b(?:torba|torbe|torbica|sleeve|laptop bags?)\b|^cover za (?:macbook|laptop)/;
const KOMBINOVANE_TORBE_I_RANCEVI = /torbe futrole rancevi|rancevi torbe i coveri|torbe i rancevi|rancevi i torbe/;

function prenosnaOpremaZaLaptop(title: string, path: string, subcategory: string): StoreCategory | null {
  if (RANAC.test(title)) return ["laptop", "rancevi"];
  if (TORBA_ZA_LAPTOP.test(title)) return ["laptop", "torbe"];
  const leaf = path.split(/[/>]/).at(-1) ?? "";
  if (subcategory === "rancevi" || (RANAC.test(leaf) && !/torb|futrol|cover|sleeve|\bbags?\b/.test(leaf))) return ["laptop", "rancevi"];
  if (subcategory === "torbe" || KOMBINOVANE_TORBE_I_RANCEVI.test(path)) return ["laptop", "torbe"];
  return null;
}

// Feedback 27.10: releji iz industrijske automatizacije se ne objavljuju u prodavnici.
const JE_RELEJ = /\brelej/;
// Feedback 01.11: kalupi i BGA sita (naziv pocinje njima), mold frame, Handsfree Extreme i Video balun
// se ne prikazuju u prodavnici; "sa kalupima", BGA kuglice, pasta i set sablona ostaju.
// Feedback 02.11: vakuumski nosac X-78, Teracell i Samsung G810 handsfree, drzaci za zvucnik BTS08 i BTS04
// i bi fold back up baterija za iPad mini se takodje skidaju sa sajta.
// Feedback 03.11: IBM konektor J083 i konektori za laptop USB-001/005/014, sve sarke (reci "sarke"/"sarka";
// "kosarkaska" ne spada) i Dikex torbice za Airpods se skidaju sa sajta.
const NIJE_ZA_PRODAJU = /^konektor punjenja za laptop ibm \(j083\)|^konektor za laptop usb-0(?:01|05|14)\b|\bsark[ae]\b|^torbica dikex za airpods\b|^kalup\b|^bga sito\b|\bmold frame\b|\bhandsfree extreme\b|\bvideo balun\b|^nosac x-78 vakuumski\b|^handsfree teracell za\b|^handsfree slusalice (?:aaa )?za samsung g810\b|^drzac za zvucnik bts08\b|^stalak za bluetooth zvucnik bts04\b|^back up baterija bi fold za ipad\b/;
// Feedback 02.11: citaci i skeneri barkodova se skidaju sa sajta (ranije su isli u racunare);
// kabl, adapter, drzac ili futrola za njih ostaju gde su bili.
const CITAC_BARKODA = /\b(?:citac|skener|scanner|reader) (?:barkod\w*|bar ?code)\b|\b(?:barkod\w*|bar ?code) (?:citac|skener|scanner|reader)\b/;
const PRIBOR_ZA_CITAC = /^(?:kabl|kabal|kabel|adapter|drzac|nosac|stalak|futrol\w*|torbic\w*)\b/;
// Feedback 27.10: ventilatori su svoja podgrupa kucnih aparata; PC i laptop hladnjaci nisu.
const VENTILATOR_NAZIV = /^(?:[\w-]+ ){0,3}ventilator\w*\b/;
const NIJE_KUCNI_VENTILATOR = /kontroler|konzol|\bps\d|laptop|kucist|\bpc\b|\brgb\b|cpu|hladnj|zaluzin/;
const jeKucniVentilator = (title: string) => VENTILATOR_NAZIV.test(title) && !NIJE_KUCNI_VENTILATOR.test(title);
// Feedback 27.10: stampaci, toneri i papir za termalni stampac dobijaju svoju podgrupu,
// a mini kamera i fotoaparat koji stampaju ostaju kamere (odluka 21.10).
const STAMPAC_NAZIV = /^(?:[\w-]+ ){0,3}(?:stampac\w*|printer\w*|toner\w*)\b|^papir za (?:termalni )?stampac/;
const NIJE_STAMPAC = /\bkabl|\bkabel|\bkabal|kamer|fotoaparat|\bsa stampac|^maska|futrol|torbic|navlak|nalepnic|drzac|nosac|stalak|postolj/;
const jeStampacIliToner = (title: string) => STAMPAC_NAZIV.test(title) && !NIJE_STAMPAC.test(title);
// Feedback 27.10 (druga serija): TV daljinski, TV Box i TV Stick su svoje podgrupe TV i multimedije.
// "Daljinsko upravljanje" i uredjaj koji se dobija sa daljinskim nisu daljinski.
const JE_TV_DALJINSKI = /^(?:[\w-]+ ){0,3}daljinski\b|\bair ?mouse\b.*\bir daljinski\b/;
// Vrsta upravljanog uredjaja ima prednost: RC-80 je alarmni daljinski,
// a Moxom MX-LB11 po opisu dobavljaca upravlja kamerom telefona i video aplikacijama.
const SMART_DALJINSKI = /\bchuango\b|\brc-?80\b|\b433\s?mhz\b|kapij|rolet|garaz|alarm/;
const MOBILNI_DALJINSKI = /\bmx-lb11\b|selfi|za (?:kamer\w* (?:telefon\w*|mobiln\w*)|telefon\w*|mobiln\w*)/;
// Kabl, punjac, futrola i drugi pribor za TV uredjaj ne postaju taj uredjaj.
// Proverava se pocetak naziva, pa "TV Stick sa punjacem" ostaje TV Stick.
const TV_PRIBOR_NAZIV = /^(?:[\w-]+ ){0,2}(?:kabl\w*|kabel\w*|kabal\w*|adapter\w*|punjac\w*|drzac\w*|nosac\w*|stalak|postolj\w*|mask\w*|futrol\w*|torbic\w*|navlak\w*|baterij\w*|napajanj\w*)\b/;
const JE_TV_STICK = /\btv\s?(?:box|stik|stick)\b|\bset top box\b|\bmi\s?box\b|fire\s?tv\s?stick|android (?:smart )?tv (?:game )?box/;
// Feedback 27.10 (druga serija): MP3 i MP4 playeri idu u mobilnu opremu, ne u slusalice i zvucnike.
const MP3_NAZIV = /^(?:[\w-]+ ){0,2}mp\s?[34]\b/;
const NIJE_MP3 = /\bkabl|\bkabel|\bkabal|drzac|nosac|stalak|postolj|maska|futrol|torbic|navlak|slusalic|zvucni[kc]|adapter|punjac|modulator|transmit|set top/;
const jeMp3Player = (title: string) => MP3_NAZIV.test(title) && /player|plejer/.test(title) && !NIJE_MP3.test(title);
// Feedback 27.10 (druga serija): navigacija i auto kamera izlaze iz opste auto opreme, a punjac,
// drzac i maska za navigaciju ostaju tamo gde su, kao i stitnik i drzac za retrovizor.
const jeNavigacija = (title: string) => /^(?:[\w-]+ ){0,2}navigacij/.test(title)
  && !/punjac|\bkabl|\bkabel|\bkabal|drzac|nosac|stalak|maska|futrol|torbic|navlak/.test(title);
const jeAutoKamera = (title: string) => /\bauto kamer|kamer\w* za (?:auto|vozil)|dash\s?cam/.test(title)
  && !/retrovizor|zastit|\bdrzac|\bnosac|stalak|maska|futrol|kabl/.test(title);
// Feedback 27.10 (druga serija): preciscivaci, difuzeri i filteri za preciscivace su svoja podgrupa.
// Feedback 01.11: ovlazivaci vazduha i Xiaomi filteri vazduha idu uz njih; auto sprej za aromaterapiju ostaje gde je.
const jePreciscivac = (title: string) => /precisciva|preciscavanj|difuzer|\bpurifier\b|ovlazivac|humidifier|^filter vazduha xiaomi/.test(title)
  && !/sprej|za vozil/.test(title);
// Feedback 01.11: fen, brijac, trimer, epilator, ogledalo i elektricna cetkica za zube su Nega i lepota.
const NEGA_NAZIV = /^(?:[\w-]+ ){0,4}(?:fen|brijac\w*|trimer\w*|epilator\w*)\b|^(?:[\w-]+ ){0,2}ogledal\w*\b|aparat za brijanje|masinic\w* za sisanj|cetkic\w* za zube/;
// Feedback 27.10 (druga serija): alkalne, litijumske, dugmaste i punjive celije i punjaci za njih
// idu u kucne aparate. Format u nazivu (AA, LR03, CR2032, 18650) je dokaz da je rec o celiji, a ne
// o bateriji za uredjaj; baterije za telefone i laptopove vracaju se pre ovog pravila.
const CELIJA_FORMAT = /\balkaln|alkaline|dugmast|srebro oksid|silver oxide|eneloop|zinc|ni-?mh|litijum|lithium|\b(?:lr|hr|cr|sr|pr|ag)\s?\d{2,4}\b|\bmn\s?\d{2}\b|\bv\d{2}\s?ga?\b|\b(?:11a|23ae?|27a)\b|\b(?:aa|aaa)\b|\b9v\b|\b(?:3lr12|6lr61)\b|\b(?:14500|16340|18650|21700|26650|32700)\b|za slusni aparat/;
const NIJE_KUCNA_BATERIJA = /za (?:telefon|mobiln|laptop|notebook|macbook|tablet|sat|satove|kamer|dron|trotinet|bicikl)|iphone|power\s?bank|\bulozak\b|lamp|\bsat\b|\bps[345]\b|dzojstik|kontroler|slusalic|airpods|usisivac|kompresor|\bfen\b|lemilic|duvaljk/;
const jeKucnaBaterija = (title: string) => !NIJE_KUCNA_BATERIJA.test(title)
  && ((/\bbaterij/.test(title) && CELIJA_FORMAT.test(title))
    || /punjac\b.*\bbaterij|eneloop punjac|^(?:[\w-]+ ){0,2}punjac\b.*\b(?:aa|aaa)\b/.test(title));
// Feedback 27.10 (druga serija): servisni alat se deli na lemilice i duvaljke, mikroskope sa
// kamerama, separatore i pincete sa srafcigerima. Privezak sa srafcigerom i lampa nisu alat,
// a plasticni separator za postolja je industrijski deo.
const NIJE_PINCETA = /privezak|lamp|otvarac|kljuc za/;
const servisnaPodgrupa = (title: string, path = ""): string | null => {
  // Feedback 01.11: elektricna pinceta i vrh za nju idu uz lemilice i duvaljke.
  if (/lemilic|duvaljk|rework|elektricn\w* pincet/.test(title)) return "lemilice";
  // Servisne kamere bez reci "mikroskop" dokazuje namenski put dobavljaca.
  if (/mikroskop/.test(title) || (/mikroskopi i kamere/.test(path) && /kamer|endoskop/.test(title))) return "mikroskopi";
  // Feedback 01.11: ultrazvucne kade idu uz separatore.
  if ((/separator/.test(title) && !/postolj/.test(title)) || /ultrazvucn\w* kad/.test(title)) return "separatori";
  if (/pincet|srafcig|odvijac|screwdriver/.test(title) && !NIJE_PINCETA.test(title)) return "pincete-srafcigeri";
  return null;
};

// Konzole i oprema: PS generaciju dokazuje naziv ("PS4", "DualSense"), a put dobavljaca
// ("Oprema za Play Station 5", "Dzojstici za Play Station 4") samo kad je naziv ne navodi.
// Bez dokaza za PS4/PS5 artikal ostaje u gejmingu: radije nista nego pogresno.
type KonzolePodgrupa = "konzole-uredjaji" | "dzojstici-ps4" | "dzojstici-ps5" | "oprema-ps4" | "oprema-ps5";

// Generacije navedene u nazivu: "PS4", "PS 3", "PlayStation 5", "PS5/PS4", "DualShock 4", "DualSense".
function psGeneracije(title: string): Set<string> {
  const generacije = new Set<string>();
  for (const m of title.matchAll(/\b(?:ps|play\s?station)\s?([1-5])\b/g)) generacije.add(m[1]);
  if (/\bdual\s?shock\s?4\b/.test(title)) generacije.add("4");
  if (/\bdual\s?sense\b/.test(title)) generacije.add("5");
  return generacije;
}

// Druga platforma u istom nazivu znaci da artikal nije samo za PS4/PS5.
const DRUGA_PLATFORMA = /\b(xbox|nintendo|nitendo|wii|switch|pc|windows|android|ios|iphone|multiplatform|steam|sega|psp|vita)\b|\bsup\s?\d{3}\b/;
// Dodaci, a ne sam dzojstik ili konzola.
const DODATAK_KONZOLE = /\b(punjac\w*|punjenj\w*|charging|stalak\w*|cooler|cooling|kuler\w*|hub|kabl\w*|kabel\w*|kabal\w*|baterij\w*|power\s?bank|adapter\w*|set|dock\w*|navlak\w*|maska|torb\w*|futrol\w*|grip\w*|griptape|delov\w*|kontroler tastatura|zvucna karta|kombo|combo|poklopac|zastit\w*|silikon\w*|drzac|nosac|postolj\w*|ventilator|hladnjak|polic\w*|ukras\w*|stiker\w*|nalepnic\w*|kapic\w*|analog\w*)\b/;
const DZOJSTIK_NAZIV = /^(?:[\w-]+ ){0,3}(?:joypad|gamepad|game\s?pad|dzojstik\w*|joystick|kontroler\w*|controller)\b/;
const POWER_BANK = /power\s?bank|\bmah\b/;
const KONZOLE_PUT = /(?:oprema|dzojstici) za play\s?station|joypad|video igre|zakucana grupa konzole|oprema za konzole/;
const KONZOLA_UREDJAJ = /^(?:[\w-]+ ){0,2}konzol[ae]\b/;
// "Konzola" je i zidni nosac, pa van gejming puta naziv mora reci da je za igru.
const KONZOLA_ZA_IGRU = /za igr|igric|\bgame\b|handheld|retro|gameboy|\bpsp\b/;

// Podgrupa konzola; "gejming" kad artikal pripada gejmingu a dobavljac ga drzi drugde; inace null.
function konzolaPodgrupa(title: string, path: string, category: string, subcategory: string): KonzolePodgrupa | "gejming" | null {
  const konzolePut = KONZOLE_PUT.test(path);
  const gaming = category === "gejming" || konzolePut || /gaming oprema/.test(path) || /fantech/.test(`${title} ${path}`);
  const dodatak = DODATAK_KONZOLE.test(title);
  // "Konzola za igranje+power bank ..." je power bank i ide uz ostale powerbankove.
  if (KONZOLA_UREDJAJ.test(title) && !dodatak && !POWER_BANK.test(title) && (gaming || KONZOLA_ZA_IGRU.test(title))) return "konzole-uredjaji";
  const generacije = psGeneracije(title);
  // Bez gejming puta naziv mora navesti PS4/PS5; maska ili staklo sa PS dezenom ostaje gde jeste.
  if (!gaming && ((!generacije.has("4") && !generacije.has("5"))
    || (category === "mobilni" && ["maske", "stakla", "stakla-kamere"].includes(subcategory)))) return null;
  const put = path.match(/(dzojstici|oprema) za play\s?station\s?([1-5])/);
  if (put && !generacije.size) generacije.add(put[2]);
  const ps5 = generacije.has("5"), ps = ps5 || generacije.has("4");
  const dzojstik = !dodatak && (DZOJSTIK_NAZIV.test(title) || put?.[1] === "dzojstici");
  const uGejming = category !== "gejming" && (konzolePut || (DZOJSTIK_NAZIV.test(title) && gaming)) ? "gejming" : null;
  if (!ps || [...generacije].some((g) => g !== "3" && g !== "4" && g !== "5")) return uGejming;
  // Put "Oprema za Play Station 5" ostaje dokaz i kad naziv pominje PC ili telefon (docking, drzac).
  if (!put && DRUGA_PLATFORMA.test(title)) return uGejming;
  if (dzojstik) return generacije.has("3") ? uGejming : ps5 ? "dzojstici-ps5" : "dzojstici-ps4";
  if (dodatak || put) return ps5 ? "oprema-ps5" : "oprema-ps4";
  return uGejming;
}

// Samostalan mikrofon: imenica mikrofon/microphone/mic mora biti medju prvih pet reci naziva
// ("JBL PBM 100 mikrofon", "JBL PartyBox Wireless mikrofon", "Bezicni lavalier mikrofon").
// Dodaci i uredjaji koji mikrofon samo imaju ili za njega sluze ostaju gde jesu.
const NIJE_MIKROFON = /\b(?:za mikrofon\w*|sa mikrofon\w*|with (?:a )?(?:microphone|mic)|stalak\w*|drzac\w*|nosac\w*|kabl\w*|kabal\w*|kabel\w*|adapter\w*|splitter\w*|pop filter|sundjer\w*|slusalic\w*|headset\w*|headphone\w*|earbud\w*|kamer\w*|webcam|zvucnik\w*|speaker\w*|karaoke|tripod\w*|prijemnik\w*|receiver\w*|sound ?card|zvucna karta|interface)\b/;
function jeMikrofon(title: string): boolean {
  if (NIJE_MIKROFON.test(title)) return false;
  return title.split(/[^a-z0-9]+/).filter(Boolean).slice(0, 5).some((rec) => /^(?:mikrofon|mikrofoni|microfon|microphone|mic)$/.test(rec));
}

// Tablet mora biti u nazivu; put "telefone i tablete" vazi za oba uredjaja i nije dokaz.
const TABLET_NAZIV = /tablet|\btab\b|\bipad|mediapad|matepad|galaxy tab|\b(?:honor|redmi|xiaomi|oneplus|realme|oppo|poco|nokia|lenovo|huawei)\s+pad\b|\bpad x\d|\bsamsung (?:galaxy )?(?:tab )?(?:sm-|gt-)?[pt]\d{3,4}\b|\blenovo a3500\b/;
const POWERBANK_NASLOV = /power\s?bank|back\s?up baterij|eksterna baterija|prenosiva baterija/;
const SATOVI_DOKAZ = /smart\s?watch|smart\s?band|apple watch|galaxy watch|iwatch|\bwatch\b|garmin|amazfit|\bmi band|\bza (?:pametn\w* )?sat(?:ove|a)?\b|pametn\w* sat\w*/;
const NIJE_ZA_SAT = /\d\s?u\s?1|airpods|iphone/;
// Feedback 20.10: digitalni, mehanicki i dzepni sat nije pametni sat.
const KLASICAN_SAT = /^(?:[\w-]+ ){0,2}(?:digitaln\w*|mehanick\w*|dzepn\w*|analogn\w*|rucn\w*) sat\b/;
const AUTO_DRZAC = /ventilacij|gravitacion|air ?vent|\bvent\b|retr?ovizor|vetrobran|sofersajbn|komandn\w* tabl|kontroln\w* tabl|instrument tabl|steering|za sedist|\bcd slot|\bgoji\b|superior\b.*\bsu-?(?:303|502|d10\d)\b|\bjy004\b|\bd20\b|lp120|t-z20|mx-vs01\b|mx-vs157|c5s-f1p|c8-f1|co-bh48/;
const DRZAC_NASLOV = /^(?:[\w-]+ ){0,2}(?:drzac\w*|nosac\w*|holder\w*|stalak|stalci|postolj\w*|popsocket\w*|pop socket|ring stent|stand)\b/;
const LED_NASLOV = /^(?:[\w-]+ ){0,2}(?:led (?:svetl|ring|panel|lamp|studio)|ring (?:light|lamp)|rgb (?:svetl|lamp)|video (?:svetl|lamp)|fill light)|^selfie (?:magnetic )?(?:led|ring)/;
// "Slefie" je cesta greska u nazivu, a LED svetlo sa drzacem za telefon sluzi za snimanje.
const FOTO_DOKAZ = /fotograf|snimanj|selfi|slefi|tripod|stativ|video|vlog|studio|youtube|tiktok|stream|half moon|ring|make ?up|sminkanj|\bunme\b|sa drzacem za (?:mobiln|telefon)|magnetic drzac/;
const NIJE_FOTO_LED = /za glavu|baterijsk|ventilator|ogledal|za auto|automobil|motion|senzor|stona|stoln/;
const DRZACI_PUT = /stalci i nosaci|kucni drzaci|drzaci za bicikl|drzaci ostali|popsocket|drzaci outlet|octobuddy|drzaci stalci i docking|oprema za tablet > drzaci|drzaci, selfie stick, tripodi/;
const BATERIJA_TELEFON_PUT = /baterije za mobiln|baterije deji|baterije outlet|baterije premium|baterije comicell|eco grade|aplong|baterije i ostalo/;
const BATERIJA_TELEFON_NASLOV = /^baterij[ae]?\b.*\bza (?:mini telefon\w*|mobiln\w*|telefon\w*|iphone|apple|samsung|xiaomi|redmi|huawei|honor|nokia|motorola|lg|sony|htc|alcatel|oneplus|oppo|realme|vivo|zte|tcl|meizu|lenovo|asus|google|poco|infinix|tecno|blackberry|gigaset|maxcom)\b/;
const NIJE_BATERIJA_TELEFONA = /laptop|notebook|macbook|bicikl|trotinet|\bps\d|playstation|kontroler|dzojstik|\bsat\b|satov|watch|kamer|dron|tablet|\btab\b|ipad|airpods|slusalic|apollo|power\s?bank|back\s?up|^(?:aktivator|alat|lepak|lepilo|traka|nalepnic)/;
const STARTER = /\bstarter\w*\b(?! (?:kit|set|pack|paket))/;
// Drzac "za retrovizor motora" je za motor ili bicikl, ne za automobil.
const BAJS = /bicikl|\bmotor(?:a|e|i|u|om|ima)?\b|motocikl|trotinet|skuter|scooter|\bbike\b/;
// Feedback 01.11: oprema za bicikl i motor ide u "Oprema za bicikle i motore", a oprema samo za trotinet
// ostaje gde je. Naziv odlucuje; put dobavljaca samo kad naziv ne navodi vozilo.
const samoTrotinet = (tekst: string) => /trotinet|scooter/.test(tekst) && !/bicikl|bicycle|\bbike\b|\bmotor(?:a|e|i|u|om|ima)?\b|motocikl|skuter/.test(tekst);
const zaBiciklIliMotor = (title: string, path: string) => BAJS.test(title) ? !samoTrotinet(title) : BAJS.test(path) && !samoTrotinet(path);

// Produzni kabl za struju, razvodnik i uticnica; USB, HDMI, audio i ATX produzni su kablovi.
// Pametna uticnica ostaje smart oprema, a pametni produzni kabl je produzni.
function produzniZaStruju(title: string): boolean {
  if (/router|wireless|wi-?fi|\bpoe\b/.test(title) || (/pametn|smart/.test(title) && !/produzn/.test(title))) return false;
  // Suko uticnice dokazuju struju i kad produzni ima i USB portove.
  return /uticnic|razvodnik|prenapon/.test(title)
    || (/produzn/.test(title) && (/\bsu[hk]o\b/.test(title)
      || !/type[ -]?c|usb|hdmi|vga|displayport|\baux\b|3[.,]5|\blan\b|utp|rj ?45|lightning|\batx\b|pci-?e|\d ?pin|sata|molex/.test(title)));
}

// 3g "Oprema za mobilni > Servis" i "> Alati" su servisni alat i potrosni materijal, ne oprema za telefon.
// Feedback 20.10: isto vazi za "Alati za otvaranje telefona", "Kalupi" i servisni brend bez puta (Stega KAISI, Zica BAKU).
function servisniAlat(title: string, path: string): StoreCategory | null {
  const servisPut = /(?:^|> )(?:servis|alati|kalupi)(?: >|$)|^alati za otvaranje telefona/.test(path);
  if (!servisPut && (path || !/^(?:stega|stipaljk\w*|zica)\b|\b(?:baku|kaisi|jakemy|relife)\b/.test(title))) return null;
  // Punjaci iz te grane (RELIFE RL-304R, RL-309AW) ostaju punjaci.
  if (/punjac/.test(title)) return null;
  // Silikonska radna podloga je radni prostor, kao u glavnoj grani "Alati > Radni prostor"; podloga za separator ide uz separatore.
  if (/^torba za alat/.test(title) || (/^(?:[\w-]+ ){0,2}silikonsk\w* (?:radna )?podlog/.test(title) && !/separator/.test(title))) return ["alati", "radni-prostor"];
  if (/^(?:[\w-]+ ){0,2}(?:kalaj|flux|fluks|pasta|lepak|lepilo|sprej|krpic\w*|maramic\w*|sundjer\w*|traka|tape|zica za (?:lemljenje|ciscenje kalaja)|maska za lemljenje|alkohol|izopropil)|double side tape/.test(title)) return ["alati", "hemikalije"];
  const podgrupa = servisnaPodgrupa(title, path);
  if (podgrupa) return ["alati", podgrupa];
  if (/lemljenj/.test(title)) return ["alati", "lemilice"];
  if (/separator|alat\w* za (?:skidanje|otvaranje|ciscenje)|podlog|spatula|demontaz|masina za rotiranje|aktivator|zica za (?:odvajanje|skidanje|obnavljanje)|^zica\b(?! za)|\bmold\b|kalup|\bstega\b|stipaljk|skalpel|stampan\w* ploc|\bpcb\b/.test(title)) return ["alati", "reparacija"];
  return ["alati", "alati"];
}

// Stalci i nosaci (feedback 20.10.2026): tripodi, gimbali, LED lampe za snimanje i drzaci za telefon i tablet.
// Auto drzaci idu u auto opremu, a stalak koji puni ostaje punjac.
function stalciIliNosaci(title: string, path: string, type: string, category: string, subcategory: string, auto: boolean): StoreCategory | null {
  const naslovKandidat = /gimbal|stabilizator|tripod|stativ|monopod|selfi|slefi|ring light|ring lamp|led (?:ring|panel|svetl|lamp|studio)/.test(title);
  // Fantech stalak za slusalice i mouse bungee ostaju gejming oprema.
  if (/gaming oprema/.test(path) && !naslovKandidat) return null;
  if (category !== "mobilni" && !(naslovKandidat && ["kucni", "gejming", "racunari"].includes(category))) return null;
  // Maska ili futrola sa drzacem ("Maska Tulip pop socket", "Futrola HOLDER") ostaje maska.
  // Kabl i drzac kablova nisu drzac za telefon; drzac uz koji ide kabl ("Palm Shape drzac + kabel") jeste.
  if (/drzac\w* za kartic|za lamp|lamp\w* za citanj|shelf|\bimac\b|za mikrofon|mikrofon\w* (?:drzac|nosac|stalak)|^zastit|selfie monitor|organizer|^(?:[\w-]+ ){0,2}(?:kabl|kabel|kabal)|^(?!(?:[\w-]+ ){0,2}(?:drzac|nosac|stalak)\w* (?!(?:za )?(?:kab|organiz))).*(?:kabl|kabel|kabal)|^(?:maska|maske|futrol\w*|case|navlak\w*)\b|^vodootporn\w* (?:torbic|futrol|mask)/.test(title)) return null;
  if (SATOVI_DOKAZ.test(title) && !NIJE_ZA_SAT.test(title)) return null;
  if (/gopro|go pro|akcion\w* kamer|action cam|insta ?360/.test(`${title} ${path}`)) return null;
  // Desktop drzac sa bezicnim punjacem je punjac; zvucnik ili lampa sa bezicnim punjacem ostaje zvucnik ili lampa,
  // a drzac za bicikl ili motor sa punjacem ostaje drzac.
  if (/wireless stalak|stalak.*(?:punjac|wireless)|(?:drzac\w*|nosac\w*).*punjac|bezicn\w* punjac|wireless (?:punjac|charg)/.test(title)
    && !auto && !BAJS.test(title) && !POWERBANK_NASLOV.test(title) && !/^(?:[\w-]+ ){0,1}lamp|\bzvucni[kc]/.test(title)) return ["mobilni", "punjaci"];
  // Feedback 01.11: i "Stabilizer" je gimbal.
  if (/gimbal|stabilizator(?! napon)|\bstabilizer\b/.test(title) && !/mx-vs106/.test(title)) return ["stalci", "gimbali"];
  if (/^(?:[\w-]+ ){0,1}(?:tripod|stativ|monopod)\b|^selfie (?:stick|stap)|^(?:smart )?selfie drzac/.test(title)) return ["stalci", "tripodi"];
  // Feedback 01.11: drzac, nosac, stalak ili torba za telefon na biciklu ili motoru su "Oprema za bicikle
  // i motore", ne opsti stalci; drzac samo za trotinet ostaje u drzacima, a akciona kamera i gimbal su vec odbijeni iznad.
  if (/\b(?:bike|handlebar|motorcycle) mount\b/.test(title)) return samoTrotinet(title) ? ["stalci", "drzaci-telefoni"] : ["sport", "oprema-bicikli"];
  if (!auto && zaBiciklIliMotor(title, path) && (DRZAC_NASLOV.test(title) || /^(?:[\w-]+ ){0,2}torb\w*\b/.test(title))) {
    return ["sport", "oprema-bicikli"];
  }
  if (DRZAC_NASLOV.test(title)) {
    // Kuka za prtljag u automobilu nije drzac za telefon.
    if (auto) return /\bhook\b|\bkuk(?:a|ica)\b/.test(title) ? ["auto", "oprema"] : ["auto", "drzaci"];
    if (/\bpcb\b|kaisi|sunshine/.test(title)) return ["alati", "reparacija"];
    // Feedback 01.11: drzac za flasu ili casu je Sport i fitnes, osim kad je samo za trotinet.
    if (/flas|bidon|za cas[ue]\b/.test(title)) return samoTrotinet(`${title} ${path}`) ? ["sport", ""] : ["fitnes", ""];
    if (/laptop|notebook|macbook|monitor/.test(title)) return ["racunari", ""];
    if (/slusalic|headset/.test(title)) return ["audio", ""];
    if (/tastatur|\bmis\b/.test(title)) return ["racunari", "tastature"];
    if (/^drzac (?:za )?(?:tripod|stativ)\b|sa stativom/.test(title)) return ["stalci", "tripodi"];
    // Feedback 01.11: drzac sa LED rasvetom je LED lampa za snimanje.
    if (/sa led (?:rasvet|lamp|svetl)/.test(title)) return ["stalci", "led-lampe"];
    return ["stalci", "drzaci-telefoni"];
  }
  if (/^torba za (?:double )?led/.test(title) || (LED_NASLOV.test(title) && FOTO_DOKAZ.test(title) && !NIJE_FOTO_LED.test(title))) return ["stalci", "led-lampe"];
  if (/^selfie\b|tripod|stativ|monopod|selfie stick|selfi\w* stap/.test(title)) return ["stalci", "tripodi"];
  if (category === "mobilni" && !POWERBANK_NASLOV.test(title) && (DRZACI_PUT.test(path) || subcategory === "drzaci" || type === "drzac")) {
    // Auto put bez drzaca u nazivu (osvezivac, sprej) resava auto grana.
    if (auto) return /drzac|holder|nosac|stalak/.test(title) ? ["auto", "drzaci"] : null;
    return /selfie stick|tripod/.test(path) ? ["stalci", "tripodi"] : ["stalci", "drzaci-telefoni"];
  }
  return null;
}

// Feedback 01.11: artikli koje je klijent nazivom ili slikom poslao u odredjenu podgrupu,
// bez obzira na granu dobavljaca.
const VODOOTPORNA_TORBA = /^vodootporn\w* (?:suv\w* )?(?:torb|dry bag)|^(?:[\w-]+ ){0,2}dry bag\b|\btorb\w* vodootporn/;
const MREZNA_OPREMA = /\b(?:router|ruter)\b|range extender|access point|mesh system|wi-?fi extender|repeater/;
function premestajPoNazivu(title: string, path: string): StoreCategory | null {
  // Sva klesta idu uz pincete i srafcigere.
  if (/\bklest/.test(title)) return ["alati", "pincete-srafcigeri"];
  // Slusalice i interkom za kacigu su oprema za kacige.
  if (/za kacig/.test(title) && /headset|slusalic|interkom|intercom/.test(title)) return ["sport", "kacige"];
  // Combo set sa konzolom (Karler Bass K13, K35, K718) je konzola; Karler Bass K10, RegalPop,
  // Led sat privezak i MIBRO P6 su satovi za decu.
  if (/combo set\b.*\bkonzol/.test(title)) return ["konzole", "konzole-uredjaji"];
  if (/^karler bass k10\b|regalpop|\bmibro p6\b|^led sat privez/.test(title)) return ["satovi", "deciji-satovi"];
  // Masine za ciscenje periferija, bezicni usisivac i rucni kompresor su posebna podgrupa servisnog alata.
  if (/masin\w* za ciscenje periferij|^rucn\w* kompresor|^bezicn\w* usisivac/.test(title)) return ["alati", "ciscenje-periferije"];
  // Prenosivi kompresor za vazduh i vulkanizerski set sa kompresorom su "Starteri i kompresori".
  if (/(?:prenosn\w*|prenosiv\w*|portable|air) (?:kompresor|compressor)|kompresor za (?:vazduh|gume|auto)|vulkanizersk\w* set sa kompresor/.test(title)) return ["auto", "starteri"];
  // Mini kamera (i ona koja stampa, sa papirom za nju), decija kamera i deciji fotoaparat
  // (i onaj sa stampacem) su decija oprema.
  // Feedback 02.11: magnetna mini kamera F3 je akciona kamera, ostale mini kamere ostaju decija oprema.
  if (/^mini ?kamera f3\b/.test(title)) return ["kucni", "akcione-kamere"];
  if (/^mini ?kamer|^decij\w* (?:digitaln\w* )?(?:kamer|fotoaparat)|^digitaln\w* fotoaparat\b.*\bdecij/.test(title)) return ["kucni", "deca"];
  // Akcione kamere i oprema za njih su svoja podgrupa; Insta360 citac kartica nije kamera.
  if (/akcion\w* kamer|action ?(?:cam|kamer)|\bgo ?pro\b|\bsjcam\b/.test(title) || (/insta ?360/.test(title) && !/citac|reader/.test(title))
    || /akcione kamere/.test(path)) return ["kucni", "akcione-kamere"];
  // Novogodisnji ukrasi i dekoracija; zvucnik i slusalice sa novogodisnjim motivom ostaju audio.
  if ((/^novogodisnj|^dekoracij/.test(title) || /novogodisnja dekoracija/.test(path)) && !/zvucni[kc]|slusalic/.test(title)) return ["kucni", "novogodisnji-ukrasi"];
  // Vodootporna torba za bicikl ili motor je oprema za bicikle, a torba za trotinet ostaje gde je.
  if (VODOOTPORNA_TORBA.test(title) && !/trotinet/.test(title)) return BAJS.test(title) ? ["sport", "oprema-bicikli"] : ["fitnes", "vodootporne-torbe"];
  if (/\bastronaut\b/.test(title) && /lamp|projekt/.test(title)) return ["tv", "projektori"];
  // Feedback 02.11: MiraScreen, Miracast, AnyCast i Chromecast prijemnici za TV su Smart TV Box (ranije Auto oprema).
  if (/mirascreen|miracast|anycast|^chromecast\b/.test(title)) return ["tv", "tv-stick"];
  // Feedback 02.11: Relife sterilizator ide uz separatore i ultrazvucne kade.
  if (/^sterilizator\b/.test(title) && /\brelife\b/.test(title)) return ["alati", "separatori"];
  // Feedback 02.11: nosac ili drzac za monitor (i za monitor sa laptopom) je TV nosac; polica za monitor ostaje u racunarima.
  if (/^(?:nosac|drzac)\b/.test(title) && (/\bmonitor/.test(title) || /nosaci za monitore/.test(path))) return ["tv", "tv-nosaci"];
  // Feedback 02.11: kuleri za procesor i kuciste, vodeni kuleri i ventilatori za kuciste su "Kuleri i hladnjaci
  // za procesore"; laptop kuleri, postolja, kontroler ventilatora i kuleri za konzole i telefone ostaju gde su.
  if (/^(?:(?:cpu|case) )?(?:cooler|fan)\b|^white shark fan\b/.test(title) && /cooleri|kuleri|napajanja i hladnjaci/.test(path)
    && !/laptop|notebook/.test(title)) return ["racunari", "kuleri-hladnjaci"];
  if (/lamp\w* sa lupom/.test(title)) return ["alati", "radni-prostor"];
  if (/\brgbw-600\b/.test(title)) return ["stalci", "tripodi"];
  if (/zifriend|black ?shark/.test(title) && /tastatur|keyboard/.test(title)) return ["gejming", "tastature"];
  // Ruter, switch, extender i access point su mrezna oprema; HDMI, KVM i Nintendo Switch nisu.
  if ((MREZNA_OPREMA.test(title) || (/^(?:lan )?switch\b/.test(title) && !/hdmi|kvm|nintendo/.test(title)))
    && !/dock|^(?:maska|futrol|narukvic)/.test(title)) return ["racunari", "mrezni-kablovi"];
  if (/punjaci za baterij/.test(path)) return ["kucni", "baterije-punjaci"];
  // Zidna lampa i LED ogledalo su rasveta; ogledalo za sminkanje ostaje u nezi.
  if ((/^(?:[\w-]+ ){0,2}zidn\w* lamp/.test(title) || /^led ogledal/.test(title)) && !/sminkanj/.test(title)) return ["kucni", "rasveta"];
  // Punjac za telefon na motoru ili kormanu je oprema za bicikle i motore, ne auto punjac.
  if (/\bza motor\b|\bza korman/.test(title) && /punjac|adapter|usb/.test(title) && !/drzac|nosac/.test(title)) return ["sport", "oprema-bicikli"];
  return null;
}

// Classification uses the supplier's full path as evidence. An empty child
// keeps an ambiguous product in its parent instead of inventing a property.
function razvrstaj(
  category: string,
  subcategory: string,
  name: string,
  brand: string,
  supplierCategory = "",
  productType = "",
): StoreCategory {
  const title = normalize(name), path = normalize(supplierCategory);
  const type = normalize(productType), combined = `${title} ${normalize(brand)}`;
  // Feedback 20.10: sve baterije za telefone idu gore, i kad ih dobavljac drzi pod opstim "Baterije".
  // Baterija za iPad ili tablet je rezervna baterija uredjaja kao i baterija za telefon.
  const baterijaZaTablet = /^baterij[ae]?\b.*(?:\bipad|tablet|\btab\b|\btab ?\d)/.test(title) && !/laptop|notebook|macbook|power\s?bank/.test(title);
  const phoneBatteryMobilni = category === "mobilni" && ["baterije", "oprema", "razno"].includes(subcategory)
    && ((((BATERIJA_TELEFON_PUT.test(path) && /baterij|battery|\bmah\b/.test(title)) || BATERIJA_TELEFON_NASLOV.test(title))
      && !NIJE_BATERIJA_TELEFONA.test(title)) || baterijaZaTablet);
  const phoneBattery = subcategory === "baterije-telefoni" || subcategory === "delovi-baterije"
    || /rezervni delovi\s*\/\s*baterije(?:\s*\/|$)/.test(path) || phoneBatteryMobilni;
  // Apple USB-C adapter od 61 W navise je punjac za MacBook.
  const laptopNaKomad = (/baterije za laptop|punjaci za laptop|laptop baterije|laptop punjaci/.test(path)
    || /^punjac\w* za laptop|^baterij\w* (?:za )?laptop/.test(title)
    || /^apple\b.*\b(?:6[17]|70|87|96|140)\s?w\b.*power adapter/.test(title)) && !TABLET_NAZIV.test(title);
  const laptopParts = subcategory === "delovi-racunari" || subcategory.startsWith("laptop-")
    || /rezervni delovi za racunare/.test(path) || laptopNaKomad;

  // Replacement camera lenses are phone parts, not protective camera glass.
  // Keep this exclusion ahead of all name-based accessory classification.
  if (category === SKIP_STORE_CATEGORY) return [SKIP_STORE_CATEGORY, ""];
  // Feedback 27.10: sve sto u nazivu ima relej ostaje van prodavnice.
  if (JE_RELEJ.test(title)) return [SKIP_STORE_CATEGORY, ""];
  // Feedback 01.11: industrijska automatizacija, kalupi, BGA sita, mold frame, Handsfree Extreme i Video balun ostaju van prodavnice.
  if (/industrijska automatizacija/.test(path) || subcategory === "industrija" || NIJE_ZA_PRODAJU.test(title)) return [SKIP_STORE_CATEGORY, ""];
  if (CITAC_BARKODA.test(title) && !PRIBOR_ZA_CITAC.test(title)) return [SKIP_STORE_CATEGORY, ""];
  if (!phoneBattery && !laptopParts && (subcategory === "delovi-telefoni"
    || /rezervni delovi za mobilne telefone/.test(path)
    || category === "delovi")) return [SKIP_STORE_CATEGORY, ""];
  // Feedback 01.11: baterija sa "tab", "tablet" ili "iPad" u nazivu ide u baterije za tablete.
  if (phoneBattery) return ["mobilni", baterijaZaTablet || TABLET_NAZIV.test(title) || /\btab ?\d/.test(title) ? "baterije-tableti" : "baterije-telefoni"];
  // Feedback 01.11: produzni kabl za napajanje racunara i UPS-a je kabl, ne deo za laptop ni produzni za struju.
  if (/^kab\w*[- ]napajanj/.test(title) && /produzn/.test(title)) return ["racunari", "kablovi-adapteri"];
  if (laptopParts) {
    if (/baterij/.test(title) || /baterije za laptop|laptop baterije/.test(path)) return ["racunari", "laptop-baterije"];
    if (/produzn/.test(title) && produzniZaStruju(title)) return ["racunari", "produzni-kablovi"];
    if (/punjac|adapter punjac|napajanj|power adapter/.test(title) || /punjaci za laptop|laptop punjaci/.test(path)) return ["racunari", "laptop-punjaci"];
    if (/tastatur|keyboard/.test(title) || /tastature za laptop/.test(path)) return ["racunari", "laptop-tastature"];
    if (/\blcd\b|\bled panel\b|ekran|display|displej/.test(title) || /(?:^|[\/>])\s*lcd(?:\s*[\/>]|$)/.test(path)) return ["racunari", "laptop-ekrani"];
    return ["racunari", ""];
  }

  // Feedback 01.11: masine za secenje folija i njihov potrosni materijal su "Masine i folije za telefone" u mobilnoj opremi.
  if (/masine i stampaci za folije/.test(path) || /folij\w* za masin|masin\w* za (?:secenj|hidrogel)|noz za secenje folij|\bapollo\b/.test(title)) return ["mobilni", "folije"];
  const premestaj = premestajPoNazivu(title, path);
  if (premestaj) return premestaj;
  if (category === "mobilni") {
    const servis = servisniAlat(title, path);
    if (servis) return servis;
    // Oprema za elektricne bicikle (pumpa, kompresor, torba, kabanica) je sportska oprema, a sam bicikl ide u bicikle.
    if (/elektricni bicikli/.test(path)) return /^(?:[\w-]+ ){0,1}(?:elektricni )?bicikl/.test(title) ? ["sport", "bicikli"] : ["sport", "oprema-bicikli"];
    // Feedback 20.10: sportska i fitnes oprema iz gadget grane i kacige su sport.
    if (/sportska i fitnes/.test(path)) return refineStoreCategory("sport", "", name, brand, supplierCategory, productType);
    if (/^kacig/.test(title)) return ["sport", "kacige"];
  }
  // Feedback 20.10: sve sto u nazivu ima projektor ide u projektore (osim Face ID delova).
  if (/projektor|projector/.test(title) && !/dot projektor|face id/.test(title)) return ["tv", "projektori"];
  // Feedback 27.10: stampaci i toneri imaju svoju podgrupu u TV i multimediji.
  if (jeStampacIliToner(title)) return ["tv", "stampaci-toneri"];
  // Feedback 27.10 (druga serija): daljinski, TV Box i TV Stick idu u TV i multimediju,
  // MP3 i MP4 playeri u mobilnu opremu, a navigacija i auto kamera u auto opremu.
  if (!TV_PRIBOR_NAZIV.test(title)) {
    if (JE_TV_DALJINSKI.test(title)) {
      if (SMART_DALJINSKI.test(title)) return ["kucni", "smart"];
      if (MOBILNI_DALJINSKI.test(title)) return ["mobilni", "oprema"];
      return ["tv", "tv-daljinski"];
    }
    if (JE_TV_STICK.test(title)) return ["tv", "tv-stick"];
  }
  if (jeMp3Player(title)) return ["mobilni", "mp3-playeri"];
  if (jeNavigacija(title)) return ["auto", "navigacija"];
  if (jeAutoKamera(title)) return ["auto", "auto-kamere"];
  // Feedback 27.10 (druga serija): preciscivaci sa difuzerima i kucne baterije sa punjacima
  // dobijaju svoje podgrupe kucnih aparata, bez obzira na granu dobavljaca.
  if (jePreciscivac(title)) return ["kucni", "preciscivaci"];
  if (jeKucnaBaterija(title)) return ["kucni", "baterije-punjaci"];
  if ((/nosac\w* za (?:tv|televizor)\b|drzac\w* za (?:tv|televizor)\b|\btv nosac|polica za av/.test(title) && !/daljinsk/.test(title))
    || /televizori\s*\/\s*drzaci|televizori i oprema\s*\/\s*nosaci/.test(path)) return ["tv", "tv-nosaci"];
  // Feedback 20.10: produzni kablovi imaju svoju podgrupu i kad ih dobavljac drzi u kucnim aparatima.
  if (category === "kucni" && /produzn/.test(title) && produzniZaStruju(title)) return ["racunari", "produzni-kablovi"];
  // Feedback 01.11: starter, prenosivi kompresor i pumpa za gume su "Starteri i kompresori".
  if (STARTER.test(title) || /auto starteri/.test(path)) return ["auto", "starteri"];
  if (category === "mobilni" && /\bpump\w*/.test(title) && /power\s?bank|\bauto\b|gum[ae]/.test(title)) return ["auto", "starteri"];
  // Feedback 20.10: sve sto nosi naziv Arzopa i torba za eksterni monitor idu uz eksterne monitore.
  const eksterniMonitor = /(?:eksterni|prenosn\w*|prenosiv\w*|portable|portabl\w*) monitor/.test(title)
    && !/^(?:futrol\w*|maska|navlak\w*|stalak|drzac\w*|nosac\w*)\b/.test(title);
  // I sam monitor ide tu; nosac, lampa, LightBar, KVM i monitor za bebe ili pritisak ostaju gde jesu.
  const monitor = /^(?:[\w-]+ ){0,3}monitor\b/.test(title)
    && !/^(?:futrol\w*|maska|navlak\w*|stalak|drzac\w*|nosac\w*|lampa|selfie|torba|krpic\w*)\b|za monitor|lightbar|light bar|\bkvm\b|\b(?:stand|arm|mount|nosac\w*|drzac\w*|stalak)\b|beb|baby|pritis|krvn|puls|srca|heart/.test(title);
  if (/arzopa/.test(combined) || eksterniMonitor || monitor) return ["racunari", "eksterni-monitori"];
  // Feedback 20.10: AirTag, GPS tracker i futrola za AirTag su oprema za telefon.
  if (/^(?:apple )?air ?tag\b|^gps tracker\b|futrol\w* za air ?tag/.test(title)) return ["mobilni", "oprema"];

  const konzola = konzolaPodgrupa(title, path, category, subcategory);
  if (konzola === "gejming") return refineStoreCategory("gejming", "", name, brand, supplierCategory, productType);
  if (konzola) return ["konzole", konzola];

  const carPath = /auto oprema|auto punjaci|drzaci za automobil|auto drzaci|auto starteri/.test(path);
  const carTitle = /\bauto\b|automobil|\bcar\b|vozil|vetrobran|sofersajbn|autodrzac|retr?ovizor|\bza upaljac|\bupaljaca\b|sa upaljacem|za sneg/.test(title);
  const bajs = BAJS.test(`${title} ${path}`) && !/automobil|\bauto\b|\bcar\b|ventilacij|air ?vent|vetrobran|sofersajbn|komandn\w* tabl|kontroln\w* tabl/.test(title);
  const stalci = stalciIliNosaci(title, path, type, category, subcategory, !bajs && (carPath || carTitle || AUTO_DRZAC.test(title)));
  if (stalci) return stalci;

  // Feedback 20.10: svi powerbankovi u jednu podgrupu, i iz gejminga i racunara.
  if (["mobilni", "gejming", "racunari"].includes(category)
    && !/pump|starter|apollo|ulozak|tester|fnirsi/.test(title)
    && !/^(?:[\w-]+ ){0,1}(?:kabl|kabal|kabel|torbic|futrol|maska)/.test(title)
    && (POWERBANK_NASLOV.test(title) || /power\s?bank|eksterne baterije|back\s?up baterije/.test(path) || type === "eksterna baterija")) return ["mobilni", "powerbank"];

  // Feedback 20.10: White Shark, Razer i Redragon misevi, tastature, podloge i slusalice su gejming oprema.
  const gejmingBrend = ["racunari", "audio"].includes(category) && /white shark|\brazer\b|redragon/.test(`${combined} ${path}`)
    && /slusalic|headset|tastatur|keyboard|\bmis\b|misev|\bmouse\b|podlog|mouse ?pad/.test(title);
  if (category === "gejming" || gejmingBrend || /fantech/.test(`${combined} ${path}`)) {
    // Accessories mentioning a mouse/keyboard/headset must not become devices.
    const accessory = /^(glajder|grip|nalepnic|dodatak|drzac|stalak|nosac|postolj|jastucic|kabl|adapter|baterij|punjac|maska|kuciste|aluminijumsko kuciste|taster|switch|prekidac|kapic|torb|futrol)/.test(title)
      || /\b(holder|delovi za|rezervn|griptape|charging dock|mouse bungee|stalak.punjac|kontroler tastatura)/.test(title);
    // Feedback 20.10: Fantech zvucnici, mikrofoni, PC kucista, web kamere, ventilatori, punjaci,
    // ranci i kancelarijski misevi nisu gejming oprema.
    if (!accessory && /^(?:[\w-]+ ){0,2}(?:zvucni[kc]\w*|soundbar)\b/.test(title)) return ["audio", "zvucnici"];
    if (jeMikrofon(title)) return ["audio", "mikrofoni"];
    if (/^(?:kuciste|napajanje)\b/.test(title) && /komponente|napajanja i hladnjaci|kucista/.test(path)) return ["racunari", ""];
    if (/^laptop (?:cooler|stalak)|^web ?kamer/.test(title)) return ["racunari", ""];
    if (RANAC.test(title) && !accessory) return ["laptop", "rancevi"];
    if (jeKucniVentilator(title)) return ["kucni", "ventilatori"];
    if (/^(?:kucni|zidni) punjac\b|power cube/.test(title)) return ["mobilni", "punjaci"];
    if (/^termos\b/.test(title)) return ["fitnes", "termos-dose"];
    if (/kancelarijsk/.test(title) && /\bmis\b|misev|\bmouse\b/.test(title)) return ["racunari", "misevi"];
    if (accessory) return ["gejming", "gejming-oprema"];
    if (/combo|kombo/.test(title) || /\/\s*combo setovi(?:\s*\/|$)/.test(path)) return ["gejming", "combo-setovi"];
    // Mis "sa podlogom" je mis.
    if (/^(?:gaming )?(?:mis|mouse)\b/.test(title)) return ["gejming", "misevi"];
    if (/podlog\w* za stolic|chair ?mat/.test(title)) return ["gejming", "stolovi-stolice"];
    if (/podlog|mouse\s*pad|deskmat|mousemat/.test(title)) return ["gejming", "podloge"];
    if (/\b(sto|stol|stolica|desk|chair)\b|\bstolov|\bstolic/.test(title)) return ["gejming", "stolovi-stolice"];
    if (/gamepad|game\s?pad|joypad|joystick|dzojstik|\bkontroler\b/.test(title)) return ["gejming", "gamepad"];
    if (/slusalic|headset|headphone|earbud/.test(title)) return ["gejming", "slusalice"];
    if (/tastatur|keyboard/.test(title)) return ["gejming", "tastature"];
    if (/\bmis\b|misev|\bmouse\b/.test(title)) return ["gejming", "misevi"];
    return ["gejming", "gejming-oprema"];
  }

  // Mikrofon ide u audio/mikrofoni i kad ga je put dobavljaca stavio u mobilne ili kucne aparate
  // (JBL PBM 100 je bio u mobilni/oprema). Fantech i gejming mikrofone resava gejming grana iznad.
  if ((category === "mobilni" || category === "kucni" || category === "audio") && jeMikrofon(title)) return ["audio", "mikrofoni"];

  // Smart watch koji je dobavljac stavio u maske je ceo sat.
  const satoviIzMobilnog = category === "mobilni" && SATOVI_DOKAZ.test(title) && !NIJE_ZA_SAT.test(title)
    && (["punjaci", "kablovi", "oprema", "razno", "drzaci", "baterije", "adapteri"].includes(subcategory)
      || (subcategory === "maske" && /^(?:smart ?watch|smartwatch|pametn\w* sat)\b/.test(title)));
  const klasicanSat = type === "pametni sat" && KLASICAN_SAT.test(title);
  if (category === "satovi" || subcategory === "satovi" || /smart satovi|pametni satovi/.test(path) || satoviIzMobilnog || klasicanSat) {
    if (/^(?:zastit\w*|staklo|folij\w*)\b/.test(title)) return ["satovi", "oprema-satovi"];
    // Feedback 01.11: Night Stand za Apple Watch je stanica za punjenje.
    if (/punjac|charger|charging|night ?stand|kabl za.*(?:sat|watch)|^(?:[\w-]+ ){0,2}(?:kabl|kabel|kabal)\b.*punjenj/.test(title)) return ["satovi", "punjaci-satovi"];
    // Ceo sat sa silikonskom narukvicom je sat, ne narukvica.
    if (/^(?:smart ?watch|smartwatch|pametn\w* sat)\b/.test(title) && !/decij|za decu|kids|children/.test(title)) return ["satovi", "pametni-satovi"];
    // Feedback 01.11: pametna, smart i fitnes narukvica (Huawei Band, Xiaomi Band, Treko Air Band) je pametni sat, ne narukvica za sat.
    if (/^(?:[\w-]+ ){0,1}(?:pametn\w*|smart|fitness?) narukvic/.test(title) && !/decij|za decu|kids|children|narukvic\w* za\b/.test(title)) return ["satovi", "pametni-satovi"];
    if (/narukvice za|kajs|strap|watch band/.test(`${path} ${title}`)) return ["satovi", "narukvice"];
    if (/oprema za smart satove/.test(path) || /^(zastit|staklo|maska|futrola|okvir|adapter|stalak|drzac|nosac|postolj|nakit|privez)/.test(title)) return ["satovi", "oprema-satovi"];
    if (/narukvic|smart\s*band|fitness\s*band/.test(title)) {
      if (/decij|za decu|kids|children/.test(title) && /smart|pametn/.test(title)) return ["satovi", "deciji-satovi"];
      return ["satovi", "narukvice"];
    }
    if (/decij|za decu|kids|children/.test(title)) return ["satovi", "deciji-satovi"];
    if (KLASICAN_SAT.test(title) && !/smart|pametn/.test(title)) return ["satovi", ""];
    if (/\bsat\b|smartwatch|watch|smart band|pametn.*narukvic|smart.*narukvic|fitnes.*narukvic/.test(title)) return ["satovi", "pametni-satovi"];
    return ["satovi", "oprema-satovi"];
  }

  const fmNaslov = /fm.?transmit|fm modulator/.test(title);
  const fmPut = /fm (?:transmiteri|modulatori)/.test(path);
  // Feedback 20.10: CarPlay adapter, auto radio i auto BT prijemnik su auto oprema, ne FM transmiteri ni kamere.
  const carplay = /carplay|android auto/.test(title);
  const tvAuto = category === "tv" && /\bauto\b|\bcar\b/.test(title) && /radio|bluetooth|prijemnik|receiver/.test(title);
  if (category === "auto" || subcategory === "auto" || subcategory === "fm-transmiteri" || fmNaslov || carplay || tvAuto
    || ((carPath || (carTitle && !bajs)) && (category === "mobilni" || /auto oprema/.test(path)))) {
    if (carplay || /\b(?:auto|car) ?radio\b/.test(title)) return ["auto", "oprema"];
    if (fmPut && /adapter|kabl|kabal|kabel/.test(title) && !fmNaslov && !/bezicn|bluetooth|wireless|\bbt\b|receiver|prijemnik/.test(title)) return ["mobilni", "kablovi"];
    if (fmNaslov || fmPut) return ["auto", "fm-transmiteri"];
    // Kuka za prtljag nije drzac za telefon.
    if (/\bhook\b|\bkuk(?:a|ica)\b/.test(title)) return ["auto", "oprema"];
    if (/drzac|holder|stalak|nosac/.test(title)) return ["auto", "drzaci"];
    if (/punjac|charger/.test(title) || /auto punjaci/.test(path)) return ["auto", "auto-punjaci"];
    return ["auto", "oprema"];
  }

  const computerAudio = category === "racunari" && (
    /[\/>]\s*(slusalice za racunare|mikrofoni|zvucnici)(?:\s*[\/>]|$)/.test(path)
    || /^(?:[\w-]+\s+)?(?:slusalic|mikrofon\b|microfon\b|zvucni[kc]|soundbar)/.test(title)
    || type === "slusalice" || type === "zvucnik");
  if (category === "audio" || computerAudio) {
    // Futrola, torbica ili traka za slusalice je dodatak, ne slusalice; futrola za telefon je maska.
    if (/^(?:futrol\w*|maska)\b/.test(title) && /\b(?:galaxy|iphone|redmi|xiaomi|samsung|huawei|honor|motorola)\b/.test(title)
      && !/airpods|buds|slusalic|zvucni/.test(title)) return ["mobilni", "maske"];
    if (/^(?:[\w-]+ ){0,2}(?:traka|privez\w*|futrol\w*|maska|torbic\w*|kutij\w*|navlak\w*|jastucic\w*|nastavc\w*)\b|\bza (?:slusalic\w*|airpods)/.test(title)) return ["audio", ""];
    if (/^drzac i led svetl/.test(title)) return ["stalci", "led-lampe"];
    const airpods = /airpods|airphones/.test(title) && !/^(?:futrol|maska|torbic|kutij|navlak|kabl|punjac|nastavc|jastucic|stalak|drzac)/.test(title);
    const headphones = /slusalic|headset|headphone|earbud|handsfree|hands free|earpods/.test(title) || airpods
      || /slusalice/.test(path) || subcategory.startsWith("slusalice");
    if (headphones) {
      // A wired product can explicitly say "radi bez BT"; that is not Bluetooth.
      // Feedback 20.10: handsfree i outlet slusalice bez BT oznake u nazivu su zicane.
      const btNaslov = /bluetooth|bluetoot|\bbt\b|bezic|wireless|\btws\b/.test(title);
      const wired = /slusalice (sa kablom|zicane)|wired slusalice/.test(path) || subcategory === "slusalice-zicane"
        || /\bzican|\bwired\b|sa kablom|kompjutersk\w* slusalic/.test(title) || (/\bmx-ep\d/.test(title) && !btNaslov)
        || (/slusalice handsfree|slusalice outlet/.test(path) && !btNaslov && !airpods && !/\bbuds\b|\bpods\b|earbuds|neckband/.test(title));
      if (wired) return ["audio", "slusalice-zicane"];
      // Feedback 27.10: bezicne slusalice su spojene u Bluetooth slusalice, to je jedna podgrupa.
      if (/bluetooth|bluetoot|\bbt\b|bezic|wireless|\btws\b/.test(`${title} ${path}`)
        || subcategory === "slusalice-bezicne") return ["audio", "slusalice-bluetooth"];
      if (airpods) return ["audio", "slusalice-bluetooth"];
      if (/3[.,]5\s*mm|lightning|type[ -]?c|usb[ -]?c|handsfree|hands free/.test(title)) return ["audio", "slusalice-zicane"];
      // Buds i pods su bezicne slusalice sa Bluetooth vezom.
      if (/\bbuds\b|\bpods\b|earbuds/.test(title)) return ["audio", "slusalice-bluetooth"];
      return ["audio", ""];
    }
    if (/[\/>]\s*mikrofoni(?:\s*[\/>]|$)/.test(path)) return ["audio", "mikrofoni"];
    if (/zvucni[kc]|speaker|soundbar/.test(title)) return ["audio", "zvucnici"];
    if (/mikrofon|microfon|microphone/.test(title)) return ["audio", "mikrofoni"];
    return ["audio", subcategory === "zvucnici" ? "zvucnici" : ""];
  }

  if (category === "racunari") {
    // Whole laptops also mention SSDs, RAM and keyboards in their titles.
    if (subcategory === "racunari" || /[\/>]\s*laptop racunari(?:\s*[\/>]|$)/.test(path)) return ["racunari", "racunari"];
    // Feedback 20.10: diktafon i MP3 plejer su audio uredjaji, ne memorije.
    if (/^(?:diktafon|mp[34] player)\b/.test(title) || /mp3 playeri/.test(path)) return ["audio", ""];
    if (/^torba za alat/.test(title)) return ["alati", "radni-prostor"];
    if (/^(?:futrol|mask|torbic)/.test(title) && TABLET_NAZIV.test(title)) return ["mobilni", "maske-tableti"];
    if (/^stiker/.test(title)) return ["mobilni", "oprema"];
    if (/chuango/.test(combined)) return ["tv", "kamere"];
    if (/podlog\w* za stolic|chair ?mat/.test(title)) return ["gejming", "stolovi-stolice"];
    if (/prezenter|presenter|\bttr\b|barkod|bar ?code|skener|scanner/.test(title)) return ["racunari", ""];
    if (produzniZaStruju(title)) return /upaljac/.test(title) ? ["auto", "oprema"] : ["racunari", "produzni-kablovi"];
    const prenosnaOprema = prenosnaOpremaZaLaptop(title, path, subcategory);
    if (prenosnaOprema) return prenosnaOprema;
    if (/(?:type[ -]?c|usb\w*) na rj ?45/.test(title)
      || /citac|reader|docking|\bhub\b|^(adapter|konvertor)\b|\bkvm\b|hdd rack|kuciste za (?:hdd|ssd)|\bonten\b|ac\/dc|zvucna karta|dongle/.test(title)) return ["racunari", "kablovi-adapteri"];
    if (/\b(ssd|hdd|ram)\b/.test(title)) return ["racunari", ""];
    if (subcategory === "memorije" || /flash memorij/.test(path)
      || /memorijsk.*kartic|\b(micro\s*sd|microsd|sd)(hc|xc)?\b|\b(usb|fles|flash)\s*(memorij|drive|stick)|\bfles\b/.test(title)) return ["racunari", "memorije"];
    // USB, HDMI i Type-C kabl iz grane "UTP" nije mrezni kabl.
    if (/^konektor rj ?(?:45|11)\b/.test(title) || (/adapteri i kablovi > utp/.test(path) && !/type[ -]?c|usb|hdmi|lightning|displayport|\bvga\b/.test(title))) return ["racunari", "mrezni-kablovi"];
    if (/mrezni.*kabl|mrezn.*kabal|\blan\b.*kab|kab.*\blan\b|\butp\b|\bstp\b|\bftp\b|\bethernet\b|\brj45\b|\bcat ?[5-8]/.test(title)
      && /kabl|kabal|kabel|cable/.test(title)) return ["racunari", "mrezni-kablovi"];
    if (/mrezna oprema\s*\/\s*kablovi/.test(path) && /kabl|kabal|kabel|cable/.test(title)) return ["racunari", "mrezni-kablovi"];
    if (/kablovi i adapteri|adapteri i kablovi/.test(path) || subcategory === "kablovi" || subcategory === "kablovi-adapteri"
      || /\bkabl|\bkabal|\bkabel|\bcable\b|\badapter\b|konvertor/.test(title)
      || /docking station i hub|citaci kartica/.test(path)) return ["racunari", "kablovi-adapteri"];
    const tastatura = /tastatur|keyboard|numpad|\bcombo\b|kombo/.test(title) || /[\/>]\s*(tastature|combo setovi)(?:\s*[\/>]|$)/.test(path);
    const podloga = /podlog|mouse\s?pad|mousepad|deskmat|mousemat/.test(title) || /[\/>]\s*podloge(?:\s*[\/>]|$)/.test(path);
    const mis = /\bmis\b|misev|\bmouse\b/.test(title) || /[\/>]\s*misevi(?:\s*[\/>]|$)/.test(path);
    if (tastatura || podloga || mis) {
      // Feedback 20.10: tastature, misevi i podloge koji nisu gaming dobijaju svoje podgrupe.
      if (/gaming|gamer|gejmer|gejming|\besport/.test(title) || /gaming oprema/.test(path)) return refineStoreCategory("gejming", "", name, brand, supplierCategory, productType);
      return ["racunari", tastatura ? "tastature" : podloga ? "podloge" : "misevi"];
    }
    return ["racunari", ""];
  }

  if (category === "sport") {
    // Feedback 20.10: vaga je kucni aparat.
    if (/^(?:[\w-]+ ){0,2}vag[ae]\b/.test(title) || /vage za merenje/.test(path)) return ["kucni", "aparati"];
    // Feedback 01.11: drzac i punjac za telefon na biciklu ili motoru su "Oprema za bicikle i motore";
    // drzac samo za trotinet ostaje u drzacima.
    if (/^(?:[\w-]+ ){0,1}(?:drzac|nosac)\w* (?:za )?(?:mobiln|telefon)/.test(title)) return zaBiciklIliMotor(title, path) ? ["sport", "oprema-bicikli"] : ["stalci", "drzaci-telefoni"];
    if (/^(?:[\w-]+ ){0,1}punjac za (?:telefon|mobiln)/.test(title)) return ["sport", "oprema-bicikli"];
    if (/kacig|helmet/.test(title)) return ["sport", "kacige"];
    // Feedback 01.11: koferi, oprema za kampovanje, termos dose i vodootporne torbe su podgrupe Sporta i fitnesa.
    if (/sport i fitness\s*\/\s*koferi/.test(path)) return ["fitnes", "koferi"];
    if (/oprema za kampovanje/.test(path)) return ["fitnes", "kampovanje"];
    if (/termos dose/.test(path) || /^termos\b/.test(title)) return ["fitnes", "termos-dose"];
    if (/vodootporne torbe/.test(path)) return ["fitnes", "vodootporne-torbe"];
    // Oprema za bicikl iz grane za trotinete je oprema za bicikl.
    const bicikliNaslov = /bicikl|bicycle|\bbike\b/.test(title);
    const scooter = /trotinet|scooter/.test(title) || (!bicikliNaslov && /trotinet|scooter/.test(`${path} ${type}`));
    const bicycle = /bicikl|bicycle|\bbike\b/.test(`${title} ${path} ${type}`);
    const electric = /elektricn|electric|\be[ -]?bike\b|\be[ -]?scooter\b/.test(`${title} ${path} ${type}`);
    const accessory = /oprema i delovi|oprema za|delovi za/.test(path)
      || /\bza (?:elektricn\w* )?(trotinet|bicikl|scooter|bike)/.test(title)
      || /^(adapter|aluminijumski korman|baterij|blatobran|blokad|bocn|brava|disk|drzac|guma|kabl|kabal|kocnic|korman|kontroler|kuk|lezaj|maska|motor|nosac|osovin|podlog|polug|punjac|rucic|ruck|rukavic|sajl|sark|sedist|senzor|sraf|stalc|stalak|stop|svetl|torb|tocak|unutrasnj|vrat|zadnj|zastit)/.test(title);
    if (scooter) {
      if (accessory) return ["sport", "oprema-trotineti"];
      return ["sport", electric ? "trotineti" : ""];
    }
    if (bicycle) {
      if (accessory) return ["sport", "oprema-bicikli"];
      return ["sport", electric ? "bicikli" : ""];
    }
    // Feedback 01.11: ostala sportska i fitnes oprema ide u Sport i fitnes.
    return ["fitnes", ""];
  }

  if (category === "mobilni") {
    // 3g grana "Oprema za racunare i laptopove" nema mapu kategorija, pa je proveravamo kao racunarsku.
    if (/^oprema za racunare i laptopove/.test(path)) return refineStoreCategory("racunari", "", name, brand, supplierCategory, productType);
    const tablet = TABLET_NAZIV.test(title) || /tablet/.test(path.replace(/(?:telefon\w*|mobiln\w*) i tablet\w*/g, ""));
    // Feedback 20.10: futrola za AirPods ili Buds je dodatak za slusalice, a organizator kablova je oprema.
    if (/airpods|galaxy buds|\bbuds ?\d?\b/.test(title)
      && (/^(?:[\w-]+ ){0,2}(?:futrol\w*|maska|torbic\w*|navlak\w*|case)\b/.test(title) || /futrole za (?:airpods|buds)/.test(path))) return ["audio", ""];
    if (/^(?:[\w-]+ ){0,1}(?:organizator|organizer|drzac|nosac) (?:za )?kabl/.test(title)) return ["mobilni", "oprema"];
    // Bumperi i maske iz "Maske outlet" bez oznake tipa su maske, a "Maska ... glass" je maska, ne staklo.
    if ((["oprema", "razno"].includes(subcategory) && /(?:^|[\/>] ?)bumperi(?: ?[\/>]|$)|maske outlet/.test(path) && !/armband/.test(title))
      || (subcategory === "stakla" && /^(?:maska|futrol\w*)\b/.test(title))) return ["mobilni", tablet ? "maske-tableti" : "maske"];
    if (/zastita kamere/.test(path) || /^zastita kamere\b/.test(title) || (subcategory === "stakla" && /kamer|camera|\blens\b/.test(title))) return ["mobilni", "stakla-kamere"];
    // Staklo koje je dobavljac stavio u maske ("LITO 3D glass") je staklo; "Torbica Shiny glass" ostaje maska.
    if (subcategory === "maske" && type === "staklo" && /^(?:[\w-]+ )?(?:3d |2\.5d |9h )?(?:glass|staklo|tempered)\b/.test(title)
      && !/^(?:maska|futrol\w*|torbic\w*|case|navlak\w*)\b/.test(title)) return ["mobilni", tablet ? "stakla-tableti" : "stakla"];
    if (subcategory === "maske" && tablet) return ["mobilni", "maske-tableti"];
    if (subcategory === "stakla" && tablet) return ["mobilni", "stakla-tableti"];
    if (["maske", "maske-tableti", "stakla", "stakla-tableti", "stakla-kamere", "baterije-telefoni"].includes(subcategory)) return [category, subcategory];
    // Feedback 20.10: telefon iz bilo koje podgrupe ide u telefone, a olovka za ekran u olovke.
    if (/^mobilni telefon\b|^nokia 1[01]0\b/.test(title)) return ["mobilni", "telefoni"];
    if (/touch\s?screen pen|\bstylus\b/.test(title)) return ["mobilni", "olovke"];
    if (subcategory === "telefoni") {
      // Feedback 20.10: tablet ide u tablete, drzaci u drzace, ovde ostaju samo telefoni.
      if (/objektiv|iglic|maket/.test(title)) return ["mobilni", "oprema"];
      if (/^(tablet|tab\b)|\btablet\b|e-?book|handwriting|lcd tabl|tabla za pisanje/.test(title)) return ["mobilni", "tableti"];
      if (/\bbaku\b/.test(title)) return ["alati", "reparacija"];
      // Telefon "+ punjac" ili "bez punjaca" je telefon; punjac mora biti predmet naziva.
      if (/^(?:[\w-]+ ){0,1}(?:kucni |zidni |brzi )?punjac/.test(title)) return ["mobilni", "punjaci"];
      return ["mobilni", "telefoni"];
    }
    // Feedback 20.10: strujni putni adapter je punjac, ne kabl ni racunarski adapter.
    if (/^(?:adapter strujni|eu adapter duckhead|adapter za punjac)\b/.test(title) || /^strujni >/.test(path)) return ["mobilni", "punjaci"];
    if (/\bbnc\b|alarmn|pametne kamere|akcione kamere|fotoaparat|video nadzor/.test(path)
      || /^(?:mini |sigurnosna |akciona |pametna |ip |wifi |web |sportska )?kamer\w*\b|insta ?360|\bgopro\b|\bgo pro\b|doorbell|fotoaparat/.test(title)) return ["tv", "kamere"];
    if (/^(?:[\w-]+ ){0,2}(?:slusalic\w*|handsfree|hands free|earbuds?|airpods|airphones|headset|zvucni[kc]\w*|mp[34]\b)|\bbluetooth zvucni[kc]/.test(title)
      && !/^(?:kabl|kabal|kabel|adapter|punjac|maska|futrol|torbic|drzac|stalak|kutij|nastav|jastuc|navlak|privez|razdelnik|splitter|organizer|sundjer)/.test(title)) return refineStoreCategory("audio", "", name, brand, supplierCategory, productType);
    if (((/\bhub\b|hdmi|displayport|\bvga\b|\bdvi\b|docking|\bkvm\b|citac kartic|card reader|\brj ?45\b|ethernet|\butp\b|\bcat ?[5-8]|\b(usb|fles|flash)\s*(memorij|drive|stick)|\bfles\b|\bonten\b|ac\/dc|usb[ -]?b\b/.test(title)
      || /^adapter.*100-2[45]0\s?v/.test(title)) && !/anycast|mirascreen|chromecast|tv stick|dongle/.test(title))
      || produzniZaStruju(title) || /zvucna karta|bluetooth\b.*\bdongle|kuciste za (?:hdd|ssd)|citac licn/.test(title)
      || /^adapter (?:ssd|m\.2|pci|type c - sata|usb 3\.0 - sata|usb az\b|bluetooth 5\.0 pc|usb riser)|^cable usb to parallel|^kabal usb na rs|usb nastavak|^hdd rack/.test(title)
      || /skladistenje podataka/.test(path)) return refineStoreCategory("racunari", "", name, brand, supplierCategory, productType);
    // Vodootporna futrola ili maska za telefon je maska; vodootporne torbe i torbice su od 01.11 u Sportu i fitnesu.
    if (/^vodootporn\w* (?:futrol|mask)/.test(title)) return ["mobilni", tablet ? "maske-tableti" : "maske"];
    if (/vodootporne torbe/.test(path)) return ["fitnes", "vodootporne-torbe"];
    if (/^(?:[\w-]+ ){0,3}(?:torba|ranac|backpack|dry bag)\b/.test(title)) return ["laptop", RANAC.test(title) ? "rancevi" : "torbe"];
    // E-book citac i tabla za pisanje idu uz tablete i iz opreme.
    if (["oprema", "razno"].includes(subcategory) && /^(?:[\w-]+ ){0,1}(?:e-?book (?:reader|citac)|handwriting tabl|lcd tabl)|tabla za pisanje/.test(title)) return ["mobilni", "tableti"];
    // Kucni aparati i nega iz gadget grana (Xiaomi oprema, higijena).
    if (["oprema", "razno", "baterije", "adapteri"].includes(subcategory)) {
      if (/higijen/.test(path) && !/krpic/.test(title)) return ["kucni", "nega"];
      if (NEGA_NAZIV.test(title)) return ["kucni", "nega"];
      if (jeKucniVentilator(title)) return ["kucni", "ventilatori"];
      if (/^(?:[\w-]+ ){0,2}(?:mini klima|usisivac\w*|kompresor\w*|ovlazivac\w*|pegl\w*)\b/.test(title)) return ["kucni", "aparati"];
      if (/^(?:[\w-]+ ){0,3}(?:baterijsk\w* lamp\w*|lamp\w* za glavu|ceon\w* lamp\w*)\b|lightbar|light bar/.test(title)) return ["kucni", "rasveta"];
      if (/xiaomi oprema/.test(path)) {
        if (/odvijac|srafciger/.test(title)) return ["alati", "pincete-srafcigeri"];
        if (/lamp|lightbar/.test(title)) return ["kucni", "rasveta"];
        if (/brav/.test(title)) return ["kucni", "smart"];
        return ["kucni", "aparati"];
      }
    }
    if (subcategory === "adapteri") return /otg|lightning|type[ -]?c|usb[ -]?c|micro ?usb|3[.,]5|\baux\b|splitter|jack/.test(title) ? ["mobilni", "kablovi"] : ["mobilni", "oprema"];
    if (subcategory === "kablovi") {
      // Feedback 20.10: u data kablovima ostaju samo kablovi.
      if (/zastita za kablove/.test(path) || /^(?:zastit\w* za (?:kabl|kabel|kabal)|organizer za kabl)/.test(title)) return ["mobilni", "oprema"];
      if (/punjaci kucni/.test(path) || /^(?:[\w-]+ ){0,1}(?:kucni |zidni |brzi )?punjac|^kuciste punjac/.test(title)) return ["mobilni", "punjaci"];
      if (/^led lampa 225/.test(title)) return ["stalci", "led-lampe"];
    }
    if (subcategory === "punjaci" && /^(?:[\w-]+ ){0,2}(?:kabl|kabal|kabel|data kabl)\b/.test(title)) return ["mobilni", "kablovi"];
    if (["punjaci", "kablovi", "telefoni", "olovke", "tableti", "powerbank", "oprema"].includes(subcategory)) return [category, subcategory];
    // Powerbanks, AA cells, desk holders and adapters stay available as accessories.
    return ["mobilni", "oprema"];
  }
  if (category === "kucni") {
    if (jeKucniVentilator(title)) return ["kucni", "ventilatori"];
    // Feedback 01.11: fen, brijac, trimer, epilator i elektricna cetkica za zube idu u Negu i kad ih
    // dobavljac drzi direktno u kucnim aparatima, bez "Nega" u putu (npr. XIAOMI Mi UniBlade Trimer).
    if (NEGA_NAZIV.test(title)) return ["kucni", "nega"];
    // Feedback 20.10: kamere, video zvona i akcione kamere idu u TV i kamere.
    if (/(?:akcione|smart|pametne|sigurnosne) kamere|video nadzor/.test(path) || (/kamere i multimedija/.test(path) && /kamer/.test(title))
      || /^(?:[\w-]+ ){0,2}kamer\w*\b|\bgopro\b|\bgo pro\b|\bsjcam\b|pametno zvono|doorbell/.test(title)
      || (subcategory !== "deca" && /foto ?aparat/.test(title))) return ["tv", "kamere"];
    if (/smart tv box/.test(path) || /^(?:[\w-]+ ){0,1}(?:tv|televizor)\b.*(?:\d{2}"|4k|uhd|google tv|android tv)|(?:smart )?tv (?:box|stik|stick)|fire ?tv|set top box|android tv\b|^android (?:smart )?tv\b/.test(title)) return ["tv", "televizori"];
    if (/^(?:[\w-]+ ){0,2}(?:soundbar|zvucni[kc]\w*)\b/.test(title)) return ["audio", "zvucnici"];
    if (/sportsk\w* flas|flas\w* za vodu/.test(title)) return ["fitnes", ""];
    const servisnaIzKucnih = servisnaPodgrupa(title);
    if (servisnaIzKucnih) return ["alati", servisnaIzKucnih];
    if (/elektricn\w* bicikl/.test(path)) return /^(?:[\w-]+ ){0,1}(?:elektricni )?bicikl/.test(title) ? ["sport", "bicikli"] : ["sport", "oprema-bicikli"];
  }
  if (category === "tv") {
    // Reflektor je rasveta, a 433 MHz daljinski i prekidaci su smart oprema.
    if (/^reflektor\b/.test(title)) return ["kucni", "rasveta"];
    if (/433 ?mhz/.test(title)) return ["kucni", "smart"];
    // Dronovi nemaju svoju podgrupu u meniju, pa idu u kamere.
    if (subcategory === "dronovi") return ["tv", "kamere"];
  }
  if (category === "alati") {
    // Alat za otvaranje telefona je alat za reparaciju, kao u servisnoj grani 3g.
    if (/alati za otvaranje i zatvaranje/.test(path)) return ["alati", "reparacija"];
    // Punjac iz grane "Punjaci i testeri" je punjac za telefon; tester i detektor ostaju alat.
    if (/punjaci i testeri/.test(path) && /^(?:[\w-]+ ){0,3}punjac\b/.test(title) && !/tester|detektor|merac/.test(title)) return ["mobilni", "punjaci"];
    // Feedback 27.10 (druga serija): podgrupe servisnog alata vaze i kad artikal dolazi iz
    // dobavljaceve grane alata, ne samo iz servisne grane opreme za mobilne telefone.
    const servisnaIzAlata = servisnaPodgrupa(title, path);
    if (servisnaIzAlata) return ["alati", servisnaIzAlata];
  }
  if (category === "laptop" && ["", "oprema", "torbe", "rancevi"].includes(subcategory)) {
    return prenosnaOpremaZaLaptop(title, path, subcategory) ?? [category, subcategory];
  }
  return [category, subcategory];
}

// Feedback 01.11: tableti i oprema za tablete su posebna kategorija "Tableti i oprema", a podgrupe koje je
// klijent preimenovao ili premestio dobijaju novo mesto bez obzira na granu koja ih je razvrstala.
const TABLET_PODGRUPE = new Set(["maske-tableti", "stakla-tableti", "tableti", "baterije-tableti"]);
// Feedback 03.11: "Laptop i oprema" je nova kategorija. Baterije, punjaci i tastature za laptop se sele iz racunara
// (LCD paneli ostaju), a artikli bez podgrupe dobijaju nove podgrupe po nazivu. Pravila rade samo nad racunarima.
const LAPTOP_PODGRUPE = new Set(["laptop-baterije", "laptop-punjaci", "laptop-tastature"]);
const SSD_ADAPTER = /^(?:adapter (?:ssd|m\.?2|nvme|msata)\b|ssd\b)|\bm\.2 ssd\b/;
const LAPTOP_HLADNJAK = /^(?:laptop (?:cooler|stalak|postolje)|postolje (?:cooler )?za laptop|stalak za laptop)\b/;
const RACUNARSKO_KUCISTE = /^(?:white shark )?kuciste\b(?! (?:za|punjac))/;
const RACUNARSKO_NAPAJANJE = /^(?:white shark )?napajanje\b.*(?:\b\d{3,4} ?w\b|\batx\b)/;
function novaPodgrupaRacunara(kategorija: string, podkategorija: string, title: string): StoreCategory | null {
  if (kategorija !== "racunari") return null;
  if (LAPTOP_PODGRUPE.has(podkategorija)) return ["laptop", podkategorija];
  // Stara podgrupa "Racunari i laptopovi" je sada "Laptopovi" u kategoriji Laptop i oprema.
  if (podkategorija === "racunari") return ["laptop", "laptopovi"];
  if (/^polica za monitor\b/.test(title)) return ["racunari", "eksterni-monitori"];
  if ((podkategorija === "" || podkategorija === "kablovi-adapteri") && SSD_ADAPTER.test(title) && !/^kuciste|enclosure|\brack\b/.test(title)) return ["laptop", "ssd-adapteri"];
  if (podkategorija !== "") return null;
  if (LAPTOP_HLADNJAK.test(title)) return ["laptop", "hladnjaci-postolja"];
  if (RACUNARSKO_KUCISTE.test(title) || RACUNARSKO_NAPAJANJE.test(title)) return ["racunari", "kucista-napajanja"];
  if (/^web ?kamer/.test(title)) return ["racunari", "web-kamere"];
  if (/^memorija ddr\d?\b/.test(title)) return ["racunari", "ram-memorije"];
  return null;
}
// Olovka za tablet ima tablet, tab ili iPad u nazivu; Apple Pencil, univerzalne N2 i Y2 i Moxom MX-SP10/13/14 su sa slike klijenta.
const OLOVKA_ZA_TABLET = /tablet|\btab\b|\bipad|apple pencil|\bn2\b|\by2\b|mx-sp1[034]/;
export function refineStoreCategory(
  category: string,
  subcategory: string,
  name: string,
  brand: string,
  supplierCategory = "",
  productType = "",
): StoreCategory {
  const [kategorija, podkategorija] = razvrstaj(category, subcategory, name, brand, supplierCategory, productType);
  const novoMesto = novaPodgrupaRacunara(kategorija, podkategorija, normalize(name));
  if (novoMesto) return novoMesto;
  // Oprema iz grane "Mrezna oprema" bez podgrupe je Mrezna oprema.
  if (kategorija === "racunari" && podkategorija === ""
    && (subcategory === "mrezna" || /mrezna oprema/.test(normalize(supplierCategory)))) return ["racunari", "mrezni-kablovi"];
  if (kategorija === "auto" && podkategorija === "punjaci") return ["auto", "auto-punjaci"];
  if (kategorija === "alati" && podkategorija === "folije") return ["mobilni", "folije"];
  if (kategorija !== "mobilni") return [kategorija, podkategorija];
  if (TABLET_PODGRUPE.has(podkategorija)) return ["tableti", podkategorija];
  if (podkategorija === "olovke" && OLOVKA_ZA_TABLET.test(normalize(name))) return ["tableti", "olovke-tableti"];
  return [kategorija, podkategorija];
}

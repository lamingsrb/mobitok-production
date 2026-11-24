// Customer-facing names and navigation order from the 10 and 20 October and 1 November feedback.
// A requested menu group stays visible when its stock is temporarily empty.
// Filters only include groups present in the current search results.
export const categorySubcategoryOrder: Record<string, readonly string[]> = {
  mobilni: ["maske", "stakla", "stakla-kamere", "baterije-telefoni", "punjaci", "kablovi", "powerbank", "telefoni", "mp3-playeri", "olovke", "folije", "oprema"],
  tableti: ["maske-tableti", "stakla-tableti", "tableti", "baterije-tableti", "olovke-tableti"],
  // Feedback 03.11: baterije, punjaci i tastature za laptop, stari "Racunari i laptopovi" (sada "Laptopovi"),
  // hladnjaci i postolja te SSD su u kategoriji "Laptop i oprema"; u racunarima su ostali LCD paneli.
  racunari: ["laptop-ekrani", "kablovi-adapteri", "produzni-kablovi", "mrezni-kablovi", "memorije", "ram-memorije", "kuleri-hladnjaci", "kucista-napajanja", "web-kamere", "tastature", "misevi", "podloge", "eksterni-monitori"],
  laptop: ["laptopovi", "laptop-baterije", "laptop-punjaci", "laptop-tastature", "hladnjaci-postolja", "ssd-adapteri", "torbe", "rancevi"],
  gejming: ["slusalice", "misevi", "tastature", "podloge", "stolovi-stolice", "gamepad", "combo-setovi", "gejming-oprema"],
  audio: ["zvucnici", "mikrofoni", "slusalice-bluetooth", "slusalice-zicane"],
  sport: ["bicikli", "trotineti", "kacige", "oprema-trotineti", "oprema-bicikli"],
  satovi: ["pametni-satovi", "deciji-satovi", "narukvice", "punjaci-satovi", "oprema-satovi"],
  konzole: ["konzole-uredjaji", "dzojstici-ps4", "dzojstici-ps5", "oprema-ps4", "oprema-ps5"],
  auto: ["auto-punjaci", "drzaci", "navigacija", "auto-kamere", "fm-transmiteri", "starteri", "oprema"],
  tv: ["televizori", "tv-stick", "tv-daljinski", "tv-nosaci", "projektori", "kamere", "stampaci-toneri"],
  stalci: ["tripodi", "gimbali", "led-lampe", "drzaci-telefoni"],
  fitnes: ["koferi", "kampovanje", "termos-dose", "vodootporne-torbe"],
};

export const subcategoryNames: Record<string, string> = {
  maske: "Maske",
  "maske-tableti": "Maske za tablete",
  stakla: "Zaštitna stakla za telefone",
  "stakla-tableti": "Zaštitna stakla za tablete",
  "stakla-kamere": "Zaštita za kameru",
  punjaci: "Punjači",
  kablovi: "Data kablovi",
  powerbank: "Powerbank",
  slusalice: "Slušalice",
  tastature: "Tastature",
  misevi: "Miševi",
  podloge: "Podloge",
  "stolovi-stolice": "Stolovi i stolice",
  gamepad: "Gamepad i joypad",
  "combo-setovi": "Combo setovi",
  "konzole-uredjaji": "Konzole",
  "dzojstici-ps4": "Džojstici PS4",
  "dzojstici-ps5": "Džojstici PS5",
  "oprema-ps4": "Ostala oprema za PS4",
  "oprema-ps5": "Ostala oprema za PS5",
  "gejming-oprema": "Dodatna oprema",
  lemilice: "Lemilice i duvaljke",
  mikroskopi: "Mikroskopi i kamere",
  separatori: "Separatori i ultrazvučne kade",
  "pincete-srafcigeri": "Pincete, šrafcigeri i klešta",
  zvucnici: "Zvučnici",
  mikrofoni: "Mikrofoni",
  baterije: "Baterije",
  drzaci: "Držači",
  adapteri: "Adapteri",
  alati: "Alati",
  telefoni: "Telefoni",
  tableti: "Tableti",
  satovi: "Pametni satovi i narukvice",
  "pametni-satovi": "Pametni satovi",
  "deciji-satovi": "Pametni satovi za decu",
  narukvice: "Narukvice",
  "punjaci-satovi": "Punjači za satove",
  "oprema-satovi": "Ostala oprema",
  olovke: "Olovke za ekran",
  "mp3-playeri": "MP3 i MP4 playeri",
  pripejd: "Pripejd kartice",
  "fm-transmiteri": "FM transmiteri",
  navigacija: "Navigacija",
  "auto-kamere": "Auto kamere",
  starteri: "Starteri i kompresori",
  "tv-nosaci": "TV nosači",
  projektori: "Projektori",
  "stampaci-toneri": "Štampači i toneri",
  "tv-daljinski": "TV daljinski",
  // Feedback 02.11: klijent je podgrupu "TV Stick" preimenovao u "Smart TV Box"; kljuc ostaje zbog postojecih linkova.
  "tv-stick": "Smart TV Box",
  tripodi: "Tripodi",
  gimbali: "Gimbali",
  "led-lampe": "LED lampe",
  "drzaci-telefoni": "Držači za telefone",
  "slusalice-bluetooth": "Bluetooth slušalice",
  "slusalice-zicane": "Žične slušalice",
  memorije: "Memorijske kartice i USB flash",
  "kuleri-hladnjaci": "Kuleri i hladnjaci za procesore",
  laptopovi: "Laptopovi",
  // Stari kljuc "racunari" (podgrupa "Racunari i laptopovi") do ponovne objave dobavljaca.
  racunari: "Laptopovi",
  "hladnjaci-postolja": "Hladnjaci i postolja za laptop",
  "ssd-adapteri": "SSD memorije i adapteri",
  "kucista-napajanja": "Kućišta i napajanja",
  "web-kamere": "Web kamere",
  "ram-memorije": "RAM memorije",
  oprema: "Oprema i dodaci",
  televizori: "Televizori",
  kamere: "Kamere i multimedija",
  dronovi: "Dronovi",
  mobilnost: "Trotineti i mobilnost",
  aparati: "Kućni aparati",
  ventilatori: "Ventilatori",
  preciscivaci: "Prečišćivači i difuzeri",
  "baterije-punjaci": "Baterije i punjači",
  nega: "Nega i lepota",
  folije: "Mašine i folije za telefone",
  razno: "Ostalo",
  periferije: "Tastature, miševi i podloge",
  mrezna: "Mrežna oprema",
  komponente: "Komponente",
  hemikalije: "Hemikalije i materijali",
  reparacija: "Alati za reparaciju",
  merna: "Merna oprema",
  "radni-prostor": "Radni prostor",
  industrija: "Industrijska automatizacija",
  smart: "Smart oprema",
  rasveta: "Rasveta i osvetljenje",
  deca: "Dečija oprema",
  auto: "Auto oprema",
  bicikli: "Električni bicikli",
  trotineti: "Električni trotineti",
  kacige: "Kacige",
  "oprema-trotineti": "Oprema za trotinete",
  "oprema-bicikli": "Oprema za bicikle i motore",
  koferi: "Koferi",
  fitness: "Sport i fitnes",
  "delovi-telefoni": "Delovi za telefone",
  "laptop-delovi": "Delovi za laptopove",
  "laptop-baterije": "Baterije za laptop",
  "laptop-punjaci": "Punjači za laptop",
  "laptop-tastature": "Tastature za laptop",
  "laptop-ekrani": "LCD paneli za laptop",
  "kablovi-adapteri": "Kablovi i adapteri",
  "produzni-kablovi": "Produžni kablovi",
  "mrezni-kablovi": "Mrežna oprema",
  "eksterni-monitori": "Monitori i eksterni monitori",
  torbe: "Torbe",
  rancevi: "Rančevi",
  "baterije-telefoni": "Baterije za mobilne telefone",
  "delovi-racunari": "Delovi za laptopove",
  "delovi-baterije": "Baterije za mobilne telefone",
  "delovi-ostalo": "Ostali delovi",
  "baterije-tableti": "Baterije za tablete",
  "olovke-tableti": "Olovke za tablete",
  "novogodisnji-ukrasi": "Novogodišnji ukrasi",
  "akcione-kamere": "Akcione kamere i oprema",
  "ciscenje-periferije": "Mašina za čišćenje periferije",
  "auto-punjaci": "Auto punjači",
  kampovanje: "Oprema za kampovanje",
  "termos-dose": "Termos dose",
  "vodootporne-torbe": "Vodootporne torbe",
};

export const subcategoryName = (key: string) => subcategoryNames[key] || key.replaceAll("-", " ");

export function sortSubcategories(category: string, available: readonly string[]): string[] {
  const keys = [...new Set(available.filter(Boolean))];
  const order = categorySubcategoryOrder[category];
  if (order) return order.filter((key) => keys.includes(key));
  const last = new Set(["razno", "delovi-ostalo", "oprema"]);
  return keys.sort((a, b) => Number(last.has(a)) - Number(last.has(b)));
}

export function menuSubcategories(category: string, available: readonly string[]): string[] {
  return categorySubcategoryOrder[category] ? [...categorySubcategoryOrder[category]] : sortSubcategories(category, available);
}

// Preserve shared links when a whole group moves. Removed phone parts stay an
// empty query: they must never redirect to unrelated items or become purchasable.
export function relocatedCategory(category: string, subcategory: string): [string, string] | null {
  if (category === "delovi") return subcategory === "delovi-racunari" ? ["racunari", ""] : ["mobilni", subcategory === "delovi-baterije" ? "baterije-telefoni" : "delovi-telefoni"];
  if (category === "mobilni") {
    if (subcategory === "satovi") return ["satovi", ""];
    if (subcategory === "auto" || subcategory === "fm-transmiteri") return ["auto", subcategory === "auto" ? "" : subcategory];
    if (subcategory === "drzaci") return ["stalci", "drzaci-telefoni"];
    if (["razno", "baterije", "adapteri"].includes(subcategory)) return ["mobilni", "oprema"];
    // Feedback 01.11: tableti i oprema za tablete su posebna kategorija.
    if (["maske-tableti", "stakla-tableti", "tableti"].includes(subcategory)) return ["tableti", subcategory];
  }
  // Feedback 01.11: masine i folije za telefone su u mobilnoj opremi, a auto punjaci imaju svoj kljuc.
  if (category === "alati" && subcategory === "folije") return ["mobilni", "folije"];
  if (category === "auto" && subcategory === "punjaci") return ["auto", "auto-punjaci"];
  if (category === "racunari") {
    if (subcategory === "torbe") return ["laptop", "torbe"];
    if (["kablovi", "adapteri"].includes(subcategory)) return ["racunari", "kablovi-adapteri"];
    // Feedback 01.11: "Mrezni kablovi" su sada "Mrezna oprema", sa svom mreznom opremom.
    if (subcategory === "mrezna") return ["racunari", "mrezni-kablovi"];
    if (["laptop-delovi", "komponente", "oprema", "periferije"].includes(subcategory)) return ["racunari", ""];
    // Feedback 03.11: baterije, punjaci i tastature za laptop i "Racunari i laptopovi" su u kategoriji "Laptop i oprema".
    if (["laptop-baterije", "laptop-punjaci", "laptop-tastature"].includes(subcategory)) return ["laptop", subcategory];
    if (subcategory === "racunari") return ["laptop", "laptopovi"];
  }
  if (category === "konzole" && ["dzojstici-ps", "oprema-ps"].includes(subcategory)) return ["konzole", ""];
  if (category === "gejming" && subcategory === "oprema") return ["gejming", "gejming-oprema"];
  if (category === "audio") {
    if (subcategory === "slusalice") return ["audio", ""];
    // Feedback 27.10: bezicne slusalice su spojene u bluetooth grupu.
    if (subcategory === "slusalice-bezicne") return ["audio", "slusalice-bluetooth"];
  }
  // Feedback 01.11: sportska i fitnes oprema i koferi su nova kategorija "Sport i fitnes".
  if (category === "sport" && subcategory === "fitness") return ["fitnes", ""];
  if (category === "sport" && subcategory === "koferi") return ["fitnes", "koferi"];
  if (category === "sport" && subcategory === "mobilnost") return ["sport", ""];
  return null;
}

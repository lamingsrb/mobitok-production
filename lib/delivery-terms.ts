// Cena dostave i rok isporuke iz podesavanja prodavnice, u istim recenicama za korpu,
// stranicu proizvoda, FAQ, Uslove i /dostava (pregled 18.10.2026). Uneta vrednost se
// navodi, a ono sto vlasnik jos nije uneo potvrdjujemo pri potvrdi porudzbine, pa sajt
// ne protivreci adminu kada se cena ili rok upisu. Besplatna dostava vazi od navedenog
// iznosa, kao i obracun u korpi (ukupno >= prag).

export type PodesavanjaDostave = {
  deliveryFee: number | null;
  deliveryFreeOver: number | null;
  deliveryTime: string | null;
};

// Rok kako ga je vlasnik upisao, bez razmaka i zavrsne tacke, jer ga recenice
// same zavrsavaju tackom ("1–2 radna dana." ne postaje "1–2 radna dana..").
export function ocistiRok(rok: string | null | undefined) {
  return (rok ?? "").trim().replace(/\.+$/, "");
}

export function opisDostave(p: PodesavanjaDostave, iznos: (vrednost: number) => string) {
  const cena =
    p.deliveryFee === 0
      ? "Dostava je besplatna."
      : p.deliveryFee !== null
        ? `Dostava se naplaćuje ${iznos(p.deliveryFee)}${p.deliveryFreeOver !== null ? `, a besplatna je za porudžbine od ${iznos(p.deliveryFreeOver)}` : ""}.`
        : p.deliveryFreeOver !== null
          ? `Dostava je besplatna za porudžbine od ${iznos(p.deliveryFreeOver)}.`
          : "";
  const rokTekst = ocistiRok(p.deliveryTime);
  const rok = rokTekst ? `Uobičajen rok isporuke je ${rokTekst}.` : "";
  const potvrda =
    p.deliveryFee === null && !rokTekst
      ? "Cenu dostave i rok isporuke potvrđujemo pri potvrdi porudžbine."
      : p.deliveryFee === null
        ? "Cenu dostave potvrđujemo pri potvrdi porudžbine."
        : !rokTekst
          ? "Rok isporuke potvrđujemo pri potvrdi porudžbine."
          : "";
  return { cena, rok, potvrda, tekst: [cena, rok, potvrda].filter(Boolean).join(" ") };
}

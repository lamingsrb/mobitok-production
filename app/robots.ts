import type { MetadataRoute } from "next";

const SAJT = (process.env.NEXT_PUBLIC_SITE_URL || "https://mobitok.rs").replace(/\/+$/, "");

// Korpa, placanje, nalog, favoriti i admin su licne strane i ne idu u pretragu.
// /api/ ostaje otvoren: preko njega strane ucitavaju artikle i slike, a
// pretrazivac mora da ih vidi da bi stranu prikazao onako kako je kupac vidi.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/nalog", "/korpa", "/placanje", "/favoriti"],
    },
    sitemap: `${SAJT}/sitemap.xml`,
  };
}

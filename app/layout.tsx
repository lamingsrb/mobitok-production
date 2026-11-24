import type { Metadata, Viewport } from "next";
import { Geist, Manrope } from "next/font/google";
import "./globals.css";
import "./cinematic-theme.css";
import "./cinematic-home.css";
const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
});
const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-manrope",
});
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://mobitok.rs",
  ),
  // Bez reci "servis": prodavnica ne nudi popravke (pregled 18.10.2026).
  title: {
    default: "MOBITOK — Telefoni i oprema",
    template: "%s | MOBITOK",
  },
  description:
    "Telefoni, mobilna i računarska oprema, gejming, audio, rezervni delovi i alati. Pronađi pravu opremu za svoj uređaj.",
  robots: { index: true, follow: true },
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  openGraph: {
    title: "MOBITOK — Telefoni i oprema",
    description:
      "Telefoni i oprema za tvoj uređaj. Pogledaj novu MOBITOK prodavnicu.",
    type: "website",
    locale: "sr_RS",
    images: [{ url: "/images/hero-audio.webp", width: 1536, height: 1024 }],
  },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#20182f",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sr-Latn" className={geist.variable + " " + manrope.variable}>
      <body>
        {children}
      </body>
    </html>
  );
}

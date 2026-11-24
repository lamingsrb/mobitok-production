import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // Besplatan Vercel plan ima 5.000 optimizacija slika mesecno, a katalog
    // oko 25.000 artikala. Slike se zato salju kakve jesu: btm direktno sa
    // dobavljaca, trig kroz nasu rutu koju kesira Vercel CDN.
    unoptimized: true,
    // Fotografije artikala dolaze sa dobavljacevog servera. Pisana saglasnost
    // za koriscenje sadrzaja dobijena mejlom 16.09.2026.
    remotePatterns: [
      { protocol: "https", hostname: "btm.rs", pathname: "/images/**" },
      { protocol: "https", hostname: "www.btm.rs", pathname: "/images/**" },
      // Digital Vision salje https slike koje se prikazuju direktno (MS Mobile ide kroz nasu rutu).
      { protocol: "https", hostname: "digitalvision.rs", pathname: "/**" },
      { protocol: "https", hostname: "www.digitalvision.rs", pathname: "/**" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

"use client";

import Image from "next/image";
import { ImageOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Product } from "@/lib/catalog";
import { supplierCardImageURL, malformedBTMImage } from "@/lib/catalog-card-image";

/** Fixed small presets only on cards. Detail and zoom keep the original source. */
export default function ProductCardImage({ product }: { product: Product }) {
  const thumbnail = supplierCardImageURL(product);
  const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);
  const [failedOriginal, setFailedOriginal] = useState<string | null>(null);
  const pendingImage = useRef<HTMLSpanElement | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  useEffect(() => {
    if (nearViewport || !pendingImage.current) return;
    if (typeof IntersectionObserver === "undefined") { setNearViewport(true); return; }
    let observer: IntersectionObserver | undefined;
    let mounted = true;
    try {
      observer = new IntersectionObserver(entries => {
        if (mounted && entries.some(entry => entry.isIntersecting)) {
          observer?.disconnect();
          setNearViewport(true);
        }
      }, { rootMargin: "200px 0px", threshold: 0 });
      observer.observe(pendingImage.current);
    } catch {
      observer?.disconnect();
      setNearViewport(true);
    }
    return () => { mounted = false; observer?.disconnect(); };
  }, [nearViewport, product.image]);

  const source = thumbnail && failedThumbnail !== thumbnail ? thumbnail : product.image;
  if (!product.image || malformedBTMImage(product.image) || failedOriginal === product.image) {
    return <span className="product-image product-image-placeholder" data-product-image-placeholder
      role="img" aria-label="Fotografija trenutno nije dostupna"
      style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 10, padding: 12, textAlign: "center", color: "var(--muted)", fontSize: 12, lineHeight: 1.5 }}>
      <ImageOff size={32} strokeWidth={1.25} aria-hidden="true" />
      <span aria-hidden="true">Fotografija trenutno nije dostupna</span>
    </span>;
  }
  if (!nearViewport) return <span ref={pendingImage}
    className="product-image product-image-pending" data-product-image-pending
    role="img" aria-label={product.name} style={{ display: "block" }} />;
  return <Image key={source} src={source} alt={product.name} width={480} height={480}
    referrerPolicy="no-referrer" decoding="async" loading="lazy"
    className="product-image " sizes="(max-width: 600px) 45vw, (max-width: 1100px) 30vw, 320px"
    onError={() => {
      if (thumbnail && source === thumbnail) setFailedThumbnail(thumbnail);
      else setFailedOriginal(product.image);
    }} />;
}

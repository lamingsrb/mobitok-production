"use client";

import CinematicHome from "@/components/cinematic-home";
import Storefront, { DeviceFinder, ProductCard } from "@/components/storefront";

export default function Home() {
  return (
    <Storefront path={[]}>
      <CinematicHome
        renderProduct={product => <ProductCard product={product} />}
        deviceFinder={<DeviceFinder deferUntilIntent />}
      />
    </Storefront>
  );
}

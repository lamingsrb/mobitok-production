import Link from "next/link";
export default function NotFound() {
  return (
    <main className="not-found">
      <span className="eyebrow">MOBITOK / 404</span>
      <h1>
        Ova veza je
        <br />
        ostala bez signala.
      </h1>
      <p>Proizvod ili stranica koju tražiš nisu ovde.</p>
      <Link className="button button-lime" href="/katalog">
        Istraži opremu →
      </Link>
    </main>
  );
}

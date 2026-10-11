import Link from "next/link";
import { NotFoundServices } from "@/components/NotFoundServices";

export default function NotFound() {
  return (
    <section className="recovery-page not-found-page" aria-labelledby="not-found-title">
      <svg
        className="broken-path"
        viewBox="0 0 320 64"
        role="img"
        aria-label="Connection path interrupted"
      >
        <circle cx="22" cy="32" r="8" />
        <path d="M30 32h92m18 0h112" />
        <circle cx="270" cy="32" r="8" />
        <circle cx="131" cy="32" r="5" />
      </svg>
      <p className="eyebrow">404</p>
      <h1 id="not-found-title">Halaman tidak ditemukan.</h1>
      <p>Alamat mungkin berubah atau link sudah tidak berlaku.</p>
      <Link
        className="button-primary recovery-home"
        href="/"
        style={{ borderRadius: "var(--radius-pill)" }}
      >
        Kembali ke Home
      </Link>
      <NotFoundServices />
    </section>
  );
}

"use client";

import { useId } from "react";

export function RecoveryError({ retry, digest }: { retry: () => void; digest?: string }) {
  const id = useId()
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-8)
    .toUpperCase();
  return (
    <section
      className="recovery-page"
      aria-labelledby="recovery-title"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-soft)",
        padding: "clamp(1.5rem, 4vw, 2.5rem)",
      }}
    >
      <p className="eyebrow">Something went wrong</p>
      <h1 id="recovery-title">Halaman belum dapat ditampilkan.</h1>
      <p>Coba refresh halaman. Jika perlu bantuan, sertakan error code berikut.</p>
      <p className="recovery-code">Error code: {digest?.slice(0, 8) ?? id}</p>
      <button
        className="button-primary"
        type="button"
        onClick={retry}
        style={{ borderRadius: "var(--radius-pill)" }}
      >
        Try again
      </button>
    </section>
  );
}

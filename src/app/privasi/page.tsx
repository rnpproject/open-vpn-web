export const metadata = { title: "Privasi" };
export default function Privasi() {
  return (
    <article className="panel legal" style={{ borderRadius: "var(--radius-lg)" }}>
      <h1 style={{ fontFamily: "var(--font-sans)" }}>Privacy policy
      </h1>
      <p>Terakhir diperbarui: 8 Oktober 2026.</p>
      <p>
        Web app tidak menyimpan kredensial akun di database atau log. Untuk rate limit, log dapat memuat waktu, service, durasi, salted IP hash, dan hasil request. Counter rate limit memakai hash dan dihapus sesuai masa berlaku.
      </p>
      <p>
        Jika diaktifkan, Cloudflare Turnstile memproses security verification. Salinan sementara detail akun disimpan di sessionStorage pada tab Anda hingga 30 menit atau sampai hasil ditutup.
      </p>
    </article>
  );
}

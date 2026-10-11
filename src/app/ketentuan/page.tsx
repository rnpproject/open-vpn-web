export const metadata = { title: "Ketentuan" };
export default function Ketentuan() {
  return (
    <article className="panel legal" style={{ borderRadius: "var(--radius-lg)" }}>
      <h1 style={{ fontFamily: "var(--font-sans)" }}>Terms layanan</h1>
      <p>Terakhir diperbarui: 8 Oktober 2026.</p>
      <p>
        Service ini tersedia gratis apa adanya, tanpa jaminan uptime atau kesesuaian untuk tujuan tertentu.
      </p>
      <p>
        Dilarang menggunakan service untuk spam, serangan, pelanggaran hukum, atau penyalahgunaan lainnya. Akun dapat dibatasi atau dicabut. Quota harian berlaku untuk setiap service.
      </p>
      <p>Anda bertanggung jawab atas penggunaan akun dan koneksi yang dibuat melalui portal ini.</p>
    </article>
  );
}

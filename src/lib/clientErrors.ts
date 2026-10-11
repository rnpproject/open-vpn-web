export function clientErrorMessage(
  status?: number,
  code?: string,
  retryAfter?: string | null,
): string {
  if (code === "invalid_request")
    return "Service atau durasi tidak tersedia. Refresh halaman lalu pilih kembali.";
  if (code === "verification_failed")
    return "Security verification gagal. Selesaikan verifikasi lalu coba lagi.";
  if (code === "forbidden_origin" || status === 415 || status === 413)
    return "Request ditolak. Refresh halaman lalu coba lagi.";
  if (code === "rate_limited")
    return `Terlalu banyak request. Coba lagi dalam ${Math.max(1, Math.ceil(Number(retryAfter ?? 60) / 60))} menit.`;
  if (code === "quota_exhausted")
    return "Quota service hari ini habis. Reset pukul 00.00 WIB.";
  if (code === "conflict") return "Akun belum dapat dibuat. Coba lagi.";
  if (code === "service_unavailable" || code === "store_unavailable")
    return "Service sedang sibuk atau tidak dapat dihubungi. Coba lagi sebentar.";
  if (code === "creation_unknown")
    return "Status pembuatan akun belum pasti. Jangan klik berulang kali. Tunggu beberapa menit lalu cek kembali.";
  if (code === "network")
    return "Tidak dapat terhubung ke internet. Periksa koneksi lalu coba lagi.";
  if (code === "timeout")
    return "Permintaan memakan waktu terlalu lama. Akun mungkin sudah dibuat. Tunggu 2–3 menit sebelum mencoba lagi.";
  return "Terjadi error pada server. Coba lagi.";
}

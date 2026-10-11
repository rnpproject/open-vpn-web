import { describe, expect, test } from "vitest";
import { clientErrorMessage } from "../src/lib/clientErrors";

describe("clientErrors", () => {
  test("maps request errors to useful Indonesian messages", () => {
    expect(clientErrorMessage(undefined, "invalid_request")).toContain("durasi tidak tersedia");
    expect(clientErrorMessage(undefined, "verification_failed")).toContain("Verifikasi keamanan");
    expect(clientErrorMessage(415)).toContain("Permintaan ditolak");
    expect(clientErrorMessage(undefined, "rate_limited", "600")).toContain("10 menit");
    expect(clientErrorMessage(undefined, "quota_exhausted")).toContain("00.00 WIB");
    expect(clientErrorMessage(undefined, "service_unavailable")).toContain("tidak dapat dihubungi");
    expect(clientErrorMessage(undefined, "creation_unknown")).toContain(
      "Status pembuatan akun tidak pasti",
    );
    expect(clientErrorMessage(undefined, "network")).toContain("Periksa koneksi");
    expect(clientErrorMessage(undefined, "timeout")).toContain("memakan waktu terlalu lama");
    expect(clientErrorMessage()).toContain("Terjadi kesalahan di server");
  });
});

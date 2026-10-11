import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const dev = process.env.NODE_ENV === "development";
  // Kebijakan "tanpa nonce": halaman situs ini campuran statis (prerender build-time)
  // dan dinamis. Nonce per-request tidak bisa ditempel ke HTML statis, dan
  // 'strict-dynamic' akan memblokir script Next (termasuk bootstrap inline
  // self.__next_f) di halaman statis sehingga hidrasi mati total. Karena itu
  // dipakai pola "Without Nonces" dari dokumentasi Next: script/style seasal
  // 'self' + inline diizinkan. Output React ter-escape dan tidak ada
  // dangerouslySetInnerHTML, jadi risiko XSS praktis tetap rendah. Bila kelak
  // semua halaman kembali force-dynamic, nonce CSP bisa diaktifkan lagi.
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self' https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
  const path = request.nextUrl.pathname;
  const adminPath =
    path === "/admin" ||
    path.startsWith("/admin/") ||
    path === "/api/admin" ||
    path.startsWith("/api/admin/");
  const statusPath = path === "/api/health";
  const assetPath = /\.[a-z0-9]+$/i.test(path) || path.startsWith("/_next/");
  const forced = process.env.FORCE_MAINTENANCE === "1" && !adminPath && !statusPath && !assetPath;
  // Halaman maintenance statis tidak punya script sama sekali dan memakai <style>
  // inline: ia butuh CSP tersendiri yang melarang script total.
  const staticCsp = [
    "default-src 'self'",
    "script-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  let response: NextResponse;
  if (forced && path.startsWith("/api/")) {
    response = NextResponse.json(
      { error: { code: "maintenance", message: "Portal sedang dalam pemeliharaan." } },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "300" } },
    );
  } else if (forced) {
    const html = readFileSync(resolve(process.cwd(), "public", "maintenance-static.html"));
    response = new NextResponse(html, {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "300",
        "Content-Security-Policy": staticCsp,
      },
    });
    response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
    if (!dev)
      response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    return response;
  } else {
    response = NextResponse.next();
  }
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  );
  if (!dev)
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };

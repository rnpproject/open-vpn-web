import { NextResponse } from "next/server";
import { z } from "zod";
import {
  adminSessionCookie,
  createAdminSession,
  isAdminEmail,
  isSameOrigin,
  verifyAdminPassword,
} from "@/lib/adminAuth";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
});

const response = (body: unknown, status: number) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return response({ error: "Permintaan tidak diizinkan." }, 403);
  const raw = await request.text();
  if (raw.length > 4096) return response({ error: "Permintaan terlalu besar." }, 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return response({ error: "Email atau password tidak valid." }, 400);
  }
  const parsed = credentialsSchema.safeParse(body);
  if (!parsed.success) return response({ error: "Email atau password tidak valid." }, 400);

  const env = getEnv();
  if (!env.ADMIN_EMAILS.length || !env.ADMIN_PASSWORD_HASH || !env.ADMIN_SESSION_SECRET)
    return response({ error: "Login admin belum dikonfigurasi." }, 503);

  try {
    const passwordMatches = await verifyAdminPassword(
      parsed.data.password,
      env.ADMIN_PASSWORD_HASH,
    );
    if (!passwordMatches || !isAdminEmail(parsed.data.email))
      return response({ error: "Email atau password tidak valid." }, 401);

    const email = parsed.data.email.toLowerCase();
    const session = createAdminSession(email);
    const result = response({ data: { email } }, 200);
    result.headers.append("Set-Cookie", adminSessionCookie(session));
    return result;
  } catch (cause) {
    console.error(
      "Konfigurasi autentikasi admin tidak valid.",
      cause instanceof Error ? cause.message : "UnknownError",
    );
    return response({ error: "Konfigurasi login admin tidak valid." }, 503);
  }
}

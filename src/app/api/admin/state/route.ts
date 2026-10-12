import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOrigin, readAdminIdentity, type AdminIdentity } from "@/lib/adminAuth";
import { getSiteSettings, quotaStoreName, setSiteSettings } from "@/lib/firestore";

export const dynamic = "force-dynamic";

const siteSettingsSchema = z
  .object({
    mode: z.enum(["normal", "notice", "maintenance", "closed"]),
    message: z.string().trim().max(280),
    estimatedEndAt: z.string().datetime().optional(),
    pausedServices: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,60}$/)).max(100),
  })
  .strict();

const response = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function requireAdmin(
  request: Request,
): Promise<{ identity: AdminIdentity } | { response: NextResponse }> {
  try {
    const identity = await readAdminIdentity(request);
    return identity
      ? { identity }
      : { response: response({ error: "Login admin diperlukan." }, 401) };
  } catch (cause) {
    console.error(
      "Verifikasi sesi admin gagal.",
      cause instanceof Error ? cause.name : "UnknownError",
    );
    return { response: response({ error: "Layanan admin sementara tidak tersedia." }, 503) };
  }
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;
  try {
    const settings = await getSiteSettings();
    if (!settings) return response({ error: "Status situs belum dapat dibaca." }, 503);
    return response({
      data: {
        settings,
        persistent: quotaStoreName() !== "memory",
        forcedMaintenance: process.env.FORCE_MAINTENANCE === "1",
      },
    });
  } catch (cause) {
    console.error(
      "Gagal membaca pengaturan situs.",
      cause instanceof Error ? cause.name : "UnknownError",
    );
    return response({ error: "Status situs belum dapat dibaca." }, 503);
  }
}

export async function PUT(request: Request) {
  if (!isSameOrigin(request)) return response({ error: "Permintaan tidak diizinkan." }, 403);
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;
  if (process.env.FORCE_MAINTENANCE === "1")
    return response({ error: "Matikan FORCE_MAINTENANCE sebelum mengubah mode situs." }, 409);
  if (quotaStoreName() === "memory")
    return response({ error: "Pengaturan situs memerlukan QUOTA_STORE yang persisten." }, 503);

  const raw = await request.text();
  if (raw.length > 8192) return response({ error: "Permintaan terlalu besar." }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return response({ error: "Pengaturan situs tidak valid." }, 400);
  }
  const parsed = siteSettingsSchema.safeParse(body);
  if (!parsed.success) return response({ error: "Pengaturan situs tidak valid." }, 400);

  try {
    const settings = await setSiteSettings(parsed.data, auth.identity.email);
    return response({ data: { settings, persistent: true, forcedMaintenance: false } });
  } catch (cause) {
    console.error(
      "Gagal menyimpan pengaturan situs.",
      cause instanceof Error ? cause.name : "UnknownError",
    );
    return response({ error: "Pengaturan situs gagal disimpan." }, 503);
  }
}

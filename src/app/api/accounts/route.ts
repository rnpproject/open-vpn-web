import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv, durationLimits } from "@/lib/env";
import { commitQuota, getSiteSettings, releaseQuota, reserveQuota } from "@/lib/firestore";
import { guardAccountRequest, isPayloadTooLarge } from "@/lib/requestGuard";
import { clientIpHash, reserveCreateAttempt, verifyTurnstile } from "@/lib/rateLimit";
import { newSession, readSession, reserveSessionAttempt } from "@/lib/sessionLimit";
import { nextResetAt } from "@/lib/time";
import { ApiError, createAccount, getServices } from "@/lib/vpnApi";

export const dynamic = "force-dynamic";
const bodySchema = z
  .object({ service: z.string().min(1).max(120), days: z.number().int() })
  .strict();
const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
const error = (
  status: number,
  code: string,
  message = "Permintaan tidak dapat diproses.",
  headers?: HeadersInit,
) =>
  NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
const username = () => `w${Array.from(randomBytes(7), (value) => alphabet[value & 31]).join("")}`;
const logCreate = (
  requestId: string,
  service: string,
  days: number,
  ipHash: string,
  outcome: string,
) =>
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      request_id: requestId,
      service,
      days,
      ip_hash: ipHash,
      outcome,
    }),
  );

function storeErrorCode(cause: unknown): string | undefined {
    if (!cause || typeof cause !== "object") return undefined;
    if ("code" in cause && typeof cause.code === "string") return cause.code;
    if ("_errCode" in cause) {
      const oracleCode = cause._errCode;
      if (
        oracleCode &&
        typeof oracleCode === "object" &&
        "_name" in oracleCode &&
        typeof oracleCode._name === "string"
      )
        return oracleCode._name;
    }
    return undefined;
}

function logStoreFailure(requestId: string, stage: string, cause: unknown): void {
    console.error(
      JSON.stringify({
        event: "account_store_failed",
        request_id: requestId,
        stage,
        error: cause instanceof Error ? cause.name : "UnknownError",
        code: storeErrorCode(cause),
      }),
    );
}

export async function POST(request: Request) {
  const ctx: { cookie: string | null } = { cookie: null };
  const response = await handle(request, ctx);
  if (ctx.cookie) response.headers.append("Set-Cookie", ctx.cookie);
  return response;
}

async function handle(request: Request, ctx: { cookie: string | null }) {
  const requestId = randomUUID();
  try {
    const guard = guardAccountRequest(request);
    if (guard) return error(guard.status, guard.code);
    const siteSettings = await getSiteSettings();
    if (!siteSettings)
      return error(
        503,
        "maintenance_state_unavailable",
        "Pembuatan akun sementara dinonaktifkan karena status situs belum dapat dipastikan.",
      );
    if (siteSettings.mode === "maintenance" || siteSettings.mode === "closed")
      return error(
        503,
        siteSettings.mode,
        siteSettings.message || "Pembuatan akun sedang dihentikan.",
        { "Retry-After": "300" },
      );
    const text = await request.text();
    if (isPayloadTooLarge(text)) return error(413, "payload_too_large");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return error(422, "invalid_request");
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return error(422, "invalid_request", "Layanan atau durasi tidak valid.");
    const env = getEnv();
    let catalog;
    try {
      catalog = await getServices();
    } catch {
      return error(503, "service_unavailable");
    }
    const service = catalog.value.find((item) => item.id === parsed.data.service);
    if (siteSettings.pausedServices.includes(parsed.data.service))
      return error(503, "service_paused", "Pembuatan akun untuk layanan ini sedang dijeda.");
    if (
      !service ||
      !service.available ||
      !env.ALLOWED_DAYS.includes(parsed.data.days as 1 | 3 | 7) ||
      (service.max_days !== undefined && parsed.data.days > service.max_days)
    )
      return error(422, "invalid_request", "Layanan atau durasi tidak tersedia.");
    const forwarded = env.TRUST_PROXY_HEADERS
      ? (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null)
      : (request.headers.get("x-real-ip")?.trim() ?? null);
    if (!(await verifyTurnstile(request.headers.get("cf-turnstile-response"), forwarded, env)))
      return error(422, "verification_failed");
    const now = new Date();
    const days = parsed.data.days as 1 | 3 | 7;
    const durationLimit = durationLimits(env, service.daily_limit)[days] ?? 1;
    let attempt;
    try {
      attempt = await reserveCreateAttempt(request.headers, service.id, now, env);
    } catch (cause) {
      logStoreFailure(requestId, "ip_limit", cause);
      return error(503, "store_unavailable", "Penyimpanan kuota sedang tidak dapat dihubungi.");
    }
    if (!attempt.ok)
      return error(429, "rate_limited", "Terlalu banyak percobaan.", {
        "Retry-After": String(attempt.retryAfter),
      });
    let sessionId = readSession(request.headers, env);
    if (!sessionId) {
      const created = newSession(env);
      sessionId = created.id;
      ctx.cookie = created.cookie;
    }
    try {
      const sessionAttempt = await reserveSessionAttempt(sessionId, service.id, now, env);
      if (!sessionAttempt.ok)
        return error(429, "rate_limited", "Terlalu banyak percobaan.", {
          "Retry-After": String(sessionAttempt.retryAfter),
        });
    } catch (cause) {
      logStoreFailure(requestId, "session_limit", cause);
      return error(503, "store_unavailable", "Penyimpanan kuota sedang tidak dapat dihubungi.");
    }
    let reservation;
    try {
      reservation = await reserveQuota(service.id, now, durationLimit, days);
    } catch (cause) {
      logStoreFailure(requestId, "global_quota", cause);
      return error(503, "store_unavailable", "Penyimpanan kuota sedang tidak dapat dihubungi.");
    }
    if (!reservation.ok) {
      logCreate(
        requestId,
        service.id,
        days,
        clientIpHash(request.headers, env),
        "quota_exhausted",
      );
      return NextResponse.json(
        {
          error: { code: "quota_exhausted", message: "Kuota layanan hari ini habis." },
          data: {
            used: reservation.used,
            limit: durationLimit,
            resetsAt: nextResetAt(now).toISOString(),
          },
        },
        { status: 429, headers: { "Cache-Control": "no-store" } },
      );
    }
    // Finalisasi reservasi bersifat best-effort: bila gagal, reservasi kedaluwarsa
    // sendiri dalam RESERVATION_TTL_MS dan direklamasi (tidak ada kuota yatim).
    const finalize = async (finalizeFn: () => Promise<void>): Promise<void> => {
      try {
        await finalizeFn();
      } catch (finalizeError) {
        console.error(
          JSON.stringify({
            event: "quota_finalize_failed",
            request_id: requestId,
            error: finalizeError instanceof Error ? finalizeError.message : "unknown",
          }),
        );
      }
    };
    try {
      const result = await createAccount(
        {
          service: service.upstream_id ?? service.id,
          days,
          username: username(),
        },
        randomUUID(),
        service.server_id,
      );
      await finalize(() => commitQuota(service.id, reservation.day, days, reservation.reservationId));
      logCreate(requestId, service.id, days, clientIpHash(request.headers, env), "ok");
      return NextResponse.json(
        { data: result },
        { status: 201, headers: { "Cache-Control": "no-store" } },
      );
    } catch (cause) {
      if (cause instanceof ApiError && cause.uncertain) {
        // Respons hilang di tengah jalan: akun mungkin sudah terbuat di upstream,
        // jadi kuota ditahan (commit) seperti perilaku sebelumnya.
        await finalize(() =>
          commitQuota(service.id, reservation.day, days, reservation.reservationId),
        );
        logCreate(
          requestId,
          service.id,
          days,
          clientIpHash(request.headers, env),
          "unknown",
        );
        return error(504, "creation_unknown");
      }
      await releaseQuota(service.id, reservation.day, days, reservation.reservationId);
      logCreate(
        requestId,
        service.id,
        days,
        clientIpHash(request.headers, env),
        "fail",
      );
      if (cause instanceof ApiError && cause.status === 409) return error(409, "conflict");
      if (cause instanceof ApiError && cause.status === 422) return error(422, "invalid_request");
      return error(503, "service_unavailable");
    }
  } catch (cause) {
    if (cause instanceof Error && /Firestore|Store|store/i.test(cause.message))
      return error(503, "store_unavailable");
    console.error(
      JSON.stringify({
        event: "account_create_failed",
        request_id: requestId,
        error: "internal_error",
      }),
    );
    return error(500, "internal_error");
  }
}

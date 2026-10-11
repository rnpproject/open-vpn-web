import { NextResponse } from "next/server";
import { durationLimits, getEnv } from "@/lib/env";
import { getServices, getStatus } from "@/lib/vpnApi";
import { getSiteSettings, quotaSnapshot, type QuotaSnapshot } from "@/lib/firestore";
import { withTimeout } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Batas waktu eksplisit agar polling first-paint tidak pernah menggantung. */
const META_TIMEOUT_MS = 12_000;

export async function GET() {
  const env = getEnv();
  const gather = async () => {
    const [serviceResult, statusResult, siteResult] = await Promise.allSettled([
      getServices(),
      getStatus(),
      getSiteSettings(),
    ]);
    const services = serviceResult.status === "fulfilled" ? serviceResult.value.value : [];
    const status = statusResult.status === "fulfilled" ? statusResult.value.value : null;
    const stale =
      (serviceResult.status === "fulfilled" && serviceResult.value.stale) ||
      (statusResult.status === "fulfilled" && statusResult.value.stale);
    const unavailable =
      serviceResult.status === "rejected" || statusResult.status === "rejected" || stale;
    let quota: QuotaSnapshot = { resetsAt: new Date().toISOString() };
    let quotaUnavailable = false;
    try {
      quota = await quotaSnapshot(
        services,
        new Date(),
        Object.fromEntries(
          services.map((service) => [service.id, durationLimits(env, service.daily_limit)]),
        ),
      );
    } catch {
      quotaUnavailable = true;
    }
    return NextResponse.json(
      {
        data: {
          services,
          catalogUnavailable: serviceResult.status !== "fulfilled" || serviceResult.value.stale,
          catalogFetchedAt:
            serviceResult.status === "fulfilled" ? serviceResult.value.fetchedAt : undefined,
          statusUnavailable: statusResult.status !== "fulfilled" || statusResult.value.stale,
          status,
          statusFetchedAt:
            statusResult.status === "fulfilled" ? statusResult.value.fetchedAt : undefined,
          serverNow: new Date().toISOString(),
          quota,
          quotaUnavailable,
          unavailable,
          stale,
          allowed_days: env.ALLOWED_DAYS,
          support_url: env.SUPPORT_URL || undefined,
          turnstile_site_key: env.TURNSTILE_SITE_KEY || undefined,
          siteMode: siteResult.status === "fulfilled" ? siteResult.value?.mode : undefined,
          siteMessage: siteResult.status === "fulfilled" ? siteResult.value?.message : undefined,
          estimatedEndAt:
            siteResult.status === "fulfilled" ? siteResult.value?.estimatedEndAt : undefined,
          pausedServices:
            siteResult.status === "fulfilled" ? siteResult.value?.pausedServices : undefined,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  };
  try {
    return await withTimeout(gather(), META_TIMEOUT_MS, "GET /api/meta");
  } catch {
    return NextResponse.json(
      {
        data: {
          services: [],
          catalogUnavailable: true,
          status: null,
          statusUnavailable: true,
          serverNow: new Date().toISOString(),
          quota: { resetsAt: new Date().toISOString() },
          quotaUnavailable: true,
          unavailable: true,
          stale: true,
          allowed_days: env.ALLOWED_DAYS,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}

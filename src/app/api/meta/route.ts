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
    const siteSettings = await getSiteSettings();
    const siteUnavailable = !siteSettings;
    const siteClosed = siteSettings?.mode === "maintenance" || siteSettings?.mode === "closed";
    if (siteUnavailable || siteClosed)
      return NextResponse.json(
        {
          data: {
            services: [],
            catalogUnavailable: false,
            statusUnavailable: false,
            status: null,
            serverNow: new Date().toISOString(),
            quota: { resetsAt: new Date().toISOString() },
            quotaUnavailable: false,
            unavailable: false,
            stale: false,
            allowed_days: env.ALLOWED_DAYS,
            support_url: env.SUPPORT_URL || undefined,
            turnstile_site_key: env.TURNSTILE_SITE_KEY || undefined,
            siteMode: siteSettings?.mode,
            siteMessage: siteSettings?.message,
            estimatedEndAt: siteSettings?.estimatedEndAt,
            pausedServices: siteSettings?.pausedServices,
            siteStatusUnavailable: siteUnavailable,
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      );

    const [serviceResult, statusResult] = await Promise.allSettled([getServices(), getStatus()]);
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
          siteMode: siteSettings.mode,
          siteMessage: siteSettings.message,
          estimatedEndAt: siteSettings.estimatedEndAt,
          pausedServices: siteSettings.pausedServices,
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

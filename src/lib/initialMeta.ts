import "server-only";
import { durationLimits, getEnv } from "@/lib/env";
import { getServices, getStatus } from "@/lib/vpnApi";
import { getSiteSettings, quotaSnapshot } from "@/lib/firestore";
import type { Meta } from "@/components/Portal";

export async function initialMeta(): Promise<Meta> {
  const env = getEnv();
  const [s, t, site] = await Promise.allSettled([getServices(), getStatus(), getSiteSettings()]);
  const services = s.status === "fulfilled" ? s.value.value : [];
  const status = t.status === "fulfilled" ? t.value.value : null;
  let quota: Meta["quota"] = {};
  let quotaUnavailable = false;
  try {
    // Shape runtime: per layanan berisi entri per durasi ("1","3","7") + field
    // agregat lama (used/limit/remaining/resetsAt, deprecated) + "resetsAt" atas.
    quota = (await quotaSnapshot(
      services,
      new Date(),
      Object.fromEntries(
        services.map((service) => [service.id, durationLimits(env, service.daily_limit)]),
      ),
    )) as unknown as Meta["quota"];
  } catch {
    quotaUnavailable = true;
  }
  return {
    services,
    catalogUnavailable: s.status !== "fulfilled" || s.value.stale,
    catalogFetchedAt: s.status === "fulfilled" ? s.value.fetchedAt : undefined,
    statusUnavailable: t.status !== "fulfilled" || t.value.stale,
    status,
    statusFetchedAt: t.status === "fulfilled" ? t.value.fetchedAt : undefined,
    serverNow: new Date().toISOString(),
    quota,
    quotaUnavailable,
    unavailable:
      s.status !== "fulfilled" ||
      t.status !== "fulfilled" ||
      (s.status === "fulfilled" && s.value.stale) ||
      (t.status === "fulfilled" && t.value.stale),
    allowed_days: env.ALLOWED_DAYS,
    support_url: env.SUPPORT_URL || undefined,
    turnstile_site_key: env.TURNSTILE_SITE_KEY || undefined,
    siteMode: site.status === "fulfilled" ? site.value?.mode : undefined,
    siteMessage: site.status === "fulfilled" ? site.value?.message : undefined,
    estimatedEndAt: site.status === "fulfilled" ? site.value?.estimatedEndAt : undefined,
    pausedServices: site.status === "fulfilled" ? site.value?.pausedServices : undefined,
  };
}

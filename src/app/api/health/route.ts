import { NextResponse } from "next/server";
import { checkQuotaStore } from "@/lib/firestore";
import { getServices, getStatus } from "@/lib/vpnApi";
import { withTimeout } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Batas waktu eksplisit agar health check tidak pernah menggantung. */
const HEALTH_TIMEOUT_MS = 10_000;

export async function GET() {
  const gather = async () => {
    const [storeResult, servicesResult, statusResult] = await Promise.allSettled([
      checkQuotaStore(),
      getServices(),
      getStatus(),
    ]);
    const store = storeResult.status === "fulfilled" ? storeResult.value : "unavailable";
    const api =
      servicesResult.status === "fulfilled" &&
      statusResult.status === "fulfilled" &&
      !servicesResult.value.stale &&
      !statusResult.value.stale
        ? "ok"
        : "unavailable";
    return NextResponse.json(
      {
        status: "ok",
        version: process.env.BUILD_VERSION ?? process.env.npm_package_version ?? "unknown",
        firestore: store,
        vpnApi: api,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  };
  try {
    return await withTimeout(gather(), HEALTH_TIMEOUT_MS, "GET /api/health");
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        version: process.env.BUILD_VERSION ?? process.env.npm_package_version ?? "unknown",
        firestore: "unavailable",
        vpnApi: "unavailable",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}

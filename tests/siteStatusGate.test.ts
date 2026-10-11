import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";

const mocks = vi.hoisted(() => ({
  getSiteSettings: vi.fn(),
  getServices: vi.fn(),
  getStatus: vi.fn(),
  quotaSnapshot: vi.fn(),
  checkQuotaStore: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    ALLOWED_DAYS: [1, 3, 7],
    DAILY_LIMIT_PER_SERVICE: 10,
    QUOTA_PER_DURATION: { 1: 4, 3: 3, 7: 3 },
    SUPPORT_URL: "",
    TURNSTILE_SITE_KEY: "",
  }),
  durationLimits: () => ({ 1: 4, 3: 3, 7: 3 }),
}));

vi.mock("@/lib/firestore", () => ({
  getSiteSettings: mocks.getSiteSettings,
  quotaSnapshot: mocks.quotaSnapshot,
  checkQuotaStore: mocks.checkQuotaStore,
  quotaStoreName: () => "firestore",
}));

vi.mock("@/lib/vpnApi", () => ({
  getServices: mocks.getServices,
  getStatus: mocks.getStatus,
}));

vi.mock("@/lib/time", () => ({
  withTimeout: (promise: Promise<unknown>) => promise,
}));

describe("site status gate for upstream checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSiteSettings.mockResolvedValue({
      mode: "normal",
      message: "",
      pausedServices: [],
    });
    mocks.getServices.mockResolvedValue({
      value: [{ id: "vm1-ssh", label: "SSH", available: true }],
      stale: false,
      fetchedAt: Date.now(),
    });
    mocks.getStatus.mockResolvedValue({
      value: { services: {} },
      stale: false,
      fetchedAt: Date.now(),
    });
    mocks.quotaSnapshot.mockResolvedValue({ resetsAt: new Date().toISOString() });
    mocks.checkQuotaStore.mockResolvedValue("ok");
  });

  it.each(["maintenance", "closed"] as const)(
    "does not query upstream or quota while site mode is %s",
    async (mode) => {
      mocks.getSiteSettings.mockResolvedValue({
        mode,
        message: "Portal sedang tidak tersedia",
        pausedServices: [],
      });

      const { initialMeta } = await import("@/lib/initialMeta");
      const { GET: metaGET } = await import("@/app/api/meta/route");
      const { GET: healthGET } = await import("@/app/api/health/route");
      const meta = await initialMeta();
      const apiMeta = await metaGET();
      const health = await healthGET();

      expect(meta.siteMode).toBe(mode);
      expect(meta.services).toEqual([]);
      expect(meta.unavailable).toBe(false);
      expect((await apiMeta.json()).data.siteMode).toBe(mode);
      expect(await health.json()).toMatchObject({ status: "ok", vpnApi: "skipped" });
      expect(mocks.getServices).not.toHaveBeenCalled();
      expect(mocks.getStatus).not.toHaveBeenCalled();
      expect(mocks.quotaSnapshot).not.toHaveBeenCalled();
      expect(mocks.checkQuotaStore).not.toHaveBeenCalled();
    },
  );

  it("does not query upstream when site settings are unavailable", async () => {
    mocks.getSiteSettings.mockResolvedValue(null);

    const { initialMeta } = await import("@/lib/initialMeta");
    const { GET } = await import("@/app/api/meta/route");
    const { GET: healthGET } = await import("@/app/api/health/route");
    const meta = await initialMeta();
    const response = await GET();
    const health = await healthGET();

    expect(meta.siteStatusUnavailable).toBe(true);
    expect((await response.json()).data.siteStatusUnavailable).toBe(true);
    expect(await health.json()).toMatchObject({ status: "degraded", vpnApi: "skipped" });
    expect(mocks.getServices).not.toHaveBeenCalled();
    expect(mocks.getStatus).not.toHaveBeenCalled();
    expect(mocks.quotaSnapshot).not.toHaveBeenCalled();
    expect(mocks.checkQuotaStore).not.toHaveBeenCalled();
  });

  it("queries upstream after confirming the site is open", async () => {
    const { initialMeta } = await import("@/lib/initialMeta");
    const meta = await initialMeta();

    expect(meta.siteMode).toBe("normal");
    expect(mocks.getServices).toHaveBeenCalledOnce();
    expect(mocks.getStatus).toHaveBeenCalledOnce();
    expect(mocks.quotaSnapshot).toHaveBeenCalledOnce();
  });

  it("skips service and server existence checks during maintenance", async () => {
    mocks.getSiteSettings.mockResolvedValue({
      mode: "closed",
      message: "",
      pausedServices: [],
    });
    const { default: ServiceLayout } = await import("@/app/s/[service]/layout");
    const { default: ServerLayout } = await import("@/app/server/[server]/layout");
    const children = createElement("div", null, "child");

    await expect(
      ServiceLayout({ children, params: Promise.resolve({ service: "vm1-ssh" }) }),
    ).resolves.toMatchObject({ props: { children } });
    await expect(
      ServerLayout({ children, params: Promise.resolve({ server: "vm1" }) }),
    ).resolves.toMatchObject({ props: { children } });
    expect(mocks.getServices).not.toHaveBeenCalled();
  });
});

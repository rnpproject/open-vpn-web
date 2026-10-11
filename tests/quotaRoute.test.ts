import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSiteSettings: vi.fn(async () => ({ mode: "normal", message: "", pausedServices: [] })),
  getServices: vi.fn(async () => ({
    value: [{ id: "ssh", label: "SSH", available: true }],
    stale: false,
    fetchedAt: Date.now(),
  })),
}));

vi.mock("@/lib/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/env")>();
  return {
    ...mod,
    getEnv: () => ({
      DAILY_LIMIT_PER_SERVICE: 10,
      QUOTA_PER_DURATION: { 1: 4, 3: 3, 7: 3 },
      ALLOWED_DAYS: [1, 3, 7],
      TRUST_PROXY_HEADERS: false,
      TURNSTILE_SITE_KEY: "",
      TURNSTILE_SECRET_KEY: "",
      PER_IP_CREATE_LIMIT_PER_HOUR: 5,
      PER_IP_CREATE_LIMIT_PER_DAY: 3,
      IP_HASH_SALT: "test-salt-min-16-chars",
    }),
  };
});
vi.mock("@/lib/firestore", () => ({
  getSiteSettings: mocks.getSiteSettings,
  reserveQuota: vi.fn(async () => ({ ok: false, day: "2026-10-10", used: 4 })),
  releaseQuota: vi.fn(async () => undefined),
  commitQuota: vi.fn(async () => undefined),
}));
vi.mock("@/lib/requestGuard", () => ({
  guardAccountRequest: vi.fn(() => null),
  isPayloadTooLarge: vi.fn(() => false),
}));
vi.mock("@/lib/rateLimit", () => ({
  clientIpHash: vi.fn(() => "a".repeat(64)),
  reserveCreateAttempt: vi.fn(async () => ({ ok: true, logId: "safe-test-id" })),
  verifyTurnstile: vi.fn(async () => true),
}));
vi.mock("@/lib/sessionLimit", () => ({
  readSession: vi.fn(() => "s".repeat(22)),
  newSession: vi.fn(() => ({ id: "s".repeat(22), cookie: "vpn_sid=x" })),
  reserveSessionAttempt: vi.fn(async () => ({ ok: true, logId: "safe-test-id" })),
}));
vi.mock("@/lib/vpnApi", () => ({
  ApiError: class ApiError extends Error {},
  getServices: mocks.getServices,
  createAccount: vi.fn(),
}));

describe("POST /api/accounts site gate and per-duration quota", () => {
  beforeEach(() => {
    mocks.getSiteSettings.mockResolvedValue({ mode: "normal", message: "", pausedServices: [] });
  });

  it("does not check the upstream API while full maintenance is active", async () => {
    mocks.getSiteSettings.mockResolvedValue({
      mode: "maintenance",
      message: "Maintenance sedang berlangsung.",
      pausedServices: [],
    });
    const { POST } = await import("@/app/api/accounts/route");
    const response = await POST(
      new Request("http://portal.test/api/accounts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://portal.test",
          host: "portal.test",
        },
        body: JSON.stringify({ service: "ssh", days: 1 }),
      }),
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("maintenance");
    expect(mocks.getServices).not.toHaveBeenCalled();
  });

  it("rejects with 429 QUOTA_EXHAUSTED and resetsAt when the duration bucket is full", async () => {
    const { POST } = await import("@/app/api/accounts/route");
    const response = await POST(
      new Request("http://portal.test/api/accounts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://portal.test",
          host: "portal.test",
        },
        body: JSON.stringify({ service: "ssh", days: 1 }),
      }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.error.code).toBe("quota_exhausted");
    expect(body.data.used).toBe(4);
    expect(body.data.limit).toBe(4);
    expect(typeof body.data.resetsAt).toBe("string");
  });
});

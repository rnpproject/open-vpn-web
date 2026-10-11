import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/env")>();
  return {
    durationLimits: mod.durationLimits,
    getEnv: () => ({
      DAILY_LIMIT_PER_SERVICE: 10,
      QUOTA_PER_DURATION: { 1: 4, 3: 3, 7: 3 },
      ALLOWED_DAYS: [1, 3, 7],
      TRUST_PROXY_HEADERS: false,
      TURNSTILE_SITE_KEY: "",
      TURNSTILE_SECRET_KEY: "",
      PER_IP_CREATE_LIMIT_PER_HOUR: 5,
      PER_IP_CREATE_LIMIT_PER_DAY: 3,
    }),
  };
});
vi.mock("@/lib/firestore", () => ({
  getSiteSettings: vi.fn(async () => ({ mode: "normal", message: "", pausedServices: [] })),
  reserveQuota: vi.fn(async () => ({ ok: true, day: "2026-10-08" })),
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
  getServices: vi.fn(async () => ({
    value: [{ id: "ssh", label: "SSH", available: true }],
    stale: false,
    fetchedAt: Date.now(),
  })),
  createAccount: vi.fn(async () => ({
    username: "private-account-name",
    expires_at: "2026-10-09T00:00:00.000Z",
    connection: { host: "private-host", password: "private-account-password" },
  })),
}));

describe("account creation log privacy", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs only a request id, service metadata and a hash", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.VPN_API_KEY = "private-api-key";
    const { POST } = await import("@/app/api/accounts/route");
    const response = await POST(
      new Request("http://portal.test/api/accounts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://portal.test",
          host: "portal.test",
          "x-real-ip": "203.0.113.57",
        },
        body: JSON.stringify({ service: "ssh", days: 1 }),
      }),
    );
    expect(response.status).toBe(201);
    const output = log.mock.calls.map(([line]) => String(line)).join("\n");
    for (const secret of [
      "private-account-name",
      "private-host",
      "private-account-password",
      "private-api-key",
      "203.0.113.57",
    ])
      expect(output).not.toContain(secret);
    expect(output).toContain('"request_id"');
    expect(output).toContain('"ip_hash"');
    expect(error).not.toHaveBeenCalled();
    delete process.env.VPN_API_KEY;
  });
});

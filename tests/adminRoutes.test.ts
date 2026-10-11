import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  identity: null as { email: string } | null,
  readAdminIdentity: vi.fn(),
  createAdminSession: vi.fn(() => "signed"),
  isAdminEmail: vi.fn((email?: string): boolean => email?.toLowerCase() === "admin@example.com"),
  isSameOrigin: vi.fn(
    (request: Request) => request.headers.get("origin") === new URL(request.url).origin,
  ),
  verifyAdminPassword: vi.fn(async (password: string) => password === "valid-password"),
  setSiteSettings: vi.fn(),
  getSiteSettings: vi.fn(),
}));

vi.mock("@/lib/adminAuth", () => ({
  ADMIN_SESSION_COOKIE: "vpn_admin_session",
  adminSessionCookie: vi.fn(() => "vpn_admin_session=signed"),
  clearAdminSessionCookie: vi.fn(() => "vpn_admin_session=; Max-Age=0"),
  createAdminSession: mocks.createAdminSession,
  isAdminEmail: mocks.isAdminEmail,
  isSameOrigin: mocks.isSameOrigin,
  readAdminIdentity: mocks.readAdminIdentity,
  verifyAdminPassword: mocks.verifyAdminPassword,
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    ADMIN_EMAILS: ["admin@example.com"],
    ADMIN_PASSWORD_HASH: "configured-hash",
    ADMIN_SESSION_SECRET: "test-session-secret-which-is-at-least-32-bytes",
  }),
}));

vi.mock("@/lib/firestore", () => ({
  getSiteSettings: mocks.getSiteSettings,
  quotaStoreName: () => "firestore",
  setSiteSettings: mocks.setSiteSettings,
}));

describe("admin routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity = { email: "admin@example.com" };
    mocks.isAdminEmail.mockImplementation(
      (email?: string) => email?.toLowerCase() === "admin@example.com",
    );
    mocks.readAdminIdentity.mockImplementation(async () => mocks.identity);
    mocks.getSiteSettings.mockResolvedValue({
      mode: "normal",
      message: "",
      pausedServices: [],
    });
    mocks.setSiteSettings.mockImplementation(async (settings, updatedBy) => ({
      ...settings,
      updatedBy,
    }));
    mocks.verifyAdminPassword.mockImplementation(
      async (password: string) => password === "valid-password",
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FORCE_MAINTENANCE;
  });

  it("requires an authenticated admin before changing site state", async () => {
    mocks.identity = null;
    const { PUT } = await import("@/app/api/admin/state/route");
    const response = await PUT(
      new Request("http://portal.test/api/admin/state", {
        method: "PUT",
        headers: { origin: "http://portal.test", "content-type": "application/json" },
        body: JSON.stringify({
          mode: "closed",
          message: "Portal ditutup",
          pausedServices: [],
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.setSiteSettings).not.toHaveBeenCalled();
  });

  it("persists a permanent closure through the authenticated state endpoint", async () => {
    const { PUT } = await import("@/app/api/admin/state/route");
    const response = await PUT(
      new Request("http://portal.test/api/admin/state", {
        method: "PUT",
        headers: { origin: "http://portal.test", "content-type": "application/json" },
        body: JSON.stringify({
          mode: "closed",
          message: "Portal ditutup permanen.",
          pausedServices: ["ssh"],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.setSiteSettings).toHaveBeenCalledWith(
      {
        mode: "closed",
        message: "Portal ditutup permanen.",
        pausedServices: ["ssh"],
      },
      "admin@example.com",
    );
  });

  it("does not create a session when the email is not allowlisted", async () => {
    mocks.isAdminEmail.mockReturnValue(false);
    const { POST } = await import("@/app/api/admin/login/route");
    const response = await POST(
      new Request("http://portal.test/api/admin/login", {
        method: "POST",
        headers: { origin: "http://portal.test", "content-type": "application/json" },
        body: JSON.stringify({ email: "other@example.com", password: "valid-password" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.verifyAdminPassword).toHaveBeenCalledWith("valid-password", "configured-hash");
    expect(mocks.createAdminSession).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects an invalid password", async () => {
    const { POST } = await import("@/app/api/admin/login/route");
    const response = await POST(
      new Request("http://portal.test/api/admin/login", {
        method: "POST",
        headers: { origin: "http://portal.test", "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@example.com", password: "wrong-password" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.createAdminSession).not.toHaveBeenCalled();
  });

  it("creates an HttpOnly admin session for a valid env-configured admin", async () => {
    const { POST } = await import("@/app/api/admin/login/route");
    const response = await POST(
      new Request("http://portal.test/api/admin/login", {
        method: "POST",
        headers: { origin: "http://portal.test", "content-type": "application/json" },
        body: JSON.stringify({ email: "ADMIN@example.com", password: "valid-password" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBe("vpn_admin_session=signed");
    expect(mocks.createAdminSession).toHaveBeenCalledWith("admin@example.com");
  });

  it("allows repeated valid admin logins without a login attempt limit", async () => {
    const { POST } = await import("@/app/api/admin/login/route");
    for (let i = 0; i < 21; i += 1) {
      const response = await POST(
        new Request("http://portal.test/api/admin/login", {
          method: "POST",
          headers: { origin: "http://portal.test", "content-type": "application/json" },
          body: JSON.stringify({ email: "admin@example.com", password: "valid-password" }),
        }),
      );
      expect(response.status).toBe(200);
    }
  });

  it("does not allow the emergency maintenance override to be replaced via admin API", async () => {
    process.env.FORCE_MAINTENANCE = "1";
    const { PUT } = await import("@/app/api/admin/state/route");
    const response = await PUT(
      new Request("http://portal.test/api/admin/state", {
        method: "PUT",
        headers: { origin: "http://portal.test", "content-type": "application/json" },
        body: JSON.stringify({
          mode: "normal",
          message: "",
          pausedServices: [],
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.setSiteSettings).not.toHaveBeenCalled();
  });
});

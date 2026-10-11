import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const previous = process.env.FORCE_MAINTENANCE;
afterEach(() => {
  if (previous === undefined) delete process.env.FORCE_MAINTENANCE;
  else process.env.FORCE_MAINTENANCE = previous;
});

describe("emergency maintenance switch", () => {
  it("serves a static 503 page and blocks public API requests", async () => {
    process.env.FORCE_MAINTENANCE = "1";
    const page = proxy(new NextRequest("http://portal.test/"));
    expect(page.status).toBe(503);
    expect(page.headers.get("retry-after")).toBe("300");
    expect(page.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await page.text()).toContain("Portal sedang dirawat");

    const api = proxy(new NextRequest("http://portal.test/api/meta"));
    expect(api.status).toBe(503);
    await expect(api.json()).resolves.toMatchObject({ error: { code: "maintenance" } });
  });

  it("keeps health checks, admin routes, and static assets reachable", () => {
    process.env.FORCE_MAINTENANCE = "1";
    expect(proxy(new NextRequest("http://portal.test/api/health")).status).toBe(200);
    expect(proxy(new NextRequest("http://portal.test/admin")).status).toBe(200);
    expect(proxy(new NextRequest("http://portal.test/api/admin/state")).status).toBe(200);
    expect(proxy(new NextRequest("http://portal.test/favicon.ico")).status).toBe(200);
  });
});

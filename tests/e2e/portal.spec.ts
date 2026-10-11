import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("desktop flow creates an account, copies credentials and downloads OpenVPN config", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.setExtraHTTPHeaders({ "x-real-ip": "127.0.0.1" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Pilih server" })).toBeVisible();
  const homeAxe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    homeAxe.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? "")),
  ).toEqual([]);
  const headers = await page.evaluate(async () => {
    const r = await fetch("/api/meta");
    return {
      csp: r.headers.get("content-security-policy"),
      type: r.headers.get("x-content-type-options"),
      frame: r.headers.get("x-frame-options"),
    };
  });
  // CSP memakai pola "Without Nonces" (Next 16): halaman statis prerender
  // tidak bisa ditempeli nonce per-request, dan 'strict-dynamic' mematikan
  // hidrasi. Kebijakan ini disengaja, lihat BACKEND_BUILD.md keputusan 8.
  expect(headers.csp).toContain("script-src 'self' 'unsafe-inline'");
  expect(headers.csp).not.toContain("strict-dynamic");
  expect(headers.csp).not.toContain("nonce-");
  expect(headers.type).toBe("nosniff");
  expect(headers.frame).toBe("DENY");
  await expect(page.getByRole("link", { name: "Uji", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Uji", exact: true }).click();
  await expect(page.getByRole("link", { name: "Pilih VMess", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Pilih SSH", exact: true }).click();
  await page.getByRole("radio", { name: "3 hari", exact: true }).check();
  const createResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/accounts"),
  );
  await page.getByRole("button", { name: "Buat Akun" }).click();
  const created = await createResponse;
  expect(created.status(), JSON.stringify(await created.json())).toBe(201);
  await expect(page.getByText("Akun berhasil dibuat")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Akun berhasil dibuat" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Salin semua detail" })).toBeVisible();
  await expect(
    page.getByText(
      "Detail akun tersimpan sementara di tab ini, maksimal 30 menit. Salin atau unduh sekarang.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: /Salin/ }).first().click();
  await expect(page.getByText("Tersalin")).toBeVisible();
  await page.goto("/s/e2e--ovpn-tcp");
  await page.getByRole("button", { name: "Buat Akun" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.ovpn$/);
});

test("mobile menu exposes services and service page has no serious accessibility violations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: /Menu/ });
  await toggle.click();
  const menu = page.getByRole("navigation", { name: "Navigasi" });
  await expect(page.getByRole("link", { name: "Uji", exact: true })).toBeVisible();
  await expect(menu.getByRole("link", { name: "SSH", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Uji", exact: true }).click();
  await page.getByRole("button", { name: /Menu/ }).click();
  await expect(menu.getByRole("link", { name: "SSH", exact: true })).toHaveCount(1);
  await expect(menu.getByRole("link", { name: "VMess", exact: true })).toHaveCount(1);
  await expect(menu.getByRole("link", { name: "OpenVPN TCP", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: /Menu/ }).click();
  await expect(page.getByRole("link", { name: "Pilih OpenVPN UDP", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Pilih VMess", exact: true }).click();
  await expect(page).toHaveURL(/\/s\/e2e--vmess$/);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? "")),
  ).toEqual([]);
  for (const [width, height] of [
    [360, 640],
    [390, 844],
    [768, 1024],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width, height });
    const measured = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(measured.scroll).toBeLessThanOrEqual(measured.client);
  }
});

test("API unavailable state disables account creation", async ({ page }) => {
  await page.route("**/api/meta", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          services: [
            {
              id: "e2e--ssh",
              label: "SSH",
              server_id: "e2e",
              server_label: "Uji",
              upstream_id: "ssh",
              available: true,
            },
          ],
          status: null,
          quota: {
            "e2e--ssh": {
              used: 0,
              limit: 10,
              remaining: 10,
              resetsAt: new Date(Date.now() + 3600000).toISOString(),
            },
          },
          unavailable: true,
          allowed_days: [1, 3, 7],
        },
      }),
    }),
  );
  await page.goto("/s/e2e--ssh");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(
    page.getByRole("heading", { name: "Server sedang tidak dapat dihubungi" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Buat Akun" })).toHaveCount(0);
});

test("unknown URLs and services use the custom 404 view", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const unknownUrl = await page.goto("/alamat-yang-tidak-ada");
  expect(unknownUrl?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Halaman ini tidak ada di portal." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Kembali ke beranda" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Lewati ke konten" })).toBeFocused();
  let width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(360);

  const unknownService = await page.goto("/s/tidak-ada");
  expect(unknownService?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Halaman ini tidak ada di portal." }),
  ).toBeVisible();
  width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(360);
});

test("reset countdown is present in the server-rendered homepage", async ({ page }) => {
  await page.goto("/server/e2e");
  await expect(page.getByText(/Reset 00\.00 WIB, dalam \d{2}:\d{2}:\d{2}/).first()).toBeVisible();
});

test("health endpoint reports component states without server configuration", async ({ page }) => {
  await page.goto("/");
  const response = await page.request.get("/api/health");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ status: "ok", firestore: "memory" });
  expect(["ok", "unavailable"]).toContain(body.vpnApi);
  expect(JSON.stringify(body)).not.toMatch(/apiKey|secret|private|baseUrl|localhost|127\.0\.0\.1/i);
});

test("stale and missing data are labeled without fabricated values", async ({ page }) => {
  await page.route("**/api/meta", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          services: [
            {
              id: "e2e--ssh",
              label: "SSH",
              server_id: "e2e",
              server_label: "Uji",
              upstream_id: "ssh",
              available: true,
            },
          ],
          catalogUnavailable: true,
          catalogFetchedAt: Date.now() - 240_000,
          status: {
            server: { uptime_seconds: 3600 },
            services: { "e2e--ssh": "running" },
            accounts: { "e2e--ssh": 3 },
            servers: [{ id: "e2e", label: "Uji", uptime_seconds: 3600 }],
          },
          statusUnavailable: true,
          statusFetchedAt: Date.now() - 240_000,
          quota: {},
          quotaUnavailable: true,
          unavailable: true,
          serverNow: new Date().toISOString(),
          allowed_days: [1, 3, 7],
        },
      }),
    }),
  );
  await page.goto("/server/e2e");
  await expect(page.getByText("Terakhir diketahui aktif")).toBeVisible();
  await expect(page.getByText("Kuota belum tersedia").first()).toBeVisible();
  await expect(page.getByText("0 / 10", { exact: true })).toHaveCount(0);
});

test("public pages fit the requested viewport widths", async ({ page }) => {
  for (const route of ["/", "/server/e2e", "/s/e2e--ssh", "/ketentuan", "/privasi"]) {
    await page.goto(route);
    for (const [width, height] of [
      [360, 780],
      [390, 844],
      [768, 1024],
      [1280, 900],
    ]) {
      await page.setViewportSize({ width, height });
      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }));
      expect(dimensions.content, `${route} at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
    }
  }
});

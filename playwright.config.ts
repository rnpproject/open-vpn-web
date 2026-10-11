import { defineConfig, devices } from "@playwright/test";
const appPort = process.env.PLAYWRIGHT_PORT ?? "3100";
const mockPort = process.env.PLAYWRIGHT_MOCK_PORT ?? "8189";
const mockUrl = `http://127.0.0.1:${mockPort}`;
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${appPort}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run mock",
      url: `${mockUrl}/v1/services`,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      env: { MOCK_PORT: mockPort, MOCK_EXTRA_SERVICE_ID: "wireguard" },
    },
    {
      command: "npm run start",
      url: `http://127.0.0.1:${appPort}`,
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        PORT: appPort,
        VPN_API_SERVERS: JSON.stringify([
          { id: "e2e", label: "Uji", baseUrl: mockUrl, apiKey: "e2e-test-key" },
        ]),
        VPN_API_BASE_URL: mockUrl,
        VPN_API_KEY: "e2e-test-key",
        IP_HASH_SALT: "e2e-test-salt-long",
        QUOTA_STORE: "memory",
        DAILY_LIMIT_PER_SERVICE: "10",
        PER_IP_CREATE_LIMIT_PER_HOUR: "50",
        PER_IP_CREATE_LIMIT_PER_DAY: "50",
        TURNSTILE_SITE_KEY: "",
        TURNSTILE_SECRET_KEY: "",
      },
    },
  ],
});

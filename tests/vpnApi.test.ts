import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createAccount,
  getServices,
  getStatus,
  resetVpnApiCacheForTests,
} from "@/lib/vpnApi";

const originalFetch = globalThis.fetch;
process.env.IP_HASH_SALT = "test-only-salt-16";
afterEach(() => {
  globalThis.fetch = originalFetch;
  resetVpnApiCacheForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("VPN API client", () => {
  it("retries a transient read failure once", async () => {
    process.env.VPN_API_SERVERS = JSON.stringify([
      { id: "read-server", baseUrl: "http://127.0.0.1:8089", apiKey: "test-secret" },
    ]);
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("temporary connection error"))
      .mockResolvedValueOnce(
        jsonResponse({ data: { services: [{ id: "ssh", label: "SSH", available: true }] } }),
      ) as typeof fetch;
    await expect(getServices()).resolves.toMatchObject({
      value: [{ id: "read-server--ssh", upstream_id: "ssh" }],
      stale: false,
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("waits for a fresh read when the short cache expires", async () => {
    process.env.VPN_API_SERVERS = JSON.stringify([
      { id: "read-server", baseUrl: "http://127.0.0.1:8089", apiKey: "test-secret" },
    ]);
    vi.useFakeTimers();
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ data: { services: [{ id: "ssh", label: "Old", available: true }] } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { services: [{ id: "ssh", label: "Fresh", available: true }] } }),
      ) as typeof fetch;

    await getServices();
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(getServices()).resolves.toMatchObject({
      stale: false,
      value: [{ label: "read-server · Fresh" }],
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("parses services loosely and sends the API key only from the server", async () => {
    process.env.VPN_API_BASE_URL = "http://127.0.0.1:8089";
    process.env.VPN_API_KEY = "test-secret";
    globalThis.fetch = vi.fn(async (_input, init) => {
      expect(new Headers(init?.headers).get("X-API-Key")).toBe("test-secret");
      return jsonResponse({
        data: { services: [{ id: "new", label: "New", available: true, extra: "ignored" }] },
        future_field: 1,
      });
    }) as typeof fetch;
    await expect(getServices()).resolves.toMatchObject({
      stale: false,
      value: [
        { id: "read-server--new", label: "read-server · New", upstream_id: "new", available: true },
      ],
    });
  });

  it("parses status fields used by the dashboard", async () => {
    process.env.VPN_API_BASE_URL = "http://127.0.0.1:8089";
    process.env.VPN_API_KEY = "test-secret";
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ data: { accounts: { ssh: 4 }, online: { xray: null }, ignored: true } }),
    ) as typeof fetch;
    await expect(getStatus()).resolves.toMatchObject({
      value: { accounts: { "read-server--ssh": 4 }, online: { xray: null } },
    });
  });

  it("exposes every configured API server with isolated catalog, status, and quota identity", async () => {
    process.env.VPN_API_SERVERS = JSON.stringify([
      {
        id: "vm1",
        label: "Jakarta",
        location: "Jakarta, Indonesia",
        baseUrl: "http://127.0.0.1:8088",
        apiKey: "one",
        dailyLimit: 8,
      },
      {
        id: "vm2",
        label: "Singapore",
        location: "Singapore",
        baseUrl: "http://127.0.0.1:8089",
        apiKey: "two",
        dailyLimit: 12,
      },
    ]);
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      const server = url.includes(":8088") ? "vm1" : "vm2";
      if (url.endsWith("/v1/accounts"))
        return jsonResponse(
          { data: { username: "wabcdefg", expires_at: "2026-10-10T00:00:00Z", connection: {} } },
          201,
        );
      if (url.endsWith("/v1/services"))
        return jsonResponse({ data: { services: [{ id: "ssh", label: "SSH", available: true }] } });
      return jsonResponse({
        data: {
          server: { uptime_seconds: server === "vm1" ? 3600 : 7200 },
          services: {
            ssh: "running",
            xray: "running",
            "vpn-openvpn-tcp": "running",
            "vpn-openvpn-udp": "stopped",
          },
          accounts: { ssh: server === "vm1" ? 3 : 5 },
        },
      });
    }) as typeof fetch;

    await expect(getServices()).resolves.toMatchObject({
      value: [
        {
          id: "vm1--ssh",
          label: "Jakarta · SSH",
          server_id: "vm1",
          server_location: "Jakarta, Indonesia",
          upstream_id: "ssh",
          daily_limit: 8,
        },
        {
          id: "vm2--ssh",
          label: "Singapore · SSH",
          server_id: "vm2",
          server_location: "Singapore",
          upstream_id: "ssh",
          daily_limit: 12,
        },
      ],
    });
    await expect(getStatus()).resolves.toMatchObject({
      value: {
        services: {
          "vm1--ssh": "running",
          "vm2--ssh": "running",
          "vm1--vmess": "running",
          "vm1--vless": "running",
          "vm1--trojan": "running",
          "vm1--ovpn-tcp": "running",
          "vm1--ovpn-udp": "stopped",
          "vm2--vmess": "running",
          "vm2--vless": "running",
          "vm2--trojan": "running",
          "vm2--ovpn-tcp": "running",
          "vm2--ovpn-udp": "stopped",
        },
        accounts: { "vm1--ssh": 3, "vm2--ssh": 5 },
        servers: [
          {
            id: "vm1",
            label: "Jakarta",
            location: "Jakarta, Indonesia",
            ping_ms: expect.any(Number),
          },
          { id: "vm2", label: "Singapore", location: "Singapore", ping_ms: expect.any(Number) },
        ],
      },
    });
    await expect(
      createAccount({ service: "ssh", days: 1, username: "wabcdefg" }, "key-vm2", "vm2"),
    ).resolves.toMatchObject({ username: "wabcdefg" });
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      "http://127.0.0.1:8089/v1/accounts",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ service: "ssh", days: 1, username: "wabcdefg" }),
      }),
    );
  });

  it("posts creation with its idempotency key", async () => {
    process.env.VPN_API_BASE_URL = "http://127.0.0.1:8089";
    process.env.VPN_API_KEY = "test-secret";
    globalThis.fetch = vi.fn(async (_input, init) => {
      expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("request-1");
      expect(JSON.parse(String(init?.body))).toEqual({
        service: "ssh",
        days: 3,
        username: "wabcdefg",
      });
      return jsonResponse(
        {
          data: {
            username: "wabcdefg",
            expires_at: "2026-10-09T00:00:00Z",
            connection: { host: "mock.local" },
          },
        },
        201,
      );
    }) as typeof fetch;
    await expect(
      createAccount({ service: "ssh", days: 3, username: "wabcdefg" }, "request-1"),
    ).resolves.toMatchObject({ username: "wabcdefg", connection: { host: "mock.local" } });
  });

  it("maps 401 and 409 without leaking the upstream message", async () => {
    process.env.VPN_API_BASE_URL = "http://127.0.0.1:8089";
    process.env.VPN_API_KEY = "test-secret";
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: { code: "conflict", message: "private upstream detail" } }, 409),
    ) as typeof fetch;
    await expect(
      createAccount({ service: "ssh", days: 1, username: "wabcdefg" }, "request-2"),
    ).rejects.toMatchObject({ code: "conflict", status: 409, retryable: false });
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: { code: "unauthorized" } }, 401),
    ) as typeof fetch;
    await expect(
      createAccount({ service: "ssh", days: 1, username: "wabcdefg" }, "request-3"),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("marks an aborted POST timeout as uncertain and retryable", async () => {
    process.env.VPN_API_BASE_URL = "http://127.0.0.1:8089";
    process.env.VPN_API_KEY = "test-secret";
    process.env.VPN_API_POST_TIMEOUT_MS = "10";
    globalThis.fetch = vi.fn(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    ) as typeof fetch;
    await expect(
      createAccount({ service: "ssh", days: 1, username: "wabcdefg" }, "request-4"),
    ).rejects.toMatchObject({
      code: "upstream_timeout",
      status: 504,
      retryable: true,
      uncertain: true,
    });
    delete process.env.VPN_API_POST_TIMEOUT_MS;
  });

  it("fails over a POST only when the first server refused the connection", async () => {
    process.env.VPN_API_SERVERS = JSON.stringify([
      { id: "first", baseUrl: "http://127.0.0.1:8088", apiKey: "one" },
      { id: "second", baseUrl: "http://127.0.0.1:8089", apiKey: "two" },
    ]);
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }),
    });
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(refused)
      .mockResolvedValueOnce(
        jsonResponse({
          data: { username: "wabcdefg", expires_at: "2026-10-09T00:00:00Z", connection: {} },
        }),
      ) as typeof fetch;
    await expect(
      createAccount({ service: "ssh", days: 1, username: "wabcdefg" }, "request-failover"),
    ).resolves.toMatchObject({ username: "wabcdefg" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not fail over a POST after an ambiguous network failure", async () => {
    process.env.VPN_API_SERVERS = JSON.stringify([
      { id: "first", baseUrl: "http://127.0.0.1:8088", apiKey: "one" },
      { id: "second", baseUrl: "http://127.0.0.1:8089", apiKey: "two" },
    ]);
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("connection closed");
    }) as typeof fetch;
    await expect(
      createAccount({ service: "ssh", days: 1, username: "wabcdefg" }, "request-ambiguous"),
    ).rejects.toMatchObject({ uncertain: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

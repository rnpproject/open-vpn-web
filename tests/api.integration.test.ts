import { describe, expect, it } from "vitest";
import { guardAccountRequest, isPayloadTooLarge } from "@/lib/requestGuard";

describe("account request guard", () => {
  it("accepts same-origin JSON requests", () => {
    expect(
      guardAccountRequest(
        new Request("http://portal.test/api/accounts", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://portal.test",
            host: "portal.test",
            "sec-fetch-site": "same-origin",
          },
          body: JSON.stringify({ service: "ssh", days: 1 }),
        }),
      ),
    ).toBeNull();
  });

  it("rejects a non-JSON cross-origin and oversized request", () => {
    expect(
      guardAccountRequest(
        new Request("https://portal.test/api/accounts", {
          method: "POST",
          headers: { "content-type": "text/plain" },
        }),
      ),
    ).toMatchObject({ status: 415 });
    expect(
      guardAccountRequest(
        new Request("https://portal.test/api/accounts", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://evil.test" },
        }),
      ),
    ).toMatchObject({ status: 403 });
    expect(isPayloadTooLarge("x".repeat(2049))).toBe(true);
  });
});

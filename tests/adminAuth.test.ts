import { scrypt } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvForTests } from "@/lib/env";
import {
  ADMIN_SESSION_COOKIE,
  createAdminSession,
  readAdminIdentity,
  verifyAdminPassword,
} from "@/lib/adminAuth";

const previousEnv = new Map<string, string | undefined>();
const envKeys = ["ADMIN_EMAILS", "ADMIN_SESSION_SECRET", "IP_HASH_SALT"];
const password = "correct horse battery staple";

function deriveKey(value: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(value, salt, 64, { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

async function encodedPasswordHash(value: string): Promise<string> {
  const salt = Buffer.from("0123456789abcdef");
  const key = await deriveKey(value, salt);
  return `scrypt:32768:8:1:${salt.toString("base64url")}:${key.toString("base64url")}`;
}

describe("admin authentication helpers", () => {
  beforeEach(() => {
    for (const key of envKeys) previousEnv.set(key, process.env[key]);
    process.env.ADMIN_EMAILS = "admin@example.com";
    process.env.ADMIN_SESSION_SECRET = "test-session-secret-which-is-at-least-32-bytes";
    process.env.IP_HASH_SALT = "test-only-salt-with-at-least-16-bytes";
    resetEnvForTests();
  });

  afterEach(() => {
    for (const key of envKeys) {
      const previous = previousEnv.get(key);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    previousEnv.clear();
    resetEnvForTests();
  });

  it("verifies a scrypt hash and rejects a wrong password", async () => {
    const hash = await encodedPasswordHash(password);
    await expect(verifyAdminPassword(password, hash)).resolves.toBe(true);
    await expect(verifyAdminPassword("wrong password", hash)).resolves.toBe(false);
  });

  it("rejects malformed scrypt hash configuration", async () => {
    await expect(verifyAdminPassword(password, "not-a-hash")).rejects.toThrow(
      "ADMIN_PASSWORD_HASH format is invalid",
    );
  });

  it("accepts a valid signed session only for an allowed email", () => {
    const token = createAdminSession("admin@example.com");
    const request = new Request("http://portal.test/api/admin/state", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}` },
    });
    expect(readAdminIdentity(request)).toEqual({ email: "admin@example.com" });

    const [payload, signature] = token.split(".");
    const tampered = new Request("http://portal.test/api/admin/state", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${payload}.${signature}x` },
    });
    expect(readAdminIdentity(tampered)).toBeNull();
  });

  it("revokes an otherwise valid session when its email leaves the allowlist", () => {
    const token = createAdminSession("admin@example.com");
    process.env.ADMIN_EMAILS = "other@example.com";
    resetEnvForTests();
    const request = new Request("http://portal.test/api/admin/state", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}` },
    });

    expect(readAdminIdentity(request)).toBeNull();
  });
});

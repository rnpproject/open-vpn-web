import "server-only";
import { createHmac, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_BYTES = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export const ADMIN_SESSION_COOKIE = "vpn_admin_session";
export const ADMIN_SESSION_MAX_AGE = 5 * 24 * 60 * 60;

export type AdminIdentity = { email: string };

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      SCRYPT_KEY_BYTES,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export async function verifyAdminPassword(password: string, encodedHash: string): Promise<boolean> {
  const parts = encodedHash.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt")
    throw new Error("ADMIN_PASSWORD_HASH format is invalid.");

  const [nText, rText, pText, saltText, keyText] = parts.slice(1);
  if (nText !== String(SCRYPT_N) || rText !== String(SCRYPT_R) || pText !== String(SCRYPT_P))
    throw new Error("ADMIN_PASSWORD_HASH parameters are invalid.");

  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(keyText, "base64url");
  if (
    salt.length < 16 ||
    expected.length !== SCRYPT_KEY_BYTES ||
    salt.toString("base64url") !== saltText ||
    expected.toString("base64url") !== keyText
  )
    throw new Error("ADMIN_PASSWORD_HASH encoding is invalid.");

  const actual = await deriveKey(password, salt);
  return timingSafeEqual(actual, expected);
}

export function isAdminEmail(email: string | undefined): email is string {
  return Boolean(email && getEnv().ADMIN_EMAILS.includes(email.toLowerCase()));
}

function sessionSecret(): Buffer {
  const value = getEnv().ADMIN_SESSION_SECRET;
  if (Buffer.byteLength(value, "utf8") < 32)
    throw new Error("ADMIN_SESSION_SECRET must contain at least 32 bytes.");
  return Buffer.from(value, "utf8");
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function createAdminSession(email: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      email: email.toLowerCase(),
      expiresAt: Date.now() + ADMIN_SESSION_MAX_AGE * 1000,
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readAdminIdentity(request: Request): AdminIdentity | null {
  const cookieHeader = request.headers.get("cookie");
  const value = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ADMIN_SESSION_COOKIE}=`))
    ?.slice(ADMIN_SESSION_COOKIE.length + 1);
  if (!value) return null;

  let token: string;
  try {
    token = decodeURIComponent(value);
  } catch {
    return null;
  }
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;

  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(sign(payload), "base64url");
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (
    actual.length !== expected.length ||
    actual.toString("base64url") !== signature ||
    !timingSafeEqual(actual, expected)
  )
    return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: unknown;
      expiresAt?: unknown;
    };
    if (
      typeof decoded.email !== "string" ||
      typeof decoded.expiresAt !== "number" ||
      decoded.expiresAt <= Date.now() ||
      !isAdminEmail(decoded.email)
    )
      return null;
    return { email: decoded.email };
  } catch {
    return null;
  }
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const source = new URL(origin);
    const target = new URL(request.url);
    const host = request.headers.get("host");
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const sameHost = Boolean(host && source.host === host);
    const sameProtocol =
      source.protocol === target.protocol ||
      (sameHost && Boolean(forwardedProtocol) && source.protocol === `${forwardedProtocol}:`);
    return source.origin === target.origin || (sameHost && sameProtocol);
  } catch {
    return false;
  }
}

export function adminSessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${ADMIN_SESSION_MAX_AGE}; HttpOnly; SameSite=Strict${secure}`;
}

export function clearAdminSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure}`;
}

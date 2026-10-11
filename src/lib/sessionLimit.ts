import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AppEnv } from "@/lib/env";
import { reserveIpQuota } from "@/lib/firestore";

export const SESSION_COOKIE = "vpn_sid";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const sign = (id: string, env: AppEnv) =>
  createHmac("sha256", `${env.IP_HASH_SALT}:session`).update(id).digest("base64url");

function readCookie(headers: Headers, name: string): string | null {
  for (const part of (headers.get("cookie") ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

export function readSession(headers: Headers, env: AppEnv): string | null {
  const value = readCookie(headers, SESSION_COOKIE);
  const [id, mac] = value?.split(".") ?? [];
  if (!id || !mac || !/^[A-Za-z0-9_-]{22}$/.test(id)) return null;
  const expected = Buffer.from(sign(id, env));
  const actual = Buffer.from(mac);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? id : null;
}

export function newSession(env: AppEnv): { id: string; cookie: string } {
  const id = randomBytes(16).toString("base64url");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return {
    id,
    cookie: `${SESSION_COOKIE}=${id}.${sign(id, env)}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`,
  };
}

export function reserveSessionAttempt(sessionId: string, service: string, now: Date, env: AppEnv) {
  return reserveIpQuota(
    `s_${sessionId}`,
    service,
    now,
    env.PER_IP_CREATE_LIMIT_PER_HOUR,
    env.PER_IP_CREATE_LIMIT_PER_DAY,
  );
}

import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { AppEnv } from "@/lib/env";
import { reserveIpQuota } from "@/lib/firestore";

let lastMissingIpLog = 0;

export function normalizeIp(value: string | null): string | null {
  if (!value) return null;
  let address = value.trim().replace(/%.+$/, "");
  if (/^\[[^\]]+\](?::\d+)?$/.test(address)) address = address.slice(1, address.indexOf("]"));
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(address)) address = address.replace(/:\d+$/, "");
  const version = isIP(address);
  if (version === 4) return address;
  if (version === 6) {
    const [head, tail = ""] = address.split("::");
    const left = head ? head.split(":") : [];
    const right = tail ? tail.split(":") : [];
    return [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
      .map((group) => group.padStart(4, "0"))
      .slice(0, 4)
      .join(":");
  }
  return null;
}

function clientIp(headers: Headers, env: AppEnv): string {
  const raw = env.TRUST_PROXY_HEADERS
    ? (headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null)
    : (headers.get("x-real-ip")?.trim() ?? null);
  const normalized = normalizeIp(raw);
  if (normalized) return normalized;
  if (process.env.NODE_ENV === "production" && Date.now() - lastMissingIpLog > 60_000) {
    console.warn(JSON.stringify({ event: "ip_missing" }));
    lastMissingIpLog = Date.now();
  }
  return process.env.NODE_ENV === "development"
    ? `dev:${headers.get("user-agent")?.slice(0, 128) ?? "unknown"}`
    : "missing";
}

export function clientIpHash(headers: Headers, env: AppEnv): string {
  return createHash("sha256")
    .update(`${env.IP_HASH_SALT}:${clientIp(headers, env)}`)
    .digest("hex");
}

export function reserveCreateAttempt(headers: Headers, service: string, now: Date, env: AppEnv) {
  return reserveIpQuota(
    clientIpHash(headers, env),
    service,
    now,
    clientIp(headers, env) === "missing" ? 1 : env.PER_IP_CREATE_LIMIT_PER_HOUR,
    env.PER_IP_CREATE_LIMIT_PER_DAY,
  );
}

export async function verifyTurnstile(
  token: string | null,
  remoteIp: string | null,
  env: AppEnv,
): Promise<boolean> {
  if (!env.TURNSTILE_SITE_KEY && !env.TURNSTILE_SECRET_KEY) return true;
  if (!token || !env.TURNSTILE_SECRET_KEY) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
    const ip = normalizeIp(remoteIp);
    if (ip) body.set("remoteip", ip);
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return false;
    const result: unknown = await response.json();
    return Boolean(
      result && typeof result === "object" && "success" in result && result.success === true,
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

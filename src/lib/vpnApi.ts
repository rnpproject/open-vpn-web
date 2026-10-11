import "server-only";
import { z } from "zod";
import { getApiServers, getEnv, resetEnvForTests } from "@/lib/env";

const serviceSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}$/),
  label: z.string(),
  available: z.boolean(),
  reason: z.string().nullable().optional(),
  max_days: z.number().int().positive().optional(),
  server_id: z.string().optional(),
  server_label: z.string().optional(),
  server_location: z.string().optional(),
  server_capacity: z.number().int().positive().optional(),
  server_bandwidth: z.string().optional(),
  service_label: z.string().optional(),
  upstream_id: z.string().optional(),
  daily_limit: z.number().int().positive().optional(),
});
const servicesEnvelopeSchema = z.object({ data: z.object({ services: z.array(serviceSchema) }) });
const statusEnvelopeSchema = z.object({
  data: z.object({
    server: z.record(z.string(), z.unknown()).optional(),
    services: z.record(z.string(), z.unknown()).optional(),
    accounts: z.record(z.string(), z.number()).optional(),
    online: z.record(z.string(), z.number().nullable()).optional(),
    servers: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
});
const createEnvelopeSchema = z.object({
  data: z.object({
    service: z.string().optional(),
    username: z.string(),
    created_at: z.string().optional(),
    expires_at: z.string(),
    max_sessions: z.number().int().positive().optional(),
    connection: z.record(z.string(), z.unknown()).optional().default({}),
  }),
});

export type Service = z.infer<typeof serviceSchema>;
export type ServerStatus = z.infer<typeof statusEnvelopeSchema>["data"];
export type ConnectionData = Record<string, unknown>;
export type CreatedAccount = {
  service?: string;
  username: string;
  created_at?: string;
  expires_at: string;
  max_sessions?: number;
  connection: ConnectionData;
};
export type CachedResult<T> = { value: T; stale: boolean; fetchedAt: number };

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly uncertain: boolean;

  constructor(code: string, status: number, retryable: boolean, uncertain = false) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.uncertain = uncertain;
  }
}

type CacheEntry<T> = { value: T; savedAt: number; refresh?: Promise<T> };
const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
const negativeCache = new Map<string, number>();
const circuit = new Map<string, { failures: number; openUntil: number }>();
const serverLatency = new Map<string, number>();
const CACHE_TTL_MS = 1_000;
const STALE_LIMIT_MS = 5 * 60_000;
const CIRCUIT_FAILURES = 3;
const CIRCUIT_OPEN_MS = 30_000;

function isConnectionRefused(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "cause" in error &&
    (error as { cause?: { code?: string } }).cause?.code === "ECONNREFUSED",
  );
}

function circuitKey(id: string, path: string): string {
  return `${id}:${path}`;
}

function recordServerFailure(id: string, path: string): void {
  const key = circuitKey(id, path);
  const state = circuit.get(key) ?? { failures: 0, openUntil: 0 };
  state.failures += 1;
  if (state.failures >= CIRCUIT_FAILURES) state.openUntil = Date.now() + CIRCUIT_OPEN_MS;
  circuit.set(key, state);
}

function recordServerSuccess(id: string, path: string): void {
  circuit.delete(circuitKey(id, path));
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  timeoutMs: number,
  init?: RequestInit,
  selectedServerId?: string,
): Promise<T> {
  const env = getEnv();
  let last: unknown;
  const isPost = init?.method === "POST";
  const servers = getApiServers(env).filter(
    (server) => !selectedServerId || server.id === selectedServerId,
  );
  const availableServers = isPost
    ? servers
    : servers.filter(
        (server) => (circuit.get(circuitKey(server.id, path))?.openUntil ?? 0) <= Date.now(),
      );
  let timedOut = false;
  for (const server of availableServers) {
    const attempts = isPost ? 1 : 2;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const requestStartedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetch(`${server.baseUrl}${path}`, {
          ...init,
          signal: controller.signal,
          headers: {
            "X-API-Key": server.apiKey,
            Accept: "application/json",
            ...(init?.body ? { "Content-Type": "application/json" } : {}),
            ...init?.headers,
          },
          cache: "no-store",
        });
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new ApiError("invalid_response", 502, false);
        }
        if (!response.ok) {
          const envelope = z
            .object({
              error: z
                .object({ code: z.string().optional(), message: z.string().optional() })
                .optional(),
            })
            .safeParse(payload);
          const code = envelope.success
            ? (envelope.data.error?.code ?? `upstream_${response.status}`)
            : `upstream_${response.status}`;
          throw new ApiError(code, response.status, response.status >= 500, false);
        }
        const parsed = schema.safeParse(payload);
        if (!parsed.success) throw new ApiError("invalid_response", 502, false);
        recordServerSuccess(server.id, path);
        if (path === "/v1/status")
          serverLatency.set(server.id, Math.max(1, Date.now() - requestStartedAt));
        return parsed.data;
      } catch (error) {
        last = error;
        const refused = isConnectionRefused(error);
        if (error instanceof ApiError && !error.retryable) throw error;
        if (isPost) {
          if (refused) {
            recordServerFailure(server.id, path);
            break;
          }
          // A POST may have reached the upstream even if the response was lost.
          break;
        }
        recordServerFailure(server.id, path);
        if (attempt + 1 < attempts)
          await new Promise((resolve) => setTimeout(resolve, 80 + Math.random() * 120));
        else break;
      } finally {
        clearTimeout(timeout);
      }
    }
    if (isPost && !isConnectionRefused(last)) break;
  }
  if (last) {
    const error = last;
    if (error instanceof ApiError) throw error;
    if (timedOut || (error instanceof Error && error.name === "AbortError")) {
      throw new ApiError("upstream_timeout", 504, true, true);
    }
    throw new ApiError("upstream_unavailable", 503, true, true);
  }
  throw new ApiError("upstream_unavailable", 503, true, true);
}

async function cached<T>(
  key: string,
  load: () => Promise<T>,
  now = Date.now(),
): Promise<CachedResult<T>> {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (entry && now - entry.savedAt < CACHE_TTL_MS)
    return { value: entry.value, stale: false, fetchedAt: entry.savedAt };
  if (entry && now - entry.savedAt < STALE_LIMIT_MS) {
    if (!entry.refresh) {
      entry.refresh = load()
        .then((value) => {
          cache.set(key, { value, savedAt: Date.now() });
          return value;
        })
        .finally(() => {
          const current = cache.get(key) as CacheEntry<T> | undefined;
          if (current) delete current.refresh;
        });
    }
    try {
      const value = await entry.refresh;
      const refreshed = cache.get(key) as CacheEntry<T> | undefined;
      return { value, stale: false, fetchedAt: refreshed?.savedAt ?? Date.now() };
    } catch {
      return { value: entry.value, stale: true, fetchedAt: entry.savedAt };
    }
  }
  if ((negativeCache.get(key) ?? 0) > now) throw new ApiError("upstream_unavailable", 503, true);
  let pending = inFlight.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = load()
      .then((value) => {
        cache.set(key, { value, savedAt: Date.now() });
        negativeCache.delete(key);
        return value;
      })
      .catch((error: unknown) => {
        negativeCache.set(key, Date.now() + 5000);
        throw error;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  const value = await pending;
  const savedAt = (cache.get(key) as CacheEntry<T> | undefined)?.savedAt ?? Date.now();
  return { value, stale: false, fetchedAt: savedAt };
}

export function getServices(): Promise<CachedResult<Service[]>> {
  const env = getEnv();
  return cached("services", async () => {
    const servers = getApiServers(env);
    const results = await Promise.allSettled(
      servers.map(async (server) => {
        const response = await request(
          "/v1/services",
          servicesEnvelopeSchema,
          env.VPN_API_GET_TIMEOUT_MS,
          undefined,
          server.id,
        );
        return response.data.services.map((service) => ({
          ...service,
          id: `${server.id}--${service.id}`,
          label: `${server.label || server.id} · ${service.label}`,
          server_id: server.id,
          server_label: server.label || server.id,
          server_location: server.location,
          server_capacity: server.capacity,
          server_bandwidth: server.bandwidth,
          service_label: service.label,
          upstream_id: service.id,
          daily_limit: server.dailyLimit,
        }));
      }),
    );
    const services = results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );
    if (results.some((result) => result.status === "rejected") || !services.length)
      throw new ApiError("upstream_unavailable", 503, true);
    return services;
  });
}

export function getStatus(): Promise<CachedResult<ServerStatus>> {
  const env = getEnv();
  return cached("status", async () => {
    const servers = getApiServers(env);
    const results = await Promise.allSettled(
      servers.map(async (apiServer) => ({
        apiServer,
        status: (
          await request(
            "/v1/status",
            statusEnvelopeSchema,
            env.VPN_API_GET_TIMEOUT_MS,
            undefined,
            apiServer.id,
          )
        ).data,
      })),
    );
    const successful = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    if (successful.length !== servers.length) throw new ApiError("upstream_unavailable", 503, true);
    const services: Record<string, unknown> = {};
    const accounts: Record<string, number> = {};
    const serversStatus: Array<Record<string, unknown>> = [];
    for (const { apiServer, status } of successful) {
      for (const [id, value] of Object.entries(status.services ?? {})) {
        const serviceIds =
          id === "xray"
            ? ["vmess", "vless", "trojan"]
            : id === "vpn-openvpn-tcp"
              ? ["ovpn-tcp"]
              : id === "vpn-openvpn-udp"
                ? ["ovpn-udp"]
                : [id];
        for (const serviceId of serviceIds) services[`${apiServer.id}--${serviceId}`] = value;
      }
      for (const [id, value] of Object.entries(status.accounts ?? {}))
        accounts[`${apiServer.id}--${id}`] = value;
      serversStatus.push({
        id: apiServer.id,
        label: apiServer.label || apiServer.id,
        ...(status.server ?? {}),
        location:
          apiServer.location ??
          (typeof status.server?.location === "string" ? status.server.location : undefined),
        ping_ms: serverLatency.get(apiServer.id),
      });
    }
    const first = successful[0].status;
    return { ...first, services, accounts, servers: serversStatus } as ServerStatus;
  });
}

export async function createAccount(
  input: { service: string; days: number; username: string },
  idempotencyKey: string,
  serverId?: string,
): Promise<CreatedAccount> {
  const env = getEnv();
  return (
    await request(
      "/v1/accounts",
      createEnvelopeSchema,
      env.VPN_API_POST_TIMEOUT_MS,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          ...input,
          service: input.service.includes("--")
            ? input.service.split("--").slice(1).join("--")
            : input.service,
        }),
      },
      serverId,
    )
  ).data;
}

export function resetVpnApiCacheForTests(): void {
  cache.clear();
  inFlight.clear();
  negativeCache.clear();
  circuit.clear();
  serverLatency.clear();
  resetEnvForTests();
}

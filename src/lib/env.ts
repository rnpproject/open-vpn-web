import "server-only";
import { z } from "zod";

const isSafeApiUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname))
    );
  } catch {
    return false;
  }
};

export type DurationDays = 1 | 3 | 7;

/** Default kuota per durasi (hari: limit). Total 10 = DAILY_LIMIT_PER_SERVICE default.
 *  Nilai sementara, butuh konfirmasi Rizky. */
export const DEFAULT_QUOTA_PER_DURATION: Record<DurationDays, number> = { 1: 4, 3: 3, 7: 3 };

/** Parse "1:4,3:3,7:3" menjadi {1:4, 3:3, 7:3}. Throw bila sintaks tidak valid. */
export function parseQuotaPerDuration(raw: string): Record<number, number> {
  const result: Record<number, number> = {};
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("QUOTA_PER_DURATION kosong.");
  for (const pair of trimmed.split(",")) {
    const text = pair.trim();
    const match = text.match(/^(\d+)\s*:\s*(\d+)$/);
    if (!match) throw new Error(`QUOTA_PER_DURATION tidak valid pada "${text}".`);
    const days = Number(match[1]);
    const limit = Number(match[2]);
    if (days < 1 || days > 30)
      throw new Error(`Durasi "${days}" di QUOTA_PER_DURATION harus 1-30 hari.`);
    if (limit < 1) throw new Error(`Limit durasi ${days} hari harus minimal 1.`);
    if (result[days] !== undefined)
      throw new Error(`Durasi ${days} hari duplikat di QUOTA_PER_DURATION.`);
    result[days] = limit;
  }
  return result;
}

/** Limit per durasi untuk satu layanan. serviceDailyLimit (override per server)
 *  membagi totalnya secara proporsional mengikuti distribusi QUOTA_PER_DURATION. */
export function durationLimits(
  env: { QUOTA_PER_DURATION?: Record<number, number>; DAILY_LIMIT_PER_SERVICE: number },
  serviceDailyLimit?: number,
): Record<number, number> {
  const base = env.QUOTA_PER_DURATION ?? DEFAULT_QUOTA_PER_DURATION;
  const entries = Object.entries(base);
  const baseTotal = entries.reduce((sum, [, limit]) => sum + limit, 0) || 1;
  const total = serviceDailyLimit ?? env.DAILY_LIMIT_PER_SERVICE;
  const out: Record<number, number> = {};
  for (const [daysText, baseLimit] of entries)
    out[Number(daysText)] = Math.max(1, Math.round((total * baseLimit) / baseTotal));
  return out;
}

const envSchema = z
  .object({
    VPN_API_BASE_URL: z.string().default(""),
    VPN_API_KEY: z.string().trim().default(""),
    VPN_API_SERVERS: z.string().default(""),
    DAILY_LIMIT_PER_SERVICE: z.coerce.number().int().min(1).default(10),
    QUOTA_PER_DURATION: z
      .string()
      .default("1:4,3:3,7:3")
      .transform((value) => parseQuotaPerDuration(value))
      .pipe(z.record(z.coerce.number().int().positive(), z.number().int().min(1))),
    ALLOWED_DAYS: z
      .string()
      .default("1,3,7")
      .transform((value) => value.split(",").map((item) => Number(item.trim())))
      .pipe(z.array(z.union([z.literal(1), z.literal(3), z.literal(7)])).min(1))
      .transform((value) => value as Array<1 | 3 | 7>),
    FIREBASE_PROJECT_ID: z.string().default(""),
    FIREBASE_CLIENT_EMAIL: z.string().default(""),
    FIREBASE_PRIVATE_KEY: z.string().default(""),
    ORACLE_NOSQL_REGION: z.string().trim().default(""),
    ORACLE_NOSQL_COMPARTMENT: z.string().trim().default(""),
    ORACLE_NOSQL_TENANT_ID: z.string().trim().default(""),
    ORACLE_NOSQL_USER_ID: z.string().trim().default(""),
    ORACLE_NOSQL_FINGERPRINT: z.string().trim().default(""),
    ORACLE_NOSQL_PRIVATE_KEY: z.string().default(""),
    ORACLE_NOSQL_PASSPHRASE: z.string().default(""),
    ORACLE_NOSQL_CONFIG_FILE: z.string().trim().default(""),
    ORACLE_NOSQL_PROFILE: z.string().trim().default("DEFAULT"),
    ORACLE_NOSQL_TABLE: z.string().trim().default("free_ovpn"),
    ADMIN_EMAILS: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().email())),
    ADMIN_PASSWORD_HASH: z.string().default(""),
    ADMIN_SESSION_SECRET: z.string().default(""),
    QUOTA_STORE: z.enum(["firestore", "oracle-nosql", "memory"]).optional(),
    PER_IP_CREATE_LIMIT_PER_HOUR: z.coerce.number().int().min(1).default(5),
    PER_IP_CREATE_LIMIT_PER_DAY: z.coerce.number().int().min(1).default(3),
    IP_HASH_SALT: z.string().min(16),
    TRUST_PROXY_HEADERS: z
      .enum(["0", "1"])
      .default("0")
      .transform((value) => value === "1"),
    SUPPORT_URL: z.string().default(""),
    SITE_URL: z.string().default(""),
    TURNSTILE_SITE_KEY: z.string().default(""),
    TURNSTILE_SECRET_KEY: z.string().default(""),
    VPN_API_GET_TIMEOUT_MS: z.coerce.number().int().positive().default(4000),
    VPN_API_POST_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  })
  .refine((value) => Boolean(value.TURNSTILE_SITE_KEY) === Boolean(value.TURNSTILE_SECRET_KEY), {
    message: "Turnstile site and secret keys must be configured together",
  })
  .refine(
    (value) => {
      const quotaDays = Object.keys(value.QUOTA_PER_DURATION).map(Number);
      return (
        value.ALLOWED_DAYS.every((day) => quotaDays.includes(day)) &&
        quotaDays.every((day) => (value.ALLOWED_DAYS as number[]).includes(day))
      );
    },
    { message: "QUOTA_PER_DURATION harus memuat tepat durasi yang ada di ALLOWED_DAYS" },
  )
  .refine(
    (value) => value.QUOTA_STORE !== "oracle-nosql" || Boolean(value.ORACLE_NOSQL_REGION),
    {
      message: "ORACLE_NOSQL_REGION wajib diisi saat QUOTA_STORE=oracle-nosql",
      path: ["ORACLE_NOSQL_REGION"],
    },
  )
  .refine(
    (value) => {
      if (value.QUOTA_STORE !== "oracle-nosql") return true;
      const credentials = [
        value.ORACLE_NOSQL_TENANT_ID,
        value.ORACLE_NOSQL_USER_ID,
        value.ORACLE_NOSQL_FINGERPRINT,
        value.ORACLE_NOSQL_PRIVATE_KEY,
      ];
      return credentials.every((credential) => !credential) || credentials.every(Boolean);
    },
    {
      message:
        "ORACLE_NOSQL_TENANT_ID, ORACLE_NOSQL_USER_ID, ORACLE_NOSQL_FINGERPRINT, dan ORACLE_NOSQL_PRIVATE_KEY harus diisi bersama",
      path: ["ORACLE_NOSQL_PRIVATE_KEY"],
    },
  );

export type AppEnv = z.infer<typeof envSchema>;
export type ApiServer = {
  id: string;
  baseUrl: string;
  apiKey: string;
  label?: string;
  location?: string;
  dailyLimit?: number;
  capacity?: number;
  bandwidth?: string;
};
let cachedEnv: AppEnv | undefined;
let warnedSupport = false;
let warnedTurnstile = false;

export function getApiServers(env: AppEnv = getEnv()): ApiServer[] {
  const raw = env.VPN_API_SERVERS.trim();
  if (!raw) {
    if (!isSafeApiUrl(env.VPN_API_BASE_URL) || !env.VPN_API_KEY)
      throw new Error("VPN_API_BASE_URL https dan VPN_API_KEY wajib diisi");
    return [
      { id: "default", baseUrl: env.VPN_API_BASE_URL.replace(/\/+$/, ""), apiKey: env.VPN_API_KEY },
    ];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("harus berupa array");
    const servers = parsed.map((item, index) => {
      if (!item || typeof item !== "object") throw new Error(`server ${index + 1} tidak valid`);
      const value = item as Record<string, unknown>;
      const baseUrl = typeof value.baseUrl === "string" ? value.baseUrl.replace(/\/+$/, "") : "";
      const apiKey = typeof value.apiKey === "string" ? value.apiKey.trim() : "";
      if (!isSafeApiUrl(baseUrl) || !apiKey) throw new Error(`server ${index + 1} tidak valid`);
      const id = typeof value.id === "string" && value.id ? value.id : `server-${index + 1}`;
      if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(id))
        throw new Error(`id server ${index + 1} tidak valid`);
      const dailyLimit = value.dailyLimit;
      if (dailyLimit !== undefined && (!Number.isInteger(dailyLimit) || Number(dailyLimit) < 1))
        throw new Error(`dailyLimit server ${index + 1} tidak valid`);
      const capacity = value.capacity;
      if (capacity !== undefined && (!Number.isInteger(capacity) || Number(capacity) < 1))
        throw new Error(`capacity server ${index + 1} tidak valid`);
      return {
        id,
        baseUrl,
        apiKey,
        label: typeof value.label === "string" ? value.label : undefined,
        location:
          typeof value.location === "string" && value.location.trim()
            ? value.location.trim().slice(0, 80)
            : undefined,
        dailyLimit: dailyLimit === undefined ? undefined : Number(dailyLimit),
        capacity: capacity === undefined ? undefined : Number(capacity),
        bandwidth:
          typeof value.bandwidth === "string" && value.bandwidth.trim()
            ? value.bandwidth.trim().slice(0, 40)
            : undefined,
      };
    });
    if (!servers.length) throw new Error("tidak ada server");
    return servers;
  } catch (error) {
    throw new Error(
      `VPN_API_SERVERS tidak valid: ${error instanceof Error ? error.message : "JSON tidak valid"}`,
    );
  }
}

export function getEnv(): AppEnv {
  if (cachedEnv) return cachedEnv;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success)
    throw new Error(
      `Konfigurasi server tidak valid: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  const env = parsed.data;
  if (env.SUPPORT_URL)
    try {
      const url = new URL(env.SUPPORT_URL);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      if (!warnedSupport)
        console.warn("SUPPORT_URL diabaikan karena bukan URL http(s) yang valid.");
      warnedSupport = true;
      env.SUPPORT_URL = "";
    }
  if (env.SITE_URL) {
    try {
      const url = new URL(env.SITE_URL);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      env.SITE_URL = url.origin;
    } catch {
      throw new Error("SITE_URL harus berupa URL http(s) yang valid.");
    }
  }
  if (process.env.NODE_ENV === "production" && !env.TURNSTILE_SITE_KEY && !warnedTurnstile) {
    console.warn("Turnstile belum dikonfigurasi; perlindungan hanya mengandalkan rate limit.");
    warnedTurnstile = true;
  }
  cachedEnv = env;
  return env;
}

export function resetEnvForTests(): void {
  cachedEnv = undefined;
}

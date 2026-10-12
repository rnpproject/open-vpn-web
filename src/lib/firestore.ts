import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any -- Firebase Admin is dynamically imported. */
/* Firebase is loaded lazily so a local deployment needs no Firebase credentials. */
import { randomUUID } from "node:crypto";
import { DEFAULT_QUOTA_PER_DURATION, getEnv } from "@/lib/env";
import { nextResetAt, wibDay } from "@/lib/time";
import { getOracleDocument, updateOracleDocument } from "@/lib/oracleNosql";
import { Timestamp } from "firebase-admin/firestore";

type Store = {
  runTransaction: (fn: (tx: any) => Promise<unknown>) => Promise<unknown>;
  collection: (name: string) => any;
};
type Reservation =
  { ok: true; day: string; reservationId: string } | { ok: false; day: string; used: number };
type IpReservation = { ok: true; logId: string } | { ok: false; used: number; retryAfter: number };
/** Reservasi yang belum difinalisasi. Bila proses mati sebelum commit/release,
 *  entri kedaluwarsa setelah RESERVATION_TTL_MS dan direklamasi saat baca berikutnya. */
export type PendingReservation = { id: string; expiresAt: number };
export const RESERVATION_TTL_MS = 10 * 60_000;
type QuotaCounter = { used: number; pending: PendingReservation[]; expires: number };
type DurationQuotaEntry = { used: number; limit: number };
/** Snapshot kuota: tiap layanan berisi entri per durasi ("1","3","7"),
 *  plus field agregat lama (used/limit/remaining/resetsAt, deprecated) dan
 *  "resetsAt" di tingkat atas. */
export type QuotaSnapshot = {
  resetsAt: string;
  [serviceId: string]:
    | string
    | ({ [duration: string]: DurationQuotaEntry | number | string } & {
        used: number;
        limit: number;
        remaining: number;
        resetsAt: string;
      });
};
const memoryQuota = new Map<string, QuotaCounter>();
const memoryIp = new Map<string, { used: number; expires: number }>();
let storePromise: Promise<Store> | undefined;
let warnedMemory = false;
let snapshotCache:
  | { value: Record<string, unknown>; expires: number; pending?: Promise<Record<string, unknown>> }
  | undefined;
export type SiteSettings = {
  mode: "normal" | "notice" | "maintenance" | "closed";
  message: string;
  estimatedEndAt?: string;
  pausedServices: string[];
  updatedAt?: string;
  updatedBy?: string;
};
const normalSiteSettings: SiteSettings = { mode: "normal", message: "", pausedServices: [] };
let siteSettingsCache:
  { value?: SiteSettings; expires: number; pending?: Promise<SiteSettings> } | undefined;

function selectedStore(): "memory" | "firestore" | "oracle-nosql" {
  const env = getEnv();
  return (
    env.QUOTA_STORE ??
    (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY
      ? "firestore"
      : "memory")
  );
}

async function firebaseStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = (async () => {
      const env = getEnv();
      if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY)
        throw new Error("Konfigurasi Firestore tidak lengkap.");
      try {
        const [{ getApps, cert, initializeApp }, { getFirestore }] = await Promise.all([
          import("firebase-admin/app"),
          import("firebase-admin/firestore"),
        ]);
        const app =
          getApps()[0] ??
          initializeApp({
            credential: cert({
              projectId: env.FIREBASE_PROJECT_ID,
              clientEmail: env.FIREBASE_CLIENT_EMAIL,
              privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
            }),
          });
        return getFirestore(app) as unknown as Store;
      } catch {
        throw new Error("Konfigurasi Firestore tidak valid.");
      }
    })();
    storePromise.catch(() => {
      storePromise = undefined;
    });
  }
  return storePromise;
}

function cleanup(map: Map<string, { expires: number }>, now = Date.now()): void {
  for (const [key, value] of map) if (value.expires <= now) map.delete(key);
}

/** Buang reservasi pending yang kedaluwarsa. Kembalikan daftar aktif + jumlah yang direklamasi. */
export function reconcilePending(
  pending: PendingReservation[] | undefined,
  nowMs: number,
): { pending: PendingReservation[]; reclaimed: number } {
  const list = Array.isArray(pending) ? pending : [];
  const active = list.filter(
    (item) => item && typeof item.id === "string" && item.expiresAt > nowMs,
  );
  return { pending: active, reclaimed: list.length - active.length };
}

function oraclePending(data: Record<string, unknown> | undefined): PendingReservation[] {
  return Array.isArray(data?.pending)
    ? data.pending.flatMap((item: unknown) =>
        item &&
        typeof item === "object" &&
        typeof (item as PendingReservation).id === "string" &&
        typeof (item as PendingReservation).expiresAt === "number"
          ? [{ id: (item as PendingReservation).id, expiresAt: (item as PendingReservation).expiresAt }]
          : [],
      )
    : [];
}

function storedCount(value: unknown): number {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? Math.max(0, count) : 0;
}

const quotaKey = (day: string, service: string, days: number): string =>
  `${day}_${service}_${days}`;
function resetMs(now: Date): number {
  return nextResetAt(now).getTime();
}
function hourResetMs(now: Date): number {
  const date = new Date(now);
  date.setMinutes(0, 0, 0);
  return date.getTime() + 3_600_000;
}
function invalidate(): void {
  snapshotCache = undefined;
}

export function firestoreEnabled(): boolean {
  return selectedStore() === "firestore";
}
export function quotaStoreName(): "memory" | "firestore" | "oracle-nosql" {
  return selectedStore();
}

export async function getSiteSettings(): Promise<SiteSettings | null> {
  if (process.env.FORCE_MAINTENANCE === "1") return { ...normalSiteSettings, mode: "maintenance" };
  if (siteSettingsCache && siteSettingsCache.expires > Date.now()) {
    if (siteSettingsCache.pending) return siteSettingsCache.pending;
    return siteSettingsCache.value ?? null;
  }
  const pending = (async () => {
    if (selectedStore() === "memory") return normalSiteSettings;
    if (selectedStore() === "oracle-nosql") {
      const data = await getOracleDocument("site_settings", "state");
      if (!data) return normalSiteSettings;
      const modes = ["normal", "notice", "maintenance", "closed"] as const;
      const mode = modes.includes(data.mode as (typeof modes)[number]) ? data.mode : "normal";
      return {
        mode,
        message: typeof data.message === "string" ? data.message.slice(0, 280) : "",
        estimatedEndAt: typeof data.estimatedEndAt === "string" ? data.estimatedEndAt : undefined,
        pausedServices: Array.isArray(data.pausedServices)
          ? data.pausedServices.filter((x: unknown) => typeof x === "string")
          : [],
        updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : undefined,
        updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : undefined,
      } as SiteSettings;
    }
    const db = await firebaseStore();
    const snap = await db.collection("site_settings").doc("state").get();
    if (!snap.exists) return normalSiteSettings;
    const data = snap.data() ?? {};
    const modes = ["normal", "notice", "maintenance", "closed"] as const;
    const mode = modes.includes(data.mode) ? data.mode : "normal";
    return {
      mode,
      message: typeof data.message === "string" ? data.message.slice(0, 280) : "",
      estimatedEndAt: typeof data.estimatedEndAt === "string" ? data.estimatedEndAt : undefined,
      pausedServices: Array.isArray(data.pausedServices)
        ? data.pausedServices.filter((x: unknown) => typeof x === "string")
        : [],
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : undefined,
      updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : undefined,
    } as SiteSettings;
  })();
  siteSettingsCache = { expires: Date.now() + 5000, pending };
  try {
    const value = await pending;
    siteSettingsCache = { value, expires: Date.now() + 5000 };
    return value;
  } catch (cause) {
    console.error(
      "Gagal membaca status situs dari database.",
      cause instanceof Error ? cause.name : "UnknownError",
    );
    siteSettingsCache = { expires: Date.now() + 5000 };
    return null;
  }
}

export async function setSiteSettings(
  settings: SiteSettings,
  updatedBy: string,
): Promise<SiteSettings> {
  if (selectedStore() === "memory")
    throw new Error("Pengaturan situs memerlukan database persisten.");
  const updated: SiteSettings = {
    ...settings,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  if (selectedStore() === "oracle-nosql") {
    await updateOracleDocument(
      "site_settings",
      "state",
      () => ({ write: true, payload: updated, result: undefined }),
    );
  } else {
    const db = await firebaseStore();
    await db.collection("site_settings").doc("state").set(updated);
  }
  siteSettingsCache = { value: updated, expires: Date.now() + 5000 };
  return updated;
}

export async function checkQuotaStore(): Promise<"memory" | "ok"> {
  if (selectedStore() === "memory") return "memory";
  if (selectedStore() === "oracle-nosql") {
    await getOracleDocument("vpn_web_health", "_probe");
    return "ok";
  }
  const db = await firebaseStore();
  await db.collection("vpn_web_health").doc("_probe").get();
  return "ok";
}

/** Reservasi satu slot kuota untuk (layanan, durasi). Kembalikan reservationId yang
 *  wajib difinalisasi lewat commitQuota (sukses/tidak pasti) atau releaseQuota (gagal).
 *  Reservasi yang tidak difinalisasi kedaluwarsa setelah RESERVATION_TTL_MS dan
 *  direklamasi otomatis pada pembacaan berikutnya (tidak ada kuota yatim). */
export async function reserveQuota(
  service: string,
  now: Date,
  limit: number,
  days: number,
): Promise<Reservation> {
  const day = wibDay(now);
  const nowMs = now.getTime();
  const key = quotaKey(day, service, days);
  invalidate();
  if (selectedStore() === "memory") {
    if (process.env.NODE_ENV === "production" && !warnedMemory) {
      console.warn("Store kuota memory tidak dibagi antar proses dan hilang saat restart.");
      warnedMemory = true;
    }
    cleanup(memoryQuota);
    const entry = memoryQuota.get(key) ?? { used: 0, pending: [], expires: resetMs(now) };
    const { pending, reclaimed } = reconcilePending(entry.pending, nowMs);
    const used = entry.used - reclaimed;
    if (used >= limit) {
      entry.used = used;
      entry.pending = pending;
      memoryQuota.set(key, entry);
      return { ok: false, day, used };
    }
    const reservationId = randomUUID();
    entry.used = used + 1;
    entry.pending = [...pending, { id: reservationId, expiresAt: nowMs + RESERVATION_TTL_MS }];
    memoryQuota.set(key, entry);
    return { ok: true, day, reservationId };
  }
  if (selectedStore() === "oracle-nosql") {
    return updateOracleDocument<Reservation>(
      "vpn_web_quota",
      key,
      (data) => {
        const { pending, reclaimed } = reconcilePending(oraclePending(data), nowMs);
        const used = Math.max(0, storedCount(data?.used) - reclaimed);
        const payload = {
          ...data,
          day,
          service,
          days,
          used,
          pending,
          updatedAt: new Date().toISOString(),
          expireAt: new Date(nextResetAt(now).getTime() + 3 * 86_400_000).toISOString(),
        };
        if (used >= limit)
          return { write: true, payload, result: { ok: false as const, day, used } };
        const reservationId = randomUUID();
        return {
          write: true,
          payload: {
            ...payload,
            used: used + 1,
            pending: [...pending, { id: reservationId, expiresAt: nowMs + RESERVATION_TTL_MS }],
          },
          result: { ok: true as const, day, reservationId },
        };
      },
      4,
    );
  }
  const db = await firebaseStore();
  const ref = db.collection("vpn_web_quota").doc(key);
  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const data = (snap.exists ? snap.data() : undefined) ?? {};
    const stored = Array.isArray(data.pending)
      ? data.pending.map((item: any) => ({
          id: typeof item?.id === "string" ? item.id : "",
          expiresAt:
            typeof item?.expiresAt?.toMillis === "function" ? item.expiresAt.toMillis() : 0,
        }))
      : [];
    const { pending, reclaimed } = reconcilePending(stored, nowMs);
    const used = Math.max(0, Number(data.used ?? 0) - reclaimed);
    const pendingDocs = pending.map((item) => ({
      id: item.id,
      expiresAt: Timestamp.fromMillis(item.expiresAt),
    }));
    if (used >= limit) {
      tx.set(
        ref,
        {
          day,
          service,
          days,
          used,
          pending: pendingDocs,
          updatedAt: new Date().toISOString(),
          expireAt: Timestamp.fromDate(new Date(nextResetAt(now).getTime() + 3 * 86_400_000)),
        },
        { merge: true },
      );
      return { ok: false as const, day, used };
    }
    const reservationId = randomUUID();
    tx.set(
      ref,
      {
        day,
        service,
        days,
        used: used + 1,
        pending: [
          ...pendingDocs,
          { id: reservationId, expiresAt: Timestamp.fromMillis(nowMs + RESERVATION_TTL_MS) },
        ],
        updatedAt: new Date().toISOString(),
        expireAt: Timestamp.fromDate(new Date(nextResetAt(now).getTime() + 3 * 86_400_000)),
      },
      { merge: true },
    );
    return { ok: true as const, day, reservationId };
  }) as Promise<Reservation>;
}

function removePending(
  pending: PendingReservation[],
  reservationId: string,
): { pending: PendingReservation[]; found: boolean } {
  const next = pending.filter((item) => item.id !== reservationId);
  return { pending: next, found: next.length !== pending.length };
}

/** Finalisasi reservasi yang GAGAL: slot dikembalikan. Idempoten. */
export async function releaseQuota(
  service: string,
  day: string,
  days: number,
  reservationId: string,
): Promise<void> {
  const key = quotaKey(day, service, days);
  invalidate();
  if (selectedStore() === "memory") {
    const entry = memoryQuota.get(key);
    if (!entry) return;
    const { pending, reclaimed } = reconcilePending(entry.pending, Date.now());
    const { pending: next, found } = removePending(pending, reservationId);
    entry.pending = next;
    entry.used = Math.max(0, entry.used - reclaimed - (found ? 1 : 0));
    memoryQuota.set(key, entry);
    return;
  }
  if (selectedStore() === "oracle-nosql") {
    await updateOracleDocument(
      "vpn_web_quota",
      key,
      (data) => {
        if (!data) return { write: false, result: undefined };
        const { pending, reclaimed } = reconcilePending(oraclePending(data), Date.now());
        const { pending: next, found } = removePending(pending, reservationId);
        return {
          write: true,
          payload: {
            ...data,
            used: Math.max(0, storedCount(data.used) - reclaimed - (found ? 1 : 0)),
            pending: next,
            updatedAt: new Date().toISOString(),
          },
          result: undefined,
        };
      },
      4,
    );
    return;
  }
  const db = await firebaseStore();
  const ref = db.collection("vpn_web_quota").doc(key);
  await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() ?? {};
    const stored: PendingReservation[] = Array.isArray(data.pending)
      ? data.pending.map((item: any) => ({
          id: typeof item?.id === "string" ? item.id : "",
          expiresAt:
            typeof item?.expiresAt?.toMillis === "function" ? item.expiresAt.toMillis() : 0,
        }))
      : [];
    const { pending, reclaimed } = reconcilePending(stored, Date.now());
    const { pending: next, found } = removePending(pending, reservationId);
    tx.set(
      ref,
      {
        used: Math.max(0, Number(data.used ?? 0) - reclaimed - (found ? 1 : 0)),
        pending: next.map((item) => ({
          id: item.id,
          expiresAt: Timestamp.fromMillis(item.expiresAt),
        })),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  });
}

/** Finalisasi reservasi yang SUKSES (atau tidak pasti): slot tetap terpakai. Idempoten. */
export async function commitQuota(
  service: string,
  day: string,
  days: number,
  reservationId: string,
): Promise<void> {
  const key = quotaKey(day, service, days);
  invalidate();
  if (selectedStore() === "memory") {
    const entry = memoryQuota.get(key);
    if (!entry) return;
    const { pending, reclaimed } = reconcilePending(entry.pending, Date.now());
    entry.pending = removePending(pending, reservationId).pending;
    entry.used = Math.max(0, entry.used - reclaimed);
    memoryQuota.set(key, entry);
    return;
  }
  if (selectedStore() === "oracle-nosql") {
    await updateOracleDocument(
      "vpn_web_quota",
      key,
      (data) => {
        if (!data) return { write: false, result: undefined };
        const { pending, reclaimed } = reconcilePending(oraclePending(data), Date.now());
        const next = removePending(pending, reservationId).pending;
        return {
          write: true,
          payload: {
            ...data,
            used: Math.max(0, storedCount(data.used) - reclaimed),
            pending: next,
            updatedAt: new Date().toISOString(),
          },
          result: undefined,
        };
      },
      4,
    );
    return;
  }
  const db = await firebaseStore();
  const ref = db.collection("vpn_web_quota").doc(key);
  await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() ?? {};
    const stored: PendingReservation[] = Array.isArray(data.pending)
      ? data.pending.map((item: any) => ({
          id: typeof item?.id === "string" ? item.id : "",
          expiresAt:
            typeof item?.expiresAt?.toMillis === "function" ? item.expiresAt.toMillis() : 0,
        }))
      : [];
    const { pending, reclaimed } = reconcilePending(stored, Date.now());
    const next = removePending(pending, reservationId).pending;
    tx.set(
      ref,
      {
        used: Math.max(0, Number(data.used ?? 0) - reclaimed),
        pending: next.map((item) => ({
          id: item.id,
          expiresAt: Timestamp.fromMillis(item.expiresAt),
        })),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  });
}

async function readSnapshot(
  services: Array<{ id: string }>,
  now: Date,
  limits: Record<string, Record<number, number>>,
): Promise<QuotaSnapshot> {
  const day = wibDay(now);
  const nowMs = now.getTime();
  const resetsAt = nextResetAt(now).toISOString();
  const result: QuotaSnapshot = { resetsAt };
  const toPending = (data: any): PendingReservation[] =>
    Array.isArray(data?.pending)
      ? data.pending.map((item: any) => ({
          id: typeof item?.id === "string" ? item.id : "",
          expiresAt:
            typeof item?.expiresAt?.toMillis === "function" ? item.expiresAt.toMillis() : 0,
        }))
      : [];
  const buildEntry = (id: string, readUsed: (serviceId: string, days: number) => number): void => {
    const serviceLimits = limits[id] ?? DEFAULT_QUOTA_PER_DURATION;
    const durations: Record<string, DurationQuotaEntry | number | string> = {};
    let usedTotal = 0;
    let limitTotal = 0;
    for (const [daysText, limit] of Object.entries(serviceLimits)) {
      const days = Number(daysText);
      const used = Math.max(0, readUsed(id, days));
      durations[daysText] = { used, limit };
      usedTotal += used;
      limitTotal += limit;
    }
    result[id] = {
      ...durations,
      used: usedTotal,
      limit: limitTotal,
      remaining: Math.max(0, limitTotal - usedTotal),
      resetsAt,
    };
  };
  if (selectedStore() === "memory") {
    cleanup(memoryQuota);
    for (const { id } of services)
      buildEntry(id, (serviceId, days) => {
        const entry = memoryQuota.get(quotaKey(day, serviceId, days));
        if (!entry) return 0;
        const { pending, reclaimed } = reconcilePending(entry.pending, nowMs);
        entry.used = Math.max(0, entry.used - reclaimed);
        entry.pending = pending;
        return entry.used;
      });
    return result;
  }
  if (selectedStore() === "oracle-nosql") {
    await Promise.all(
      services.map(async ({ id }) => {
        const durations = Object.keys(limits[id] ?? DEFAULT_QUOTA_PER_DURATION);
        const reads = await Promise.all(
          durations.map(async (daysText) => {
            const data = await getOracleDocument(
              "vpn_web_quota",
              quotaKey(day, id, Number(daysText)),
            );
            const { reclaimed } = reconcilePending(oraclePending(data), nowMs);
            return [daysText, Math.max(0, storedCount(data?.used) - reclaimed)] as const;
          }),
        );
        const usedByDuration = Object.fromEntries(reads);
        buildEntry(id, (_serviceId, days) => usedByDuration[String(days)] ?? 0);
      }),
    );
    return result;
  }
  const db = await firebaseStore();
  await Promise.all(
    services.map(async ({ id }) => {
      const durations = Object.keys(limits[id] ?? DEFAULT_QUOTA_PER_DURATION);
      const reads = await Promise.all(
        durations.map(async (daysText) => {
          const snap = await db
            .collection("vpn_web_quota")
            .doc(quotaKey(day, id, Number(daysText)))
            .get();
          const data = (snap.exists ? snap.data() : undefined) ?? {};
          const { reclaimed } = reconcilePending(toPending(data), nowMs);
          return [daysText, Math.max(0, Number(data.used ?? 0) - reclaimed)] as const;
        }),
      );
      const usedByDuration = Object.fromEntries(reads);
      buildEntry(id, (_serviceId, days) => usedByDuration[String(days)] ?? 0);
    }),
  );
  return result;
}

export async function quotaSnapshot(
  services: Array<{ id: string }>,
  now: Date,
  limits: Record<string, Record<number, number>>,
): Promise<QuotaSnapshot> {
  if (snapshotCache && snapshotCache.expires > Date.now())
    return snapshotCache.pending
      ? (snapshotCache.pending as Promise<QuotaSnapshot>)
      : (snapshotCache.value as QuotaSnapshot);
  const pending = readSnapshot(services, now, limits);
  snapshotCache = { value: {}, expires: Date.now() + 5000, pending };
  try {
    const value = await pending;
    snapshotCache = { value, expires: Date.now() + 5000 };
    return value;
  } catch (error) {
    snapshotCache = undefined;
    throw error;
  }
}

export async function reserveIpQuota(
  ipHash: string,
  service: string,
  now: Date,
  hourlyLimit: number,
  dailyLimit: number,
): Promise<IpReservation> {
  const hour = Math.floor(now.getTime() / 3_600_000).toString();
  const day = wibDay(now);
  if (selectedStore() === "memory") {
    cleanup(memoryIp);
    const hourKey = `h_${hour}_${ipHash}`;
    const dayKey = `d_${day}_${ipHash}_${service}`;
    const hourly = memoryIp.get(hourKey) ?? { used: 0, expires: hourResetMs(now) };
    const daily = memoryIp.get(dayKey) ?? { used: 0, expires: resetMs(now) };
    if (hourly.used >= hourlyLimit || daily.used >= dailyLimit)
      return {
        ok: false,
        used: Math.max(hourly.used, daily.used),
        retryAfter: Math.ceil((Math.min(hourly.expires, daily.expires) - now.getTime()) / 1000),
      };
    hourly.used += 1;
    daily.used += 1;
    memoryIp.set(hourKey, hourly);
    memoryIp.set(dayKey, daily);
    return { ok: true, logId: `${hour}_${ipHash}_${Date.now()}` };
  }
  if (selectedStore() === "oracle-nosql") {
    return updateOracleDocument<IpReservation>(
      "vpn_web_ip_limits",
      `ip_${ipHash}`,
      (data) => {
        const hourUsed = data?.hour === hour ? storedCount(data.hourlyUsed) : 0;
        const dailyCounts =
          data?.day === day && data.dailyUsed && typeof data.dailyUsed === "object"
            ? (data.dailyUsed as Record<string, unknown>)
            : {};
        const dayUsed = storedCount(dailyCounts[service]);
        if (hourUsed >= hourlyLimit || dayUsed >= dailyLimit)
          return {
            write: false,
            result: {
              ok: false as const,
              used: Math.max(hourUsed, dayUsed),
              retryAfter: Math.ceil(
                (Math.min(hourResetMs(now), resetMs(now)) - now.getTime()) / 1000,
              ),
            },
          };

        return {
          write: true,
          payload: {
            hour,
            hourlyUsed: hourUsed + 1,
            day,
            dailyUsed: { ...dailyCounts, [service]: dayUsed + 1 },
            updatedAt: new Date().toISOString(),
          },
          result: { ok: true as const, logId: `${hour}_${ipHash}_${Date.now()}` },
        };
      },
      3,
    );
  }
  const db = await firebaseStore();
  const hourRef = db.collection("vpn_web_ip_limits").doc(`h_${hour}_${ipHash}`);
  const dayRef = db.collection("vpn_web_ip_limits").doc(`d_${day}_${ipHash}_${service}`);
  return db.runTransaction(async (tx: any) => {
    const [hourSnap, daySnap] = await Promise.all([tx.get(hourRef), tx.get(dayRef)]);
    const h = Number(hourSnap.data()?.used ?? 0);
    const d = Number(daySnap.data()?.used ?? 0);
    if (h >= hourlyLimit || d >= dailyLimit)
      return {
        ok: false as const,
        used: Math.max(h, d),
        retryAfter: Math.ceil((Math.min(hourResetMs(now), resetMs(now)) - now.getTime()) / 1000),
      };
    tx.set(
      hourRef,
      {
        hour,
        ipHash,
        used: h + 1,
        updatedAt: new Date().toISOString(),
        expireAt: Timestamp.fromDate(new Date(hourResetMs(now) + 2 * 3_600_000)),
      },
      { merge: true },
    );
    tx.set(
      dayRef,
      {
        day,
        ipHash,
        service,
        used: d + 1,
        updatedAt: new Date().toISOString(),
        expireAt: Timestamp.fromDate(new Date(resetMs(now) + 2 * 86_400_000)),
      },
      { merge: true },
    );
    return { ok: true as const, logId: `${hour}_${ipHash}_${Date.now()}` };
  }) as Promise<IpReservation>;
}

export function resetMemoryStoreForTests(): void {
  memoryQuota.clear();
  memoryIp.clear();
  snapshotCache = undefined;
}

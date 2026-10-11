// Bentuk kuota dari GET /api/meta. Backend memakai peta per durasi
// quota[serviceId]["1"|"3"|"7"] = { used, limit }, plus agregat lama
// (used/limit/remaining/resetsAt) dan resetsAt di tingkat atas.
// Kode defensif: dukung bentuk baru maupun bentuk datar lama.

export type QuotaEntry = {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
};

export type QuotaMap = {
  resetsAt?: string;
  [serviceId: string]: unknown;
};

type RawEntry = {
  used?: unknown;
  limit?: unknown;
  remaining?: unknown;
  resetsAt?: unknown;
  [duration: string]: unknown;
};

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalize(raw: unknown, resetsAt: string): QuotaEntry | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const used = asNumber((raw as RawEntry).used);
  const limit = asNumber((raw as RawEntry).limit);
  if (used === undefined || limit === undefined) return undefined;
  return { used, limit, remaining: Math.max(0, limit - used), resetsAt };
}

function entryResetsAt(quota: QuotaMap | undefined, entry: RawEntry): string {
  const fromEntry = typeof entry.resetsAt === "string" ? entry.resetsAt : "";
  if (fromEntry) return fromEntry;
  return typeof quota?.resetsAt === "string" ? quota.resetsAt : "";
}

// Kuota untuk satu durasi. Fallback ke bentuk datar bila peta per durasi
// belum tersedia.
export function quotaForDuration(
  quota: QuotaMap | undefined,
  serviceId: string,
  days: 1 | 3 | 7,
): QuotaEntry | undefined {
  const raw = quota?.[serviceId];
  if (!raw || typeof raw !== "object") return undefined;
  const entry = raw as RawEntry;
  const resetsAt = entryResetsAt(quota, entry);
  const perDuration = normalize(entry[String(days)], resetsAt);
  if (perDuration) return perDuration;
  if (asNumber(entry.remaining) !== undefined) return normalize(entry, resetsAt);
  return undefined;
}

// Agregat seluruh durasi untuk tampilan per layanan (halaman server).
export function quotaTotals(
  quota: QuotaMap | undefined,
  serviceId: string,
): QuotaEntry | undefined {
  const raw = quota?.[serviceId];
  if (!raw || typeof raw !== "object") return undefined;
  const entry = raw as RawEntry;
  const resetsAt = entryResetsAt(quota, entry);
  const parts = (["1", "3", "7"] as const)
    .map((key) => normalize(entry[key], resetsAt))
    .filter((part): part is QuotaEntry => part !== undefined);
  if (parts.length > 0) {
    return {
      used: parts.reduce((sum, part) => sum + part.used, 0),
      limit: parts.reduce((sum, part) => sum + part.limit, 0),
      remaining: parts.reduce((sum, part) => sum + part.remaining, 0),
      resetsAt,
    };
  }
  if (asNumber(entry.remaining) !== undefined) return normalize(entry, resetsAt);
  return undefined;
}

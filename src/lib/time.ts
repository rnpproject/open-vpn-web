const WIB = "Asia/Jakarta";
const DAY_MS = 24 * 60 * 60 * 1000;

export function wibDay(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: WIB,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function nextResetAt(now: Date): Date {
  const [year, month, day] = wibDay(now).split("-").map(Number);
  // Jakarta is UTC+07:00 year round; 17:00 UTC on this calendar day is 00:00 WIB tomorrow.
  return new Date(Date.UTC(year, month - 1, day, 17, 0, 0, 0));
}

export function formatWib(iso: string | Date): string {
  const date = iso instanceof Date ? iso : new Date(iso);
  return `${new Intl.DateTimeFormat("id-ID", {
    timeZone: WIB,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date)} WIB`;
}

/** Human-readable uptime, e.g. "42 menit", "5 jam 12 menit", "3 hari 4 jam". Returns null for invalid input. */
export function formatUptime(totalSeconds: number): string | null {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return null;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 1) return "kurang dari 1 menit";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${days} hari ${hours} jam` : `${days} hari`;
  if (hours > 0) return mins > 0 ? `${hours} jam ${mins} menit` : `${hours} jam`;
  return `${mins} menit`;
}

export function countdownToReset(now: Date): { hours: number; minutes: number; seconds: number } {
  const remaining = Math.max(0, nextResetAt(now).getTime() - now.getTime());
  const seconds = Math.floor(remaining / 1000);
  return {
    hours: Math.floor(seconds / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
  };
}

/** Batasi janji agar tidak menggantung selamanya. Janji aslinya tetap jalan di
 *  latar, tetapi pemanggil mendapat kepastian waktu. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = "operation"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const WIB_DAY_MS = DAY_MS;

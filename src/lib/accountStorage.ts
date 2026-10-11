export type StoredAccount = {
  username: string;
  expires_at: string;
  connection: Record<string, unknown>;
};

type StoredValue = { savedAt: number; data: StoredAccount };
const TTL_MS = 30 * 60 * 1000;

function valid(data: unknown): data is StoredAccount {
  if (!data || typeof data !== "object") return false;
  const value = data as Record<string, unknown>;
  return (
    typeof value.username === "string" &&
    typeof value.expires_at === "string" &&
    !Number.isNaN(Date.parse(value.expires_at)) &&
    Boolean(value.connection) &&
    typeof value.connection === "object" &&
    !Array.isArray(value.connection)
  );
}

export function readStoredAccount(
  storage: Storage,
  key: string,
  now = Date.now(),
): StoredAccount | null {
  try {
    const raw: unknown = JSON.parse(storage.getItem(key) ?? "null");
    if (!raw || typeof raw !== "object") throw new Error("invalid");
    const value = raw as Partial<StoredValue>;
    if (
      !Number.isFinite(value.savedAt) ||
      !valid(value.data) ||
      now - Number(value.savedAt) > TTL_MS ||
      Date.parse(value.data.expires_at) <= now
    )
      throw new Error("expired");
    return value.data;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function writeStoredAccount(
  storage: Storage,
  key: string,
  data: StoredAccount,
  now = Date.now(),
): void {
  storage.setItem(key, JSON.stringify({ savedAt: now, data } satisfies StoredValue));
}

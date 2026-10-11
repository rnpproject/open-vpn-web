import { afterEach, describe, expect, it } from "vitest";
import {
  durationLimits,
  getEnv,
  parseQuotaPerDuration,
  resetEnvForTests,
} from "@/lib/env";
import {
  commitQuota,
  quotaSnapshot,
  reconcilePending,
  releaseQuota,
  reserveQuota,
  resetMemoryStoreForTests,
} from "@/lib/firestore";

const SALT = "test-salt-min-16-chars";

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  resetEnvForTests();
  resetMemoryStoreForTests();
  delete process.env.QUOTA_PER_DURATION;
  delete process.env.ALLOWED_DAYS;
  delete process.env.IP_HASH_SALT;
  delete process.env.QUOTA_STORE;
});

describe("parseQuotaPerDuration", () => {
  it("parses the default format", () => {
    expect(parseQuotaPerDuration("1:4,3:3,7:3")).toEqual({ 1: 4, 3: 3, 7: 3 });
  });

  it("tolerates surrounding spaces", () => {
    expect(parseQuotaPerDuration(" 1 : 4 , 3:3 ")).toEqual({ 1: 4, 3: 3 });
  });

  it.each([
    ["empty", ""],
    ["missing limit", "1:4,3"],
    ["missing days", "1:4,:3"],
    ["zero limit", "1:0"],
    ["negative limit", "1:-2"],
    ["zero days", "0:5"],
    ["days over 30", "31:5"],
    ["duplicate days", "1:4,1:3"],
    ["not a pair", "abc"],
    ["trailing separator", "1:4,"],
  ])("rejects %s", (_label, raw) => {
    expect(() => parseQuotaPerDuration(raw)).toThrow();
  });
});

describe("QUOTA_PER_DURATION env validation", () => {
  it("defaults to 1:4, 3:3, 7:3", () => {
    setEnv({ IP_HASH_SALT: SALT });
    expect(getEnv().QUOTA_PER_DURATION).toEqual({ 1: 4, 3: 3, 7: 3 });
  });

  it("accepts a custom split matching ALLOWED_DAYS", () => {
    setEnv({ IP_HASH_SALT: SALT, ALLOWED_DAYS: "1,7", QUOTA_PER_DURATION: "1:6,7:4" });
    expect(getEnv().QUOTA_PER_DURATION).toEqual({ 1: 6, 7: 4 });
  });

  it("rejects a duration outside ALLOWED_DAYS", () => {
    setEnv({ IP_HASH_SALT: SALT, ALLOWED_DAYS: "1,3,7", QUOTA_PER_DURATION: "1:4,3:3,7:3,2:5" });
    expect(() => getEnv()).toThrow(/Konfigurasi server tidak valid/);
  });

  it("rejects a missing ALLOWED_DAYS duration", () => {
    setEnv({ IP_HASH_SALT: SALT, ALLOWED_DAYS: "1,3,7", QUOTA_PER_DURATION: "1:4,3:6" });
    expect(() => getEnv()).toThrow(/Konfigurasi server tidak valid/);
  });

  it("rejects malformed pairs", () => {
    setEnv({ IP_HASH_SALT: SALT, QUOTA_PER_DURATION: "1:4,3" });
    expect(() => getEnv()).toThrow();
  });
});

describe("durationLimits", () => {
  it("returns the configured split by default", () => {
    expect(durationLimits({ DAILY_LIMIT_PER_SERVICE: 10 })).toEqual({ 1: 4, 3: 3, 7: 3 });
  });

  it("scales proportionally with a per-server override", () => {
    expect(durationLimits({ DAILY_LIMIT_PER_SERVICE: 10 }, 20)).toEqual({ 1: 8, 3: 6, 7: 6 });
  });

  it("falls back to the default split when the env is incomplete (test mocks)", () => {
    expect(durationLimits({ DAILY_LIMIT_PER_SERVICE: 10 } as never)).toEqual({ 1: 4, 3: 3, 7: 3 });
  });
});

describe("reconcilePending", () => {
  it("drops expired entries and counts what was reclaimed", () => {
    const nowMs = 1_000_000;
    const { pending, reclaimed } = reconcilePending(
      [
        { id: "old", expiresAt: nowMs - 1 },
        { id: "edge", expiresAt: nowMs },
        { id: "fresh", expiresAt: nowMs + 1 },
      ],
      nowMs,
    );
    expect(pending.map((item) => item.id)).toEqual(["fresh"]);
    expect(reclaimed).toBe(2);
  });

  it("handles missing input", () => {
    expect(reconcilePending(undefined, Date.now())).toEqual({ pending: [], reclaimed: 0 });
  });
});

describe("per-duration quota (memory store)", () => {
  const limits = { ssh: { 1: 4, 3: 3, 7: 3 } };
  const usedOf = (snapshot: unknown, days: string): number =>
    (snapshot as Record<string, Record<string, { used: number }>>).ssh[days].used;

  it("enforces independent limits per duration", async () => {
    setEnv({ IP_HASH_SALT: SALT });
    const now = new Date();
    for (let i = 0; i < 4; i += 1) expect((await reserveQuota("ssh", now, 4, 1)).ok).toBe(true);
    const exhausted = await reserveQuota("ssh", now, 4, 1);
    expect(exhausted.ok).toBe(false);
    if (!exhausted.ok) expect(exhausted.used).toBe(4);
    // The 3-day bucket is independent from the 1-day bucket.
    expect((await reserveQuota("ssh", now, 3, 3)).ok).toBe(true);
    const snapshot = await quotaSnapshot([{ id: "ssh" }], now, limits);
    expect(usedOf(snapshot, "1")).toBe(4);
    expect(usedOf(snapshot, "3")).toBe(1);
    expect(usedOf(snapshot, "7")).toBe(0);
  });

  it("release returns the slot while commit keeps it", async () => {
    setEnv({ IP_HASH_SALT: SALT });
    const now = new Date();
    const first = await reserveQuota("ssh", now, 4, 1);
    if (!first.ok) throw new Error("reserve should succeed");
    await releaseQuota("ssh", first.day, 1, first.reservationId);
    expect(usedOf(await quotaSnapshot([{ id: "ssh" }], now, limits), "1")).toBe(0);

    const second = await reserveQuota("ssh", now, 4, 1);
    if (!second.ok) throw new Error("reserve should succeed");
    await commitQuota("ssh", second.day, 1, second.reservationId);
    expect(usedOf(await quotaSnapshot([{ id: "ssh" }], now, limits), "1")).toBe(1);
    // Releasing after a commit is a no-op: no double decrement.
    await releaseQuota("ssh", second.day, 1, second.reservationId);
    expect(usedOf(await quotaSnapshot([{ id: "ssh" }], now, limits), "1")).toBe(1);
  });

  it("reclaims orphaned reservations once they expire", async () => {
    setEnv({ IP_HASH_SALT: SALT });
    const t1 = new Date();
    const t0 = new Date(t1.getTime() - 11 * 60_000);
    const orphan = await reserveQuota("ssh", t0, 4, 1);
    expect(orphan.ok).toBe(true);
    // 11 minutes later the 10-minute reservation has expired without finalize.
    const next = await reserveQuota("ssh", t1, 4, 1);
    expect(next.ok).toBe(true);
    // Only the new reservation counts; the orphan was reclaimed, not double-counted.
    expect(usedOf(await quotaSnapshot([{ id: "ssh" }], t1, limits), "1")).toBe(1);
  });

  it("returns the legacy aggregate fields for compatibility", async () => {
    setEnv({ IP_HASH_SALT: SALT });
    const now = new Date();
    await reserveQuota("ssh", now, 4, 1);
    await reserveQuota("ssh", now, 3, 3);
    const snapshot = (await quotaSnapshot([{ id: "ssh" }], now, limits)) as Record<
      string,
      { used: number; limit: number; remaining: number; resetsAt: string }
    >;
    expect(snapshot.ssh.used).toBe(2);
    expect(snapshot.ssh.limit).toBe(10);
    expect(snapshot.ssh.remaining).toBe(8);
    expect(typeof snapshot.ssh.resetsAt).toBe("string");
  });
});

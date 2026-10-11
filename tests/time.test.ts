import { describe, expect, it } from "vitest";
import { formatUptime, formatWib, nextResetAt, wibDay } from "@/lib/time";

describe("formatUptime", () => {
  it("picks the two most useful units", () => {
    expect(formatUptime(30)).toBe("kurang dari 1 menit");
    expect(formatUptime(42 * 60)).toBe("42 menit");
    expect(formatUptime(5 * 3600 + 12 * 60)).toBe("5 jam 12 menit");
    expect(formatUptime(5 * 3600)).toBe("5 jam");
    expect(formatUptime(3 * 86400 + 4 * 3600 + 59 * 60)).toBe("3 hari 4 jam");
    expect(formatUptime(2 * 86400)).toBe("2 hari");
  });
  it("rejects invalid input", () => {
    expect(formatUptime(-1)).toBeNull();
    expect(formatUptime(Number.NaN)).toBeNull();
  });
});

describe("Jakarta time calculations", () => {
  it("uses the WIB day close to midnight without depending on host timezone", () => {
    expect(wibDay(new Date("2026-10-06T16:59:59.000Z"))).toBe("2026-10-06");
    expect(wibDay(new Date("2026-10-06T17:00:00.000Z"))).toBe("2026-10-07");
  });
  it("resets at 00:00 WIB", () => {
    expect(nextResetAt(new Date("2026-10-06T16:59:59.000Z")).toISOString()).toBe(
      "2026-10-06T17:00:00.000Z",
    );
    expect(nextResetAt(new Date("2026-10-06T17:00:00.000Z")).toISOString()).toBe(
      "2026-10-07T17:00:00.000Z",
    );
  });
  it("formats human-readable Indonesian time in WIB", () => {
    expect(formatWib("2026-10-06T17:10:00.000Z")).toContain("07 Okt 2026, 00.10 WIB");
  });
});

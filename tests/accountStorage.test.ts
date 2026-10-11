import { describe, expect, it } from "vitest";
import { readStoredAccount, writeStoredAccount } from "@/lib/accountStorage";

function storage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: () => null,
    removeItem: (key) => data.delete(key),
    setItem: (key, value) => data.set(key, value),
  };
}

describe("account storage", () => {
  it("round-trips an account only within its lifetime", () => {
    const tab = storage();
    const now = Date.parse("2026-10-08T00:00:00Z");
    const account = {
      username: "user",
      expires_at: "2026-10-09T00:00:00Z",
      connection: { host: "example" },
    };
    writeStoredAccount(tab, "account", account, now);
    expect(readStoredAccount(tab, "account", now + 1000)).toEqual(account);
    expect(readStoredAccount(tab, "account", now + 31 * 60 * 1000)).toBeNull();
  });
  it("removes malformed values", () => {
    const tab = storage();
    tab.setItem("account", "not-json");
    expect(readStoredAccount(tab, "account")).toBeNull();
    expect(tab.getItem("account")).toBeNull();
  });
});

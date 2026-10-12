import { afterEach, describe, expect, it, vi } from "vitest";

const oracle = vi.hoisted(() => ({
  rows: new Map<string, { payload: Record<string, unknown>; version: number }>(),
  conflictNextPut: false,
  lastConfig: undefined as Record<string, unknown> | undefined,
  lastPutOptions: undefined as Record<string, unknown> | undefined,
}));

vi.mock("oracle-nosqldb", () => ({
  NoSQLClient: class {
    constructor(config: Record<string, unknown>) {
      oracle.lastConfig = config;
    }

    async get(_table: string, key: Record<string, string>) {
      const stored = oracle.rows.get(JSON.stringify([key.collection_type, key.document_id]));
      return stored
        ? { row: { ...key, payload: stored.payload }, version: stored.version }
        : { row: null };
    }

    async put(_table: string, row: Record<string, unknown>, options: Record<string, unknown>) {
      oracle.lastPutOptions = options;
      const id = JSON.stringify([row.collection_type, row.document_id]);
      const existing = oracle.rows.get(id);
      if (oracle.conflictNextPut) {
        oracle.conflictNextPut = false;
        oracle.rows.set(id, {
          payload: { counter: 1 },
          version: (existing?.version ?? 0) + 1,
        });
        return { success: false };
      }
      if (options.ifAbsent && existing) return { success: false };
      if (options.matchVersion !== undefined && options.matchVersion !== existing?.version)
        return { success: false };
      const version = (existing?.version ?? 0) + 1;
      oracle.rows.set(id, { payload: row.payload as Record<string, unknown>, version });
      return { success: true, version };
    }
  },
}));

import { resetEnvForTests } from "@/lib/env";
import {
  commitQuota,
  quotaSnapshot,
  reserveIpQuota,
  reserveQuota,
  resetMemoryStoreForTests,
} from "@/lib/firestore";
import { updateOracleDocument } from "@/lib/oracleNosql";

function configureOracleStore(): void {
  process.env.QUOTA_STORE = "oracle-nosql";
  process.env.ORACLE_NOSQL_REGION = "ap-singapore-1";
  process.env.ORACLE_NOSQL_COMPARTMENT = "ocid1.compartment.oc1..test";
  process.env.ORACLE_NOSQL_TENANT_ID = "ocid1.tenancy.oc1..test";
  process.env.ORACLE_NOSQL_USER_ID = "ocid1.user.oc1..test";
  process.env.ORACLE_NOSQL_FINGERPRINT = "12:34:56";
  process.env.ORACLE_NOSQL_PRIVATE_KEY =
    "-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----";
  process.env.ORACLE_NOSQL_PASSPHRASE = "test-passphrase";
  process.env.ORACLE_NOSQL_TABLE = "free_ovpn";
  process.env.IP_HASH_SALT = "test-salt-long-enough";
  resetEnvForTests();
}

afterEach(() => {
  oracle.rows.clear();
  oracle.conflictNextPut = false;
  oracle.lastConfig = undefined;
  oracle.lastPutOptions = undefined;
  delete process.env.QUOTA_STORE;
  delete process.env.ORACLE_NOSQL_REGION;
  delete process.env.ORACLE_NOSQL_COMPARTMENT;
  delete process.env.ORACLE_NOSQL_TENANT_ID;
  delete process.env.ORACLE_NOSQL_USER_ID;
  delete process.env.ORACLE_NOSQL_FINGERPRINT;
  delete process.env.ORACLE_NOSQL_PRIVATE_KEY;
  delete process.env.ORACLE_NOSQL_PASSPHRASE;
  delete process.env.ORACLE_NOSQL_TABLE;
  delete process.env.IP_HASH_SALT;
  resetEnvForTests();
  resetMemoryStoreForTests();
});

describe("Oracle NoSQL quota store", () => {
  it("uses OCI IAM credentials and retries a stale row version", async () => {
    configureOracleStore();
    oracle.conflictNextPut = true;

    const result = await updateOracleDocument(
      "vpn_web_quota",
      "2026-10-12_ssh_1",
      (current) => ({
        write: true,
        payload: { counter: Number(current?.counter ?? 0) + 1 },
        result: Number(current?.counter ?? 0) + 1,
      }),
      4,
    );

    expect(result).toBe(2);
    expect(oracle.lastConfig).toMatchObject({
      region: "ap-singapore-1",
      compartment: "ocid1.compartment.oc1..test",
      auth: {
        iam: {
          tenantId: "ocid1.tenancy.oc1..test",
          userId: "ocid1.user.oc1..test",
          fingerprint: "12:34:56",
          privateKey: "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----",
          passphrase: "test-passphrase",
        },
      },
    });
    expect(oracle.lastPutOptions).toMatchObject({ ttl: 4, matchVersion: 1 });
  });

  it("enforces concurrent global quota reservations and snapshots usage", async () => {
    configureOracleStore();
    const now = new Date("2026-10-12T12:00:00.000Z");

    const reservations = await Promise.all(
      Array.from({ length: 8 }, () => reserveQuota("ssh", now, 1, 1)),
    );

    expect(reservations.filter((item) => item.ok)).toHaveLength(1);
    expect(reservations.filter((item) => !item.ok)).toHaveLength(7);
    const successful = reservations.find((item) => item.ok);
    if (!successful?.ok) throw new Error("Expected one successful quota reservation.");
    await commitQuota("ssh", successful.day, 1, successful.reservationId);

    const snapshot = await quotaSnapshot([{ id: "ssh" }], now, { ssh: { 1: 1 } });
    expect((snapshot.ssh as Record<string, { used: number }>)["1"].used).toBe(1);
    expect(oracle.rows.has(JSON.stringify(["vpn_web_quota", `${successful.day}_ssh_1`]))).toBe(
      true,
    );
  });

  it("keeps hourly per-IP and daily per-service limits atomic in one JSON record", async () => {
    configureOracleStore();
    const now = new Date("2026-10-12T12:00:00.000Z");
    const attempts = await Promise.all(
      Array.from({ length: 6 }, () => reserveIpQuota("ip-hash", "ssh", now, 1, 1)),
    );

    expect(attempts.filter((item) => item.ok)).toHaveLength(1);
    expect(attempts.filter((item) => !item.ok)).toHaveLength(5);
    expect((await reserveIpQuota("ip-hash", "xray", now, 1, 1)).ok).toBe(false);

    const nextHour = new Date(now.getTime() + 60 * 60_000);
    expect((await reserveIpQuota("ip-hash", "xray", nextHour, 1, 1)).ok).toBe(true);
    expect((await reserveIpQuota("ip-hash", "ssh", nextHour, 1, 1)).ok).toBe(false);
    expect(oracle.rows.has(JSON.stringify(["vpn_web_ip_limits", "ip_ip-hash"]))).toBe(true);
  });
});

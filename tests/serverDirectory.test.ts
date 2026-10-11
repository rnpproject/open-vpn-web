import { describe, expect, it } from "vitest";
import { groupServicesByServer, serverAccountTotal, serverHealth } from "@/lib/serverDirectory";
import type { Service } from "@/lib/vpnApi";

const services: Service[] = [
  {
    id: "vm1--ssh",
    label: "Server 1 · SSH",
    available: true,
    server_id: "vm1",
    server_label: "Server 1",
    server_capacity: 150,
    server_bandwidth: "Unlimited",
  },
  { id: "vm1--vmess", label: "Server 1 · VMess", available: false, server_id: "vm1" },
];

describe("server directory helpers", () => {
  it("carries capacity and bandwidth from the first service of a server", () => {
    const [group] = groupServicesByServer(services);
    expect(group.capacity).toBe(150);
    expect(group.bandwidth).toBe("Unlimited");
  });

  it("sums only numeric account counts and returns null without data", () => {
    const [group] = groupServicesByServer(services);
    expect(serverAccountTotal(group, { "vm1--ssh": 40, "vm1--vmess": 61 })).toBe(101);
    expect(serverAccountTotal(group, { "vm1--ssh": 40 })).toBe(40);
    expect(serverAccountTotal(group, {})).toBeNull();
    expect(serverAccountTotal(group, undefined)).toBeNull();
  });

  it("reports online only for a fresh status that includes the server", () => {
    const statusServers = [{ id: "vm1" }];
    expect(serverHealth(statusServers, "vm1", false)).toBe("online");
    expect(serverHealth(statusServers, "vm1", true)).toBe("stale");
    expect(serverHealth(statusServers, "vm2", false)).toBe("unknown");
    expect(serverHealth(undefined, "vm1", false)).toBe("unknown");
  });
});

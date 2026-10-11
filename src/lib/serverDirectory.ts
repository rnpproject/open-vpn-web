import type { Service } from "@/lib/vpnApi";

export type ServerGroup = {
  id: string;
  label: string;
  location?: string;
  capacity?: number;
  bandwidth?: string;
  services: Service[];
};

export function groupServicesByServer(services: Service[]): ServerGroup[] {
  const groups = new Map<string, ServerGroup>();
  for (const service of services) {
    const id = service.server_id ?? "default";
    const group = groups.get(id) ?? {
      id,
      label: service.server_label ?? "Server utama",
      location: service.server_location,
      capacity: service.server_capacity,
      bandwidth: service.server_bandwidth,
      services: [],
    };
    group.services.push(service);
    groups.set(id, group);
  }
  return [...groups.values()];
}

/** Total accounts recorded for a server, or null when the API reported none. */
export function serverAccountTotal(
  group: ServerGroup,
  accounts: Record<string, number> | undefined,
): number | null {
  const counts = group.services
    .map((service) => accounts?.[service.id])
    .filter((value): value is number => typeof value === "number");
  return counts.length ? counts.reduce((sum, value) => sum + value, 0) : null;
}

export type ServerHealth = "online" | "stale" | "unknown";

/**
 * "online" only when a fresh status response included this server. The portal
 * requires every configured server to answer, so a fresh response means all are up.
 */
export function serverHealth(
  statusServers: Array<Record<string, unknown>> | undefined,
  serverId: string,
  statusUnavailable: boolean | undefined,
): ServerHealth {
  const known = statusServers?.some((item) => item.id === serverId) ?? false;
  if (!known) return "unknown";
  return statusUnavailable ? "stale" : "online";
}

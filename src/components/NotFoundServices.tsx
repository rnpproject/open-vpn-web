"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { groupServicesByServer } from "@/lib/serverDirectory";
import type { Service } from "@/lib/vpnApi";

export function NotFoundServices() {
  const [services, setServices] = useState<Service[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/meta", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (Array.isArray(payload?.data?.services)) setServices(payload.data.services);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  const servers = groupServicesByServer(services);
  return servers.length ? (
    <nav aria-label="Available servers">
      <h2>Atau pilih server lain</h2>
      <ul className="not-found-services">
        {servers.map((server) => (
          <li key={server.id}>
            <Link
              href={`/server/${encodeURIComponent(server.id)}`}
              style={{ borderRadius: "var(--radius-pill)" }}
            >
              {server.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  ) : (
    <p role="status">Server list belum dapat dimuat.</p>
  );
}

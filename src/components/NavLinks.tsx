"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import type { ServerGroup } from "@/lib/serverDirectory";
import type { Service } from "@/lib/vpnApi";
import { ServiceIcon } from "@/components/ServiceIcon";

// Nav item berbentuk pill; item aktif memakai tint primary.
function pillStyle(active: boolean): CSSProperties {
  return {
    borderRadius: "var(--radius-pill)",
    padding: "0.45rem 0.9rem",
    fontFamily: "var(--font-sans)",
    background: active ? "var(--surface-tint)" : "transparent",
    color: active ? "var(--primary)" : "var(--muted)",
  };
}

export function NavLinks({
  servers,
  services,
}: {
  servers: Pick<ServerGroup, "id" | "label">[];
  services: Service[];
}) {
  const pathname = usePathname();
  const selectedServiceId = pathname.match(/^\/s\/([^/]+)/)?.[1];
  const selectedService = selectedServiceId
    ? services.find((service) => service.id === decodeURIComponent(selectedServiceId))
    : undefined;
  const serverId = pathname.match(/^\/server\/([^/]+)/)?.[1] ?? selectedService?.server_id;
  const currentServerServices = services.filter((service) => service.server_id === serverId);
  return (
    <>
      {
        <Link
          className={`desktop-nav__link ${pathname === "/" ? "is-current" : ""}`}
          href="/"
          aria-current={pathname === "/" ? "page" : undefined}
          style={pillStyle(pathname === "/")}
        >
          Home
        </Link>
      }
      {serverId
        ? currentServerServices.map((service) => {
            const href = `/s/${encodeURIComponent(service.id)}`;
            const active = pathname === href;
            return (
              <Link
                key={service.id}
                className={`desktop-nav__link ${active ? "is-current" : ""}`}
                href={href}
                aria-current={active ? "page" : undefined}
                style={pillStyle(active)}
              >
                <ServiceIcon id={service.id} size={20} />
                {service.service_label ?? service.label}
              </Link>
            );
          })
        : servers.map((server) => {
            const active = pathname === `/server/${server.id}`;
            return (
              <Link
                key={server.id}
                className={`desktop-nav__link ${active ? "is-current" : ""}`}
                href={`/server/${encodeURIComponent(server.id)}`}
                aria-current={active ? "page" : undefined}
                style={pillStyle(active)}
              >
                {server.label}
              </Link>
            );
          })}
    </>
  );
}

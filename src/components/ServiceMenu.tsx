"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { ServerGroup } from "@/lib/serverDirectory";
import type { Service } from "@/lib/vpnApi";
import { ServiceIcon } from "@/components/ServiceIcon";

const panelStyle: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-soft)",
  fontFamily: "var(--font-sans)",
};

const headingStyle: CSSProperties = {
  fontSize: "0.72rem",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--muted)",
};

export function ServiceMenu({
  servers,
  services,
}: {
  servers: Pick<ServerGroup, "id" | "label">[];
  services: Service[];
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const selectedServiceId = pathname.match(/^\/s\/([^/]+)/)?.[1];
  const selectedService = selectedServiceId
    ? services.find((service) => service.id === decodeURIComponent(selectedServiceId))
    : undefined;
  const serverId = pathname.match(/^\/server\/([^/]+)/)?.[1] ?? selectedService?.server_id;
  const currentServerServices = services.filter((service) => service.server_id === serverId);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  return (
    <div className="mobile-menu" ref={root}>
      <button
        ref={button}
        className="mobile-menu__toggle"
        type="button"
        aria-expanded={open}
        aria-controls="service-menu"
        onClick={() => setOpen(!open)}
        style={{
          borderRadius: "var(--radius-pill)",
          fontFamily: "var(--font-sans)",
          background: open ? "var(--surface-tint)" : "var(--surface)",
          color: open ? "var(--primary)" : "var(--ink)",
        }}
      >
        <Menu size={19} aria-hidden="true" /> Menu <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <nav
          id="service-menu"
          className="mobile-menu__panel"
          aria-label="Menu navigasi"
          style={panelStyle}
        >
          <Link
            href="/"
            aria-current={pathname === "/" ? "page" : undefined}
            onClick={() => setOpen(false)}
          >
            Home
          </Link>
          {serverId ? (
            currentServerServices.map((service) => (
              <Link
                key={service.id}
                href={`/s/${encodeURIComponent(service.id)}`}
                aria-current={
                  pathname === `/s/${encodeURIComponent(service.id)}` ? "page" : undefined
                }
                onClick={() => setOpen(false)}
              >
                <ServiceIcon id={service.id} size={20} /> {service.service_label ?? service.label}
              </Link>
            ))
          ) : (
            <>
              <p className="mobile-menu__heading" style={headingStyle}>
                Servers
              </p>
              {servers.map((server) => (
                <Link
                  key={server.id}
                  href={`/server/${encodeURIComponent(server.id)}`}
                  aria-current={pathname === `/server/${server.id}` ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  <span className="server-nav-mark" aria-hidden="true" /> {server.label}
                </Link>
              ))}
            </>
          )}
        </nav>
      )}
    </div>
  );
}

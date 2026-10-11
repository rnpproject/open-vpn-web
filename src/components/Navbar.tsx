"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { Service } from "@/lib/vpnApi";
import { ServiceMenu } from "@/components/ServiceMenu";
import { NavLinks } from "@/components/NavLinks";
import { groupServicesByServer } from "@/lib/serverDirectory";

export function Navbar({ services = [] }: { services?: Service[] }) {
  const servers = groupServicesByServer(services).map(({ id, label }) => ({ id, label }));
  return (
    <header
      className="site-header"
      style={{
        background: "var(--surface)",
        borderBottom: "1px solid var(--line)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <div className="site-header__inner">
        <Link className="brand" href="/" aria-label="Free VPN Home">
          <span className="brand__mark">
            <ShieldCheck size={21} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <span>
            <span className="brand__name">
              Free VPN<span style={{ color: "var(--primary)" }}>.</span>
            </span>
            <span className="brand__caption">QubanTra</span>
          </span>
        </Link>
        <nav className="desktop-nav" aria-label="Main navigation">
          <NavLinks servers={servers} services={services} />
        </nav>
        <ServiceMenu servers={servers} services={services} />
      </div>
    </header>
  );
}

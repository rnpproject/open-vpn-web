import Link from "next/link";
import type { CSSProperties } from "react";
import { ArrowRight, Gauge, Server as ServerIcon, Users } from "lucide-react";
import type { Meta } from "@/components/Portal";
import { ServerStatusBadge } from "@/components/ServerStatusBadge";
import { groupServicesByServer, serverAccountTotal, serverHealth } from "@/lib/serverDirectory";
import { formatUptime, formatWib } from "@/lib/time";

// Token visual (didefinisikan worker tokens di src/styles/tokens.css); fallback
// di sini menjaga tampilan tetap waras bila token belum terisi.
const heroHeadingStyle: CSSProperties = {
  fontFamily: "var(--font-sans, 'Plus Jakarta Sans', system-ui, sans-serif)",
  fontWeight: 800,
  letterSpacing: "-0.02em",
};

const sectionHeadingStyle: CSSProperties = {
  fontFamily: "var(--font-sans, 'Plus Jakarta Sans', system-ui, sans-serif)",
  fontWeight: 800,
  letterSpacing: "-0.015em",
};

const cardStyle: CSSProperties = {
  background: "var(--surface, #ffffff)",
  border: "1px solid var(--line, rgba(24, 51, 69, 0.14))",
  borderRadius: "var(--radius-lg, 10px)",
  boxShadow: "var(--shadow-soft, 0 12px 32px rgba(24, 51, 69, 0.08))",
};

const chipStyle: CSSProperties = {
  borderRadius: "var(--radius-pill, 6px)",
  background: "var(--surface-tint, #eaf3f8)",
  border: "1px solid transparent",
};

const chipOffStyle: CSSProperties = {
  borderRadius: "var(--radius-pill, 6px)",
};

const noteStyle: CSSProperties = {
  background: "var(--surface-tint, #eaf3f8)",
  border: "1px solid color-mix(in srgb, var(--primary, #0866b5) 28%, transparent)",
  borderRadius: "var(--radius, 8px)",
};

const protocolDetails: Record<string, string> = {
  ssh: "Gunakan host, port, username, dan password ini di aplikasi SSH tunneling.",
  vmess:
    "Xray protocol. Import connection link (biasanya diawali vmess://) ke aplikasi client yang mendukung VMess.",
  vless:
    "Xray protocol. Import connection link (biasanya diawali vless://) ke aplikasi client yang mendukung VLESS.",
  trojan:
    "Xray protocol. Import connection link (biasanya diawali trojan://) ke aplikasi client yang mendukung Trojan.",
  "ovpn-tcp":
    "OpenVPN melalui TCP. Jika tersedia file .ovpn, download lalu impor ke aplikasi OpenVPN.",
  "ovpn-udp":
    "OpenVPN melalui UDP. Jika tersedia file .ovpn, download lalu impor ke aplikasi OpenVPN.",
};

function listDays(days: number[]): string {
  if (days.length === 0) return "beberapa hari";
  if (days.length === 1) return `${days[0]} hari`;
  const head = days.slice(0, -1).join(", ");
  return `${head}${days.length > 2 ? "," : ""} atau ${days[days.length - 1]} hari`;
}

export function ServerDirectory({ meta }: { meta: Meta }) {
  const servers = groupServicesByServer(meta.services);
  const protocols = Array.from(
    new Map(
      servers
        .flatMap((server) => server.services)
        .map((service) => [
          service.upstream_id ?? service.id.split("--").at(-1) ?? service.id,
          service,
        ]),
    ).values(),
  );
  return (
    <section className="server-directory" aria-labelledby="server-directory-title">
      <header className="server-directory__hero">
        <p className="eyebrow">PORTAL AKUN VPN</p>
        <h1 id="server-directory-title" style={heroHeadingStyle}>
          Buat akun VPN gratis untuk {listDays(meta.allowed_days)}
        </h1>
        <p className="server-directory__intro">
          Pilih server dan service, lalu create akun dan simpan connection details. Data akun tersedia di tab ini selama 30 menit.
        </p>
      </header>
      {meta.unavailable ? (
        <p className="notice" role="status">
          Sebagian data server gagal diperbarui. {meta.statusFetchedAt ? `Last update ${formatWib(new Date(meta.statusFetchedAt))}.` : ""}
        </p>
      ) : null}
      <div className="server-directory__selection">
        <h2 id="server-selection-title" style={sectionHeadingStyle}>
          Pilih server
        </h2>
        <p>
          Pilih server untuk melihat status service dan sisa quota hari ini.
        </p>
      </div>
      {servers.length ? (
        <ul className="server-card-list">
          {servers.map((server) => {
            const status = meta.status?.servers?.find((item) => item.id === server.id);
            const available = server.services.filter((service) => service.available).length;
            const uptime = status?.uptime_seconds;
            const location =
              server.location ??
              (typeof status?.location === "string" ? status.location : undefined);
            const health = serverHealth(meta.status?.servers, server.id, meta.statusUnavailable);
            const accounts = serverAccountTotal(server, meta.status?.accounts);
            return (
              <li key={server.id}>
                <Link
                  className="server-card"
                  href={`/server/${encodeURIComponent(server.id)}`}
                  style={cardStyle}
                >
                  <span className="server-card__head">
                    <span className="server-card__icon">
                      <ServerIcon aria-hidden="true" />
                    </span>
                    <span className="server-card__title">
                      <strong>{server.label}</strong>
                      {location ? <span>Location: {location}</span> : null}
                    </span>
                    <ArrowRight className="server-card__arrow" aria-hidden="true" />
                  </span>
                  <ServerStatusBadge health={health} available={available} />
                  <span className="server-card__block">
                      <span className="server-card__label">Service</span>
                    <span className="chip-list">
                      {server.services.map((service) => (
                        <span
                          className={service.available ? "chip" : "chip chip--off"}
                          key={service.id}
                          style={service.available ? chipStyle : chipOffStyle}
                        >
                          {service.service_label ?? service.label}
                          {service.available ? null : (
                            <span className="sr-only"> (unavailable)</span>
                          )}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className="server-card__stats">
                    <span className="stat-tile">
                      <span className="server-card__label">
                        {server.capacity ? "Capacity" : "Akun tercatat"}
                      </span>
                      <strong>
                        <Users size={15} aria-hidden="true" />
                        {accounts === null
                          ? "Data belum tersedia"
                          : server.capacity
                            ? `${accounts} / ${server.capacity}`
                            : accounts}
                      </strong>
                    </span>
                    {server.bandwidth ? (
                      <span className="stat-tile">
                        <span className="server-card__label">Bandwidth</span>
                        <strong>
                          <Gauge size={15} aria-hidden="true" />
                          {server.bandwidth}
                        </strong>
                      </span>
                    ) : null}
                    <span className="stat-tile">
                      <span className="server-card__label">Uptime</span>
                      <strong>
                        {(typeof uptime === "number" ? formatUptime(uptime) : null) ??
                          "Data belum tersedia"}
                      </strong>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="panel" role="status">
          Server list gagal dimuat. Coba lagi sebentar.
        </p>
      )}

      <section className="portal-guide" aria-labelledby="portal-guide-title">
        <header className="portal-guide__heading">
          <h2 id="portal-guide-title" style={sectionHeadingStyle}>
            Cara kerja
          </h2>
        </header>

        <ol className="portal-guide__steps">
          <li>
            <h3>Bandingkan server</h3>
            <p>
              Cek location, status, dan service pada setiap server. Status Online berarti server merespons pengecekan terakhir. Uptime menunjukkan lama server aktif.
            </p>
          </li>
          <li>
            <h3>Pilih service dan durasi</h3>
            <p>
              Cek status service dan sisa quota, lalu pilih durasi akun yang tersedia.
            </p>
          </li>
          <li>
            <h3>Create dan simpan akun</h3>
            <p>
              Username dan password dibuat otomatis. Setelah berhasil, copy detail akun atau download file konfigurasi jika tersedia.
            </p>
          </li>
        </ol>

        {protocols.length ? (
          <section className="protocol-guide" aria-labelledby="protocol-guide-title">
            <h2 id="protocol-guide-title" style={sectionHeadingStyle}>
              Mengenal protocol
            </h2>
            <p>
              Setiap protocol punya format koneksi berbeda. Gunakan detail yang tampil setelah akun berhasil dibuat.
            </p>
            <ul className="protocol-guide__list">
              {protocols.map((service) => {
                const key = service.upstream_id ?? service.id.split("--").at(-1) ?? service.id;
                return (
                  <li key={key}>
                    <h3>{service.service_label ?? service.label}</h3>
                    <p>
                      {protocolDetails[key] ?? "Detail koneksi tersedia setelah akun berhasil dibuat."}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <aside className="portal-guide__note" style={noteStyle}>
          <h2 style={sectionHeadingStyle}>Quota dan detail akun</h2>
          <p>
            Quota dihitung per service dan reset pukul 00.00 WIB. Detail akun tersimpan di tab ini hingga 30 menit. Segera copy atau download setelah akun dibuat.
          </p>
        </aside>
      </section>
      {meta.support_url ? (
        <aside className="support-card">
          <h2 style={sectionHeadingStyle}>Support</h2>
          <p>Perlu bantuan menggunakan detail koneksi? Hubungi support melalui tautan berikut.</p>
          <a href={meta.support_url} rel="noreferrer">
            Hubungi support
          </a>
        </aside>
      ) : null}
    </section>
  );
}

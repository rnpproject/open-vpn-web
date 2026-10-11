"use client";

import { Clock3, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { Service, ServerStatus } from "@/lib/vpnApi";
import { AccountForm } from "@/components/AccountForm";
import { DurationCards } from "@/components/DurationCards";
import { PathLoader } from "@/components/PathLoader";
import { QuotaCountdown } from "@/components/QuotaCountdown";
import { ServerDirectory } from "@/components/ServerDirectory";
import { ServerServices } from "@/components/ServerServices";
import { useMeta } from "@/components/useMeta";
import { quotaForDuration, type QuotaEntry, type QuotaMap } from "@/components/quota";

export type Meta = {
  services: Service[];
  catalogUnavailable?: boolean;
  catalogFetchedAt?: number;
  statusUnavailable?: boolean;
  status: ServerStatus | null;
  statusFetchedAt?: number;
  serverNow?: string;
  quota: QuotaMap;
  quotaUnavailable?: boolean;
  unavailable: boolean;
  stale?: boolean;
  allowed_days: Array<1 | 3 | 7>;
  support_url?: string;
  turnstile_site_key?: string;
  siteMode?: "normal" | "notice" | "maintenance" | "closed";
  siteMessage?: string;
  estimatedEndAt?: string;
  pausedServices?: string[];
};

function NoticeBanner({ meta }: { meta: Meta }) {
  if (meta.siteMode !== "notice" || !meta.siteMessage) return null;
  return (
    <p className="notice" role="status">
      {meta.siteMessage}
    </p>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="panel loading-panel" role="status">
      <PathLoader size="md" decorative />
      <p>{label}...</p>
    </div>
  );
}

function MetaErrorPanel({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="panel" role="alert">
      <h2>Data belum dapat dimuat</h2>
      <p>
        Koneksi ke portal terputus. Periksa internet Anda lalu coba lagi. Akun yang sudah dibuat
        tetap aman.
      </p>
      <button className="button-primary" type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

function SiteStatePanel({ meta }: { meta: Meta }) {
  const closed = meta.siteMode === "closed";
  const estimatedEnd = meta.estimatedEndAt ? new Date(meta.estimatedEndAt) : null;
  return (
    <section
      className="recovery-page site-state-panel"
      aria-labelledby="site-state-title"
      role="status"
    >
      <svg className="broken-path" viewBox="0 0 240 60" aria-hidden="true">
        <path d="M8 30h72m18 0h134M80 22l8 8-8 8m18-16-8 8 8 8" />
        <circle cx="8" cy="30" r="4" />
        <circle cx="232" cy="30" r="4" />
      </svg>
      <p className="eyebrow">PORTAL AKUN VPN</p>
      <h1 id="site-state-title">{closed ? "Portal ditutup" : "Portal sedang maintenance"}</h1>
      <p>
        {meta.siteMessage ||
          (closed ? "Portal ini sudah ditutup." : "Create akun dihentikan sementara.")}
      </p>
      {!closed && estimatedEnd && Number.isFinite(estimatedEnd.getTime()) ? (
        <p>
          Perkiraan selesai:{" "}
          {new Intl.DateTimeFormat("id-ID", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Asia/Jakarta",
          }).format(estimatedEnd)}{" "}
          WIB
        </p>
      ) : null}
      <p className="muted">Coba refresh halaman nanti untuk melihat update terbaru.</p>
    </section>
  );
}

function ServiceView({ meta, serviceId }: { meta: Meta; serviceId: string }) {
  const days: Array<1 | 3 | 7> = meta.allowed_days.length > 0 ? meta.allowed_days : [1, 3, 7];
  const [day, setDay] = useState<1 | 3 | 7>(days[0] ?? 1);
  const selected = meta.services.find((service) => service.id === serviceId);
  const catalogUnavailable = meta.catalogUnavailable ?? meta.unavailable;
  const paused = meta.pausedServices?.includes(serviceId) ?? false;
  const quota: QuotaEntry | undefined = quotaForDuration(meta.quota, serviceId, day);

  if (!selected && meta.services.length > 0) {
    return (
      <section className="recovery-page" aria-labelledby="service-missing-title">
        <p className="eyebrow">VPN Service</p>
        <h1 id="service-missing-title">Service tidak tersedia</h1>
        <p>Service {serviceId} belum ada di daftar server.</p>
        <Link className="button-primary recovery-home" href="/">
          Kembali ke Home
        </Link>
      </section>
    );
  }

  if (!selected?.available || catalogUnavailable || paused) {
    return (
      <section className="service-page" aria-labelledby="service-title">
        <div className="service-heading service-heading--compact">
          <div>
            <p className="eyebrow">VPN Service</p>
            <h1 id="service-title">{selected?.service_label ?? selected?.label ?? serviceId}</h1>
          </div>
        </div>
        <NoticeBanner meta={meta} />
        <div className="panel unavailable" role="status">
          <TriangleAlert aria-hidden="true" />
          <h2>
            {catalogUnavailable
              ? "Server tidak dapat dihubungi"
              : paused
                ? "Create akun dijeda"
                : "Service tidak tersedia"}
          </h2>
          <p>
            {catalogUnavailable
              ? "Daftar service gagal diperbarui. Coba lagi sebentar."
              : paused
                ? "Admin menjeda pembuatan akun untuk service ini sementara."
                : selected?.reason || "Coba lagi nanti."}
          </p>
          {catalogUnavailable ? (
            <button
              className="button-secondary"
              type="button"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          ) : (
            <Link className="button-secondary" href="/">
              Lihat server dan service lain
            </Link>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="service-page" aria-labelledby="service-title">
      <div className="service-heading service-heading--compact">
        <div>
          <p className="eyebrow">VPN Service</p>
          <h1 id="service-title">{selected.service_label ?? selected.label}</h1>
          {selected.server_label ? (
            <p className="service-server-label">
              Server:{" "}
              {selected.server_id ? (
                <Link href={`/server/${encodeURIComponent(selected.server_id)}`}>
                  {selected.server_label}
                </Link>
              ) : (
                selected.server_label
              )}
            </p>
          ) : null}
          <p>Pilih durasi, lalu create akun.</p>
        </div>
      </div>
      <NoticeBanner meta={meta} />
      <DurationCards
        days={days}
        selected={day}
        onSelect={setDay}
        meta={meta}
        serviceId={serviceId}
      />
      <section className="panel service-account-panel" aria-label="Create account">
        <div className="quota-summary-inline">
          <h2>Quota hari ini</h2>
          {quota ? (
            <>
              <p className="quota-number">
                {quota.used}
                <span>/{quota.limit} used</span>
              </p>
              <progress value={quota.used} max={quota.limit} aria-label="Quota terpakai" />
              <p>
                Tersisa {quota.remaining} akun untuk {day} hari
              </p>
              <p className="muted">
                <Clock3 size={16} aria-hidden="true" /> <QuotaCountdown />
              </p>
            </>
          ) : (
            <p role="status">Quota belum dapat dimuat.</p>
          )}
        </div>
        <AccountForm
          service={selected}
          day={day}
          quota={quota}
          quotaUnavailable={meta.quotaUnavailable || !quota}
          turnstileSiteKey={meta.turnstile_site_key}
        />
      </section>
    </section>
  );
}

export function Portal({
  serviceId,
  serverId,
  initialMeta,
}: {
  serviceId?: string;
  serverId?: string;
  initialMeta: Meta;
}) {
  const { meta, failed, retry } = useMeta(initialMeta);

  if (failed) {
    return <MetaErrorPanel onRetry={retry} />;
  }
  if (meta === null) {
    if (serviceId) {
      return (
        <section className="service-page" aria-label="Memuat">
          <LoadingPanel label="Loading service data" />
        </section>
      );
    }
    if (serverId) {
      return (
        <section className="server-page" aria-label="Memuat">
          <LoadingPanel label="Loading server data" />
        </section>
      );
    }
    return <LoadingPanel label="Loading portal data" />;
  }

  if (meta.siteMode === "maintenance" || meta.siteMode === "closed") {
    return <SiteStatePanel meta={meta} />;
  }

  if (serverId) {
    return (
      <>
        <NoticeBanner meta={meta} />
        <ServerServices meta={meta} serverId={serverId} />
      </>
    );
  }

  if (serviceId) {
    return <ServiceView meta={meta} serviceId={serviceId} />;
  }

  return (
    <>
      <NoticeBanner meta={meta} />
      <ServerDirectory meta={meta} />
    </>
  );
}

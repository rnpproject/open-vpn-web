"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SiteMode = "normal" | "maintenance" | "partial" | "closed";
type StoredSiteMode = "normal" | "notice" | "maintenance" | "closed";
type SiteSettings = {
  mode: StoredSiteMode;
  message: string;
  estimatedEndAt?: string;
  pausedServices: string[];
  updatedAt?: string;
  updatedBy?: string;
};
type Service = { id: string; label: string; service_label?: string };
type AdminState = {
  settings: SiteSettings;
  persistent: boolean;
  forcedMaintenance: boolean;
};

const modes: Array<{ value: SiteMode; label: string }> = [
  { value: "normal", label: "Normal" },
  { value: "maintenance", label: "Maintenance (full)" },
  { value: "partial", label: "Hanya beberapa service" },
  { value: "closed", label: "Tutup total" },
];

function localDateTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function AdminPortal() {
  const [state, setState] = useState<AdminState | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [mode, setMode] = useState<SiteMode>("normal");
  const [message, setMessage] = useState("");
  const [estimatedEndAt, setEstimatedEndAt] = useState("");
  const [pausedServices, setPausedServices] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pauseAllRef = useRef<HTMLInputElement>(null);
  const serviceIds = services.map((service) => service.id);
  const selectedPausedServices = pausedServices.filter((id) => serviceIds.includes(id));
  const allServicesPaused =
    serviceIds.length > 0 && serviceIds.every((id) => pausedServices.includes(id));
  const someServicesPaused = serviceIds.some((id) => pausedServices.includes(id));

  useEffect(() => {
    if (pauseAllRef.current)
      pauseAllRef.current.indeterminate = someServicesPaused && !allServicesPaused;
  }, [allServicesPaused, someServicesPaused]);

  const applyState = useCallback((next: AdminState) => {
    setState(next);
    setMode(
      next.settings.mode === "maintenance" || next.settings.mode === "closed"
        ? next.settings.mode
        : next.settings.pausedServices.length > 0
          ? "partial"
          : "normal",
    );
    setMessage(next.settings.message);
    setEstimatedEndAt(localDateTime(next.settings.estimatedEndAt));
    setPausedServices(next.settings.pausedServices);
    setAuthenticated(true);
  }, []);

  const loadState = useCallback(async () => {
    const response = await fetch("/api/admin/state", { cache: "no-store" });
    if (response.status === 401) {
      setAuthenticated(false);
      setState(null);
      return;
    }
    const result = (await response.json()) as { data?: AdminState; error?: string };
    if (!response.ok || !result.data) throw new Error(result.error || "Status admin gagal dimuat.");
    applyState(result.data);
  }, [applyState]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await loadState();
        if (!active) return;
        const response = await fetch("/api/meta", { cache: "no-store" });
        if (response.ok) {
          const result = (await response.json()) as { data?: { services?: Service[] } };
          if (active) setServices(result.data?.services ?? []);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Status admin gagal dimuat.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadState]);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Login gagal.");
      setPassword("");
      await loadState();
      const metaResponse = await fetch("/api/meta", { cache: "no-store" });
      if (metaResponse.ok) {
        const meta = (await metaResponse.json()) as { data?: { services?: Service[] } };
        setServices(meta.data?.services ?? []);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Login gagal.");
    } finally {
      setBusy(false);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "partial" && selectedPausedServices.length === 0) {
      setError("Pilih minimal satu service untuk dijeda.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: mode === "partial" ? "normal" : mode,
          message: mode === "maintenance" || mode === "closed" ? message.trim() : "",
          ...(mode === "maintenance" && estimatedEndAt
            ? { estimatedEndAt: new Date(estimatedEndAt).toISOString() }
            : {}),
          pausedServices: mode === "partial" ? selectedPausedServices : [],
        }),
      });
      const result = (await response.json()) as { data?: AdminState; error?: string };
      if (!response.ok || !result.data)
        throw new Error(result.error || "Pengaturan situs gagal disimpan.");
      applyState(result.data);
      setNotice("Pengaturan berhasil disimpan.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pengaturan situs gagal disimpan.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout gagal.");
      setAuthenticated(false);
      setState(null);
      setPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Logout gagal.");
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <p className="panel" role="status">
        Memuat portal admin...
      </p>
    );

  if (!authenticated) {
    return (
      <section className="admin-page">
        <p className="eyebrow">Portal VPN</p>
        <h1>Admin</h1>
        <p className="admin-intro">Masuk untuk mengelola status portal dan layanan.</p>
        <form className="panel admin-form" onSubmit={login}>
          <h2>Login admin</h2>
          <label>
            Email admin
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? (
            <p className="admin-alert" role="alert">
              {error}
            </p>
          ) : null}
          <button className="button-primary" type="submit" disabled={busy}>
            {busy ? "Memproses..." : "Masuk"}
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="admin-page">
      <header className="admin-heading">
        <div>
          <p className="eyebrow">Pengelolaan situs</p>
          <h1>Admin portal</h1>
        </div>
        <button className="button-secondary" type="button" onClick={logout} disabled={busy}>
          Keluar
        </button>
      </header>
      {!state?.persistent ? (
        <p className="admin-alert" role="alert">
          Store saat ini hanya tersedia sementara. Pengaturan tidak dapat disimpan permanen;
          konfigurasikan QUOTA_STORE dan kredensial database.
        </p>
      ) : null}
      {state?.forcedMaintenance ? (
        <p className="admin-alert" role="alert">
          FORCE_MAINTENANCE=1 sedang aktif. Pengaturan database tidak dapat mengubah maintenance
          sampai variabel tersebut dimatikan di server.
        </p>
      ) : null}
      <form className="panel admin-form" onSubmit={save}>
        <h2>Status portal</h2>
        <label>
          Mode situs
          <select value={mode} onChange={(event) => setMode(event.target.value as SiteMode)}>
            {modes.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <p className="admin-help">
          {mode === "normal"
            ? "Semua service aktif kembali."
            : mode === "maintenance"
              ? "Seluruh portal dihentikan. Waktu selesai hanya perkiraan; portal tidak dibuka otomatis."
              : mode === "partial"
                ? "Pilih service yang dijeda. Service lain tetap bisa digunakan."
                : "Portal ditutup total hingga mode diubah kembali."}
        </p>
        {mode === "maintenance" || mode === "closed" ? (
          <label>
            Pesan untuk pengunjung
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={280}
              rows={4}
            />
            <span className="admin-help">{message.length}/280 karakter</span>
          </label>
        ) : null}
        {mode === "maintenance" ? (
          <label>
            Perkiraan maintenance selesai (opsional)
            <input
              type="datetime-local"
              value={estimatedEndAt}
              onChange={(event) => setEstimatedEndAt(event.target.value)}
            />
          </label>
        ) : null}
        {mode === "partial" ? (
          <fieldset className="admin-services">
            <legend>Service yang dijeda</legend>
            {services.length ? (
              <>
                <label className="admin-checkbox admin-checkbox--bulk">
                  <input
                    ref={pauseAllRef}
                    type="checkbox"
                    checked={allServicesPaused}
                    onChange={(event) => {
                      const shouldPause = event.currentTarget.checked;
                      setPausedServices((current) => {
                        const next = new Set(current);
                        for (const id of serviceIds) {
                          if (shouldPause) next.add(id);
                          else next.delete(id);
                        }
                        return [...next];
                      });
                    }}
                  />
                  Jeda semua layanan ({services.length})
                </label>
                {services.map((service) => (
                  <label className="admin-checkbox" key={service.id}>
                    <input
                      type="checkbox"
                      checked={pausedServices.includes(service.id)}
                      onChange={(event) =>
                        setPausedServices((current) =>
                          event.target.checked
                            ? [...current, service.id]
                            : current.filter((id) => id !== service.id),
                        )
                      }
                    />
                    {service.service_label ?? service.label} <span>({service.id})</span>
                  </label>
                ))}
              </>
            ) : (
              <p className="admin-help">Daftar layanan belum tersedia.</p>
            )}
          </fieldset>
        ) : null}
        {error ? (
          <p className="admin-alert" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="admin-success" role="status">
            {notice}
          </p>
        ) : null}
        {state?.settings.updatedAt ? (
          <p className="admin-help">
            Terakhir diperbarui {new Date(state.settings.updatedAt).toLocaleString("id-ID")}
            {state.settings.updatedBy ? ` oleh ${state.settings.updatedBy}` : ""}.
          </p>
        ) : null}
        <button
          className="button-primary"
          type="submit"
          disabled={
            busy ||
            !state?.persistent ||
            state.forcedMaintenance ||
            (mode === "partial" && selectedPausedServices.length === 0)
          }
        >
          {busy ? "Menyimpan..." : "Simpan pengaturan"}
        </button>
      </form>
    </section>
  );
}

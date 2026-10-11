"use client";

import { useCallback, useEffect, useState } from "react";
import type { Meta } from "@/components/Portal";

type MetaState = {
  meta: Meta | null;
  failed: boolean;
  retry: () => void;
};

// Data awal dirender di server. Request klien hanya berjalan saat pengguna
// meminta retry setelah kegagalan, sehingga status berubah hanya saat refresh.
export function useMeta(initialMeta: Meta): MetaState {
  const [meta, setMeta] = useState<Meta | null>(initialMeta);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    async function load() {
      if (document.hidden) return;
      try {
        const response = await fetch("/api/meta", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`meta ${response.status}`);
        const payload = (await response.json()) as { data?: Meta };
        if (alive && payload?.data) {
          setMeta(payload.data);
          setFailed(false);
        }
      } catch {
        if (alive && !controller.signal.aborted) setFailed(true);
      }
    }

    if (initialMeta.unavailable) void load();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [attempt, initialMeta]);

  return { meta, failed: failed && meta === null, retry };
}

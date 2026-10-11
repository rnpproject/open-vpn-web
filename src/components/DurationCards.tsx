"use client";

import type { Meta } from "@/components/Portal";
import { quotaForDuration } from "@/components/quota";

function quotaLabel(quota: ReturnType<typeof quotaForDuration>, quotaUnavailable: boolean): string {
  if (quotaUnavailable || !quota) return "Quota belum tersedia";
  if (quota.remaining <= 0) return "Quota hari ini habis";
  return `Tersisa ${quota.remaining} dari ${quota.limit}`;
}

// Compact duration choices with per-duration quota availability.
export function DurationCards({
  days,
  selected,
  onSelect,
  meta,
  serviceId,
}: {
  days: Array<1 | 3 | 7>;
  selected: 1 | 3 | 7;
  onSelect: (day: 1 | 3 | 7) => void;
  meta: Meta;
  serviceId: string;
}) {
  const quotaUnavailable = meta.quotaUnavailable ?? false;
  return (
    <fieldset className="duration-cards">
      <legend>Pilih durasi akun</legend>
      <div className="duration-cards__grid">
        {days.map((day) => {
          const quota = quotaForDuration(meta.quota, serviceId, day);
          const exhausted = !quotaUnavailable && quota ? quota.remaining <= 0 : false;
          const active = selected === day;
          return (
            <label
              key={day}
              className={`duration-card${active ? " duration-card--active" : ""}${exhausted ? " duration-card--exhausted" : ""}`}
            >
              <input
                type="radio"
                name="days"
                value={day}
                checked={active}
                disabled={quotaUnavailable || exhausted}
                onChange={() => onSelect(day)}
                aria-label={`${day} hari`}
              />
              <span
                className="duration-card__days"
                aria-hidden="true"
                style={{ color: "var(--ink)", fontWeight: 750 }}
              >
                {day} hari
              </span>
              <span className="duration-card__quota">{quotaLabel(quota, quotaUnavailable)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

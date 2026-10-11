"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      area.style.position = "fixed";
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setDone(true);
    window.setTimeout(() => setDone(false), 1800);
  }
  return (
    <button type="button" className="copy-button copy-button--pill" onClick={copy}>
      <span aria-live="polite">
        {done ? (
          <>
            <Check size={14} aria-hidden="true" /> Copied
          </>
        ) : (
          <>
            <Copy size={14} aria-hidden="true" /> {label}
          </>
        )}
      </span>
    </button>
  );
}

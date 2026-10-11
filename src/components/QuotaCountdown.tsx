export function QuotaCountdown() {
  return (
    <span
      style={{
        display: "inline-block",
        fontVariantNumeric: "tabular-nums",
        borderRadius: "var(--radius-pill)",
        padding: "0.25rem 0.3rem",
        fontSize: "0.85rem",
        fontWeight: 600,
        color: "var(--ink)",
      }}
    >
      Reset 00.00 WIB
    </span>
  );
}

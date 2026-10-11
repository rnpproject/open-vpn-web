type PathLoaderProps = {
  size?: "sm" | "md" | "lg";
  label?: string;
  /** Hide from assistive tech when the surrounding element already announces the state. */
  decorative?: boolean;
};

export function PathLoader({ size = "md", label = "Loading", decorative = false }: PathLoaderProps) {
  const svg = (
    <svg viewBox="0 0 120 32" aria-hidden="true" focusable="false">
      <circle className="path-loader__device" cx="12" cy="16" r="5" />
      <path className="path-loader__line" d="M17 16h24c7 0 7-9 14-9h25c7 0 7 9 14 9h14" />
      <circle className="path-loader__server" cx="108" cy="16" r="5" />
    </svg>
  );
  if (decorative) {
    return (
      <span className={`path-loader path-loader--${size}`} aria-hidden="true">
        {svg}
      </span>
    );
  }
  return (
    <span className={`path-loader path-loader--${size}`} role="status" aria-label={label}>
      {svg}
      <span className="sr-only">{label}...</span>
    </span>
  );
}

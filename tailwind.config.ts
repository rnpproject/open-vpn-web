import type { Config } from "tailwindcss";

// Keep the requested color names available to Tailwind utilities.
// Tailwind CSS v4 consumes the actual tokens from src/styles/tokens.css via @theme.
const config = {
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        primary: "var(--primary)",
        sky: "var(--sky)",
        cyan: "var(--cyan)",
        warm: "var(--warm)",
      },
    },
  },
} satisfies Config;

export default config;

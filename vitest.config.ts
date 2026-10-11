import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: {
    "@": fileURLToPath(new URL("./src", import.meta.url)),
    "server-only": fileURLToPath(new URL("./tests/server-only.ts", import.meta.url)),
  } },
  test: { environment: "node", clearMocks: true, exclude: ["tests/e2e/**", "node_modules/**", ".next/**"] },
});

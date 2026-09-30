import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Deterministic key for crypto / OAuth-state tests (never a real secret).
    env: { ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), TZ: "UTC" },
  },
});

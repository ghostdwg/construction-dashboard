import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next", "sidecar"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});

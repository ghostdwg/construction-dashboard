import { defineConfig } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Local-only authenticated navigation suite. Unlike the default fixture,
// AUTH_DISABLED is omitted so Auth.js and the proxy's authenticated root
// redirect are exercised together against a throwaway SQLite database.
const E2E_DB_PATH = join(tmpdir(), "gwx-e2e-auth-nav", "e2e.db");
const PORT = 3212;

export default defineConfig({
  testDir: "./e2e-auth",
  timeout: 45_000,
  retries: 1,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node e2e-auth/setup-db.mjs && npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_ENV: "local",
      DATABASE_URL: `file:${E2E_DB_PATH}`,
      DATABASE_AUTH_TOKEN: "",
      AUTH_SECRET: "placeholder-auth-secret-minimum-32-chars-xx",
      ANTHROPIC_API_KEY: "sk-ant-placeholder",
      NEXTAUTH_URL: `http://localhost:${PORT}`,
    },
  },
});

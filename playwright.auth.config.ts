import { defineConfig } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Authenticated navigation e2e suite — LOCAL ONLY.
//
// playwright.config.ts's suite runs with AUTH_DISABLED=true, which makes
// proxy.ts's auth() wrapper return early (see proxy.ts's solo-dev bypass)
// before its authenticated "/" → "/bids" landing redirect ever runs. That
// suite therefore cannot see what happened on staging (GWX-R1): the sidebar's
// Operations item pointed at "/", an authenticated visitor requesting "/"
// gets redirected to "/bids", so Operations silently converged on Projects.
//
// This config boots the same app with AUTH_DISABLED unset, so the real
// Auth.js credentials flow and proxy.ts's redirect branch both execute.
// Separate port + fixture DB from the main suite so the two can run
// independently or in parallel.
const E2E_DB_PATH = join(tmpdir(), "gwx-e2e-auth-nav", "e2e.db");
const PORT = 3212;

export default defineConfig({
  testDir: "./e2e-auth",
  timeout: 45_000,
  retries: 1,
  workers: 1, // one dev server, one sqlite file — serialize
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
      // AUTH_DISABLED intentionally omitted (defaults to "false" in lib/env.ts)
      // — the real Auth.js session flow must run for this suite to mean anything.
    },
  },
});

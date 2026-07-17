import { defineConfig } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";

// E2E navigation suite — LOCAL ONLY.
//
// The webServer block boots `next dev` against a throwaway sqlite fixture
// built by e2e/setup-db.mjs (see its header). Every env value below is a
// local placeholder, deliberately identical in spirit to the Dockerfile's
// build-stage placeholders — no real secret, DB, or tier is ever involved.
// This suite must never be pointed at a staging or production URL.
const E2E_DB_PATH = join(tmpdir(), "gwx-e2e-nav", "e2e.db");
const PORT = 3211;

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  retries: 1,
  workers: 1, // one dev server, one sqlite file — serialize
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node e2e/setup-db.mjs && npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_ENV: "local",
      DATABASE_URL: `file:${E2E_DB_PATH}`,
      DATABASE_AUTH_TOKEN: "",
      AUTH_DISABLED: "true",
      AUTH_SECRET: "placeholder-auth-secret-minimum-32-chars-xx",
      ANTHROPIC_API_KEY: "sk-ant-placeholder",
      NEXTAUTH_URL: `http://localhost:${PORT}`,
    },
  },
});

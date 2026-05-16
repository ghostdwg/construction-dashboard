import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Python sidecar + GPU workers — not JS/TS
    "sidecar/**",
    "sidecar_gpu/**",
    "gpu-service/**",
    "gpu_worker/**",
  ]),
  {
    rules: {
      // Allow intentionally-unused vars/args/destructured fields when prefixed with `_`.
      // Common pattern for stripping fields via destructuring: `const { secret: _s, ...safe } = obj`
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Warn on explicit `any` — keeps strict typing honest without blocking legacy spots.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  // ── AI/prompt isolation from the credential vault ──────────────────────
  //
  // Any file that imports the Anthropic SDK is part of the AI/prompt path.
  // Those files MUST NOT import credentialVault, the credentialsService, or
  // the auditLog — encrypted credentials must only flow through the sidecar
  // at scrape time, never through any AI/prompt-building code path.
  //
  // The rule below applies broadly to AI-adjacent paths. If you legitimately
  // need to add a new AI file, do not weaken this rule — refactor so the
  // credential read happens in a separate, non-AI module.
  {
    files: [
      "lib/services/jobs/**",
      "lib/services/spec/**",
      "lib/services/briefing/**",
      "lib/services/drawing/**",
      "lib/services/submittal/**",
      "lib/services/meeting*/**",
      "lib/meeting-analysis.ts",
      "app/api/bids/**/analyze*/**",
      "app/api/bids/**/brief*/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/services/credentials/credentialVault",
                "@/lib/services/credentials/credentialVault.*",
                "@/lib/services/credentials/credentialsService",
                "@/lib/services/credentials/auditLog",
                "**/credentials/credentialVault",
                "**/credentials/credentialsService",
                "**/credentials/auditLog",
              ],
              message:
                "AI/prompt-building code cannot import the credential vault. " +
                "Credentials must only flow through the sidecar at scrape time. " +
                "See docs/architecture/CREDENTIALS.md.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;

// ──────────────────────────────────────────────────────────────────────────────
//  vitest.setup.ts
//  Test environment bootstrap. Sets the env vars lib/env.ts requires so its
//  Zod schema parse succeeds at module-load time during test imports.
//
//  Added in Phase MI-2 — closes the pre-existing R5 oversight noted in the
//  R6.7 completion report (tests in __tests__/* failed at lib/env.ts:28
//  because APP_ENV / AUTH_SECRET / ANTHROPIC_API_KEY were missing).
//
//  Test-only values — none of these reach production. The pattern matches
//  runtime/env/local.env.example so any test that exercises tier-aware
//  behavior sees a consistent local-dev shape.
// ──────────────────────────────────────────────────────────────────────────────

process.env.APP_ENV ??= "local";
// NODE_ENV is set by vitest automatically and is read-only in TS types.
process.env.DATABASE_URL ??= "file:./test.db";
process.env.DATABASE_AUTH_TOKEN ??= "";
process.env.AUTH_SECRET ??= "test-only-test-only-test-only-test-only";
process.env.ANTHROPIC_API_KEY ??= "sk-ant-test-only";
process.env.NEXTAUTH_URL ??= "http://localhost:3000";

// Quiet the resolver's stdout audit so tests don't flood with JSON lines.
// Tests that explicitly want to assert on emitted audit can override by
// reading the returned `audit` object from resolveEntity().
process.env.RESOLVER_AUDIT_QUIET ??= "true";

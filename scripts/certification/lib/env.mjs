#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
//  scripts/certification/lib/env.mjs
//
//  Environment allowlisting + subprocess-call recording for the R2 candidate
//  validation orchestrator. Every gate that shells out MUST build its env via
//  buildAllowlistedEnv() rather than spreading ambient process.env — this is
//  what lets the orchestrator prove ("EXTERNAL_NETWORK_REQUIRED",
//  "CREDENTIALS_REQUIRED") that no staging/production DATABASE_URL or real
//  provider credential ever reached a gate's subprocess.
// ──────────────────────────────────────────────────────────────────────────────

// Ambient keys safe to pass through unchanged (process plumbing only — no
// secrets, no DB/provider endpoints).
export const PASSTHROUGH_ENV_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "NODE_ENV",
  "CI",
  "npm_config_cache",
  "SystemRoot",
  "COMSPEC",
];

// Keys that must NEVER be forwarded from ambient env, even by accident —
// provider/service credentials and non-local DB connection strings.
// DATABASE_URL is deliberately NOT here: gates legitimately set it to a
// disposable local `file:` path via buildAllowlistedEnv's override, which
// assertNetworkIsolation validates separately (must start with "file:").
// Its *presence* is expected and safe; only a non-local value is a violation.
export const FORBIDDEN_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "RESEND_API_KEY",
  "WHISPERX_API_KEY",
  "SIDECAR_API_KEY",
  "WORKER_TOKEN",
  "TURSO_AUTH_TOKEN",
  "TURSO_DATABASE_URL",
];

/**
 * Build a restricted env object for a gate subprocess: only PASSTHROUGH_ENV_KEYS
 * from ambient process.env, plus explicit overrides (e.g. a disposable
 * `file:` DATABASE_URL). Overrides win, but a `DATABASE_URL` override that
 * isn't a local `file:` path is rejected — every gate's DB access must be a
 * throwaway local file, never anything else.
 */
export function buildAllowlistedEnv(ambientEnv, overrides = {}) {
  const env = {};
  for (const key of PASSTHROUGH_ENV_KEYS) {
    if (ambientEnv[key] !== undefined) env[key] = ambientEnv[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (key === "DATABASE_URL" && typeof value === "string" && !value.startsWith("file:")) {
      throw new Error(`buildAllowlistedEnv: DATABASE_URL override must be a local file: path, got "${value}"`);
    }
    env[key] = value;
  }
  return env;
}

/**
 * Wrap an ExecFn so every call is recorded (command, args, and which env keys
 * were present) without ever recording env *values* — the network-isolation
 * gate only needs to know that no forbidden key was set and any DATABASE_URL
 * was a local file: path, not what any value actually was.
 */
export function withRecordingExec(exec) {
  const calls = [];
  const recordingExec = (cmd, args, opts = {}) => {
    const env = opts.env ?? {};
    calls.push({
      cmd,
      args: [...args],
      envKeys: Object.keys(env),
      hasForbiddenKey: FORBIDDEN_ENV_KEYS.some((k) => k in env),
      databaseUrl: typeof env.DATABASE_URL === "string" ? env.DATABASE_URL : undefined,
    });
    return exec(cmd, args, opts);
  };
  return { exec: recordingExec, calls };
}

/**
 * Pure assertion over a recorded-call log: no forbidden env key was ever
 * passed to any subprocess, and every DATABASE_URL used was a local `file:`
 * path (never staging/production/live Turso).
 */
export function assertNetworkIsolation(calls) {
  const violations = [];
  for (const call of calls) {
    if (call.hasForbiddenKey) {
      violations.push(`${call.cmd} ${call.args.join(" ")} was passed a forbidden env key`);
    }
    if (call.databaseUrl !== undefined && !call.databaseUrl.startsWith("file:")) {
      violations.push(`${call.cmd} ${call.args.join(" ")} used a non-local DATABASE_URL`);
    }
  }
  return violations;
}

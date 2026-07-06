#!/usr/bin/env node
/**
 * GroundWorX PreToolUse guard for Bash commands.
 *
 * Blocks obvious live-action / secret-exposure commands as defense-in-depth
 * behind the permissions.deny list (which uses prefix matching and can be
 * sidestepped by wrappers like `sh -c "docker ..."`).
 *
 * A block here is a GUARDRAIL ONLY. Passing this hook never constitutes,
 * implies, or records human approval — every live action remains human-gated
 * per Ledger §6 regardless of what this script does.
 *
 * Deny semantics: exit code 2 + stderr message (per Claude Code hooks docs).
 * On any parse problem this script exits 0 (falls through to the normal
 * permission system) — it must never be the thing that breaks local work.
 */

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  const cmd = String(input?.tool_input?.command ?? "");
  if (!cmd) process.exit(0);

  // Command-position check: dangerous binaries in command position of any
  // shell segment (catches `sh -c "docker ..."`, `cd x && turso ...`, pipes)
  // without false-positiving on arguments like `grep -r docker docs/`.
  const bannedBinaries = new Set([
    "docker",
    "docker-compose",
    "turso",
    "flyctl",
    "ssh",
    "scp",
    "psql",
    "sqlite3",
    "mysql",
    "systemctl",
    "reboot",
    "shutdown",
    "printenv",
  ]);
  // Wrappers whose next word is itself a command.
  const wrappers = new Set([
    "sudo", "exec", "command", "nohup", "time", "timeout", "xargs",
    "sh", "bash", "zsh", "dash", "env", "nice", "stdbuf", "setsid",
  ]);
  const stripped = cmd.replace(/["']/g, "");
  const segments = stripped.split(/[;|&`\n]+|\$\(/);
  let hitBinary = null;
  for (const seg of segments) {
    const words = seg.split(/\s+/).filter(Boolean);
    let i = 0;
    // Skip leading env assignments, wrappers, wrapper flags (-c, -u, ...),
    // and bare numeric wrapper args (`timeout 5`, `nice -n 10`).
    while (
      i < words.length &&
      (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) ||
        wrappers.has(words[i]) ||
        /^-/.test(words[i]) ||
        /^\d+[smhd]?$/.test(words[i]))
    ) {
      i++;
    }
    if (i < words.length && bannedBinaries.has(words[i])) {
      hitBinary = words[i];
      break;
    }
    // Bare `env`/`printenv` (dumps all values) with nothing after wrapper-skip.
    if (i === words.length && words.some((w) => w === "env" || w === "printenv") && words.length <= 2) {
      hitBinary = words.find((w) => w === "env" || w === "printenv");
      break;
    }
  }

  // Phrase-level checks: live-DB tooling, migrations, smoke execution,
  // env/secret exposure.
  const bannedPhrases = [
    { re: /apply-turso-migrations/, why: "migration runner is human-only (GWX-Q02-class gate)" },
    { re: /prisma\s+(migrate|db)\b/, why: "Prisma against a real DB is human-only; local tests use fakes" },
    { re: /\bDATABASE_URL\s*=/, why: "supplying a real DB URL to a command is human-only (operator-plane, Ledger §4.11)" },
    { re: /\bSTORAGE_SMOKE_MODE_ENABLED\s*=/, why: "storage smoke mode stays OFF outside an approved human-run smoke" },
    { re: /staging-smoke\.mjs(?=[\s\S]*--execute)/, why: "smoke --execute hits staging; human-gated per invocation" },
    { re: /storage-inventory-backfill(?=[\s\S]*--(apply|reverse))/, why: "backfill apply/reverse against any DB is human-only" },
    { re: /specbook-legacy-fixture(?=[\s\S]*--(seed|cleanup))(?![\s\S]*--dry-run)/, why: "fixture seed/cleanup runs are human-only (staging gate)" },
    { re: /\bcat\b[^|;&]*\.env(\.|\b)/, why: "env files may contain secret values; never read them" },
    { re: /git\s+push[\s\S]*--force/, why: "force-push is never allowed on GroundWorX branches" },
  ];
  const hitPhrase = bannedPhrases.find((p) => p.re.test(cmd));

  if (hitBinary || hitPhrase) {
    const reason = hitBinary
      ? `'${hitBinary}' is a live-system command; GroundWorX models are local-only`
      : hitPhrase.why;
    process.stderr.write(
      `GroundWorX guard: blocked — ${reason}. ` +
        `Live actions require explicit operator approval per invocation ` +
        `(Ledger §6). This block is a guardrail, not an approval mechanism.\n`
    );
    process.exit(2);
  }
  process.exit(0);
});

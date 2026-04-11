"use client";

// Module SET1 — About card
//
// Static info: app name, key modules, settings system overview. Mostly a
// landing surface so users have somewhere to verify "what is this thing."

export default function AboutSettingsCard() {
  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
          About this app
        </h3>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Bid Dashboard is a modular preconstruction intelligence platform for
          solo estimators. It covers the full lifecycle from bid intake through
          post-award handoff — three pursuit wings (Job Intake → Scope
          Intelligence → Bid Leveling) plus a post-award handoff layer.
        </p>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
          How settings work
        </h3>
        <ul className="text-sm text-zinc-700 dark:text-zinc-300 list-disc pl-5 space-y-1.5">
          <li>
            Every setting is keyed and stored in the local SQLite database.
          </li>
          <li>
            Saving a value applies it <strong>immediately</strong> — no restart
            required. The app maintains an in-process cache that&apos;s
            invalidated on every write.
          </li>
          <li>
            Each setting has an environment-variable fallback (e.g.{" "}
            <span className="font-mono">RESEND_API_KEY</span>). If you
            don&apos;t set a value in the UI, the app reads from{" "}
            <span className="font-mono">.env.local</span> instead.
          </li>
          <li>
            Secrets (API keys) are masked to last-4 in display mode. The
            underlying value is stored as plaintext in SQLite — no worse than{" "}
            <span className="font-mono">.env.local</span>, both live on the
            same disk.
          </li>
        </ul>
      </section>
    </div>
  );
}

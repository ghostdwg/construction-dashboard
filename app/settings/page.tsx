// Module SET1 — Settings shell
//
// Sidebar nav with sections. Each section is a self-contained client component
// that handles its own data fetching + mutations. Sections are URL-driven via
// ?section= so links can deep-link.

import Link from "next/link";
import EmailSettingsCard from "./EmailSettingsCard";
import EstimatorSettingsCard from "./EstimatorSettingsCard";
import AiSettingsCard from "./AiSettingsCard";
import AboutSettingsCard from "./AboutSettingsCard";
import MeetingSettingsCard from "./MeetingSettingsCard";
import ProcoreSettingsCard from "./ProcoreSettingsCard";

type SearchParams = Promise<{ section?: string }>;

const SECTIONS = [
  { key: "email", label: "Email Integration", description: "Resend API for RFQ emails" },
  { key: "estimator", label: "Estimator Profile", description: "Your name + reply-to" },
  { key: "ai", label: "AI Configuration", description: "API key, token budgets, usage, cost" },
  { key: "meetings", label: "Meeting Intelligence", description: "AssemblyAI transcription key" },
  { key: "procore", label: "Procore Integration", description: "Client ID, secret, company ID" },
  { key: "about", label: "About", description: "Build info + module reference" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

function isValidSection(s: string | undefined): s is SectionKey {
  return SECTIONS.some((sec) => sec.key === s);
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { section } = await searchParams;
  const active: SectionKey = isValidSection(section) ? section : "email";

  return (
    <div className="max-w-5xl mx-auto py-10 px-4">
      <div className="mb-6">
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← Home
        </Link>
        <h1 className="text-2xl font-semibold mt-2 text-zinc-900 dark:text-zinc-100">
          Settings
        </h1>
        <p className="text-sm text-zinc-600 mt-1 dark:text-zinc-300">
          Configure integrations and preferences. Changes are applied
          immediately — no restart required.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
        {/* ── Sidebar ── */}
        <nav className="flex flex-col gap-1">
          {SECTIONS.map((sec) => {
            const isActive = sec.key === active;
            return (
              <Link
                key={sec.key}
                href={`/settings?section=${sec.key}`}
                className={`flex flex-col gap-0.5 rounded-md px-3 py-2 text-left transition-colors ${
                  isActive
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                <span className="text-sm font-semibold">{sec.label}</span>
                <span
                  className={`text-[11px] ${
                    isActive
                      ? "text-zinc-300 dark:text-zinc-600"
                      : "text-zinc-500 dark:text-zinc-400"
                  }`}
                >
                  {sec.description}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* ── Active section ── */}
        <div className="min-w-0">
          {active === "email" && <EmailSettingsCard />}
          {active === "estimator" && <EstimatorSettingsCard />}
          {active === "ai" && <AiSettingsCard />}
          {active === "meetings" && <MeetingSettingsCard />}
          {active === "procore" && <ProcoreSettingsCard />}
          {active === "about" && <AboutSettingsCard />}
        </div>
      </div>
    </div>
  );
}

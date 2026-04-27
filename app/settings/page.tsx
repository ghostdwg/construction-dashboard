import { redirect } from "next/navigation";
import Link from "next/link";
import { isAdminAuthorized } from "@/lib/auth";
import EmailSettingsCard from "./EmailSettingsCard";
import EstimatorSettingsCard from "./EstimatorSettingsCard";
import AiSettingsCard from "./AiSettingsCard";
import AboutSettingsCard from "./AboutSettingsCard";
import MeetingSettingsCard from "./MeetingSettingsCard";
import ProcoreSettingsCard from "./ProcoreSettingsCard";

type SearchParams = Promise<{ section?: string }>;

const SECTIONS = [
  { key: "ai",        label: "AI Configuration",    description: "providers, routing, token budgets", dot: "set"     },
  { key: "email",     label: "Email Integration",   description: "Resend + SMTP for RFQ emails",     dot: "set"     },
  { key: "meetings",  label: "Meeting Intelligence",description: "AssemblyAI transcription key",     dot: "partial" },
  { key: "procore",   label: "Procore Integration", description: "client ID, secret, company ID",    dot: "unset"   },
  { key: "estimator", label: "Estimator Profile",   description: "name + reply-to address",          dot: "unset"   },
  { key: "about",     label: "About",               description: "build info + module reference",    dot: "unset"   },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

function isValidSection(s: string | undefined): s is SectionKey {
  return SECTIONS.some((sec) => sec.key === s);
}

const DOT: Record<string, string> = {
  set:     "var(--signal)",
  partial: "var(--amber)",
  unset:   "rgba(255,255,255,0.15)",
};

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const adminCheck = await isAdminAuthorized();
  if (!adminCheck.authorized) redirect(adminCheck.status === 401 ? "/login" : "/");

  const { section } = await searchParams;
  const active: SectionKey = isValidSection(section) ? section : "ai";
  const activeSection = SECTIONS.find((s) => s.key === active)!;

  return (
    <div style={{ minHeight: "calc(100vh - 62px)", display: "flex", flexDirection: "column" }}>

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between px-7 py-[22px] border-b border-[var(--line)]">
        <div>
          <p className="font-mono text-[9px] tracking-[0.1em] uppercase mb-1" style={{ color: "var(--text-dim)" }}>
            Settings
          </p>
          <h1 className="text-[20px] font-[700] tracking-[-0.03em]" style={{ color: "var(--text)" }}>
            {activeSection.label}
          </h1>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-soft)" }}>
            {activeSection.description}
          </p>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* Settings nav */}
        <nav className="w-[200px] shrink-0 border-r border-[var(--line)] py-4">
          {SECTIONS.map((sec) => {
            const isActive = sec.key === active;
            return (
              <Link
                key={sec.key}
                href={`/settings?section=${sec.key}`}
                className="relative flex items-center gap-2 px-4 py-[7px] text-[12px] transition-colors"
                style={{
                  color:      isActive ? "var(--text)"     : "var(--text-soft)",
                  background: isActive ? "var(--signal-dim)" : "transparent",
                }}
              >
                {isActive && (
                  <span
                    className="absolute left-0 top-0 bottom-0 w-0.5"
                    style={{ background: "var(--signal)" }}
                  />
                )}
                <span
                  className="w-[5px] h-[5px] rounded-full shrink-0"
                  style={{ background: DOT[sec.dot] }}
                />
                {sec.label}
              </Link>
            );
          })}
        </nav>

        {/* Content */}
        <div className="flex-1 px-7 py-6 min-w-0 flex flex-col gap-5">
          {active === "ai"        && <AiSettingsCard />}
          {active === "email"     && <EmailSettingsCard />}
          {active === "estimator" && <EstimatorSettingsCard />}
          {active === "meetings"  && <MeetingSettingsCard />}
          {active === "procore"   && <ProcoreSettingsCard />}
          {active === "about"     && <AboutSettingsCard />}
        </div>
      </div>
    </div>
  );
}

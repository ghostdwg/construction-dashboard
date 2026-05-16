import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { listIntegrations } from "@/lib/services/credentials/credentialsService";
import IntegrationsClient from "./IntegrationsClient";

export default async function IntegrationsSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/settings/integrations");
  const role = (session.user as { role?: string }).role;
  if (role !== "admin") redirect("/");

  const integrations = await listIntegrations();

  // Seed list of integrations we support — show cards even if no creds saved yet.
  const seedServices: { id: string; name: string; fields: string[]; description: string }[] = [
    {
      id: "beeline",
      name: "Beeline Plan Room",
      fields: ["username", "password"],
      description: "Authenticated scraping for spec books + drawings on watched jobs.",
    },
    {
      id: "blue_book",
      name: "Blue Book Network",
      fields: ["username", "password"],
      description: "Member directory + project leads. Not yet wired.",
    },
    {
      id: "constructconnect",
      name: "ConstructConnect",
      fields: ["username", "password", "api_key"],
      description: "Pre-bid project leads. Not yet wired.",
    },
    {
      id: "isqft",
      name: "iSqFt",
      fields: ["username", "password"],
      description: "GC-side bid invitations. Not yet wired.",
    },
    {
      id: "dodge",
      name: "Dodge Construction Network",
      fields: ["api_key"],
      description: "Project intelligence feed. Not yet wired.",
    },
  ];

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8 flex flex-col gap-5">
      <div className="border-b border-[var(--line)] pb-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] mb-1" style={{ color: "var(--text-dim)" }}>
          settings // integrations
        </p>
        <h1 className="text-[26px] font-[800] tracking-[-0.04em] leading-none" style={{ color: "var(--text)" }}>
          Integration Credentials
        </h1>
        <p className="text-[13px] mt-1.5" style={{ color: "var(--text-soft)" }}>
          Credentials for third-party plan-room and bid-feed services. Encrypted with AES-256-GCM
          at rest. The master key never appears in the database, never reaches AI prompts, and is
          only loaded into the sidecar process for active scrape work.
        </p>
      </div>

      <IntegrationsClient seed={seedServices} initialState={integrations} />

      <p className="text-[11px] mt-2" style={{ color: "var(--text-dim)" }}>
        Audit log path on the host: <code>/opt/neuroglitch/storage/audit/credentials-access.jsonl</code> —
        every decryption is logged with the calling code path. AI/prompt code is forbidden from
        importing the vault module (enforced by ESLint).
      </p>
    </div>
  );
}

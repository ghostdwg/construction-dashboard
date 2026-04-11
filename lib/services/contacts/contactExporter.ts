// Module H7 — Contact Handoff exporter
//
// Builds a unified contact list (project team + awarded subs) for a bid and
// formats it as Outlook CSV, Google Contacts CSV, or vCard 3.0. PMs drag the
// resulting file straight into Outlook/Google Contacts/Apple Contacts on
// project handoff so they don't have to retype anyone.
//
// Source data:
//   - ProjectContact rows (owner / architect / engineer / internal team)
//   - Awarded subs derived from BuyoutItem.subcontractorId (primary source)
//     with the contact pulled from BidInviteSelection.subcontractor.contacts
//
// Output formats are kept intentionally minimal — just the columns each
// destination actually recognizes. No empty fields, no fluff.

import { prisma } from "@/lib/prisma";
import {
  loadProjectContactsForBid,
  type ContactRole,
} from "./projectContactService";

// ── Unified contact shape ──────────────────────────────────────────────────

export type UnifiedContact = {
  /** "team" = ProjectContact row, "sub" = awarded subcontractor */
  source: "team" | "sub";
  /** Display label for the role/category column */
  roleLabel: string;
  /** Internal role/category id (used for grouping) */
  roleId: string;
  // Person fields
  fullName: string;
  firstName: string;
  lastName: string;
  title: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
};

const TEAM_ROLE_LABELS: Record<ContactRole, string> = {
  OWNER: "Owner",
  OWNER_REP: "Owner's Rep",
  ARCHITECT: "Architect",
  ENGINEER: "Engineer",
  INTERNAL_PM: "Internal — PM",
  INTERNAL_ESTIMATOR: "Internal — Estimator",
  INTERNAL_SUPER: "Internal — Superintendent",
  OTHER: "Other",
};

function splitName(full: string): { first: string; last: string } {
  const trimmed = full.trim();
  if (!trimmed) return { first: "", last: "" };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return {
    first: parts.slice(0, -1).join(" "),
    last: parts[parts.length - 1],
  };
}

// ── Loader ──────────────────────────────────────────────────────────────────

/**
 * Loads everyone the PM needs to know about for a bid:
 * - All ProjectContact rows
 * - The primary contact for each awarded subcontractor (sub is "awarded" if
 *   it has a BuyoutItem row with subcontractorId set)
 *
 * Returns null if the bid doesn't exist.
 */
export async function loadContactsForExport(
  bidId: number
): Promise<{ projectName: string; contacts: UnifiedContact[] } | null> {
  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { id: true, projectName: true },
  });
  if (!bid) return null;

  const contacts: UnifiedContact[] = [];

  // ── Project team ────────────────────────────────────────────────────────
  const team = await loadProjectContactsForBid(bidId);
  for (const row of team) {
    const { first, last } = splitName(row.name);
    contacts.push({
      source: "team",
      roleLabel: TEAM_ROLE_LABELS[row.role] ?? row.role,
      roleId: row.role,
      fullName: row.name,
      firstName: first,
      lastName: last,
      title: row.title,
      company: row.company,
      email: row.email,
      phone: row.phone,
      notes: row.notes,
    });
  }

  // ── Awarded subs ────────────────────────────────────────────────────────
  // Source = BuyoutItem.subcontractorId (set when an RFQ is accepted or
  // manually assigned). Pull the primary contact + the trade name(s).
  const buyouts = await prisma.buyoutItem.findMany({
    where: { bidId, subcontractorId: { not: null } },
    include: {
      bidTrade: { include: { trade: true } },
      subcontractor: {
        include: {
          contacts: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
        },
      },
    },
  });

  // Group by subcontractorId so multi-trade subs collapse to one row with
  // a combined trade list.
  type SubGroup = {
    subId: number;
    company: string;
    contact: { name: string; email: string | null; phone: string | null; title: string | null } | null;
    trades: string[];
  };
  const bySubId = new Map<number, SubGroup>();
  for (const b of buyouts) {
    if (!b.subcontractorId || !b.subcontractor) continue;
    let group = bySubId.get(b.subcontractorId);
    if (!group) {
      const c = b.subcontractor.contacts[0];
      group = {
        subId: b.subcontractorId,
        company: b.subcontractor.company,
        contact: c
          ? {
              name: c.name,
              email: c.email,
              phone: c.phone,
              title: c.title,
            }
          : null,
        trades: [],
      };
      bySubId.set(b.subcontractorId, group);
    }
    group.trades.push(b.bidTrade.trade.name);
  }

  for (const group of bySubId.values()) {
    if (!group.contact) continue;
    const { first, last } = splitName(group.contact.name);
    const tradeList = Array.from(new Set(group.trades)).join(", ");
    contacts.push({
      source: "sub",
      roleLabel: tradeList ? `Subcontractor — ${tradeList}` : "Subcontractor",
      roleId: "SUB",
      fullName: group.contact.name,
      firstName: first,
      lastName: last,
      title: group.contact.title,
      company: group.company,
      email: group.contact.email,
      phone: group.contact.phone,
      notes: tradeList ? `Awarded trades: ${tradeList}` : null,
    });
  }

  return { projectName: bid.projectName, contacts };
}

// ── CSV helpers ─────────────────────────────────────────────────────────────

function csvCell(v: string | null | undefined): string {
  if (v == null) return "";
  // RFC 4180 — quote any field containing comma/quote/newline; escape quotes by doubling.
  if (/[",\r\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function csvRow(cells: (string | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}

// ── Outlook CSV ─────────────────────────────────────────────────────────────
//
// Microsoft Outlook recognizes a wide variety of column names; we use the
// minimal set that maps cleanly to the New Contact dialog and works in both
// classic Outlook and Outlook on the web.

export function exportAsOutlookCsv(contacts: UnifiedContact[]): string {
  const headers = [
    "First Name",
    "Last Name",
    "Company",
    "Job Title",
    "E-mail Address",
    "Business Phone",
    "Categories",
    "Notes",
  ];
  const lines = [csvRow(headers)];

  for (const c of contacts) {
    lines.push(
      csvRow([
        c.firstName,
        c.lastName,
        c.company,
        c.title,
        c.email,
        c.phone,
        c.roleLabel,
        c.notes,
      ])
    );
  }

  return lines.join("\r\n") + "\r\n";
}

// ── Google Contacts CSV ─────────────────────────────────────────────────────
//
// Google Contacts CSV uses a flexible column layout. We emit the columns the
// import wizard recognizes by default. "Group Membership" lets us drop the
// project name in as a Google Contacts label so the contacts land in their
// own group.

export function exportAsGoogleCsv(
  contacts: UnifiedContact[],
  projectName: string
): string {
  const groupLabel = `* myContacts ::: Bid: ${projectName}`;
  const headers = [
    "Name",
    "Given Name",
    "Family Name",
    "Group Membership",
    "E-mail 1 - Type",
    "E-mail 1 - Value",
    "Phone 1 - Type",
    "Phone 1 - Value",
    "Organization 1 - Type",
    "Organization 1 - Name",
    "Organization 1 - Title",
    "Notes",
  ];
  const lines = [csvRow(headers)];

  for (const c of contacts) {
    const noteParts: string[] = [];
    noteParts.push(`Role: ${c.roleLabel}`);
    if (c.notes) noteParts.push(c.notes);

    lines.push(
      csvRow([
        c.fullName,
        c.firstName,
        c.lastName,
        groupLabel,
        c.email ? "Work" : "",
        c.email,
        c.phone ? "Work" : "",
        c.phone,
        c.company ? "Work" : "",
        c.company,
        c.title,
        noteParts.join(" | "),
      ])
    );
  }

  return lines.join("\r\n") + "\r\n";
}

// ── vCard 3.0 ───────────────────────────────────────────────────────────────
//
// One vCard per contact, concatenated into a single .vcf file. Apple
// Contacts, Google Contacts, Outlook, and most CRMs read this format
// directly. RFC 6350 escapes: backslash, comma, semicolon, newline.

function vcardEscape(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\r?\n/g, "\\n");
}

function vcardLine(field: string, value: string | null | undefined): string | null {
  if (!value) return null;
  return `${field}:${vcardEscape(value)}`;
}

export function exportAsVcard(
  contacts: UnifiedContact[],
  projectName: string
): string {
  const blocks: string[] = [];
  for (const c of contacts) {
    const lines: string[] = [];
    lines.push("BEGIN:VCARD");
    lines.push("VERSION:3.0");
    // N: structured name (LastName;FirstName;;;)
    lines.push(`N:${vcardEscape(c.lastName)};${vcardEscape(c.firstName)};;;`);
    // FN: formatted display name (required)
    lines.push(`FN:${vcardEscape(c.fullName)}`);

    const org = vcardLine("ORG", c.company);
    if (org) lines.push(org);
    const title = vcardLine("TITLE", c.title);
    if (title) lines.push(title);

    if (c.email) lines.push(`EMAIL;TYPE=WORK:${vcardEscape(c.email)}`);
    if (c.phone) lines.push(`TEL;TYPE=WORK,VOICE:${vcardEscape(c.phone)}`);

    // CATEGORIES = role + project tag (most clients show categories/tags)
    const categories = [c.roleLabel, `Bid: ${projectName}`];
    lines.push(`CATEGORIES:${categories.map(vcardEscape).join("\\,")}`);

    // NOTE: combine the notes field with the role for clarity
    const noteParts: string[] = [`Role: ${c.roleLabel}`, `Project: ${projectName}`];
    if (c.notes) noteParts.push(c.notes);
    lines.push(`NOTE:${vcardEscape(noteParts.join(" | "))}`);

    lines.push("END:VCARD");
    blocks.push(lines.join("\r\n"));
  }
  return blocks.join("\r\n") + "\r\n";
}

// ── Format dispatcher ───────────────────────────────────────────────────────

export const EXPORT_FORMATS = ["outlook", "google", "vcard"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isValidExportFormat(s: string): s is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(s);
}

export type RenderedExport = {
  body: string;
  contentType: string;
  fileExtension: string;
};

export function renderContactExport(
  format: ExportFormat,
  contacts: UnifiedContact[],
  projectName: string
): RenderedExport {
  switch (format) {
    case "outlook":
      return {
        body: exportAsOutlookCsv(contacts),
        contentType: "text/csv; charset=utf-8",
        fileExtension: "csv",
      };
    case "google":
      return {
        body: exportAsGoogleCsv(contacts, projectName),
        contentType: "text/csv; charset=utf-8",
        fileExtension: "csv",
      };
    case "vcard":
      return {
        body: exportAsVcard(contacts, projectName),
        contentType: "text/vcard; charset=utf-8",
        fileExtension: "vcf",
      };
  }
}

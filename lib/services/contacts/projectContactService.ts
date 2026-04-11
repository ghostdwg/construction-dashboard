// Module H1 — Project Contact service layer
//
// Manages owner / architect / engineer / internal-team contacts attached to
// a Bid. Replaces the deferred contacts placeholder in the H1 Handoff Packet
// and feeds the Contacts XLSX sheet.
//
// Validation (role enum, required name) is enforced here so the API routes
// stay thin.

import { prisma } from "@/lib/prisma";

// ── Roles ───────────────────────────────────────────────────────────────────

export const CONTACT_ROLES = [
  "OWNER",
  "OWNER_REP",
  "ARCHITECT",
  "ENGINEER",
  "INTERNAL_PM",
  "INTERNAL_ESTIMATOR",
  "INTERNAL_SUPER",
  "OTHER",
] as const;

export type ContactRole = (typeof CONTACT_ROLES)[number];

export function isValidContactRole(s: string): s is ContactRole {
  return (CONTACT_ROLES as readonly string[]).includes(s);
}

// Sort order for grouping in UI + exports. Owner-side first, then internal,
// then catch-all.
const ROLE_ORDER: Record<ContactRole, number> = {
  OWNER: 0,
  OWNER_REP: 1,
  ARCHITECT: 2,
  ENGINEER: 3,
  INTERNAL_PM: 4,
  INTERNAL_ESTIMATOR: 5,
  INTERNAL_SUPER: 6,
  OTHER: 7,
};

// ── Types ───────────────────────────────────────────────────────────────────

export type ProjectContactRow = {
  id: number;
  bidId: number;
  role: ContactRole;
  name: string;
  company: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
};

// ── Read ────────────────────────────────────────────────────────────────────

/**
 * Loads all project contacts for a bid, sorted by role then primary then name.
 */
export async function loadProjectContactsForBid(
  bidId: number
): Promise<ProjectContactRow[]> {
  const rows = await prisma.projectContact.findMany({
    where: { bidId },
  });

  const mapped = rows.map(toRow);
  mapped.sort((a, b) => {
    const ra = ROLE_ORDER[a.role] ?? 99;
    const rb = ROLE_ORDER[b.role] ?? 99;
    if (ra !== rb) return ra - rb;
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return mapped;
}

function toRow(it: {
  id: number;
  bidId: number;
  role: string;
  name: string;
  company: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ProjectContactRow {
  return {
    id: it.id,
    bidId: it.bidId,
    role: (isValidContactRole(it.role) ? it.role : "OTHER") as ContactRole,
    name: it.name,
    company: it.company,
    title: it.title,
    email: it.email,
    phone: it.phone,
    notes: it.notes,
    isPrimary: it.isPrimary,
    createdAt: it.createdAt.toISOString(),
    updatedAt: it.updatedAt.toISOString(),
  };
}

// ── Create ──────────────────────────────────────────────────────────────────

export type ProjectContactInput = {
  role?: string;
  name?: string;
  company?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  isPrimary?: boolean;
};

export type ProjectContactCreateResult =
  | { ok: true; row: ProjectContactRow }
  | { ok: false; error: string };

export async function createProjectContact(
  bidId: number,
  input: ProjectContactInput
): Promise<ProjectContactCreateResult> {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "name is required" };

  const role = input.role ?? "OTHER";
  if (!isValidContactRole(role)) {
    return { ok: false, error: `Invalid role. Must be one of: ${CONTACT_ROLES.join(", ")}` };
  }

  const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
  if (!bid) return { ok: false, error: "Bid not found" };

  const created = await prisma.projectContact.create({
    data: {
      bidId,
      role,
      name,
      company: input.company ?? null,
      title: input.title ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      notes: input.notes ?? null,
      isPrimary: input.isPrimary ?? false,
    },
  });
  return { ok: true, row: toRow(created) };
}

// ── Update ──────────────────────────────────────────────────────────────────

export type ProjectContactUpdateResult =
  | { ok: true; row: ProjectContactRow }
  | { ok: false; error: string };

export async function updateProjectContact(
  bidId: number,
  contactId: number,
  input: ProjectContactInput
): Promise<ProjectContactUpdateResult> {
  const existing = await prisma.projectContact.findUnique({
    where: { id: contactId },
    select: { id: true, bidId: true },
  });
  if (!existing) return { ok: false, error: "Contact not found" };
  if (existing.bidId !== bidId) {
    return { ok: false, error: "Contact does not belong to this bid" };
  }

  if (input.role !== undefined && !isValidContactRole(input.role)) {
    return { ok: false, error: `Invalid role. Must be one of: ${CONTACT_ROLES.join(", ")}` };
  }
  if (input.name !== undefined && input.name.trim() === "") {
    return { ok: false, error: "name cannot be empty" };
  }

  const data: Record<string, unknown> = {};
  if ("role" in input) data.role = input.role;
  if ("name" in input) data.name = input.name!.trim();
  if ("company" in input) data.company = input.company;
  if ("title" in input) data.title = input.title;
  if ("email" in input) data.email = input.email;
  if ("phone" in input) data.phone = input.phone;
  if ("notes" in input) data.notes = input.notes;
  if ("isPrimary" in input) data.isPrimary = input.isPrimary;

  const updated = await prisma.projectContact.update({
    where: { id: contactId },
    data,
  });
  return { ok: true, row: toRow(updated) };
}

// ── Delete ──────────────────────────────────────────────────────────────────

export type ProjectContactDeleteResult =
  | { ok: true }
  | { ok: false; error: string };

export async function deleteProjectContact(
  bidId: number,
  contactId: number
): Promise<ProjectContactDeleteResult> {
  const existing = await prisma.projectContact.findUnique({
    where: { id: contactId },
    select: { id: true, bidId: true },
  });
  if (!existing) return { ok: false, error: "Contact not found" };
  if (existing.bidId !== bidId) {
    return { ok: false, error: "Contact does not belong to this bid" };
  }

  await prisma.projectContact.delete({ where: { id: contactId } });
  return { ok: true };
}

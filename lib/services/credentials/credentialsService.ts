/**
 * credentialsService — write/list/delete operations on IntegrationCredential.
 *
 * Encryption happens here (via credentialVault). Decryption is intentionally
 * NOT exposed by this module — only the test-connection bridge to the
 * sidecar may decrypt, and only with explicit caller_module audit.
 */

import { prisma } from "@/lib/prisma";
import { encrypt } from "./credentialVault";

export type IntegrationStatus = {
  service: string;
  fields: Array<{
    field: string;
    masked: string;          // safe for UI display
    updatedAt: string;
  }>;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
};

const KNOWN_SERVICES = ["beeline", "blue_book", "constructconnect", "isqft", "dodge"] as const;
const KNOWN_FIELDS   = ["username", "password", "api_key", "totp_secret", "client_id", "client_secret"] as const;

export function isValidService(s: string): boolean {
  return KNOWN_SERVICES.includes(s as (typeof KNOWN_SERVICES)[number]);
}

export function isValidField(f: string): boolean {
  return KNOWN_FIELDS.includes(f as (typeof KNOWN_FIELDS)[number]);
}

/** List all integrations with masked field summaries. NO decryption. */
export async function listIntegrations(): Promise<IntegrationStatus[]> {
  const rows = await prisma.integrationCredential.findMany({
    orderBy: [{ service: "asc" }, { field: "asc" }],
  });

  const byService = new Map<string, IntegrationStatus>();
  for (const r of rows) {
    if (!byService.has(r.service)) {
      byService.set(r.service, {
        service: r.service,
        fields: [],
        lastTestedAt:   r.lastTestedAt?.toISOString() ?? null,
        lastTestStatus: r.lastTestStatus,
        lastTestError:  r.lastTestError,
      });
    }
    const entry = byService.get(r.service)!;
    // Masked summary: we know the field type but NEVER decrypt here.
    // Show a generic mask based on field length isn't possible without
    // decryption; use a fixed shape (8 bullets for passwords/secrets,
    // "set" for everything else).
    const masked = /password|secret/i.test(r.field) ? "••••••••" : "(set)";
    entry.fields.push({
      field: r.field,
      masked,
      updatedAt: r.updatedAt.toISOString(),
    });
    // Bubble up the most-recent test result across all fields
    if (r.lastTestedAt && (!entry.lastTestedAt || r.lastTestedAt.toISOString() > entry.lastTestedAt)) {
      entry.lastTestedAt   = r.lastTestedAt.toISOString();
      entry.lastTestStatus = r.lastTestStatus;
      entry.lastTestError  = r.lastTestError;
    }
  }
  return Array.from(byService.values());
}

/** Upsert a single field. Encrypts plaintext server-side. */
export async function upsertCredential(args: {
  service: string;
  field: string;
  plaintext: string;
}): Promise<void> {
  if (!isValidService(args.service)) throw new Error(`Invalid service: ${args.service}`);
  if (!isValidField(args.field))     throw new Error(`Invalid field: ${args.field}`);
  if (typeof args.plaintext !== "string" || !args.plaintext)
    throw new Error("plaintext must be a non-empty string");

  const enc = encrypt(args.plaintext);
  await prisma.integrationCredential.upsert({
    where:  { service_field: { service: args.service, field: args.field } },
    update: {
      encryptedValue: enc.encryptedValue,
      iv:             enc.iv,
      authTag:        enc.authTag,
      algorithm:      enc.algorithm,
    },
    create: {
      service:        args.service,
      field:          args.field,
      encryptedValue: enc.encryptedValue,
      iv:             enc.iv,
      authTag:        enc.authTag,
      algorithm:      enc.algorithm,
    },
  });
}

export async function deleteCredential(service: string, field: string): Promise<void> {
  await prisma.integrationCredential.deleteMany({
    where: { service, field },
  });
}

/** Update test status after a test-connection attempt. No decryption. */
export async function recordTestResult(args: {
  service: string;
  status: "success" | "failed";
  error?: string;
}): Promise<void> {
  await prisma.integrationCredential.updateMany({
    where: { service: args.service },
    data: {
      lastTestedAt:   new Date(),
      lastTestStatus: args.status,
      lastTestError:  args.error?.slice(0, 500) ?? null,
    },
  });
}

/** Use only by the test-connection bridge. Returns the encrypted row for
 *  the sidecar to receive (sidecar holds the master key and decrypts).
 *  We expose this rather than decrypting in the Next.js process to keep
 *  plaintext out of the Node memory entirely on the test path. */
export async function getCredentialRow(service: string, field: string) {
  return prisma.integrationCredential.findUnique({
    where: { service_field: { service, field } },
  });
}

export { KNOWN_SERVICES, KNOWN_FIELDS };

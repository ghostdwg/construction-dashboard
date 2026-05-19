import { auth } from "@/lib/auth";
import {
  isValidService,
  isValidField,
  upsertCredential,
  deleteCredential,
} from "@/lib/services/credentials/credentialsService";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  const role = (session.user as { role?: string }).role;
  if (role !== "admin") return { error: Response.json({ error: "admin required" }, { status: 403 }) };
  return { session };
}

/**
 * POST /api/settings/credentials/[service]
 * Body: { fields: { username?: "...", password?: "...", api_key?: "..." } }
 * Encrypts and upserts each provided field. Returns count of updated fields.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ service: string }> },
) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;

  const { service } = await params;
  if (!isValidService(service)) {
    return Response.json({ error: `Invalid service: ${service}` }, { status: 400 });
  }

  const body = await request.json();
  const fields = body?.fields;
  if (!fields || typeof fields !== "object") {
    return Response.json({ error: "Body must include { fields: { ... } }" }, { status: 400 });
  }

  let updated = 0;
  const errors: string[] = [];
  for (const [field, value] of Object.entries(fields)) {
    if (!isValidField(field)) {
      errors.push(`Invalid field: ${field}`);
      continue;
    }
    if (typeof value !== "string" || !value) {
      errors.push(`Field ${field} must be a non-empty string`);
      continue;
    }
    try {
      await upsertCredential({ service, field, plaintext: value });
      updated++;
    } catch (err) {
      errors.push(`${field}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return Response.json({
    service,
    updated,
    errors: errors.length ? errors : undefined,
  });
}

/**
 * DELETE /api/settings/credentials/[service]
 * Body (optional): { field: "username" } — if omitted, deletes all fields for service.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ service: string }> },
) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;

  const { service } = await params;
  if (!isValidService(service)) {
    return Response.json({ error: `Invalid service: ${service}` }, { status: 400 });
  }

  let field: string | null = null;
  try {
    if (request.headers.get("content-length") && Number(request.headers.get("content-length")) > 0) {
      const body = await request.json();
      if (body?.field && typeof body.field === "string") field = body.field;
    }
  } catch { /* no body */ }

  if (field) {
    await deleteCredential(service, field);
    return Response.json({ deleted: { service, field } });
  } else {
    // Delete all fields for the service
    const { prisma } = await import("@/lib/prisma");
    const result = await prisma.integrationCredential.deleteMany({ where: { service } });
    return Response.json({ deleted: { service, count: result.count } });
  }
}

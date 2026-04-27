import { prisma } from "@/lib/prisma";
import { isAdminAuthorized } from "@/lib/auth";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export async function GET() {
  const authz = await isAdminAuthorized();
  if (!authz.authorized) {
    return Response.json({ error: authz.error }, { status: authz.status });
  }

  const users = await prisma.user.findMany({
    select: {
      id:        true,
      name:      true,
      email:     true,
      role:      true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return Response.json({ users });
}

export async function POST(req: Request) {
  const authz = await isAdminAuthorized();
  if (!authz.authorized) {
    return Response.json({ error: authz.error }, { status: authz.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email, name, role } = body as Record<string, unknown>;

  if (!email || typeof email !== "string") {
    return Response.json({ error: "Email is required" }, { status: 400 });
  }
  if (!name || typeof name !== "string") {
    return Response.json({ error: "Name is required" }, { status: 400 });
  }
  if (!["admin", "estimator", "pm"].includes(String(role))) {
    return Response.json({ error: "Role must be admin, estimator, or pm" }, { status: 400 });
  }

  // Generate a one-time temp password — caller must share it with the new user
  const tempPassword = crypto.randomBytes(10).toString("hex");
  const hashedPassword = await bcrypt.hash(tempPassword, 12);

  try {
    const user = await prisma.user.create({
      data: {
        email:          email.toLowerCase().trim(),
        name:           String(name).trim(),
        role:           String(role),
        hashedPassword,
      },
      select: {
        id:        true,
        name:      true,
        email:     true,
        role:      true,
        createdAt: true,
      },
    });

    return Response.json({ user, tempPassword }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("Unique constraint") || msg.includes("unique")) {
      return Response.json({ error: "A user with that email already exists" }, { status: 409 });
    }
    console.error("[POST /api/admin/users]", err);
    return Response.json({ error: "Failed to create user" }, { status: 500 });
  }
}

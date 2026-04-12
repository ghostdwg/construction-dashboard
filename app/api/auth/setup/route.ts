// GET  /api/auth/setup — check if any users exist
// POST /api/auth/setup — create the first admin user (one-shot)
//
// Auth Wall — First-user setup endpoint.
//
// GET returns { hasUsers: boolean }. The login page uses this to decide
// whether to show "Create Admin Account" or the standard login form.
//
// POST creates a user with role="admin" ONLY if zero users exist. Subsequent
// calls are rejected. Body: { name, email, password }.

import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function GET() {
  const count = await prisma.user.count();
  return Response.json({ hasUsers: count > 0 });
}

export async function POST(request: Request) {
  // Only allow setup when no users exist
  const count = await prisma.user.count();
  if (count > 0) {
    return Response.json(
      { error: "Setup already complete. Users already exist." },
      { status: 403 }
    );
  }

  let body: { name?: string; email?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!name) return Response.json({ error: "Name is required" }, { status: 400 });
  if (!email || !email.includes("@")) {
    return Response.json({ error: "Valid email is required" }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      hashedPassword,
      role: "admin",
    },
  });

  return Response.json(
    { ok: true, userId: user.id, email: user.email, role: user.role },
    { status: 201 }
  );
}

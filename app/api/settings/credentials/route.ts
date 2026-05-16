import { auth } from "@/lib/auth";
import { listIntegrations } from "@/lib/services/credentials/credentialsService";

export async function GET() {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  // Admin-only — settings pages restricted at middleware, but double-check
  // here in case middleware is bypassed or this is called by a non-admin user.
  const role = (session.user as { role?: string }).role;
  if (role !== "admin") return Response.json({ error: "admin required" }, { status: 403 });

  const integrations = await listIntegrations();
  return Response.json({ integrations });
}

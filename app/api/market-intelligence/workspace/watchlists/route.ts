// POST /api/market-intelligence/workspace/watchlists
//   body: { name, description?, subjectKind?, visibility?, ruleJson?, tagsCsv? }
//
// Auth required. Returns { ok, id }.

import { auth } from "@/lib/auth";
import { createWatchlist } from "@/lib/services/operatorWorkspace";
import type {
  WatchlistSubjectKind,
  WatchlistVisibility,
} from "@/lib/services/operatorWorkspace";

async function requireUser(): Promise<
  | { ok: true; actor: { userId: string | null; email: string | null } }
  | { ok: false; response: Response }
> {
  const session = await auth();
  const user = session?.user as { id?: string; email?: string } | undefined;
  if (!user) return { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  return { ok: true, actor: { userId: user.id ?? null, email: user.email ?? null } };
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    subjectKind?: WatchlistSubjectKind;
    visibility?: WatchlistVisibility;
    ruleJson?: string;
    tagsCsv?: string;
  };

  if (!body.name) {
    return Response.json({ ok: false, error: "name is required" }, { status: 400 });
  }

  const result = await createWatchlist({
    name: body.name,
    description: body.description,
    subjectKind: body.subjectKind,
    visibility: body.visibility,
    ruleJson: body.ruleJson,
    tagsCsv: body.tagsCsv,
    actor: auth.actor,
  });

  return Response.json(result, { status: result.ok ? 201 : 400 });
}

// POST /api/market-intelligence/workspace/briefings
//   body: { briefingKind, title?, windowStartIso, windowEndIso,
//           jurisdictionKey?, corridorKey?, watchlistId?,
//           publishImmediately? }
//
// Auth required. Returns { ok, id?, error? }.

import { auth } from "@/lib/auth";
import { generateBriefing, persistBriefing } from "@/lib/services/operatorWorkspace";
import type { BriefingKind } from "@/lib/services/operatorWorkspace";

async function requireUser() {
  const session = await auth();
  const user = session?.user as { id?: string; email?: string } | undefined;
  if (!user) return { ok: false as const, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  return { ok: true as const, actor: { userId: user.id ?? null, email: user.email ?? null } };
}

export async function POST(request: Request) {
  const a = await requireUser();
  if (!a.ok) return a.response;

  const body = (await request.json().catch(() => ({}))) as {
    briefingKind?: BriefingKind;
    title?: string;
    windowStartIso?: string;
    windowEndIso?: string;
    jurisdictionKey?: string;
    corridorKey?: string;
    watchlistId?: string;
    publishImmediately?: boolean;
  };

  if (!body.briefingKind) {
    return Response.json({ ok: false, error: "briefingKind is required" }, { status: 400 });
  }
  if (!body.windowStartIso || !body.windowEndIso) {
    return Response.json({ ok: false, error: "windowStartIso and windowEndIso are required" }, { status: 400 });
  }

  const windowStart = new Date(body.windowStartIso);
  const windowEnd = new Date(body.windowEndIso);

  const generated = await generateBriefing({
    briefingKind: body.briefingKind,
    title: body.title,
    windowStart,
    windowEnd,
    jurisdictionKey: body.jurisdictionKey,
    corridorKey: body.corridorKey,
    watchlistId: body.watchlistId,
    actor: a.actor,
  });

  const persisted = await persistBriefing({
    generated,
    windowStart,
    windowEnd,
    jurisdictionKey: body.jurisdictionKey,
    corridorKey: body.corridorKey,
    watchlistId: body.watchlistId,
    actor: a.actor,
    publishImmediately: body.publishImmediately,
  });

  return Response.json(persisted, { status: persisted.ok ? 201 : 400 });
}

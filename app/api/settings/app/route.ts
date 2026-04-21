// GET   /api/settings/app?category=email|ai|estimator
// PATCH /api/settings/app
//
// Module SET1 — App Settings (key/value).
//
// GET returns the list of settings for a category with effective values
// (DB > env > missing). Secret values are masked to last-4.
//
// PATCH body: { key: string, value: string | null }
// value=null clears the DB override (falls back to env if available).

import { isAdminAuthorized } from "@/lib/auth";
import {
  loadSettingsByCategory,
  setSetting,
  getSettingDefinition,
  type SettingDefinition,
} from "@/lib/services/settings/appSettingsService";

export async function GET(request: Request) {
  const adminCheck = await isAdminAuthorized();
  if (!adminCheck.authorized) {
    return Response.json({ error: adminCheck.error }, { status: adminCheck.status });
  }
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") as SettingDefinition["category"] | null;

  if (!category || !["email", "ai", "estimator", "procore"].includes(category)) {
    return Response.json(
      { error: "category must be one of: email, ai, estimator, procore" },
      { status: 400 }
    );
  }

  try {
    const items = await loadSettingsByCategory(category);
    return Response.json({ items });
  } catch (err) {
    console.error("[GET /api/settings/app]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const adminCheck = await isAdminAuthorized();
  if (!adminCheck.authorized) {
    return Response.json({ error: adminCheck.error }, { status: adminCheck.status });
  }

  let body: { key?: string; value?: string | null };
  try {
    body = (await request.json()) as { key?: string; value?: string | null };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.key || typeof body.key !== "string") {
    return Response.json({ error: "key is required" }, { status: 400 });
  }
  if (!getSettingDefinition(body.key)) {
    return Response.json({ error: `Unknown setting key: ${body.key}` }, { status: 400 });
  }
  if (body.value !== null && body.value !== undefined && typeof body.value !== "string") {
    return Response.json({ error: "value must be a string or null" }, { status: 400 });
  }

  try {
    await setSetting(body.key, body.value ?? null);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[PATCH /api/settings/app]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

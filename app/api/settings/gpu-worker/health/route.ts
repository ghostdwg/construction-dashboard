// GET /api/settings/gpu-worker/health
//
// Proxies health checks to both the WhisperX GPU worker and the Python sidecar,
// returning their status in a single response. Admin-only.

import { isAdminAuthorized } from "@/lib/auth";
import { getSetting } from "@/lib/services/settings/appSettingsService";

type WorkerHealth = {
  connected: true;
  device?: string;
  model?: string;
} | {
  connected: false;
  error: string;
};

async function probeHealth(
  url: string | null,
  apiKey: string | null,
  label: string
): Promise<WorkerHealth> {
  if (!url) {
    return { connected: false, error: `${label} URL not configured` };
  }
  try {
    const res = await fetch(`${url}/health`, {
      headers: apiKey ? { "X-API-Key": apiKey } : {},
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { connected: false, error: `HTTP ${res.status}` };
    }
    const body = await res.json() as Record<string, unknown>;
    return {
      connected: true,
      device: typeof body.device === "string" ? body.device : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { connected: false, error: message };
  }
}

export async function GET() {
  const adminCheck = await isAdminAuthorized();
  if (!adminCheck.authorized) {
    return Response.json({ error: adminCheck.error }, { status: adminCheck.status });
  }

  const [whisperxUrl, whisperxKey, sidecarUrl, sidecarKey] = await Promise.all([
    getSetting("WHISPERX_URL"),
    getSetting("WHISPERX_API_KEY"),
    getSetting("SIDECAR_URL"),
    getSetting("SIDECAR_API_KEY"),
  ]);

  const [gpu, sidecar] = await Promise.all([
    probeHealth(whisperxUrl, whisperxKey, "GPU worker"),
    probeHealth(sidecarUrl ?? "http://127.0.0.1:8001", sidecarKey, "Sidecar"),
  ]);

  return Response.json({ gpu, sidecar });
}

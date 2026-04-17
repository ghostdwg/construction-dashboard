// Tier F F2 — Procore REST API client
//
// Wraps Procore OAuth 2.0 client credentials flow + HTTP helpers.
// Token is cached in-process (globalThis, same pattern as appSettingsCache)
// and refreshed when it expires.
//
// All public functions throw ProcoreError on auth or API failures.
// Callers should catch and surface the .message to the user.

import { getSetting } from "@/lib/services/settings/appSettingsService";

// ── Constants ──────────────────────────────────────────────────────────────

export const PROCORE_BASE = "https://api.procore.com";
const PROCORE_AUTH_URL = "https://login.procore.com/oauth/token";

// ── Error type ────────────────────────────────────────────────────────────

export class ProcoreError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "ProcoreError";
  }
}

// ── Token cache ────────────────────────────────────────────────────────────

type TokenEntry = { accessToken: string; expiresAt: number };

const globalForToken = globalThis as unknown as {
  __procoreToken?: TokenEntry;
};

function getCachedToken(): string | null {
  const entry = globalForToken.__procoreToken;
  if (!entry) return null;
  // Give a 60-second buffer before expiry
  if (Date.now() >= entry.expiresAt - 60_000) return null;
  return entry.accessToken;
}

function setCachedToken(token: string, expiresInSeconds: number): void {
  globalForToken.__procoreToken = {
    accessToken: token,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };
}

export function clearProcoreTokenCache(): void {
  delete globalForToken.__procoreToken;
}

// ── Credentials loader ─────────────────────────────────────────────────────

export type ProcoreCreds = {
  clientId: string;
  clientSecret: string;
  companyId: string;
};

export async function getProcoreCreds(): Promise<ProcoreCreds> {
  const [clientId, clientSecret, companyId] = await Promise.all([
    getSetting("PROCORE_CLIENT_ID"),
    getSetting("PROCORE_CLIENT_SECRET"),
    getSetting("PROCORE_COMPANY_ID"),
  ]);

  const missing: string[] = [];
  if (!clientId) missing.push("PROCORE_CLIENT_ID");
  if (!clientSecret) missing.push("PROCORE_CLIENT_SECRET");
  if (!companyId) missing.push("PROCORE_COMPANY_ID");

  if (missing.length > 0) {
    throw new ProcoreError(
      `Procore not configured. Missing settings: ${missing.join(", ")}. ` +
        "Go to Settings → Procore Integration to enter your credentials."
    );
  }

  return { clientId: clientId!, clientSecret: clientSecret!, companyId: companyId! };
}

// ── OAuth token fetch ──────────────────────────────────────────────────────

async function fetchAccessToken(
  clientId: string,
  clientSecret: string
): Promise<string> {
  const cached = getCachedToken();
  if (cached) return cached;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(PROCORE_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: string; error_description?: string };
      detail = j.error_description ?? j.error ?? "";
    } catch {
      // ignore
    }
    throw new ProcoreError(
      `Procore auth failed (${res.status})${detail ? ": " + detail : ""}`,
      res.status
    );
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  setCachedToken(data.access_token, data.expires_in ?? 3600);
  return data.access_token;
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  const creds = await getProcoreCreds();
  return fetchAccessToken(creds.clientId, creds.clientSecret);
}

async function procoreHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export async function procoreGet<T>(path: string): Promise<T> {
  const headers = await procoreHeaders();
  const res = await fetch(`${PROCORE_BASE}${path}`, { headers });
  return handleResponse<T>(res, `GET ${path}`);
}

export async function procorePost<T>(path: string, body: unknown): Promise<T> {
  const headers = await procoreHeaders();
  const res = await fetch(`${PROCORE_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return handleResponse<T>(res, `POST ${path}`);
}

export async function procorePatch<T>(path: string, body: unknown): Promise<T> {
  const headers = await procoreHeaders();
  const res = await fetch(`${PROCORE_BASE}${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  return handleResponse<T>(res, `PATCH ${path}`);
}

async function handleResponse<T>(res: Response, context: string): Promise<T> {
  if (res.ok) return res.json() as Promise<T>;

  let detail = "";
  try {
    const j = (await res.json()) as { errors?: string[]; message?: string };
    detail = (j.errors ?? []).join("; ") || j.message || "";
  } catch {
    // ignore
  }
  throw new ProcoreError(
    `Procore API error (${res.status}) on ${context}${detail ? ": " + detail : ""}`,
    res.status
  );
}

// ── Company-level helpers ──────────────────────────────────────────────────

export async function getCompanyId(): Promise<string> {
  const creds = await getProcoreCreds();
  return creds.companyId;
}

import { createHash, timingSafeEqual } from "node:crypto";

export const MEETING_WORKER_TOKEN_HEADER = "x-meeting-worker-token";
export const MEETING_WORKER_LEASE_HEADER = "x-meeting-worker-lease";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Fail-closed worker authentication. Hashing both operands before the timing
 * safe comparison gives equal-length buffers without exposing either secret.
 * The environment is read per request so tests and secret rotation do not
 * depend on a module-load singleton.
 */
export function isMeetingWorkerAuthenticated(request: Request): boolean {
  const configured = process.env.MEETING_WORKER_TOKEN;
  const presented = request.headers.get(MEETING_WORKER_TOKEN_HEADER);
  if (!configured || !presented) return false;
  return timingSafeEqual(digest(configured), digest(presented));
}

export function meetingWorkerUnauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

import {
  isMeetingWorkerAuthenticated,
  meetingWorkerUnauthorized,
} from "./workerAuth";

export function meetingWorkerRouteContext(
  request: Request,
): { ok: true } | { ok: false; response: Response };
export function meetingWorkerRouteContext(
  request: Request,
  jobIdRaw: string,
): { ok: true; jobId: number } | { ok: false; response: Response };
export function meetingWorkerRouteContext(request: Request, jobIdRaw?: string) {
  if (!isMeetingWorkerAuthenticated(request)) {
    return { ok: false as const, response: meetingWorkerUnauthorized() };
  }
  if (jobIdRaw == null) return { ok: true as const };
  const jobId = Number(jobIdRaw);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    return {
      ok: false as const,
      response: Response.json({ error: "Invalid jobId" }, { status: 400 }),
    };
  }
  return { ok: true as const, jobId };
}

export async function workerJson<T>(request: Request): Promise<
  | { ok: true; body: T }
  | { ok: false; response: Response }
> {
  try {
    return { ok: true, body: (await request.json()) as T };
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }
}

export function workerConflict(reason: string): Response {
  return Response.json({ ok: false, reason }, { status: 409 });
}

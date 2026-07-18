export const EXTERNAL_PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

export function externalJson(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: { ...EXTERNAL_PRIVATE_HEADERS, ...Object.fromEntries(new Headers(init.headers).entries()) },
  });
}

export function externalNotFound(): Response {
  return externalJson({ error: "Not found" }, { status: 404 });
}

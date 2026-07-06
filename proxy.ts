// Auth Wall + runtime tier header — Route protection middleware.
//
// Two responsibilities, both request-time:
//
//   1. Auth gate. AUTH_DISABLED=true → all requests pass through (solo dev).
//      Auth enabled → unauthenticated requests to protected routes redirect
//      to /login. Public routes: /login, /api/auth/*, /api/health, /metrics,
//      /api/jobs/run-due (worker token auth handled in the route),
//      /api/procore/webhook (external webhook receiver, secret-verified in
//      the route — see route docstring for the fail-closed contract),
//      /_next/*, favicon.
//
//      /metrics (Phase O1.5.a): the Prometheus scrape endpoint is exempt
//      from auth because the Prometheus sidecar in the same Compose project
//      scrapes it on a schedule and cannot present a session cookie. The
//      endpoint exposes only operational counters/histograms (no PII, no
//      cognition state), and should be reachable only from the internal
//      observability network in deployed environments (caddy / firewall
//      enforcement is the secondary boundary).
//
//   2. X-App-Env response header. Injected at request time so the value
//      reflects the *runtime* APP_ENV (from the tier env_file), not whatever
//      was baked into the build. Phase R6.7 — see runtime/runbooks/
//      app-env-rollout.md §X-App-Env header.
//
// Why not next.config.ts headers(): that function runs at build time and
// freezes values into routes-manifest.json. Build always has APP_ENV="local"
// (the Dockerfile placeholder needed to satisfy Zod), which would propagate
// to every response in every tier. The middleware path reads env.APP_ENV
// from lib/env.ts, which is Zod-validated at server boot from the runtime
// process env.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";

function attach(res: NextResponse): NextResponse {
  res.headers.set("X-App-Env", env.APP_ENV);
  return res;
}

export default auth((req) => {
  // Solo dev bypass
  if (process.env.AUTH_DISABLED === "true") {
    return attach(NextResponse.next());
  }

  const { pathname } = req.nextUrl;

  // Public routes that don't require auth
  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/health" ||
    pathname === "/metrics" ||                // Prometheus scrape (O1.5.a)
    pathname === "/api/jobs/run-due" ||      // worker token auth — see route
    pathname === "/api/procore/webhook" ||   // external webhook receiver — see route
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico";

  if (isPublic) return attach(NextResponse.next());

  // Unauthenticated + protected route → redirect to login
  if (!req.auth) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return attach(NextResponse.redirect(loginUrl));
  }

  // Authenticated — enforce admin-only for settings pages (not API routes;
  // those return 401/403 JSON from their own handlers).
  const isSettingsPage =
    pathname.startsWith("/settings") && !pathname.startsWith("/api/");
  if (isSettingsPage) {
    const role = (req.auth.user as { role?: string })?.role;
    if (role !== "admin") {
      return attach(NextResponse.redirect(new URL("/", req.nextUrl.origin)));
    }
  }

  return attach(NextResponse.next());
});

export const config = {
  matcher: [
    // Match all routes except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

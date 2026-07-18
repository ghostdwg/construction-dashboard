// Auth Wall + runtime tier header — Route protection proxy (Next.js 16
// renamed the `middleware.ts` file convention to `proxy.ts`; behavior is
// unchanged — see node_modules/next/dist/docs/.../file-conventions/proxy.md).
//
// Three responsibilities, all request-time:
//
//   1. Auth gate. AUTH_DISABLED=true → all requests pass through (solo dev;
//      lib/env.ts refuses to boot this way when APP_ENV=production). Auth
//      enabled → unauthenticated requests to protected page routes redirect
//      to / (the public landing page — never /login directly, so a bad/
//      expired session doesn't bounce the user through a bare sign-in form
//      with no context); unauthenticated protected /api/* requests get a
//      JSON 401, never an HTML redirect, so fetch()/API clients get a
//      parseable error instead of a login page body.
//
//      Public routes: / (landing page; authenticated visitors are bounced
//      onward to /bids — see below), /login (the actual sign-in form the
//      landing page hands off to — must stay reachable while unauthenticated
//      or nobody could ever sign in), /api/auth/*, /api/health, /metrics,
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
//   2. Landing-page routing. Authenticated visitors hitting / are redirected
//      to /bids — app/page.tsx (the "Operations" dashboard) is therefore not
//      reachable at the bare / URL for an authenticated visitor. The stable
//      /operations page re-exports that dashboard so the global Operations
//      link remains distinct from Projects.
//
//   3. X-App-Env response header. Injected at request time so the value
//      reflects the *runtime* APP_ENV (from the tier env_file), not whatever
//      was baked into the build. Phase R6.7 — see runtime/runbooks/
//      app-env-rollout.md §X-App-Env header.
//
// Why not next.config.ts headers(): that function runs at build time and
// freezes values into routes-manifest.json. Build always has APP_ENV="local"
// (the Dockerfile placeholder needed to satisfy Zod), which would propagate
// to every response in every tier. The proxy path reads env.APP_ENV from
// lib/env.ts, which is Zod-validated at server boot from the runtime
// process env.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { isPublicPath } from "@/lib/routing/publicPaths";

export { isPublicPath };

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

  if (isPublicPath(pathname)) {
    // Authenticated users don't see the landing page — send them to /bids.
    if (pathname === "/" && req.auth) {
      return attach(NextResponse.redirect(new URL("/bids", req.nextUrl.origin)));
    }
    return attach(NextResponse.next());
  }

  // Unauthenticated + protected route
  if (!req.auth) {
    // /api/* → JSON 401, never an HTML redirect (fetch()/API clients need a
    // parseable error, not a login page body).
    if (pathname.startsWith("/api/")) {
      return attach(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }
    // Page routes → the public landing page, not /login directly.
    const landingUrl = new URL("/", req.nextUrl.origin);
    landingUrl.searchParams.set("callbackUrl", pathname);
    return attach(NextResponse.redirect(landingUrl));
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

// Pure routing predicate, deliberately free of any next-auth/next/server
// imports so it can be unit-tested (__tests__/proxy.test.ts) without pulling
// in next-auth's import chain, which next/server can't resolve outside the
// Next.js bundler in this Next version (see proxy.ts for the real gate).

function isPathFamily(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/" ||                        // landing page (Part 4)
    pathname === "/login" ||                    // sign-in form the landing page hands off to
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/health" ||
    pathname === "/metrics" ||                // Prometheus scrape (O1.5.a)
    pathname === "/api/jobs/run-due" ||      // worker token auth — see route
    pathname === "/api/procore/webhook" ||   // external webhook receiver — see route
    isPathFamily(pathname, "/external/response") ||
    isPathFamily(pathname, "/api/external/response") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  );
}

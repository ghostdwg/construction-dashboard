// Auth Wall — Route protection middleware
//
// When AUTH_DISABLED=true (solo dev mode), all requests pass through.
// When auth is enabled, unauthenticated requests to protected routes are
// redirected to /login. Public routes: /login, /api/auth/*, static assets.

import { auth } from "@/lib/auth";

export default auth((req) => {
  // Solo dev bypass
  if (process.env.AUTH_DISABLED === "true") return;

  const { pathname } = req.nextUrl;

  // Public routes that don't require auth
  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/health" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico";

  if (isPublic) return;

  // Unauthenticated + protected route → redirect to login
  if (!req.auth) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return Response.redirect(loginUrl);
  }

  // Authenticated — enforce admin-only for settings pages (not API routes;
  // those return 401/403 JSON from their own handlers).
  const isSettingsPage =
    pathname.startsWith("/settings") && !pathname.startsWith("/api/");
  if (isSettingsPage) {
    const role = (req.auth.user as { role?: string })?.role;
    if (role !== "admin") {
      return Response.redirect(new URL("/", req.nextUrl.origin));
    }
  }
});

export const config = {
  matcher: [
    // Match all routes except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

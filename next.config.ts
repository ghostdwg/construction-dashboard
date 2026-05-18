import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["100.82.119.37"],
  serverExternalPackages: ["@prisma/adapter-libsql", "@libsql/core", "pdfjs-dist"],
  experimental: {
    // proxy.ts (auth middleware) buffers request bodies in memory.
    // Default is 10MB — spec books can be 50-100MB+.
    proxyClientMaxBodySize: "250mb",
  },

  // X-App-Env response header is injected at request time by proxy.ts
  // middleware (Phase R6.7). It is NOT declared here because next.config.ts
  // `headers()` is evaluated at BUILD time and bakes its values into
  // routes-manifest.json — so a build-time APP_ENV="local" placeholder
  // would freeze "local" into every response regardless of runtime tier.
  // See proxy.ts and runtime/runbooks/app-env-rollout.md.
};

export default nextConfig;

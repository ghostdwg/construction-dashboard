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

  // ── X-App-Env response header (Phase R5) ───────────────────────────────
  // Every response carries the canonical tier identifier so operators can
  // verify tier via DevTools or monitoring without rendering the page.
  // Value is captured at config-evaluation time (server start); APP_ENV
  // changes require a container recreate, not a config reload.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-App-Env',
            value: process.env.APP_ENV ?? 'unknown',
          },
        ],
      },
    ];
  },
};

export default nextConfig;

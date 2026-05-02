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
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Dynamic CORS is handled in middleware and route handlers via @/lib/cors */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;

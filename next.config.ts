import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: true,
  async headers() {
    return [
      {
        // Prevent iOS webviews from reusing a stale HTML shell between deploys.
        // Only apply to extensionless routes (skip assets like .png/.css/.js).
        source: "/:path((?!_next/.*|.*\\..*).*)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/.well-known/apple-app-site-association",
        headers: [
          { key: "Content-Type", value: "application/json" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
    ];
  },
};

export default nextConfig;

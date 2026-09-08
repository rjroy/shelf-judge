import type { NextConfig } from "next";

const tailscaleHostname = process.env.TAILSCALE_HOSTNAME || "gsai.raptor-piranha.ts.net";
const e2eDistDir = process.env.SHELF_JUDGE_NEXT_DIST_DIR === ".next-e2e";

const nextConfig: NextConfig = {
  // Playwright uses an isolated, ignored output directory so it never contends with a developer's dev server.
  distDir: process.env.SHELF_JUDGE_NEXT_DIST_DIR ?? ".next",
  ...(e2eDistDir ? { typescript: { tsconfigPath: "tsconfig.next-e2e.json" } } : {}),
  // Allow access via Tailscale hostname in dev
  allowedDevOrigins: [tailscaleHostname],

  // Images from BGG use their CDN
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cf.geekdo-images.com",
      },
    ],
  },
};

export default nextConfig;

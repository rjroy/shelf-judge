import type { NextConfig } from "next";

const tailscaleHostname = process.env.TAILSCALE_HOSTNAME || "gsai.raptor-piranha.ts.net";

const nextConfig: NextConfig = {
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

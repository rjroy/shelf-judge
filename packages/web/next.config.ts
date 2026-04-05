import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

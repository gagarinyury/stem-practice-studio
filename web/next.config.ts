import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 15+/16 blocks cross-origin dev requests by default (HMR + RSC payloads).
  // Allow Tailscale + LAN hosts so the dev server is reachable from the phone.
  allowedDevOrigins: [
    "100.116.66.5",
    "macbook-air-yury.tail74a7fb.ts.net",
    "*.tail74a7fb.ts.net",
    "192.168.*",
    "10.*",
  ],
};

export default nextConfig;

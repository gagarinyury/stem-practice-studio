import type { NextConfig } from "next";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_ORIGIN || "http://100.86.227.110:8093";

const nextConfig: NextConfig = {
  experimental: {
    proxyClientMaxBodySize: "500mb",
  },
  async rewrites() {
    return [{ source: "/be/:path*", destination: `${BACKEND}/:path*` }];
  },
};

export default nextConfig;

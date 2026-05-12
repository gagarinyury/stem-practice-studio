import type { NextConfig } from "next";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_ORIGIN || "http://100.86.227.110:8093";
const LLM = process.env.NEXT_PUBLIC_LLM_ORIGIN || "http://100.86.227.110:8083";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "100.116.66.5",
    "macbook-air-yury.tail74a7fb.ts.net",
    "*.tail74a7fb.ts.net",
    "192.168.*",
    "10.*",
  ],
  // Audio/video uploads can be >10MB; raise the proxy body limit so the
  // /be/tracks rewrite doesn't truncate the stream and ECONNRESET.
  experimental: {
    proxyClientMaxBodySize: "500mb",
  },
  // Same-origin proxy. Frontend runs HTTPS (dev cert + production capacitor://);
  // backend on evo runs HTTP. WKWebView blocks mixed content when fetching
  // http:// from an https:// page, so route everything through Next instead.
  async rewrites() {
    return [
      { source: "/be/:path*", destination: `${BACKEND}/:path*` },
      { source: "/llm/:path*", destination: `${LLM}/:path*` },
    ];
  },
};

export default nextConfig;

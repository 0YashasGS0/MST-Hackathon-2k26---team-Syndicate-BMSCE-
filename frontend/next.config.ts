import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const origin = (url: string | undefined) => {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
};

// The only places the browser may talk to: the backend, the MST RPC (HTTP + WebSocket) and the explorer.
const connect = [
  "'self'",
  origin(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000"),
  origin(process.env.NEXT_PUBLIC_MST_RPC_URL ?? "https://testnetrpc.mstblockchain.com"),
  (process.env.NEXT_PUBLIC_MST_WS_URL ?? "wss://testnetrpc.mstblockchain.com").replace(/\/$/, ""),
]
  .filter(Boolean)
  .join(" ");

// Device keys live in localStorage, so XSS is the main risk: no third-party scripts, no eval in production,
// no framing (clickjacking), no plugins, and forms/base URI pinned to this origin.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`, // Next's inline bootstrap needs 'unsafe-inline'
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src ${connect}${isDev ? " ws: http://localhost:*" : ""}`,
  "media-src 'self' blob:", // QR scanner camera stream
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  output: "standalone", // minimal server bundle for the Docker image
  poweredByHeader: false,
  // Let phones on the same Wi-Fi / hotspot open the dev server by the laptop's LAN IP (demo on a real phone).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    const liveApi = process.env.NEXT_PUBLIC_LIVE_API_URL;
    if (liveApi) {
      return [{ source: "/proxy/:path*", destination: `${liveApi}/:path*` }];
    }
    return [];
  },
};

export default nextConfig;

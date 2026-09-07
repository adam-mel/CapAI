import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for FFmpeg.wasm — enables SharedArrayBuffer
  async headers() {
    // BUG-AUTH-4: Security headers — CSP, frame-ancestors, Referrer-Policy, etc.
    // BUG-AUTH-2: Referrer-Policy no-referrer prevents ?key= from leaking via Referer to fonts.googleapis.com / raw.githubusercontent.com
    // BUG-AUTH-11: Future cookie auth must use SameSite=Lax/Strict + __Host- prefix + origin/sec-fetch-site checks + CSRF token.
    // NOTE: This app is local-first with no cookies/sessions today; CSP is the primary XSS exfil gate (BUG-AUTH-1, BUG-AUTH-6).
    const csp = [
      "default-src 'self'",
      // Next.js requires 'unsafe-inline' and 'unsafe-eval' for dev/HMR and FFmpeg.wasm; tighten in production if possible via nonce
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://fonts.googleapis.com https://generativelanguage.googleapis.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      // BUG-AUTH-6: connect-src locks exfiltration — only allow self + Gemini + fonts/CDN needed for export (Inter font) and FFmpeg
      "connect-src 'self' https://generativelanguage.googleapis.com https://cdn.jsdelivr.net https://raw.githubusercontent.com",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
          {
            key: "Content-Security-Policy",
            value: csp,
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "no-referrer",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

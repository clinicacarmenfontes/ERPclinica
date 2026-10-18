import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Sin nonces (ver node_modules/next/dist/docs/.../content-security-policy.md):
// el App Router inyecta scripts inline para el streaming de RSC, así que
// script-src necesita 'unsafe-inline'. El navegador solo habla con Supabase
// para el login con Microsoft (redirección, no fetch); los datos pasan siempre
// por Server Components/Actions, así que connect-src se queda en 'self'.
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data:;
  font-src 'self';
  connect-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
`;

const nextConfig: NextConfig = {
  // No revelar qué framework sirve la app (cabecera X-Powered-By).
  poweredByHeader: false,

  // Subida de ficheros por Server Action, uno por petición (Vercel corta a 4,5 MB).
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: cspHeader.replace(/\s{2,}/g, " ").trim() },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
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

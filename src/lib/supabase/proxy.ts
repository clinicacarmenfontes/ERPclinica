import { createServerClient } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "./env";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail } from "@/lib/auth/allowlist";

const LOGIN_PATH = "/login";

// Página 403 autocontenida (el proxy no renderiza React). Permite cerrar la
// sesión para volver a entrar con la cuenta correcta.
const FORBIDDEN_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Acceso restringido</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#FDFBF7;color:#2C2C2A;font-family:system-ui,sans-serif;padding:16px}
main{max-width:380px;border:1px solid #E5DDD0;border-radius:16px;background:#fff;padding:32px;text-align:center}
h1{font-size:18px;margin:0 0 8px}p{font-size:14px;color:#6B6763;margin:0 0 20px}
button{background:#B87C7C;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer}</style></head>
<body><main><h1>Acceso restringido</h1><p>El ERP contable solo está disponible para la cuenta de administración de la clínica.</p>
<form method="post" action="/auth/signout"><button type="submit">Cerrar sesión y entrar con otra cuenta</button></form></main></body></html>`;

/**
 * Refresca la sesión de Supabase en cada petición y decide el acceso:
 *   sin sesión          → /login (o 401 en /api)
 *   sesión ≠ admin@     → 403
 *   admin@ en /login    → /dashboard
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    supabaseUrl(),
    supabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // getUser() revalida el token contra Supabase Auth (no se fía de la cookie).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = pathname === LOGIN_PATH || pathname.startsWith("/auth/");

  if (!user) {
    if (isPublic) return response;
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (!isAllowedEmail(user.email)) {
    if (isPublic) return response;
    return new NextResponse(FORBIDDEN_HTML, {
      status: 403,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (pathname === LOGIN_PATH) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail, isGraphAccount } from "@/lib/auth/allowlist";
import { saveGraphRefreshToken } from "@/lib/repository/graph";
import { createClient } from "@/lib/supabase/server";

// Segunda barrera tras el proxy: solo las cuentas de allowlist.ts (admin@ e info@) conservan la
// sesión. Cualquier otra cuenta (aunque sea del dominio) se cierra al momento.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    const detail = searchParams.get("error_description") ?? searchParams.get("error");
    const suffix = detail ? `&detail=${encodeURIComponent(detail)}` : "";
    return NextResponse.redirect(`${origin}/login?error=oauth_failed${suffix}`);
  }

  const supabase = await createClient();
  const { data: exchanged, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.redirect(`${origin}/login?error=oauth_failed&detail=${encodeURIComponent(exchangeError.message)}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAllowedEmail(user?.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=not_allowed`);
  }

  // Conexión con OneDrive (repositorio de facturas): SOLO la sesión de admin@
  // (a quien info@ comparte la carpeta) se guarda cifrada. La de info@ nunca:
  // daría acceso a todo su OneDrive. Si falla, el login sigue adelante.
  const refreshToken = exchanged.session?.provider_refresh_token;
  if (refreshToken && user?.email && isGraphAccount(user.email)) {
    try {
      await saveGraphRefreshToken(user.email, refreshToken);
    } catch (e) {
      console.error("No se pudo guardar la conexión con OneDrive", e);
    }
  }
  return NextResponse.redirect(`${origin}/dashboard`);
}

import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Todo excepto assets estáticos y los crons (se autentican con CRON_SECRET,
    // no con sesión). Incluye /api/* a propósito: solo cuentas autorizadas.
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|robots.txt|api/cron/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

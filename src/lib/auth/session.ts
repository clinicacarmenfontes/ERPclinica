import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "./allowlist";

/**
 * Tercera barrera (tras el proxy y el callback de OAuth). La documentación de
 * Next 16 insiste: las Server Functions son POST a la ruta donde se usan y un
 * cambio del matcher del proxy las dejaría sin cobertura, así que cada página,
 * Server Action y Route Handler vuelve a comprobar la identidad.
 */
export async function getAdminUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user && isAllowedEmail(user.email) ? user : null;
}

/** Para páginas: sin sesión válida → /login. */
export async function requireAdminPage() {
  const user = await getAdminUser();
  if (!user) redirect("/login");
  return user;
}

/** Para Server Actions y Route Handlers: lanza si no es el administrador. */
export async function requireAdmin(): Promise<{ email: string }> {
  const user = await getAdminUser();
  if (!user?.email) throw new Error("No autorizado");
  return { email: user.email };
}

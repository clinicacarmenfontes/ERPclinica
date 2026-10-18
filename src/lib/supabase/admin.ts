import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./env";

/**
 * Cliente con la clave secreta (se salta RLS). En el ERP es la ÚNICA vía de
 * acceso a los datos: todas las tablas tienen RLS sin políticas. Solo se usa
 * en servidor y siempre después de requireAdmin()/requireAdminPage().
 *
 * Apunta al esquema `erp`: el ERP comparte proyecto Supabase con el CRM (que
 * vive en `public`) y nunca lee ni escribe sus tablas.
 */
export function createAdminClient() {
  const url = supabaseUrl();
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) throw new Error("Falta SUPABASE_SECRET_KEY");

  return createClient(url, secretKey, {
    db: { schema: "erp" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

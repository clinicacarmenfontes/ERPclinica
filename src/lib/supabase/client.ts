import { createBrowserClient } from "@supabase/ssr";

/** Cliente Supabase para el navegador (solo login). URL y clave llegan del servidor. */
export function createClient(config: { url: string; publishableKey: string }) {
  return createBrowserClient(config.url, config.publishableKey);
}

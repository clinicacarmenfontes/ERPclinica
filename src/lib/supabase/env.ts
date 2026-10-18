// Configuración de Supabase leída en el SERVIDOR en tiempo de ejecución.
// Sin prefijo NEXT_PUBLIC_: el equipo de Vercel obliga a que todas las
// variables sean secretas y esas no pueden llevar el prefijo público. El
// navegador solo necesita URL + clave publicable para el login, y se las pasa
// la página de login como props.

export function supabaseUrl(): string {
  const v = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!v) throw new Error("Falta SUPABASE_URL");
  return v;
}

export function supabasePublishableKey(): string {
  const v = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!v) throw new Error("Falta SUPABASE_PUBLISHABLE_KEY");
  return v;
}

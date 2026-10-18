// ÚNICOS usuarios de la app. Fijados en código a propósito: no hay variable de
// entorno que pueda ampliar el acceso por error. Para cambiarlos hay que
// desplegar una versión nueva (queda en el historial de git).
export const ALLOWED_EMAILS = ["admin@clinicacarmenfontes.com", "info@clinicacarmenfontes.com"] as const;

/**
 * Única cuenta cuya sesión de Microsoft se guarda para leer OneDrive. info@ puede
 * entrar al ERP, pero su credencial NO se guarda: es la dueña de la carpeta y
 * daría acceso a todo su OneDrive, no solo a «01. Facturas» compartida con admin@.
 */
export const GRAPH_ACCOUNT_EMAIL = "admin@clinicacarmenfontes.com";

export const isGraphAccount = (email: string | null | undefined) =>
  (email ?? "").trim().toLowerCase() === GRAPH_ACCOUNT_EMAIL;

export function isAllowedEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return (ALLOWED_EMAILS as readonly string[]).includes(e);
}

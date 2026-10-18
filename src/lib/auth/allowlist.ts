// ÚNICOS usuarios de la app. Fijados en código a propósito: no hay variable de
// entorno que pueda ampliar el acceso por error. Para cambiarlos hay que
// desplegar una versión nueva (queda en el historial de git).
export const ALLOWED_EMAILS = ["admin@clinicacarmenfontes.com", "info@clinicacarmenfontes.com"] as const;

export function isAllowedEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return (ALLOWED_EMAILS as readonly string[]).includes(e);
}

// ÚNICO usuario de la app. Fijado en código a propósito: no hay variable de
// entorno que pueda ampliar el acceso por error. Para cambiarlo hay que
// desplegar una versión nueva (queda en el historial de git).
export const ADMIN_EMAIL = "admin@clinicacarmenfontes.com";

export function isAllowedEmail(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === ADMIN_EMAIL;
}

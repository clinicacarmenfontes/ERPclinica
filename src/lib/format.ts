const eur2 = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
const eur0 = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

/** Contabilidad: siempre con céntimos. `compact` para KPIs (sin decimales). */
export function formatCurrency(amount: number | string | null | undefined, opts: { compact?: boolean } = {}): string {
  const n = Number(amount ?? 0);
  return (opts.compact ? eur0 : eur2).format(n);
}

/** '2026-09-30' → '30/09/2026'. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Marca de tiempo → '06/10/2026 14:32' en hora de Madrid. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

// Avisos de gastos recurrentes, por reglas (sin IA): un proveedor que factura
// casi todos los meses y en el último mes cargado no aparece, o aparece con un
// importe muy distinto del habitual. Solo se juzgan meses COMPLETOS según lo
// cargado (datos hasta…), para no avisar de lo que aún no se ha subido.

export type RecurringInvoice = { key: string; name: string; issueDate: string; total: number };

export type RecurringAlert = {
  kind: "falta" | "importe";
  key: string;
  name: string;
  /** Mes juzgado, 'AAAA-MM'. */
  month: string;
  /** Importe habitual (mediana de los meses anteriores). */
  expected: number;
  /** Importe del mes juzgado (solo «importe»). */
  actual?: number;
};

const HISTORY = 4; // meses anteriores que se miran
const MIN_PRESENT = 3; // presente en al menos 3 de esos 4 → mensual
const AMOUNT_TOLERANCE = 0.3; // ±30 %…
const AMOUNT_MIN_DIFF = 20; // …y al menos 20 € de diferencia

const monthOf = (iso: string) => iso.slice(0, 7);

function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Último mes entero cubierto por los datos cargados (null si ninguno). */
export function lastCompleteMonth(coveredUntil: string | null): string | null {
  if (!coveredUntil) return null;
  const month = monthOf(coveredUntil);
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Number(coveredUntil.slice(8, 10)) >= lastDay ? month : addMonths(month, -1);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Meses que hay que traer para evaluar: desde (último completo − 5) inclusive. */
export function recurringWindowStart(coveredUntil: string | null): string | null {
  const last = lastCompleteMonth(coveredUntil);
  return last ? `${addMonths(last, -(HISTORY + 1))}-01` : null;
}

export function detectRecurringAlerts(invoices: RecurringInvoice[], coveredUntil: string | null): RecurringAlert[] {
  const last = lastCompleteMonth(coveredUntil);
  if (!last) return [];

  const bySupplier = new Map<string, { name: string; months: Map<string, number> }>();
  for (const inv of invoices) {
    const s = bySupplier.get(inv.key) ?? { name: inv.name, months: new Map<string, number>() };
    const m = monthOf(inv.issueDate);
    s.months.set(m, (s.months.get(m) ?? 0) + inv.total);
    bySupplier.set(inv.key, s);
  }

  const alerts: RecurringAlert[] = [];
  // Se juzgan los dos últimos meses completos; un proveedor que falta en
  // ambos solo avisa una vez (del primero), porque exige estar en el mes previo.
  for (const target of [addMonths(last, -1), last]) {
    for (const [key, s] of bySupplier) {
      const history = Array.from({ length: HISTORY }, (_, i) => addMonths(target, -(i + 1)));
      const amounts = history.map((m) => s.months.get(m)).filter((v): v is number => v !== undefined);
      if (amounts.length < MIN_PRESENT || !s.months.has(history[0])) continue;
      const expected = round2(median(amounts));
      const actual = s.months.get(target);
      if (actual === undefined) {
        alerts.push({ kind: "falta", key, name: s.name, month: target, expected });
      } else if (
        Math.abs(actual - expected) > AMOUNT_MIN_DIFF &&
        Math.abs(actual - expected) > Math.abs(expected) * AMOUNT_TOLERANCE
      ) {
        alerts.push({ kind: "importe", key, name: s.name, month: target, expected, actual: round2(actual) });
      }
    }
  }
  return alerts.sort((a, b) => b.month.localeCompare(a.month) || Math.abs(b.expected) - Math.abs(a.expected));
}

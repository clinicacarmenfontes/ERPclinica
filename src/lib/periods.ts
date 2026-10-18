export type Quarter = { year: number; quarter: 1 | 2 | 3 | 4 };

/** Hoy en Madrid como 'AAAA-MM-DD'. */
export function todayMadrid(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
}

export function quarterOf(isoDate: string): Quarter {
  const [y, m] = isoDate.split("-").map(Number);
  return { year: y, quarter: (Math.floor((m - 1) / 3) + 1) as Quarter["quarter"] };
}

export function quarterRange({ year, quarter }: Quarter): { from: string; to: string } {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const mm = (n: number) => String(n).padStart(2, "0");
  return { from: `${year}-${mm(startMonth)}-01`, to: `${year}-${mm(endMonth)}-${mm(lastDay)}` };
}

export const quarterLabel = ({ year, quarter }: Quarter) => `${quarter}T ${year}`;
export const quarterParam = ({ year, quarter }: Quarter) => `${year}-${quarter}`;

/** '?t=2026-3' → { year: 2026, quarter: 3 }; si falta o no es válido, el trimestre actual. */
export function parseQuarterParam(value: unknown): Quarter {
  if (typeof value === "string") {
    const m = /^(\d{4})-([1-4])$/.exec(value);
    if (m) return { year: Number(m[1]), quarter: Number(m[2]) as Quarter["quarter"] };
  }
  return quarterOf(todayMadrid());
}

/** Los últimos `n` trimestres, del más reciente al más antiguo. */
export function recentQuarters(n = 8): Quarter[] {
  let { year, quarter } = quarterOf(todayMadrid());
  const out: Quarter[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ year, quarter });
    quarter = (quarter === 1 ? 4 : quarter - 1) as Quarter["quarter"];
    if (quarter === 4) year--;
  }
  return out;
}

import { formatDate } from "@/lib/format";

// Cashflow previsto por semanas a partir de lo pendiente (v_cashflow_projection:
// importes + cobros / − pagos por fecha prevista). Lo vencido cae en la 1.ª semana.

export type CashItem = { expected_date: string; amount: number };
export type CashWeek = { label: string; range: string; inflow: number; outflow: number; balance: number };

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const cents = (n: number) => Math.round(n * 100);

export function weeklyCashflow(items: CashItem[], today: string, startBalance: number, weeks: number): CashWeek[] {
  const out: CashWeek[] = [];
  let balance = cents(startBalance);
  for (let w = 0; w < weeks; w++) {
    const from = addDays(today, w * 7);
    const to = addDays(today, w * 7 + 6);
    const inWeek = items.filter((c) => c.expected_date <= to && (w === 0 || c.expected_date >= from));
    const inflow = inWeek.filter((c) => c.amount > 0).reduce((s, c) => s + cents(c.amount), 0);
    const outflow = inWeek.filter((c) => c.amount < 0).reduce((s, c) => s - cents(c.amount), 0);
    balance += inflow - outflow;
    out.push({
      label: `${from.slice(8, 10)}/${from.slice(5, 7)}`,
      range: `${formatDate(from)} – ${formatDate(to)}`,
      inflow: inflow / 100,
      outflow: outflow / 100,
      balance: balance / 100,
    });
  }
  return out;
}

export const cashflowHorizon = (today: string, weeks: number) => addDays(today, weeks * 7 - 1);

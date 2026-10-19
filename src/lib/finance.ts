// Cuenta de resultados de gestión (estimación) a partir de las facturas y las
// nóminas cargadas. Todo en base imponible (sin IVA) y en céntimos.
//
//   Ingresos (pacientes + otras clínicas)
//   − Coste directo (partida «Clínico»: material y laboratorio)
//   = Margen bruto
//   − Estructura (alquiler, suministros, marketing, software, servicios…)
//   − Personal (doctoras con retención + nóminas y SS empresa)
//   = EBITDA antes de la retribución de la socia
//   − Retribución de la socia
//   = EBITDA
// «Financiero e impuestos» (intereses, comisiones, tasas) queda fuera del
// EBITDA y se muestra aparte.

export type FinanceIncome = { date: string; base: number; kind: string };
export type FinanceExpense = { date: string; base: number; category: string | null };
export type FinancePayroll = { period: string; gross_salaries: number; company_social_security: number; partner_remuneration: number };

export const DIRECT_COST = "Clínico";
export const PERSONNEL = "Personal";
export const FINANCIAL = "Financiero e impuestos";

export type ProfitAndLoss = {
  ingresos: number;
  ingresosClinica: number;
  ingresosOtrasClinicas: number;
  costeDirecto: number;
  margenBruto: number;
  estructura: number;
  sinPartida: number;
  personalDoctoras: number;
  nominas: number;
  ebitdaAntesSocia: number;
  socia: number;
  ebitda: number;
  financiero: number;
  /** Meses del rango con nóminas cargadas / meses del rango. */
  mesesConNominas: number;
  meses: number;
  /** Meses del rango ('AAAA-MM') sin nóminas cargadas. */
  mesesSinNominas: string[];
  /** Gasto por partida (incluye nóminas y socia), de mayor a menor. */
  porPartida: { name: string; amount: number }[];
};

const c = (n: number) => Math.round(Number(n) * 100);
const e = (n: number) => n / 100;

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m === 13) {
      m = 1;
      y++;
    }
  }
  return out;
}

export function profitAndLoss(
  data: { income: FinanceIncome[]; expenses: FinanceExpense[]; payroll: FinancePayroll[] },
  from: string,
  to: string,
): ProfitAndLoss {
  const inRange = (d: string) => d >= from && d <= to;
  const income = data.income.filter((r) => inRange(r.date));
  const expenses = data.expenses.filter((r) => inRange(r.date));
  const months = monthsBetween(from, to);
  const payroll = data.payroll.filter((p) => months.includes(p.period));

  const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + c(f(x)), 0);
  const ingresosClinica = sum(income.filter((r) => r.kind === "paciente"), (r) => r.base);
  const ingresosOtras = sum(income.filter((r) => r.kind !== "paciente"), (r) => r.base);
  const ingresos = ingresosClinica + ingresosOtras;

  const byCat = new Map<string, number>();
  for (const r of expenses) {
    const k = r.category ?? "Sin partida";
    byCat.set(k, (byCat.get(k) ?? 0) + c(r.base));
  }
  const cat = (k: string) => byCat.get(k) ?? 0;
  const costeDirecto = cat(DIRECT_COST);
  const personalDoctoras = cat(PERSONNEL);
  const financiero = cat(FINANCIAL);
  const sinPartida = cat("Sin partida");
  const estructura = [...byCat]
    .filter(([k]) => k !== DIRECT_COST && k !== PERSONNEL && k !== FINANCIAL)
    .reduce((s, [, v]) => s + v, 0);
  const nominas = sum(payroll, (p) => p.gross_salaries) + sum(payroll, (p) => p.company_social_security);
  const socia = sum(payroll, (p) => p.partner_remuneration);

  const margenBruto = ingresos - costeDirecto;
  const ebitdaAntesSocia = margenBruto - estructura - personalDoctoras - nominas;
  const porPartida = [
    ...[...byCat].map(([name, amount]) => ({ name: name === PERSONNEL ? "Personal (doctoras con retención)" : name, amount })),
    { name: "Nóminas y SS empresa", amount: nominas },
    { name: "Retribución de la socia", amount: socia },
  ]
    .filter((p) => p.amount !== 0)
    .sort((a, b) => b.amount - a.amount)
    .map((p) => ({ name: p.name, amount: e(p.amount) }));

  return {
    ingresos: e(ingresos),
    ingresosClinica: e(ingresosClinica),
    ingresosOtrasClinicas: e(ingresosOtras),
    costeDirecto: e(costeDirecto),
    margenBruto: e(margenBruto),
    estructura: e(estructura),
    sinPartida: e(sinPartida),
    personalDoctoras: e(personalDoctoras),
    nominas: e(nominas),
    ebitdaAntesSocia: e(ebitdaAntesSocia),
    socia: e(socia),
    ebitda: e(ebitdaAntesSocia - socia),
    financiero: e(financiero),
    mesesConNominas: new Set(payroll.map((p) => p.period)).size,
    meses: months.length,
    mesesSinNominas: months.filter((m) => !payroll.some((p) => p.period === m)),
    porPartida,
  };
}

/** % sobre ingresos (null si no hay ingresos). */
export const share = (part: number, total: number) => (total ? Math.round((part / total) * 1000) / 10 : null);

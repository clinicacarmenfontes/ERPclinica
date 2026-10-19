import "server-only";
import type { FinanceExpense, FinanceIncome } from "@/lib/finance";
import { detectRecurringAlerts, recurringWindowStart, type RecurringAlert } from "@/lib/recurring";
import { createAdminClient } from "@/lib/supabase/admin";
import { monthlyTotals, type MonthlyTotals } from "./invoices";

// Todo lo que pinta el Resumen, en una sola carga en paralelo.

export type RecentInvoice = {
  id: string;
  direction: "emitida" | "recibida";
  invoice_number: string;
  issue_date: string;
  issuer_name: string;
  total: number;
  status: string;
  due_date: string | null;
  parties: { name: string } | null;
};

export type RecentBankTx = {
  id: string;
  booking_date: string;
  description: string;
  amount: number;
  bank_accounts: { name: string } | null;
};

export type PayrollMonth = {
  period: string;
  gross_salaries: number;
  company_social_security: number;
  partner_remuneration: number;
};

export type DashboardData = {
  months: MonthlyTotals[];
  prevMonths: MonthlyTotals[];
  payroll: PayrollMonth[];
  cashflow: { expected_date: string; direction: "emitida" | "recibida"; amount: number }[];
  bankBalance: { total: number; accounts: number; asOf: string | null } | null;
  recentInvoices: RecentInvoice[];
  recentBank: RecentBankTx[];
  alerts: RecurringAlert[];
  freshness: Record<string, string | null>;
  /** Facturas del año (base) para la cuenta de resultados. */
  finance: { income: FinanceIncome[]; expenses: FinanceExpense[] };
  reviewCount: number;
  conflictCount: number;
};

/** Todas las filas de una consulta, de 1.000 en 1.000 (límite de PostgREST). */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < 50; i++) {
    const { data, error } = await page(i * 1000, i * 1000 + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function loadDashboard(year: number): Promise<DashboardData> {
  const db = createAdminClient();

  const freshnessRes = await db
    .from("v_data_freshness")
    .select("kind, covered_until")
    .returns<{ kind: string; covered_until: string | null }[]>();
  if (freshnessRes.error) throw freshnessRes.error;
  const freshness = Object.fromEntries(freshnessRes.data.map((f) => [f.kind, f.covered_until]));
  const expensesUntil = freshness.optimydent_gastos ?? null;
  const windowStart = recurringWindowStart(expensesUntil);

  const [months, prevMonths, payroll, cashflow, latest, recentInvoices, recentBank, recurring, review, conflicts, income, expenses] =
    await Promise.all([
      monthlyTotals(year),
      monthlyTotals(year - 1),
      db
        .from("payroll_months")
        .select("period, gross_salaries, company_social_security, partner_remuneration")
        .like("period", `${year}-%`)
        .returns<PayrollMonth[]>(),
      db.from("v_cashflow_projection").select("expected_date, direction, amount").returns<DashboardData["cashflow"]>(),
      db.from("v_bank_latest_balance").select("booking_date, balance_after").returns<{ booking_date: string; balance_after: number }[]>(),
      db
        .from("invoices")
        .select("id, direction, invoice_number, issue_date, issuer_name, total, status, due_date, parties(name)")
        .neq("status", "anulada")
        .order("issue_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(8)
        .returns<RecentInvoice[]>(),
      db
        .from("bank_transactions")
        .select("id, booking_date, description, amount, bank_accounts(name)")
        .order("booking_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(8)
        .returns<RecentBankTx[]>(),
      windowStart
        ? db
            .from("invoices")
            .select("issuer_key, issuer_name, issue_date, total")
            .eq("direction", "recibida")
            .neq("status", "anulada")
            .gte("issue_date", windowStart)
            .range(0, 4999)
            .returns<{ issuer_key: string; issuer_name: string; issue_date: string; total: number }[]>()
        : Promise.resolve({ data: [], error: null }),
      db.from("invoices").select("id", { count: "exact", head: true }).eq("needs_review", true).neq("status", "anulada"),
      db.from("ingest_conflicts").select("id", { count: "exact", head: true }).eq("resolution", "pendiente"),
      fetchAll((from, to) =>
        db
          .from("invoices")
          .select("issue_date, base_total, parties(kind)")
          .eq("direction", "emitida")
          .neq("status", "anulada")
          .gte("issue_date", `${year}-01-01`)
          .lte("issue_date", `${year}-12-31`)
          .order("id")
          .range(from, to)
          .returns<{ issue_date: string; base_total: number; parties: { kind: string } | null }[]>(),
      ),
      fetchAll((from, to) =>
        db
          .from("invoices")
          .select("issue_date, base_total, expense_categories(name)")
          .eq("direction", "recibida")
          .neq("status", "anulada")
          .gte("issue_date", `${year}-01-01`)
          .lte("issue_date", `${year}-12-31`)
          .order("id")
          .range(from, to)
          .returns<{ issue_date: string; base_total: number; expense_categories: { name: string } | null }[]>(),
      ),
    ]);
  for (const r of [payroll, cashflow, latest, recentInvoices, recentBank, recurring, review, conflicts]) {
    if (r.error) throw r.error;
  }

  const balances = latest.data ?? [];
  return {
    months,
    prevMonths,
    payroll: (payroll.data ?? []).map((p) => ({
      ...p,
      gross_salaries: Number(p.gross_salaries),
      company_social_security: Number(p.company_social_security),
      partner_remuneration: Number(p.partner_remuneration),
    })),
    cashflow: (cashflow.data ?? []).map((c) => ({ ...c, amount: Number(c.amount) })),
    bankBalance: balances.length
      ? {
          total: balances.reduce((s, b) => s + Math.round(Number(b.balance_after) * 100), 0) / 100,
          accounts: balances.length,
          asOf: balances.map((b) => b.booking_date).sort()[0] ?? null,
        }
      : null,
    recentInvoices: (recentInvoices.data ?? []).map((i) => ({ ...i, total: Number(i.total) })),
    recentBank: (recentBank.data ?? []).map((t) => ({ ...t, amount: Number(t.amount) })),
    alerts: detectRecurringAlerts(
      (recurring.data ?? []).map((r) => ({ key: r.issuer_key, name: r.issuer_name, issueDate: r.issue_date, total: Number(r.total) })),
      expensesUntil,
    ),
    freshness,
    finance: {
      income: income.map((r) => ({ date: r.issue_date, base: Number(r.base_total), kind: r.parties?.kind ?? "paciente" })),
      expenses: expenses.map((r) => ({ date: r.issue_date, base: Number(r.base_total), category: r.expense_categories?.name ?? null })),
    },
    reviewCount: review.count ?? 0,
    conflictCount: conflicts.count ?? 0,
  };
}

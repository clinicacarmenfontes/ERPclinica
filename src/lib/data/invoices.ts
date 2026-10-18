import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type InvoiceRow = {
  id: string;
  direction: "emitida" | "recibida";
  invoice_number: string;
  issue_date: string;
  issuer_name: string;
  issuer_tax_id: string | null;
  base_total: number;
  vat_total: number;
  withholding_total: number;
  total: number;
  status: string;
  due_date: string | null;
  paid_amount: number;
  paid_at: string | null;
  payment_method: string | null;
  needs_review: boolean;
  review_reasons: string[];
  notes: string | null;
  parties: { name: string; tax_id: string | null } | null;
  expense_types: { name: string } | null;
  expense_categories: { name: string; color: string } | null;
};

const SELECT =
  "id, direction, invoice_number, issue_date, issuer_name, issuer_tax_id, base_total, vat_total, withholding_total, total, " +
  "status, due_date, paid_amount, paid_at, payment_method, needs_review, review_reasons, notes, " +
  "parties(name, tax_id), expense_types(name), expense_categories(name, color)";

export type InvoiceFilter = "todas" | "pendientes" | "revision" | "anuladas";

/** Facturas de un periodo. Pagina de 1.000 en 1.000 (límite de PostgREST). */
export async function listInvoices(opts: {
  direction: "emitida" | "recibida";
  from: string;
  to: string;
  filter: InvoiceFilter;
}): Promise<InvoiceRow[]> {
  const db = createAdminClient();
  const rows: InvoiceRow[] = [];
  for (let page = 0; page < 10; page++) {
    let q = db
      .from("invoices")
      .select(SELECT)
      .eq("direction", opts.direction)
      .gte("issue_date", opts.from)
      .lte("issue_date", opts.to)
      .order("issue_date", { ascending: false })
      .order("invoice_number", { ascending: false })
      .range(page * 1000, page * 1000 + 999);
    if (opts.filter === "pendientes") q = q.in("status", ["pendiente", "parcial"]);
    else if (opts.filter === "revision") q = q.eq("needs_review", true).neq("status", "anulada");
    else if (opts.filter === "anuladas") q = q.eq("status", "anulada");
    else q = q.neq("status", "anulada");
    const { data, error } = await q.returns<InvoiceRow[]>();
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

export type MonthlyTotals = {
  direction: "emitida" | "recibida";
  year: number;
  month: number;
  invoices: number;
  base: number;
  vat: number;
  withholding: number;
  total: number;
  outstanding: number;
  needs_review: number;
};

export async function monthlyTotals(year: number): Promise<MonthlyTotals[]> {
  const db = createAdminClient();
  const { data, error } = await db.from("v_invoice_monthly").select("*").eq("year", year).returns<MonthlyTotals[]>();
  if (error) throw error;
  return data.map((r) => ({
    ...r,
    base: Number(r.base),
    vat: Number(r.vat),
    withholding: Number(r.withholding),
    total: Number(r.total),
    outstanding: Number(r.outstanding),
  }));
}

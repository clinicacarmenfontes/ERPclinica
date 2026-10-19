"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

// Acciones sobre una factura desde los listados de Gastos e Ingresos. La
// lógica (lápida, rectificación del asiento, auditoría) vive en SQL.

type Result = { ok: true } | { ok: false; message: string };

const MIN_REASON = 10;

async function call(fn: string, args: Record<string, unknown>): Promise<Result> {
  const { error } = await createAdminClient().rpc(fn, args);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function markInvoiceReviewed(invoiceId: string, note: string): Promise<Result> {
  const { email } = await requireAdmin();
  return call("fn_mark_invoice_reviewed", { p_invoice: invoiceId, p_note: note, p_actor: email });
}

export async function voidInvoice(invoiceId: string, reason: string): Promise<Result> {
  const { email } = await requireAdmin();
  if (reason.trim().length < MIN_REASON) {
    return { ok: false, message: `Indica el motivo de la anulación (mín. ${MIN_REASON} caracteres).` };
  }
  return call("fn_void_invoice", { p_invoice: invoiceId, p_reason: reason, p_actor: email });
}

export type InvoiceForEdit = {
  id: string;
  direction: "emitida" | "recibida";
  invoice_number: string;
  issue_date: string;
  issuer_name: string;
  issuer_tax_id: string | null;
  review_reasons: string[];
  expense_type_id: string | null;
  posted: boolean;
  counterparty: { name: string; tax_id: string | null } | null;
  lines: { line_no: number; description: string | null; base: number; vat_rate: number; vat_amount: number; withholding_amount: number }[];
  expenseTypes: { id: string; name: string }[];
};

/** Datos de la factura para el diálogo «Corregir datos». */
export async function getInvoiceForEdit(invoiceId: string): Promise<{ ok: true; invoice: InvoiceForEdit } | { ok: false; message: string }> {
  await requireAdmin();
  const db = createAdminClient();
  const { data, error } = await db
    .from("invoices")
    .select(
      "id, direction, invoice_number, issue_date, issuer_name, issuer_tax_id, review_reasons, expense_type_id, journal_entry_id, " +
        "parties(name, tax_id), invoice_lines(line_no, description, base, vat_rate, vat_amount, withholding_amount)",
    )
    .eq("id", invoiceId)
    .single<{
      id: string;
      direction: "emitida" | "recibida";
      invoice_number: string;
      issue_date: string;
      issuer_name: string;
      issuer_tax_id: string | null;
      review_reasons: string[];
      expense_type_id: string | null;
      journal_entry_id: string | null;
      parties: { name: string; tax_id: string | null } | null;
      invoice_lines: InvoiceForEdit["lines"];
    }>();
  if (error) return { ok: false, message: error.message };
  let expenseTypes: InvoiceForEdit["expenseTypes"] = [];
  if (data.direction === "recibida") {
    const types = await db.from("expense_types").select("id, name").order("name").returns<{ id: string; name: string }[]>();
    if (types.error) return { ok: false, message: types.error.message };
    expenseTypes = types.data;
  }
  return {
    ok: true,
    invoice: {
      id: data.id,
      direction: data.direction,
      invoice_number: data.invoice_number,
      issue_date: data.issue_date,
      issuer_name: data.issuer_name,
      issuer_tax_id: data.issuer_tax_id,
      review_reasons: data.review_reasons,
      expense_type_id: data.expense_type_id,
      posted: data.journal_entry_id !== null,
      counterparty: data.parties,
      lines: [...data.invoice_lines]
        .sort((a, b) => a.line_no - b.line_no)
        .map((l) => ({
          ...l,
          base: Number(l.base),
          vat_rate: Number(l.vat_rate),
          vat_amount: Number(l.vat_amount),
          withholding_amount: Number(l.withholding_amount),
        })),
      expenseTypes,
    },
  };
}

export type InvoiceEdit = {
  invoice_number?: string;
  issue_date?: string;
  issuer_tax_id?: string;
  counterparty_tax_id?: string;
  counterparty_name?: string;
  expense_type_id?: string;
  remove_lines?: number[];
};

/** Corrige los campos indicados (fn_edit_invoice decide si anula y recrea). */
export async function editInvoice(invoiceId: string, changes: InvoiceEdit, reason: string): Promise<Result> {
  const { email } = await requireAdmin();
  if (Object.keys(changes).length === 0) return { ok: false, message: "No has cambiado nada." };
  if (changes.issue_date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(changes.issue_date)) {
    return { ok: false, message: "Indica una fecha válida." };
  }
  return call("fn_edit_invoice", { p_invoice: invoiceId, p: changes, p_reason: reason, p_actor: email });
}
